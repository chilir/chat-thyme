// src/config/parse.ts

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { type ChatThymeConfig, configSchema, defaultAppConfig } from "./schema";

/**
 * Parses command line arguments using `yargs` to configure application settings.
 *
 * @returns {ReturnType<typeof argv.parseSync>} An object containing parsed
 *   command line arguments with the following properties:
 *   - config: Path to YAML configuration file
 *   - model: Model name
 *   - serverUrl: URL of the model server
 *   - useTools: Whether to enable tool usage
 *   - apiKey: API key for the model server
 *   - exaApiKey: API key for Exa search
 *   - systemPrompt: System prompt
 *   - dbDir: Directory for SQLite database files
 *   - dbConnectionCacheSize: Maximum database connection cache size
 *   - dbConnectionCacheTtl: TTL for database connection cache entries in
 *     milliseconds
 *   - dbConnectionCacheEvictionInterval: Interval to evict expired cache
 *     entries in milliseconds
 *   - discordSlowModeInterval: Slow mode interval for Discord messages in
 *     seconds
 */
const loadFromArgs = (): ReturnType<typeof argv.parseSync> => {
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
    .option("use-tools", {
      alias: "t",
      type: "boolean",
      description: `Whether or not to use tools (optional, default: \
"${defaultAppConfig.useTools}"`,
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
      description: `The time-to-live (TTL) in milliseconds for database \
connection cache entries (optional, default: \
${defaultAppConfig.dbConnectionCacheTtl})`,
    })
    .option("db-connection-cache-eviction-interval", {
      type: "number",
      description: `The interval in milliseconds to evict expired database \
connection cache entries (optional, default: \
${defaultAppConfig.dbConnectionCacheEvictionInterval})`,
    })
    .option("discord-slow-mode-interval", {
      type: "number",
      description: `The slow mode interval in seconds for Discord user \
messages, set to 0 to disable (optional, default:\
${defaultAppConfig.discordSlowModeInterval})`,
    })
    .wrap(yargs().terminalWidth());

  return argv.parseSync();
};

/**
 * Loads configuration from a YAML file specified in parsed command line
 * arguments.
 *
 * @param configFilePath - Optional path to the YAML configuration file
 * @returns {Partial<ChatThymeConfig>} A partial configuration object loaded
 *   from the YAML file, or an empty object if:
 *   - No file path is provided
 *   - The file cannot be read
 *   - The file cannot be parsed as YAML
 *
 * @remarks
 * - Successfully loading the config file will log an info message
 * - Failed loading attempts will log a warning message
 */
const loadFromConfigFile = (
  configFilePath: string | undefined,
): Partial<ChatThymeConfig> => {
  let configFileConfig: Partial<ChatThymeConfig> = {};
  if (configFilePath) {
    try {
      const rawConfigFile = fs.readFileSync(configFilePath, "utf-8");
      configFileConfig = YAML.parse(rawConfigFile);
      console.info(`Loaded configuration from YAML file: ${configFilePath}`);
    } catch (error) {
      console.warn(`Could not load configuration file from ${configFilePath}`);
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
 * - Discord bot token for authentication
 * - Model settings: name, server URL, API key
 * - Tool settings: useTools flag, Exa API key
 * - System prompt for model behavior
 * - Database settings: directory path, connection cache configuration
 *   (size, TTL, eviction interval)
 * - Discord message rate limiting (slow mode interval)
 *
 * @throws {ZodError} If configuration validation fails against the schema
 * @returns {ChatThymeConfig} Validated configuration object matching the schema
 */
export const parseConfig = (): ChatThymeConfig => {
  const parsedArgs = loadFromArgs();
  const parsedFromConfig = loadFromConfigFile(
    parsedArgs.config ? path.resolve(parsedArgs.config) : undefined,
  );

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
    useTools:
      parsedArgs.useTools ??
      (process.env.USE_TOOLS !== undefined
        ? process.env.USE_TOOLS
        : parsedFromConfig.useTools),
    exaApiKey: process.env.EXA_API_KEY ?? parsedFromConfig.exaApiKey,
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
        ? process.env.DESIRED_MAX_DB_CONNECTION_CACHE_SIZE
        : parsedFromConfig.dbConnectionCacheSize),
    dbConnectionCacheTtl:
      parsedArgs.dbConnectionCacheTtl ??
      (process.env.DB_CONNECTION_CACHE_TTL_MILLISECONDS !== undefined
        ? process.env.DB_CONNECTION_CACHE_TTL_MILLISECONDS
        : parsedFromConfig.dbConnectionCacheTtl),
    dbConnectionCacheEvictionInterval:
      parsedArgs.dbConnectionCacheEvictionInterval ??
      (process.env.DB_CONNECTION_CACHE_EVICTION_INTERVAL_MILLISECONDS !==
      undefined
        ? process.env.DB_CONNECTION_CACHE_EVICTION_INTERVAL_MILLISECONDS
        : parsedFromConfig.dbConnectionCacheEvictionInterval),
    discordSlowModeInterval:
      parsedArgs.discordSlowModeInterval ??
      (process.env.DISCORD_SLOW_MODE_SECONDS !== undefined
        ? process.env.DISCORD_SLOW_MODE_SECONDS
        : parsedFromConfig.discordSlowModeInterval),
  };

  return configSchema.parse(rawConfig);
};
