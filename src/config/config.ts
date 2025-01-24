// src/config.ts

import dotenv from "dotenv";

import fs from "node:fs";
import yaml from "yaml";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { defaultAppConfig } from "./optional";
import { requiredConfig } from "./required";

dotenv.config();

type Config = typeof defaultAppConfig & typeof requiredConfig;

const {
  DESIRED_MAX_DB_CACHE_SIZE,
  DB_CACHE_TTL_MILLISECONDS,
  DB_CACHE_CHECK_INTERVAL_MILLISECONDS,
  DB_DIR,
  DISCORD_SLOW_MODE_SECONDS,
  OLLAMA_MODEL_SYSTEM_PROMPT,
  OLLAMA_SERVER_URL,
  OLLAMA_MODEL,
} = process.env;

// Parse command line arguments using yargs
const argv = yargs(hideBin(process.argv))
  .option("config", {
    alias: "c",
    type: "string",
    description: "Path to YAML configuration file",
  })
  .option("db-connection-cache-size", {
    type: "number",
    description: "Override DB cache size",
  })
  .option("db-cache-ttl", {
    type: "number",
    description: "Override DB cache TTL (milliseconds)",
  })
  .option("db-cache-check-interval", {
    type: "number",
    description: "Override DB cache check interval (milliseconds)",
  })
  .option("db-dir", {
    alias: "d",
    type: "string",
    description: "Override DB directory",
  })
  .option("discord-slow-mode-interval", {
    type: "number",
    description: "Override Discord slow mode seconds",
  })
  .option("system-prompt", {
    alias: "p",
    type: "string",
    description: "Override Ollama system prompt",
  })
  .option("server-url", {
    alias: "s",
    type: "string",
    description: "Override Ollama server URL",
  })
  .option("model", {
    alias: "m",
    type: "string",
    description: "Override Ollama model name",
  })
  .parseSync();

// Load configuration file (lowest priority) - YAML parsing using 'yaml' library
let configFileConfig = defaultAppConfig; // Default to defaultAppConfig if file loading fails
const configFilePath = argv.config as string;
if (configFilePath) {
  try {
    const rawConfigFile = fs.readFileSync(configFilePath, "utf-8");
    const parsedConfigFile = yaml.parse(rawConfigFile);
    configFileConfig = { ...defaultAppConfig, ...parsedConfigFile };
    console.info(`Loaded configuration from YAML file: ${configFilePath}`);
  } catch (error) {
    console.warn(`Could not load configuration file from ${configFilePath}.`);
  }
}

export const config: Config = {
  ...requiredConfig, // medium priority - required env vars (secrets)
  // Override defaults and dotenv with command line args
  DESIRED_MAX_DB_CACHE_SIZE:
    argv.dbConnectionCacheSize !== undefined
      ? argv.dbConnectionCacheSize
      : defaultAppConfig.DESIRED_MAX_DB_CACHE_SIZE,
  DB_CACHE_TTL_MILLISECONDS:
    argv.dbCacheTtl !== undefined
      ? argv.dbCacheTtl
      : defaultAppConfig.DB_CACHE_TTL_MILLISECONDS,
  DB_CACHE_CHECK_INTERVAL_MILLISECONDS:
    argv.dbCacheCheckInterval !== undefined
      ? argv.dbCacheCheckInterval
      : defaultAppConfig.DB_CACHE_CHECK_INTERVAL_MILLISECONDS,
  DB_DIR: argv.dbDir !== undefined ? argv.dbDir : defaultAppConfig.DB_DIR,
  DISCORD_SLOW_MODE_SECONDS:
    argv.discordSlowModeInterval !== undefined
      ? argv.discordSlowModeInterval
      : defaultAppConfig.DISCORD_SLOW_MODE_SECONDS,
  OLLAMA_MODEL_SYSTEM_PROMPT:
    argv.systemPrompt !== undefined
      ? argv.systemPrompt
      : defaultAppConfig.OLLAMA_MODEL_SYSTEM_PROMPT,
  OLLAMA_SERVER_URL:
    argv.serverUrl !== undefined
      ? argv.serverUrl
      : defaultAppConfig.OLLAMA_SERVER_URL,
  OLLAMA_MODEL:
    argv.model !== undefined ? argv.model : defaultAppConfig.OLLAMA_MODEL,
};
