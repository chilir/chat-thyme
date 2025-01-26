// src/chat.ts

import type { Database } from "bun:sqlite";
import type {
  Message as ChatMessage,
  ChatResponse,
  Ollama as OllamaClient,
  Options as OllamaOptions,
} from "ollama";
import type { ChatThymeConfig } from "./config/schema";
import { getOrInitUserDb, releaseUserDb } from "./db/sqlite";
import type { dbCache } from "./interfaces";
import { chatWithModel } from "./llm-service/ollama";

/**
 * Retrieves chat history for a specific user and chat from the database
 * @param userDb - SQLite database instance for the user
 * @param userId - Unique identifier for the user
 * @param chatIdentifier - Unique identifier for the chat session
 * @param systemPrompt - System prompt to be used if chat history is empty
 * @returns Array of chat messages
 * @throws {Error} If database query fails
 */
export const getChatHistoryFromDb = async (
  userDb: Database,
  userId: string,
  chatIdentifier: string,
  systemPrompt: string,
): Promise<ChatMessage[]> => {
  let chatHistory: ChatMessage[];
  try {
    chatHistory = userDb
      .query(`
      SELECT role, content
      FROM chat_messages
      WHERE chat_id = ?
      ORDER BY timestamp ASC
    `)
      .all(chatIdentifier) as ChatMessage[];
  } catch (error) {
    console.error(
      `Error getting chat history from database for ${userId} in chat ${chatIdentifier}:`,
      error,
    );
    throw error;
  }

  // beginning of chat - set the system prompt
  if (chatHistory.length === 0) {
    chatHistory.push({
      role: "system",
      content: systemPrompt,
    });
  }

  return chatHistory;
};

/**
 * Saves a chat message to the user's database
 * @param userDb - SQLite database instance for the user
 * @param userId - Unique identifier for the user
 * @param chatIdentifier - Unique identifier for the chat session
 * @param role - Role of the message sender ("user" or "assistant")
 * @param content - Content of the message
 * @param timestamp - Timestamp of when the message was sent
 * @throws {Error} If database insertion fails
 */
export const saveChatMessageToDb = async (
  userDb: Database,
  userId: string,
  chatIdentifier: string,
  role: "user" | "assistant",
  content: string,
  timestamp: Date,
): Promise<void> => {
  try {
    userDb.run(
      "INSERT INTO chat_messages (chat_id, role, content, timestamp) VALUES (?, ?, ?, ?)",
      [chatIdentifier, role, content, timestamp.toISOString()],
    );
  } catch (error) {
    console.error(
      `Error saving chat message to database for ${userId} in chat ${chatIdentifier}:`,
      error,
    );
    throw error;
  }
};

/**
 * Processes a user message through the LLM model and saves the conversation to
 * the database
 * @param userId - Unique identifier for the user
 * @param ollamaClient - Ollama client instance
 * @param chatIdentifier - Unique identifier for the chat session
 * @param discordMessageContent - Content of the user's message
 * @param discordMessageTimestamp - Timestamp of the user's message
 * @param options - Ollama model options
 * @param config - Chat-Thyme configuration
 * @param userDbCache - Database cache object
 * @returns The AI model's response content
 * @throws {Error} If database operations or model interaction fails
 */
export const processUserMessage = async (
  userId: string,
  ollamaClient: OllamaClient,
  chatIdentifier: string,
  discordMessageContent: string,
  discordMessageTimestamp: Date,
  options: Partial<OllamaOptions>,
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

  let response: ChatResponse;
  try {
    const currentChatMessages = await getChatHistoryFromDb(
      userDb,
      userId,
      chatIdentifier,
      config.systemPrompt,
    );

    currentChatMessages.push({ role: "user", content: discordMessageContent });

    // could take a while, don't hold userDbCache lock here
    response = await chatWithModel(ollamaClient, {
      modelName: config.model,
      messages: currentChatMessages,
      options: options,
    });

    currentChatMessages.push({
      role: "assistant",
      content: response.message.content,
    });

    await saveChatMessageToDb(
      userDb,
      userId,
      chatIdentifier,
      "user",
      discordMessageContent,
      discordMessageTimestamp,
    );
    await saveChatMessageToDb(
      userDb,
      userId,
      chatIdentifier,
      "assistant",
      response.message.content,
      new Date(response.created_at), // NOTE: this is a string, needs to be wrapped in new Date()
    );
  } catch (error) {
    console.error(
      `Error processing user message for ${userId} in chat ${chatIdentifier}:`,
      error,
    );
    throw error;
  } finally {
    await releaseUserDb(userId, userDbCache);
  }
  return response.message.content;
};
