// src/interfaces.ts

import type { Database } from "bun:sqlite";
import type { Options } from "ollama";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OllamaChatPrompt {
  modelName: string;
  messages: ChatMessage[];
  options: Partial<Options>;
}

export interface ChatIdExistence {
  exists: number; // 1 if exists, 0 if not
}

export interface DbCacheEntry {
  dbFilePath: string;
  dbObj: Database;
  lastAccessed: number;
  refCount: number;
}
