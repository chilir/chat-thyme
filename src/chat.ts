// src/chat.ts

import type { Database } from "bun:sqlite";
import type { Ollama } from "ollama";
import { config } from "./config";
import type {
  ChatMessage,
  OllamaChatPrompt,
  OllamaModelOptions,
} from "./interfaces";
import { chatWithModel } from "./llm-service/ollama";

export const fetchChatHistory = async (
  db: Database,
  chatIdentifier: string,
): Promise<ChatMessage[]> => {
  const chatHistory = db
    .query(`
      SELECT role, content
      FROM chat_messages
      WHERE chat_id = '${chatIdentifier}'
      ORDER BY timestamp ASC
    `)
    .all() as ChatMessage[];

  if (chatHistory.length === 0) {
    chatHistory.push({
      role: "system",
      content: config.OLLAMA_MODEL_SYSTEM_PROMPT,
    });
  }

  return chatHistory;
};

export const saveChatMessage = async (
  db: Database,
  chatIdentifier: string,
  role: "user" | "assistant",
  content: string,
): Promise<void> => {
  db.run(
    "INSERT INTO chat_messages (chat_id, role, content) VALUES (?, ?, ?)",
    [chatIdentifier, role, content],
  );
};

export const processUserMessage = async (
  db: Database,
  ollamaClient: Ollama,
  chatIdentifier: string,
  messageContent: string,
  options: OllamaModelOptions,
): Promise<string> => {
  const currentChatMessages = await fetchChatHistory(db, chatIdentifier);

  currentChatMessages.push({ role: "user", content: messageContent });

  const prompt: OllamaChatPrompt = {
    modelName: config.OLLAMA_MODEL,
    messages: currentChatMessages,
    options: options,
  };

  const response = await chatWithModel(ollamaClient, prompt);

  currentChatMessages.push({ role: "assistant", content: response });

  await saveChatMessage(db, chatIdentifier, "user", messageContent);
  await saveChatMessage(db, chatIdentifier, "assistant", response);

  return response;
};
