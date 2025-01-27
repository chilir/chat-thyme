// src/chat.ts

import type { Database } from "bun:sqlite";
import type OpenAI from "openai";
import type { ChatThymeConfig } from "./config/schema";
import { getOrInitUserDb, releaseUserDb } from "./db/sqlite";
import type { dbCache } from "./interfaces";
import { chatWithModel } from "./llm-service";

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
      ORDER BY timestamp ASC
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
 * @param config - Chat Thyme confiugration
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
  options: Partial<OpenAI.Chat.ChatCompletionCreateParams>,
  config: ChatThymeConfig,
  userDbCache: dbCache,
): Promise<string> => {
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
  try {
    const currentChatMessages = await getChatHistoryFromDb(
      userDb,
      userId,
      chatId,
      config.systemPrompt,
    );

    currentChatMessages.push({ role: "user", content: discordMessageContent });

    // could take a while, don't hold userDbCache lock here
    response = await chatWithModel(modelClient as OpenAI, {
      modelName: config.model,
      messages: currentChatMessages,
      ...options,
    });

    currentChatMessages.push({
      role: "assistant",
      content: response.choices[0]?.message.content,
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
      response.choices[0]?.message.content as string,
      new Date(response.created),
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
  return response.choices[0]?.message.content as string;
};
