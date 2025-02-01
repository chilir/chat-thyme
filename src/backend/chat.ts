// src/backend/chat.ts

import type { Database } from "bun:sqlite";
import type Exa from "exa-js";
import type OpenAI from "openai";
import { getOrInitUserDb, releaseUserDb } from "../db/sqlite";
import type {
  ChatParameters,
  ChatThreadInfo,
  DbCache,
  ProcessedMessageContent,
} from "../interfaces";
import { chatWithModel } from "./llm-service";
import { processToolCalls } from "./tools";
import {
  extractMessageContent,
  formatResponse,
  getChatHistoryFromDb,
  processOpenRouterContent,
  saveChatMessageToDb,
} from "./utils";

/**
 * Extracts and processes content from model response choices.
 * Handles different types of responses including content filtering, tool calls,
 * and OpenRouter style responses.
 *
 * @param {OpenAI.Chat.Completions.ChatCompletion.Choice[]} choices - Array of response choices from the model
 * @param {OpenAI.Chat.Completions.ChatCompletionMessageParam[]} currentChatMessages - Current conversation history
 * @param {Exa | undefined} exaClient - Optional Exa client for web searches
 * @param {OpenAI} modelClient - OpenAI client instance
 * @param {string} model - Name of the model being used
 * @param {Partial<ChatParameters>} modelOptions - Model configuration parameters
 * @param {Database} userDb - User's database instance
 * @param {string} userId - Unique identifier for the user
 * @param {string} chatId - Unique identifier for the chat session
 * @returns {Promise<ProcessedMessageContent>} Processed content from the model response
 */
export const extractChoiceContent = async (
  choices: OpenAI.Chat.Completions.ChatCompletion.Choice[],
  currentChatMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  exaClient: Exa | undefined,
  modelClient: OpenAI,
  model: string,
  modelOptions: Partial<ChatParameters>,
  userDb: Database,
  userId: string,
  chatId: string,
): Promise<ProcessedMessageContent> => {
  if (!choices.length) {
    console.warn("Received empty choices array in model response");
    return {
      msgContent: "No response was generated",
      reasoningContent: undefined,
    };
  }

  const firstChoice =
    choices[0] as OpenAI.Chat.Completions.ChatCompletion.Choice;

  // Handle content filter
  if (firstChoice.finish_reason === "content_filter") {
    return {
      msgContent: "Content was filtered",
      reasoningContent: undefined,
    };
  }

  // Handle tool calls
  if (
    firstChoice.message.tool_calls &&
    firstChoice.message.tool_calls.length > 0
  ) {
    if (!exaClient) {
      return {
        msgContent: "Tool calls requested but no tool clients available",
        reasoningContent: undefined,
      };
    }

    return await processToolCalls(
      firstChoice.message.tool_calls,
      exaClient,
      currentChatMessages,
      modelClient,
      model,
      modelOptions,
      userDb,
      userId,
      chatId,
    );
  }

  // Handle OpenRouter style separate reasoning/content choices
  const { msgContent, reasoningContent } = extractMessageContent(
    firstChoice.message,
  );

  return processOpenRouterContent(msgContent, reasoningContent, choices);
};

/**
 * Processes a user message through the chat system.
 * This function handles the complete flow of:
 * 1. Getting chat history from database
 * 2. Sending the message to the model
 * 3. Processing the model's response
 * 4. Saving the conversation to database
 * 5. Formatting the final response
 *
 * @param {ChatThreadInfo} chatThreadInfo - Information about the chat thread
 * @param {DbCache} userDbCache - Database connection cache
 * @param {string} dbDir - Directory path for database files
 * @param {number} dbConnectionCacheSize - Maximum number of cached database connections
 * @param {string} systemPrompt - System prompt to prepend to chat history
 * @param {string} discordMessageContent - The user's message content
 * @param {Date} discordMessageTimestamp - Timestamp of the user's message
 * @param {OpenAI} modelClient - OpenAI client instance
 * @param {string} model - Name of the model to use
 * @param {boolean} useTools - Whether to allow the model to use tools
 * @param {Exa | undefined} exaClient - Optional Exa client for web searches
 * @returns {Promise<string>} Formatted response message
 * @throws Will throw an error if message processing fails
 */
export const processUserMessage = async (
  chatThreadInfo: ChatThreadInfo,
  userDbCache: DbCache,
  dbDir: string,
  dbConnectionCacheSize: number,
  systemPrompt: string,
  discordMessageContent: string,
  discordMessageTimestamp: Date,
  modelClient: OpenAI,
  model: string,
  useTools: boolean,
  exaClient: Exa | undefined,
): Promise<string> => {
  const userDb = await getOrInitUserDb(
    chatThreadInfo.userId,
    userDbCache,
    dbDir,
    dbConnectionCacheSize,
  );

  let response: OpenAI.Chat.ChatCompletion;
  const responseContent = "";
  let formattedContent: string;
  try {
    // TODO: need to put a cache layer in front of this at some point
    const currentChatMessages = await getChatHistoryFromDb(
      userDb,
      chatThreadInfo.userId,
      chatThreadInfo.chatId,
      systemPrompt,
    );

    currentChatMessages.push({ role: "user", content: discordMessageContent });

    response = await chatWithModel(
      modelClient,
      {
        modelName: model,
        messages: currentChatMessages,
        useTools: useTools,
      },
      chatThreadInfo.modelOptions,
    );
    console.debug(currentChatMessages);

    const result = await extractChoiceContent(
      response.choices,
      currentChatMessages,
      exaClient,
      modelClient,
      model,
      chatThreadInfo.modelOptions,
      userDb,
      chatThreadInfo.userId,
      chatThreadInfo.chatId,
    );

    formattedContent = formatResponse(
      result.msgContent as string,
      result.reasoningContent,
    );

    console.debug(`Response from model: ${formattedContent}`);

    currentChatMessages.push({
      role: "assistant",
      content: formattedContent,
    });

    await saveChatMessageToDb(
      userDb,
      chatThreadInfo.userId,
      chatThreadInfo.chatId,
      "user",
      discordMessageContent,
      discordMessageTimestamp,
    );
    await saveChatMessageToDb(
      userDb,
      chatThreadInfo.userId,
      chatThreadInfo.chatId,
      "assistant",
      formattedContent, // Save the formatted content with reasoning included
      new Date(response.created * 1000),
    );
  } catch (error) {
    console.error(
      `Error processing user message for ${chatThreadInfo.userId} in chat ${chatThreadInfo.chatId}:`,
      error,
    );
    throw error;
  } finally {
    await releaseUserDb(chatThreadInfo.userId, userDbCache);
  }

  return formattedContent;
};
