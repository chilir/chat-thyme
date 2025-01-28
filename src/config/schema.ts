// src/config/schema.ts

import { z } from "zod";

export const defaultAppConfig = {
  model: "", // CHAT_THYME_MODEL
  serverUrl: "http://localhost:11434/v1/", // MODEL_SERVER_URL
  apiKey: "ollama", // API_KEY
  exaApiKey: "", // EXA_API_KEY
  systemPrompt: // MODEL_SYSTEM_PROMPT
    "You are a helpful assistant interacting with the user through Discord messages.",
  dbDir: ".sqlite", // DB_DIR
  dbConnectionCacheSize: 100, // DESIRED_MAX_DB_CONNECTION_CACHE_SIZE
  dbConnectionCacheTtl: 3600000, // DB_CONNECTION_CACHE_TTL_MILLISECONDS, default 1hr
  dbConnectionCacheCheckInterval: 600000, // DB_CONECTION_CACHE_CHECK_INTERVAL_MILLISECONDS, default 10 minutes
  discordSlowModeInterval: 10, // DISCORD_SLOW_MODE_SECONDS, default 10 seconds
};

export const configSchema = z.object({
  discordBotToken: z
    .string()
    .min(1, { message: "Discord bot token is required" }),
  model: z
    .string()
    .min(1, { message: "Model name cannot be empty" })
    .default(defaultAppConfig.model),
  serverUrl: z.string().url().default(defaultAppConfig.serverUrl),
  apiKey: z.string().default(defaultAppConfig.apiKey),
  exaApiKey: z.string().default(defaultAppConfig.exaApiKey),
  systemPrompt: z.string().default(defaultAppConfig.systemPrompt),
  dbDir: z.string().default(defaultAppConfig.dbDir),
  dbConnectionCacheSize: z
    .number()
    .int()
    .positive()
    .default(defaultAppConfig.dbConnectionCacheSize),
  dbConnectionCacheTtl: z
    .number()
    .int()
    .positive()
    .default(defaultAppConfig.dbConnectionCacheTtl),
  dbConnectionCacheCheckInterval: z
    .number()
    .int()
    .positive()
    .default(defaultAppConfig.dbConnectionCacheCheckInterval),
  discordSlowModeInterval: z
    .number()
    .int()
    .positive()
    .default(defaultAppConfig.discordSlowModeInterval),
});

export type ChatThymeConfig = z.infer<typeof configSchema>;
