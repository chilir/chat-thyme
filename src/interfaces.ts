// src/interfaces.ts

import type { Database } from "bun:sqlite";
import type { Mutex } from "async-mutex";
import type { Message as DiscordMessage } from "discord.js";
import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export interface ChatPrompt {
  modelName: string;
  messages: ChatCompletionMessageParam[];
}

export interface ChatParameters
  extends OpenAI.Chat.ChatCompletionCreateParamsNonStreaming {
  top_k?: number | null;
  repeat_penalty?: number | null;
  min_p?: number | null;
  top_a?: number | null;
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
  modelOptions: Partial<ChatParameters>;
}

export interface ChatMessageQueue {
  queue: DiscordMessage[];
  stopSignal: boolean;
}
