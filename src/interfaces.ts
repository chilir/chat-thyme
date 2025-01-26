// src/interfaces.ts

import type { Database } from "bun:sqlite";
import type { Mutex } from "async-mutex";
import type { Message as DiscordMessage } from "discord.js";
import type { Message as ChatMessage, Options as OllamaOptions } from "ollama";

export interface OllamaChatPrompt {
  modelName: string;
  messages: ChatMessage[];
  options: Partial<OllamaOptions>;
}

export interface ChatIdExistence {
  exists: number; // 1 if exists, 0 if not
}

export interface dbCache {
  cache: Map<string, DbCacheEntry>;
  mutex: Mutex;
  checkIntervalId: ReturnType<typeof setInterval> | undefined;
}

export interface DbCacheEntry {
  filePath: string;
  db: Database;
  lastAccessed: number;
  refCount: number;
}

export interface ChatThreadInfo {
  chatId: string;
  userId: string;
  modelOptions: Partial<OllamaOptions>;
}

export interface ChatMessageQueue {
  queue: DiscordMessage[];
  stopSignal: boolean;
}
