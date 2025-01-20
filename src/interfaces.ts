// src/interfaces.ts

import type { Database } from "bun:sqlite";

export interface OllamaModelOptions {
  temperature?: number;
  topK?: number;
  topP?: number;
  repeatPenalty?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  numCtx?: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OllamaChatPrompt {
  modelName: string;
  messages: ChatMessage[];
  options: OllamaModelOptions;
}

export interface ChatIdExistence {
  exists: number; // 1 if exists, 0 if not
}

export interface DbCacheEntry {
  dbFilePath: string;
  dbObj: Database;
  lastAccessed: number;
}
