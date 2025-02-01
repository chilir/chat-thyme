// src/interfaces.ts

import type { Database } from "bun:sqlite";
import type { Mutex } from "async-mutex";
import type {
  Client as DiscordClient,
  Message as DiscordMessage,
} from "discord.js";
import type Exa from "exa-js";
import type OpenAI from "openai";

// db/cache related interfaces
export interface DbCache {
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

export interface DbChatMessageToSave {
  role: "user" | "assistant" | "tool";
  content: string | OpenAI.ChatCompletionContentPart[];
  tool_call_id?: string;
  timestamp: Date;
}

// interface for holding client objects
export interface ChatThymeClients {
  modelClient: OpenAI;
  discordClient: DiscordClient;
  exaClient: Exa | undefined;
}

// Discord chat thread management interfaces
export interface ChatIdExistence {
  exists: 0 | 1; // 1 if exists, 0 if not
}
export interface ChatThreadInfo {
  userId: string;
  chatId: string;
  modelOptions: Partial<ExpandedChatParameters>;
}

export interface ChatMessageQueue {
  queue: DiscordMessage[];
  stopSignal: boolean;
}

// model interaction interfaces
export interface ChatPrompt {
  modelName: string;
  messages: OpenAI.ChatCompletionMessageParam[];
  useTools: boolean;
}

export interface ExpandedChatParameters
  extends OpenAI.ChatCompletionCreateParamsNonStreaming {
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

export interface ExpandedChatResponse extends OpenAI.ChatCompletion {
  error?: ErrorResponse;
}

export interface ExpandedChatCompletionMessage
  extends OpenAI.ChatCompletionMessage {
  reasoning_content?: string;
  reasoning?: string;
}

export interface ProcessedMessageContent {
  timestamp: Date;
  msgContent: string | null;
  reasoningContent?: string;
}
