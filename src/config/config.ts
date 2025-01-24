// src/config/config.ts

import fs from "node:fs";
import dotenv from "dotenv";
import yaml from "yaml";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { type Config, configSchema, defaultAppConfig } from "./schema";

dotenv.config();

const {
  DISCORD_BOT_TOKEN,
  CHAT_THYME_MODEL,
  MODEL_SERVER_URL,
  MODEL_SYSTEM_PROMPT,
  DB_DIR,
  DESIRED_MAX_DB_CONNECTION_CACHE_SIZE,
  DB_CONNECTION_CACHE_TTL_MILLISECONDS,
  DB_CONNECTION_CACHE_CHECK_INTERVAL_MILLISECONDS,
  DISCORD_SLOW_MODE_SECONDS,
} = process.env;

// Parse command line arguments using yargs
const argv = yargs(hideBin(process.argv))
  .alias("h", "help")
  .alias("v", "version")
  .option("config", {
    alias: "c",
    type: "string",
    description: "Path to the YAML configuration file to load (optional)",
  })
  .option("model", {
    alias: "m",
    type: "string",
    description: "The model to use",
  })
  .option("server-url", {
    alias: "s",
    type: "string",
    description: `The URL of the model server (optional, default: "${defaultAppConfig.serverUrl}")`,
  })
  .option("system-prompt", {
    alias: "p",
    type: "string",
    description: `The system prompt for the language model (optional, default: "${defaultAppConfig.systemPrompt}")`,
  })
  .option("db-dir", {
    alias: "o",
    type: "string",
    description: `The directory to store SQLite database files (optional, default: "${defaultAppConfig.dbDir}")`,
  })
  .option("db-connection-cache-size", {
    type: "number",
    description: `The maximum size of the database connection cache (optional, default: ${defaultAppConfig.dbConnectionCacheSize})`,
  })
  .option("db-connection-cache-ttl", {
    type: "number",
    description: `The time-to-live (TTL) in milliseconds for database cache entries (optional, default: ${defaultAppConfig.dbConnectionCacheTtl})`,
  })
  .option("db-connection-cache-check-interval", {
    type: "number",
    description: `The interval in milliseconds to check for expired database cache entries (optional, default: ${defaultAppConfig.dbConnectionCacheCheckInterval})`,
  })
  .option("discord-slow-mode-interval", {
    type: "number",
    description: `The slow mode interval in seconds for Discord user messages (optional, default: ${defaultAppConfig.discordSlowModeInterval})`,
  })
  .parseSync();

// load configuration file
let configFileConfig: Partial<Config> = {};
const configFilePath = argv.config as string;
if (configFilePath) {
  try {
    const rawConfigFile = fs.readFileSync(configFilePath, "utf-8");
    configFileConfig = yaml.parse(rawConfigFile);
    console.info(`Loaded configuration from YAML file: ${configFilePath}`);
  } catch (error) {
    console.warn(`Could not load configuration file from ${configFilePath}.`);
  }
}

// Priority:
// 1. Command line arguments
// 2. Environment variables
// 3. .env
// 4. YAML config
// 5. Default values
const rawConfig = {
  discordBotToken: DISCORD_BOT_TOKEN,
  model:
    argv.model ??
    (CHAT_THYME_MODEL !== undefined
      ? CHAT_THYME_MODEL
      : configFileConfig.model),
  serverUrl:
    argv.serverUrl ??
    (MODEL_SERVER_URL !== undefined
      ? MODEL_SERVER_URL
      : configFileConfig.serverUrl),
  systemPrompt:
    argv.systemPrompt ??
    (MODEL_SYSTEM_PROMPT !== undefined
      ? MODEL_SYSTEM_PROMPT
      : configFileConfig.systemPrompt),
  dbDir: argv.dbDir ?? (DB_DIR !== undefined ? DB_DIR : configFileConfig.dbDir),
  dbConnectionCacheSize:
    argv.dbConnectionCacheSize ??
    (DESIRED_MAX_DB_CONNECTION_CACHE_SIZE !== undefined
      ? Number(DESIRED_MAX_DB_CONNECTION_CACHE_SIZE)
      : configFileConfig.dbConnectionCacheSize),
  dbConnectionCacheTtl:
    argv.dbConnectionCacheTtl ??
    (DB_CONNECTION_CACHE_TTL_MILLISECONDS !== undefined
      ? Number(DB_CONNECTION_CACHE_TTL_MILLISECONDS)
      : configFileConfig.dbConnectionCacheTtl),
  dbConnectionCacheCheckInterval:
    argv.dbConnectionCacheCheckInterval ??
    (DB_CONNECTION_CACHE_CHECK_INTERVAL_MILLISECONDS !== undefined
      ? Number(DB_CONNECTION_CACHE_CHECK_INTERVAL_MILLISECONDS)
      : configFileConfig.dbConnectionCacheCheckInterval),
  discordSlowModeInterval:
    argv.discordSlowModeInterval ??
    (DISCORD_SLOW_MODE_SECONDS !== undefined
      ? Number(DISCORD_SLOW_MODE_SECONDS)
      : configFileConfig.discordSlowModeInterval),
};

// Validate the raw config object against the Zod schema
const validationResult = configSchema.safeParse(rawConfig);
if (!validationResult.success) {
  console.error("Configuration validation failed:");
  console.error(validationResult.error.issues);
  throw new Error(
    "Invalid application configuration. See console for details.",
  );
}

export const config = configSchema.parse(rawConfig);
