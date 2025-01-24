// src/interfaces.ts

import type { Database } from "bun:sqlite";
import type { Message, Options } from "ollama";

export interface OllamaChatPrompt {
  modelName: string;
  messages: Message[];
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
