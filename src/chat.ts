// src/chat.ts

import type { Database } from "bun:sqlite";
import Exa from "exa-js";
import type OpenAI from "openai";
import type { ChatThymeConfig } from "./config/schema";
import { getOrInitUserDb, releaseUserDb } from "./db/sqlite";
import type { ChatParameters, dbCache } from "./interfaces";
import { chatWithModel } from "./llm-service";
import { processExaSearchCall } from "./tools";

/**
 * Retrieves chat history for a specific user and chat from the database and
 * prepends the system prompt.
 *
 * @param userDb - SQLite database instance for the user
 * @param userId - Unique identifier for the user
 * @param chatId - Unique identifier for the chat session
 * @param systemPrompt - System prompt to prepend to the chat history
 * @returns {Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]>}
 * Array of messages in OpenAI chat format
 * @throws {Error} If database query fails
 */
export const getChatHistoryFromDb = async (
  userDb: Database,
  userId: string,
  chatId: string,
  systemPrompt: string,
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> => {
  let chatHistory: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  try {
    chatHistory = userDb
      .query(`
      SELECT role, content
      FROM chat_messages
      WHERE chat_id = ?
      ORDER BY id ASC
    `)
      .all(chatId) as OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  } catch (error) {
    console.error(
      `Error getting chat history from database for ${userId} in chat \
${chatId}:`,
      error,
    );
    throw error;
  }

  // inject system prompt
  chatHistory.unshift({
    role: "system",
    content: systemPrompt,
  });

  return chatHistory;
};

/**
 * Saves a chat message to the user's SQLite database.
 *
 * @param userDb - SQLite database instance for the user
 * @param userId - Unique identifier for the user
 * @param chatId - Unique identifier for the chat session
 * @param role - Role of the message sender
 * @param content - Message content
 * @param timestamp - Message timestamp
 * @throws {Error} If database insertion fails
 */
export const saveChatMessageToDb = async (
  userDb: Database,
  userId: string,
  chatId: string,
  role: "user" | "assistant",
  content: string,
  timestamp: Date,
): Promise<void> => {
  try {
    userDb.run(
      "INSERT INTO chat_messages (chat_id, role, content, timestamp) VALUES (?, ?, ?, ?)",
      [chatId, role, content, timestamp.toISOString()],
    );
  } catch (error) {
    console.error(
      `Error saving chat message to database for ${userId} in chat ${chatId}:`,
      error,
    );
    throw error;
  }
};

const processToolCalls = async (
  currentChatMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[],
  exaClient: Exa,
  modelClient: OpenAI,
  config: ChatThymeConfig,
  options: Partial<ChatParameters>,
): Promise<string> => {
  let response: OpenAI.Chat.ChatCompletion;
  let responseReasoning = "";
  let responseContent = "";
  try {
    const toolCallMsgs = await processExaSearchCall(toolCalls, exaClient);
    currentChatMessages.push(...toolCallMsgs);
    currentChatMessages.push({
      role: "user",
      content: "Answer my previous query based on the search results.",
    });
    response = await chatWithModel(
      modelClient,
      {
        modelName: config.model,
        messages: currentChatMessages,
      },
      options,
    );
    console.debug("tool call debug");
    console.debug(currentChatMessages);
    console.debug(response);
    console.debug(response.choices);
    console.debug(response.choices[0].message.content);
    for (const choice of response.choices) {
      if (!responseReasoning) {
        if ("reasoning" in choice.message && choice.message.reasoning) {
          responseReasoning = choice.message.reasoning as string;
        } else if (
          "reasoning_content" in choice.message &&
          choice.message.reasoning_content
        ) {
          responseReasoning = choice.message.reasoning_content as string;
        }
      }

      if (!responseContent && choice.message.content) {
        responseContent = choice.message.content;
        break;
      }
    }
    return responseContent;
  } catch (error) {
    console.error("Error processing tool calls:", error);
    throw error;
  }
};

/**
 * Processes a user message through the OpenAI API and saves the conversation to the database.
 * Handles the entire flow of:
 * 1. Getting/initializing the user's database
 * 2. Retrieving chat history
 * 3. Sending request to OpenAI
 * 4. Saving both user message and AI response
 *
 * @param userId - Unique identifier for the user
 * @param modelClient - LLM service client
 * @param chatId - Unique identifier for the chat session
 * @param discordMessageContent - User message content
 * @param discordMessageTimestamp - User message timestamp
 * @param options - Additional options/params for chat completion request
 * @param config - Chat Thyme configuration
 * @param userDbCache - Database connection cache
 * @returns {Promise<string>} The model's response text
 * @throws {Error} If database operations or model client API call fails
 */
export const processUserMessage = async (
  userId: string,
  modelClient: OpenAI,
  chatId: string,
  discordMessageContent: string,
  discordMessageTimestamp: Date,
  options: Partial<ChatParameters>,
  config: ChatThymeConfig,
  userDbCache: dbCache,
): Promise<string> => {
  const exaClient = new Exa(config.exaApiKey);
  let userDb: Database;
  try {
    userDb = await getOrInitUserDb(userId, config, userDbCache);
  } catch (error) {
    console.error(
      `Error getting/initializing user database for ${userId}:`,
      error,
    );
    throw error;
  }

  let response: OpenAI.Chat.ChatCompletion;
  let responseReasoning = "";
  let responseContent = "";
  try {
    const currentChatMessages = await getChatHistoryFromDb(
      userDb,
      userId,
      chatId,
      config.systemPrompt,
    );

    currentChatMessages.push({ role: "user", content: discordMessageContent });

    // could take a while, don't hold userDbCache lock here
    response = await chatWithModel(
      modelClient,
      {
        modelName: config.model,
        messages: currentChatMessages,
      },
      options,
    );
    console.debug(currentChatMessages);

    for (const choice of response.choices) {
      if (!responseReasoning) {
        if ("reasoning" in choice.message && choice.message.reasoning) {
          responseReasoning = choice.message.reasoning as string;
        } else if (
          "reasoning_content" in choice.message &&
          choice.message.reasoning_content
        ) {
          responseReasoning = choice.message.reasoning_content as string;
        }
      }

      if (choice.message.tool_calls) {
        responseContent = await processToolCalls(
          currentChatMessages,
          choice.message.tool_calls,
          exaClient,
          modelClient,
          config,
          options,
        );
      }

      if (!responseContent && choice.message.content) {
        responseContent = choice.message.content;
        break;
      }
    }

    console.debug(`Response from model: ${responseContent}`);

    currentChatMessages.push({
      role: "assistant",
      content: responseContent,
    });

    await saveChatMessageToDb(
      userDb,
      userId,
      chatId,
      "user",
      discordMessageContent,
      discordMessageTimestamp,
    );
    await saveChatMessageToDb(
      userDb,
      userId,
      chatId,
      "assistant",
      responseContent,
      new Date(response.created * 1000),
    );
  } catch (error) {
    console.error(
      `Error processing user message for ${userId} in chat ${chatId}:`,
      error,
    );
    throw error;
  } finally {
    await releaseUserDb(userId, userDbCache);
  }
  return responseReasoning
    ? `<thinking>\n${responseReasoning}</thinking>\n${responseContent}`
    : responseContent;
};
