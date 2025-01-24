// src/chat.ts

import type { Database } from "bun:sqlite";
import type {
  Message as ChatMessage,
  ChatResponse,
  Ollama as OllamaClient,
  Options as OllamaOptions,
} from "ollama";
import { config } from "./config";
import { getOrInitUserDb, releaseUserDb } from "./db/sqlite";
import { chatWithModel } from "./llm-service/ollama";

export const getChatHistoryFromDb = async (
  userDb: Database,
  userId: string,
  chatIdentifier: string,
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
      content: config.systemPrompt,
    });
  }

  return chatHistory;
};

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

export const processUserMessage = async (
  userId: string,
  ollamaClient: OllamaClient,
  chatIdentifier: string,
  discordMessageContent: string,
  discordMessageTimestamp: Date,
  options: Partial<OllamaOptions>,
): Promise<string> => {
  let userDb: Database;
  try {
    userDb = await getOrInitUserDb(userId);
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
    await releaseUserDb(userId);
  }
  return response.message.content;
};
