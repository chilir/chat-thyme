// src/interfaces.ts

import type { Database } from "bun:sqlite";
import type { Mutex } from "async-mutex";
import type {
  Client as DiscordClient,
  Message as DiscordMessage,
} from "discord.js";
import type Exa from "exa-js";
import type OpenAI from "openai";

// Database related interfaces
export interface dbCache {
  cache: Map<string, DbCacheEntry>;
  mutex: Mutex;
  evictionInterval: ReturnType<typeof setInterval> | undefined;
}

export interface DbCacheEntry {
  filePath: string;
  db: Database;
  lastAccessed: number;
  refCount: number;
}

// Client interfaces
export interface ChatThymeClients {
  modelClient: OpenAI;
  discordClient: DiscordClient;
  exaClient: Exa | undefined;
}

// Discord chat thread management interfaces
export interface ChatIdExistence {
  exists: number; // 1 if exists, 0 if not
}
export interface ChatThreadInfo {
  chatId: string;
  userId: string;
  modelOptions: Partial<ChatParameters>;
}

export interface ChatMessageQueue {
  queue: DiscordMessage[];
  stopSignal: boolean;
}

// Core chat interfaces
export interface ChatPrompt {
  modelName: string;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
}

export interface ChatParameters
  extends OpenAI.Chat.ChatCompletionCreateParamsNonStreaming {
  top_k?: number | null;
  repeat_penalty?: number | null;
  min_p?: number | null;
  top_a?: number | null;
  include_reasoning?: boolean | null;
}

interface ErrorResponse {
  code: number;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface ChatResponse extends OpenAI.Chat.ChatCompletion {
  error?: ErrorResponse;
}
