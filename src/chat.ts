// src/chat.ts

import type { Database } from "bun:sqlite";
import { config } from "./config";
import type {
  ChatMessage,
  OllamaChatPrompt,
  OllamaModelOptions,
} from "./interfaces";
import { chatWithModel } from "./llm-service/ollama";
import type { Ollama } from "ollama";

export const fetchChatHistory = async (
  db: Database,
  threadId: string,
): Promise<ChatMessage[]> => {
  const chatHistory = db
    .query(`
      SELECT role, content
      FROM chat_messages
      WHERE thread_id = '${threadId}'
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
  threadId: string,
  role: "user" | "assistant",
  content: string,
): Promise<void> => {
  db.run(
    "INSERT INTO chat_messages (thread_id, role, content) VALUES (?, ?, ?)",
    [threadId, role, content],
  );
};

export const processUserMessage = async (
  db: Database,
  ollamaClient: Ollama,
  threadId: string,
  messageContent: string,
  options: OllamaModelOptions,
): Promise<void> => {
  const currentChatMessages = await fetchChatHistory(db, threadId);

  currentChatMessages.push({ role: "user", content: messageContent });

  const prompt: OllamaChatPrompt = {
    modelName: config.OLLAMA_MODEL,
    messages: currentChatMessages,
    options: options,
  };

  const response = await chatWithModel(ollamaClient, prompt);

  currentChatMessages.push({ role: "assistant", content: response });

  await saveChatMessage(db, threadId, "user", messageContent);
  await saveChatMessage(db, threadId, "assistant", response);
};
