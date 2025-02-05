// src/backend/chat.ts

import type { Database } from "bun:sqlite";
import type Exa from "exa-js";
import type OpenAI from "openai";
import { getOrInitUserDb, releaseUserDb } from "../db/sqlite";
import type {
  ChatThreadInfo,
  DbCache,
  ExpandedChatParameters,
  ProcessedMessageContent,
} from "../interfaces";
import { chatWithModel } from "./llm-service";
import { processToolCalls } from "./tools";
import {
  extractMessageContent,
  formatModelResponse,
  getChatHistoryFromDb,
  processOpenRouterContent,
  saveChatMessageToDb,
} from "./utils";

/**
 * Extracts and processes content from model response choices.
 * Handles different types of responses including content filtering, tool calls,
 * and OpenRouter style responses.
 *
 * @param {OpenAI.ChatCompletion.Choice[]} choices - Choices from chat
 *   completion
 * @param {OpenAI.ChatCompletionMessageParam[]} currentChatMessages - Current
 *   chat history
 * @param {Exa | undefined} exaClient - Optional authenticated Exa client for
 *   web searches
 * @param {OpenAI} modelClient - Authenticated OpenAI client
 * @param {string} model - Model name
 * @param {Partial<ExpandedChatParameters>} modelOptions - Model parameters
 * @param {Database} userDb - User DB connection
 * @param {string} userId - Discord user ID
 * @param {string} chatId - Chat session ID
 * @returns {Promise<ProcessedMessageContent>} The final processed response
 */
export const extractChoiceContent = async (
  choices: OpenAI.ChatCompletion.Choice[],
  timestamp: Date,
  currentChatMessages: OpenAI.ChatCompletionMessageParam[],
  exaClient: Exa | undefined,
  modelClient: OpenAI,
  model: string,
  modelOptions: Partial<ExpandedChatParameters>,
  userDb: Database,
  userId: string,
  chatId: string,
): Promise<ProcessedMessageContent> => {
  if (!choices.length) {
    console.warn("Received empty choices array in model response");
    return {
      timestamp: timestamp,
      msgContent: "No response was generated",
      reasoningContent: undefined,
    };
  }

  const firstChoice = choices[0] as OpenAI.ChatCompletion.Choice;

  // Handle content filter
  if (firstChoice.finish_reason === "content_filter") {
    return {
      timestamp: timestamp,
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
        timestamp: timestamp,
        msgContent: "Tool calls requested but no tool clients available",
        reasoningContent: undefined,
      };
    }

    currentChatMessages.push(firstChoice.message);
    await saveChatMessageToDb(
      userDb,
      userId,
      chatId,
      "assistant",
      firstChoice.message.content || "",
      timestamp,
      null,
      firstChoice.message.tool_calls,
    );

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
  return processOpenRouterContent(
    timestamp,
    msgContent,
    reasoningContent,
    choices.slice(1),
  );
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
 * @param {string} dbDir - Directory path where database files are stored
 * @param {number} dbConnectionCacheSize - Desired maximum number of database
 *   connections to keep in cache
 * @param {string} systemPrompt - System prompt to prepend to chat history
 * @param {string} discordMessageContent - User message content
 * @param {Date} discordMessageTimestamp - User message timestamp
 * @param {OpenAI} modelClient - Authenticated OpenAI client
 * @param {string} model - Model name
 * @param {boolean} useTools - Whether to allow the model to use tools
 * @param {Exa | undefined} exaClient - Optional authenticated Exa client for
 *   web searches
 * @returns {Promise<string>} The final processed response
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
  let formattedModelResponse: string;
  try {
    // TODO: need to put a cache layer in front of this at some point
    const currentChatMessages = await getChatHistoryFromDb(
      userDb,
      chatThreadInfo.userId,
      chatThreadInfo.chatId,
      systemPrompt,
    );

    console.debug("\n----------");
    console.debug("Current chat messages from DB:");
    console.debug(currentChatMessages);

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

    const extractedChoiceContent = await extractChoiceContent(
      response.choices,
      new Date(response.created * 1000),
      currentChatMessages,
      exaClient,
      modelClient,
      model,
      chatThreadInfo.modelOptions,
      userDb,
      chatThreadInfo.userId,
      chatThreadInfo.chatId,
    );

    formattedModelResponse = formatModelResponse(
      extractedChoiceContent.msgContent as string,
      extractedChoiceContent.reasoningContent,
    );

    console.debug("\n----------");
    console.debug("Current chat messages:");
    console.debug(currentChatMessages);
    console.debug("\n----------");
    console.debug("Response from model:");
    console.debug(formattedModelResponse);

    currentChatMessages.push({
      role: "assistant",
      content: formattedModelResponse,
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
      formattedModelResponse,
      extractedChoiceContent.timestamp,
      null,
    );
  } catch (error) {
    console.error(
      `Error processing user message for ${chatThreadInfo.userId} in chat \
${chatThreadInfo.chatId}:`,
      error,
    );
    throw error;
  } finally {
    await releaseUserDb(chatThreadInfo.userId, userDbCache);
  }

  return formattedModelResponse;
};
