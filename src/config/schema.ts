// src/config/schema.ts

import { z } from "zod";

export const defaultAppConfig = {
  model: "", // CHAT_THYME_MODEL
  serverUrl: "http://localhost:11434/v1/", // MODEL_SERVER_URL
  apiKey: "ollama", // API_KEY
  useTools: false, // USE_TOOLS
  exaApiKey: "", // EXA_API_KEY
  systemPrompt: // MODEL_SYSTEM_PROMPT
    "You are a helpful assistant interacting with the user through Discord messages.",
  dbDir: ".sqlite", // DB_DIR
  dbConnectionCacheSize: 100, // DESIRED_MAX_DB_CONNECTION_CACHE_SIZE
  dbConnectionCacheTtl: 3600000, // DB_CONNECTION_CACHE_TTL_MILLISECONDS, default 1hr
  dbConnectionCacheEvictionInterval: 600000, // DB_CONECTION_CACHE_EVICTION_INTERVAL_MILLISECONDS, default 10min
  discordSlowModeInterval: 10, // DISCORD_SLOW_MODE_SECONDS, default 10s
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
  useTools: z.coerce.boolean().default(defaultAppConfig.useTools),
  exaApiKey: z.string().default(defaultAppConfig.exaApiKey),
  systemPrompt: z.string().default(defaultAppConfig.systemPrompt),
  dbDir: z.string().default(defaultAppConfig.dbDir),
  dbConnectionCacheSize: z.coerce
    .number()
    .int()
    .positive({ message: "DB connection cache size must be minimum 1" })
    .default(defaultAppConfig.dbConnectionCacheSize),
  dbConnectionCacheTtl: z.coerce
    .number()
    .int()
    .positive({ message: "DB connection cache TTL must be minimum 1 (ms)" })
    .default(defaultAppConfig.dbConnectionCacheTtl),
  dbConnectionCacheEvictionInterval: z.coerce
    .number()
    .int()
    .positive({
      message: "DB connection cache eviction interval must be minimum 1 (ms)",
    })
    .default(defaultAppConfig.dbConnectionCacheEvictionInterval),
  discordSlowModeInterval: z.coerce
    .number()
    .int()
    .min(0, { message: "Discord slow mode interval cannot be below 0" })
    .default(defaultAppConfig.discordSlowModeInterval),
});

export type ChatThymeConfig = z.infer<typeof configSchema>;
