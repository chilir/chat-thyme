// src/config/parse.ts

import fs from "node:fs";
import yaml from "yaml";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { type ChatThymeConfig, configSchema, defaultAppConfig } from "./schema";

/**
 * Parses command line arguments using yargs to configure application settings.
 *
 * @returns {Object} An object containing parsed command line arguments with the
 * following properties:
 *   - config: Path to YAML configuration file
 *   - model: Model name to use
 *   - serverUrl: URL of the model server
 *   - systemPrompt: System prompt for the language model
 *   - dbDir: Directory for SQLite database files
 *   - dbConnectionCacheSize: Maximum database connection cache size
 *   - dbConnectionCacheTtl: TTL for database cache entries in milliseconds
 *   - dbConnectionCacheCheckInterval: Interval to check expired cache entries
 *     in milliseconds
 *   - discordSlowModeInterval: Slow mode interval for Discord messages in
 *     seconds
 */
const loadFromArgs = () => {
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
      description: `The URL of the model server (optional, default: \
"${defaultAppConfig.serverUrl}")`,
    })
    .option("system-prompt", {
      alias: "p",
      type: "string",
      description: `The system prompt for the language model (optional, \
default: "${defaultAppConfig.systemPrompt}")`,
    })
    .option("db-dir", {
      alias: "o",
      type: "string",
      description: `The directory to store SQLite database files (optional, \
default: "${defaultAppConfig.dbDir}")`,
    })
    .option("db-connection-cache-size", {
      type: "number",
      description: `The maximum size of the database connection cache \
(optional, default: ${defaultAppConfig.dbConnectionCacheSize})`,
    })
    .option("db-connection-cache-ttl", {
      type: "number",
      description: `The time-to-live (TTL) in milliseconds for database cache \
entries (optional, default: ${defaultAppConfig.dbConnectionCacheTtl})`,
    })
    .option("db-connection-cache-check-interval", {
      type: "number",
      description: `The interval in milliseconds to check for expired database \
cache entries (optional, default: \
${defaultAppConfig.dbConnectionCacheCheckInterval})`,
    })
    .option("discord-slow-mode-interval", {
      type: "number",
      description: `The slow mode interval in seconds for Discord user \
messages (optional, default: ${defaultAppConfig.discordSlowModeInterval})`,
    })
    .wrap(yargs().terminalWidth());

  return argv.parseSync();
};

/**
 * Loads configuration from a YAML file specified in parsed command line
 * arguments.
 *
 * @param parsedArgs - The parsed command line arguments containing the config
 * file path
 * @returns A partial configuration object loaded from the YAML file, or an
 * empty object if loading fails
 *
 * @remarks
 * - If no config file path is provided, returns an empty object
 * - If the file cannot be read or parsed, logs a warning and returns an empty
 *   object
 * - Successfully loading the config file will log an info message
 */
const loadFromConfigFile = (parsedArgs: ReturnType<typeof loadFromArgs>) => {
  let configFileConfig: Partial<ChatThymeConfig> = {};
  const configFilePath = parsedArgs.config as string;
  if (configFilePath) {
    try {
      const rawConfigFile = fs.readFileSync(configFilePath, "utf-8");
      configFileConfig = yaml.parse(rawConfigFile);
      console.info(`Loaded configuration from YAML file: ${configFilePath}`);
    } catch (error) {
      console.warn(`Could not load configuration file from ${configFilePath}.`);
    }
  }
  return configFileConfig;
};

/**
 * Parses and validates configuration settings from multiple sources with the
 * following priority:
 * 1. Command line arguments
 * 2. Environment variables
 * 3. .env file
 * 4. YAML config file
 * 5. Default values
 *
 * Configuration parameters include:
 * - Discord bot token
 * - Model settings (model name, server URL, system prompt)
 * - Database settings (directory, connection cache size/TTL/check interval)
 * - Discord slow mode interval
 *
 * @throws {ZodError} If configuration validation fails against the schema
 * @returns {ChatThymeConfig} Validated configuration object matching the configSchema
 */
export const parseConfig = () => {
  const parsedArgs = loadFromArgs();
  const parsedFromConfig = loadFromConfigFile(parsedArgs);

  // Priority:
  // 1. Command line arguments
  // 2. Environment variables
  // 3. .env
  // 4. YAML config
  // 5. Default values
  const rawConfig = {
    discordBotToken: process.env.DISCORD_BOT_TOKEN,
    model:
      parsedArgs.model ??
      (process.env.CHAT_THYME_MODEL !== undefined
        ? process.env.CHAT_THYME_MODEL
        : parsedFromConfig.model),
    serverUrl:
      parsedArgs.serverUrl ??
      (process.env.MODEL_SERVER_URL !== undefined
        ? process.env.MODEL_SERVER_URL
        : parsedFromConfig.serverUrl),
    apiKey: process.env.API_KEY ?? parsedFromConfig.apiKey,
    systemPrompt:
      parsedArgs.systemPrompt ??
      (process.env.MODEL_SYSTEM_PROMPT !== undefined
        ? process.env.MODEL_SYSTEM_PROMPT
        : parsedFromConfig.systemPrompt),
    dbDir:
      parsedArgs.dbDir ??
      (process.env.DB_DIR !== undefined
        ? process.env.DB_DIR
        : parsedFromConfig.dbDir),
    dbConnectionCacheSize:
      parsedArgs.dbConnectionCacheSize ??
      (process.env.DESIRED_MAX_DB_CONNECTION_CACHE_SIZE !== undefined
        ? Number(process.env.DESIRED_MAX_DB_CONNECTION_CACHE_SIZE)
        : parsedFromConfig.dbConnectionCacheSize),
    dbConnectionCacheTtl:
      parsedArgs.dbConnectionCacheTtl ??
      (process.env.DB_CONNECTION_CACHE_TTL_MILLISECONDS !== undefined
        ? Number(process.env.DB_CONNECTION_CACHE_TTL_MILLISECONDS)
        : parsedFromConfig.dbConnectionCacheTtl),
    dbConnectionCacheCheckInterval:
      parsedArgs.dbConnectionCacheCheckInterval ??
      (process.env.DB_CONNECTION_CACHE_CHECK_INTERVAL_MILLISECONDS !== undefined
        ? Number(process.env.DB_CONNECTION_CACHE_CHECK_INTERVAL_MILLISECONDS)
        : parsedFromConfig.dbConnectionCacheCheckInterval),
    discordSlowModeInterval:
      parsedArgs.discordSlowModeInterval ??
      (process.env.DISCORD_SLOW_MODE_SECONDS !== undefined
        ? Number(process.env.DISCORD_SLOW_MODE_SECONDS)
        : parsedFromConfig.discordSlowModeInterval),
  };

  // Validate the raw config object against the Zod schema
  const validationResult = configSchema.safeParse(rawConfig);
  if (!validationResult.success) {
    console.error("Configuration validation failed:");
    console.error(validationResult.error.issues);
    throw validationResult.error;
  }

  return configSchema.parse(rawConfig);
};
