// src/chat.ts

import type { Ollama } from "ollama";
import { config } from "./config";
import { getOrInitUserDb, releaseUserDb } from "./db/sqlite";
import type {
  ChatMessage,
  OllamaChatPrompt,
  OllamaModelOptions,
} from "./interfaces";
import { chatWithModel } from "./llm-service/ollama";

export const fetchChatHistory = async (
  userId: string,
  chatIdentifier: string,
): Promise<ChatMessage[]> => {
  const userDb = await getOrInitUserDb(userId);
  const chatHistory = userDb
    .query(`
      SELECT role, content
      FROM chat_messages
      WHERE chat_id = '${chatIdentifier}'
      ORDER BY timestamp ASC
    `)
    .all() as ChatMessage[];

  releaseUserDb(userId);

  // beginning of chat - set the system prompt
  if (chatHistory.length === 0) {
    chatHistory.push({
      role: "system",
      content: config.OLLAMA_MODEL_SYSTEM_PROMPT,
    });
  }

  return chatHistory;
};

export const saveChatMessage = async (
  userId: string,
  chatIdentifier: string,
  role: "user" | "assistant",
  content: string,
  timestamp?: Date,
): Promise<void> => {
  const query = timestamp
    ? "INSERT INTO chat_messages (chat_id, role, content, timestamp) VALUES (?, ?, ?, ?)"
    : "INSERT INTO chat_messages (chat_id, role, content) VALUES (?, ?, ?)";
  const params = timestamp
    ? [chatIdentifier, role, content, timestamp.toISOString()]
    : [chatIdentifier, role, content];

  const userDb = await getOrInitUserDb(userId);
  userDb.run(query, params);
  releaseUserDb(userId);
};

export const processUserMessage = async (
  userId: string,
  ollamaClient: Ollama,
  chatIdentifier: string,
  messageContent: string,
  messageTimestamp: Date,
  options: OllamaModelOptions,
): Promise<string> => {
  const currentChatMessages = await fetchChatHistory(userId, chatIdentifier);

  currentChatMessages.push({ role: "user", content: messageContent });

  const prompt: OllamaChatPrompt = {
    modelName: config.OLLAMA_MODEL,
    messages: currentChatMessages,
    options: options,
  };

  // could take a while, don't hold userDbCache lock here
  const response = await chatWithModel(ollamaClient, prompt);

  currentChatMessages.push({ role: "assistant", content: response });

  await saveChatMessage(
    userId,
    chatIdentifier,
    "user",
    messageContent,
    messageTimestamp,
  );
  await saveChatMessage(userId, chatIdentifier, "assistant", response);

  return response;
};
