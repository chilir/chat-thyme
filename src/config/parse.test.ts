// src/config/parse.test.ts

import { beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import tmp from "tmp";
import { ZodError } from "zod";
import { parseConfig } from "./parse";
import { defaultAppConfig } from "./schema";

tmp.setGracefulCleanup();

describe("Configuration Parsing and Loading", () => {
  const originalEnv = { ...process.env };
  const tmpDir = tmp.dirSync({
    prefix: "chat-thyme-test-",
    unsafeCleanup: true,
  });

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  it("should load default configuration", () => {
    process.env.CHAT_THYME_MODEL = "test_model";
    process.env.DB_DIR = undefined;

    const config = parseConfig();
    expect(config.discordBotToken).toBe("test_token");
    expect(config.model).toBe("test_model");
    expect(config.apiKey).toBe(defaultAppConfig.apiKey);
    expect(config.useTools).toBe(defaultAppConfig.useTools);
    expect(config.exaApiKey).toBe(defaultAppConfig.exaApiKey);
    expect(config.serverUrl).toBe(defaultAppConfig.serverUrl);
    expect(config.systemPrompt).toBe(defaultAppConfig.systemPrompt);
    expect(config.dbDir).toBe(defaultAppConfig.dbDir);
    expect(config.dbConnectionCacheSize).toBe(
      defaultAppConfig.dbConnectionCacheSize,
    );
    expect(config.dbConnectionCacheTtl).toBe(
      defaultAppConfig.dbConnectionCacheTtl,
    );
    expect(config.dbConnectionCacheEvictionInterval).toBe(
      defaultAppConfig.dbConnectionCacheEvictionInterval,
    );
    expect(config.discordSlowModeInterval).toBe(
      defaultAppConfig.discordSlowModeInterval,
    );
  });

  it("should override default config with environment variables", () => {
    Object.assign(process.env, {
      CHAT_THYME_MODEL: "env_model",
      MODEL_SERVER_URL: "http://env-server:5000",
      MODEL_SYSTEM_PROMPT: "Environment system prompt",
      API_KEY: "env_api_key",
      USE_TOOLS: "true",
      EXA_API_KEY: "env_exa_key",
      DB_DIR: "./env_db",
      DESIRED_MAX_DB_CONNECTION_CACHE_SIZE: "200",
      DB_CONNECTION_CACHE_TTL_MILLISECONDS: "7200000",
      DB_CONNECTION_CACHE_EVICTION_INTERVAL_MILLISECONDS: "1200000",
      DISCORD_SLOW_MODE_SECONDS: "20",
    });

    const config = parseConfig();
    expect(config.discordBotToken).toBe("test_token");
    expect(config.model).toBe("env_model");
    expect(config.serverUrl).toBe("http://env-server:5000");
    expect(config.systemPrompt).toBe("Environment system prompt");
    expect(config.apiKey).toBe("env_api_key");
    expect(config.useTools).toBe(true);
    expect(config.exaApiKey).toBe("env_exa_key");
    expect(config.dbDir).toBe("./env_db");
    expect(config.dbConnectionCacheSize).toBe(200);
    expect(config.dbConnectionCacheTtl).toBe(7200000);
    expect(config.dbConnectionCacheEvictionInterval).toBe(1200000);
    expect(config.discordSlowModeInterval).toBe(20);
  });

  it("should override default and env config with command line arguments", () => {
    const originalArgv = process.argv;
    process.argv = [
      ...originalArgv.slice(0, 2),
      "--model",
      "cli_model",
      "--server-url",
      "http://cli-server:6000",
      "--system-prompt",
      "CLI system prompt",
      "--use-tools",
      "--db-dir",
      "./cli_db",
      "--db-connection-cache-size",
      "300",
      "--db-connection-cache-ttl",
      "10800000",
      "--db-connection-cache-eviction-interval",
      "1800000",
      "--discord-slow-mode-interval",
      "30",
    ];

    Object.assign(process.env, {
      CHAT_THYME_MODEL: "env_model",
      MODEL_SERVER_URL: "http://env-server:5000",
      MODEL_SYSTEM_PROMPT: "Environment system prompt",
      USE_TOOLS: 0,
      EXA_API_KEY: "env_exa_key",
      DB_DIR: "./env_db",
      DESIRED_MAX_DB_CONNECTION_CACHE_SIZE: "200",
      DB_CONNECTION_CACHE_TTL_MILLISECONDS: "7200000",
      DB_CONNECTION_CACHE_EVICTION_INTERVAL_MILLISECONDS: "1200000",
      DISCORD_SLOW_MODE_SECONDS: "20",
    });

    const config = parseConfig();
    expect(config.discordBotToken).toBe("test_token");
    expect(config.model).toBe("cli_model");
    expect(config.serverUrl).toBe("http://cli-server:6000");
    expect(config.systemPrompt).toBe("CLI system prompt");
    expect(config.useTools).toBe(true); // CLI arg overrides env
    expect(config.exaApiKey).toBe("env_exa_key");
    expect(config.dbDir).toBe("./cli_db");
    expect(config.dbConnectionCacheSize).toBe(300);
    expect(config.dbConnectionCacheTtl).toBe(10800000);
    expect(config.dbConnectionCacheEvictionInterval).toBe(1800000);
    expect(config.discordSlowModeInterval).toBe(30);

    process.argv = originalArgv;
  });

  it("should load YAML config file and be overridden by CLI and env config", () => {
    const configFilePath = path.join(tmpDir.name, "test-config.yaml");
    const configFileContent = `
model: yaml_model
serverUrl: http://yaml-server:7000
systemPrompt: YAML system prompt
useTools: true
exaApiKey: yaml_exa_key
dbDir: ./yaml_db
dbConnectionCacheSize: 400
dbConnectionCacheTtl: 14400000
dbConnectionCacheCheckInterval: 2400000
discordSlowModeInterval: 40
`;
    fs.writeFileSync(configFilePath, configFileContent);

    const originalArgv = process.argv;
    process.argv = [
      ...originalArgv.slice(0, 2),
      "--config",
      configFilePath,
      "--model",
      "cli_model",
      "--server-url",
      "http://cli-server:6000",
    ];

    Object.assign(process.env, {
      CHAT_THYME_MODEL: "env_model",
      MODEL_SERVER_URL: "http://env-server:5000",
      MODEL_SYSTEM_PROMPT: "Environment system prompt",
      USE_TOOLS: 0,
      EXA_API_KEY: "env_exa_key",
      API_KEY: "env_api_key",
      DB_DIR: "./env_db",
      DESIRED_MAX_DB_CONNECTION_CACHE_SIZE: "200",
      DB_CONNECTION_CACHE_TTL_MILLISECONDS: "7200000",
      DB_CONNECTION_CACHE_EVICTION_INTERVAL_MILLISECONDS: "1200000",
      DISCORD_SLOW_MODE_SECONDS: "20",
    });

    const config = parseConfig();
    expect(config.model).toBe("cli_model");
    expect(config.serverUrl).toBe("http://cli-server:6000");
    expect(config.systemPrompt).toBe("Environment system prompt");
    expect(config.useTools).toBe(false); // Env overrides YAML
    expect(config.exaApiKey).toBe("env_exa_key"); // Env overrides YAML
    expect(config.apiKey).toBe("env_api_key");
    expect(config.dbDir).toBe("./env_db");
    expect(config.dbConnectionCacheSize).toBe(200);
    expect(config.dbConnectionCacheTtl).toBe(7200000);
    expect(config.dbConnectionCacheEvictionInterval).toBe(1200000);
    expect(config.discordSlowModeInterval).toBe(20);
    expect(config.discordBotToken).toBe("test_token");

    process.argv = originalArgv;
    fs.unlinkSync(configFilePath);
  });

  it("should load config from all sources with correct priority", () => {
    const originalArgv = process.argv;
    const configFilePath = path.join(tmpDir.name, "test-config.yaml");
    const configFileContent = `
model: yaml_model_value
serverUrl: http://yaml-server-value:7000
systemPrompt: YAML system prompt value
useTools: true
exaApiKey: yaml_exa_key
dbDir: ./yaml_db_value
dbConnectionCacheSize: 400
dbConnectionCacheTtl: 14400000
dbConnectionCacheCheckInterval: 2400000
discordSlowModeInterval: 40
`;
    fs.writeFileSync(configFilePath, configFileContent);

    process.argv = [
      ...originalArgv.slice(0, 2),
      "--config",
      configFilePath,
      "--model",
      "cli_model_value",
      "--server-url",
      "http://cli-server:6000",
    ];

    Object.assign(process.env, {
      CHAT_THYME_MODEL: "env_model_value",
      MODEL_SERVER_URL: "http://env-server-value:5000",
      MODEL_SYSTEM_PROMPT: "Environment system prompt value",
      USE_TOOLS: 0,
      EXA_API_KEY: "env_exa_key_value",
      API_KEY: "env_api_key_value",
      DB_DIR: "./env_db_value",
      DESIRED_MAX_DB_CONNECTION_CACHE_SIZE: "200",
      DB_CONNECTION_CACHE_TTL_MILLISECONDS: "7200000",
      DB_CONNECTION_CACHE_EVICTION_INTERVAL_MILLISECONDS: "1200000",
      DISCORD_SLOW_MODE_SECONDS: "20",
      DISCORD_BOT_TOKEN: "stubbed_token",
    });

    const config = parseConfig();
    expect(config.discordBotToken).toBe("stubbed_token");
    expect(config.model).toBe("cli_model_value");
    expect(config.serverUrl).toBe("http://cli-server:6000");
    expect(config.systemPrompt).toBe("Environment system prompt value");
    expect(config.useTools).toBe(false);
    expect(config.exaApiKey).toBe("env_exa_key_value");
    expect(config.apiKey).toBe("env_api_key_value");
    expect(config.dbDir).toBe("./env_db_value");
    expect(config.dbConnectionCacheSize).toBe(200);
    expect(config.dbConnectionCacheTtl).toBe(7200000);
    expect(config.dbConnectionCacheEvictionInterval).toBe(1200000);
    expect(config.discordSlowModeInterval).toBe(20);
    expect(config.dbDir).not.toBe(defaultAppConfig.dbDir);
    expect(config.dbConnectionCacheEvictionInterval).not.toBe(
      defaultAppConfig.dbConnectionCacheEvictionInterval,
    );

    process.argv = originalArgv;
    fs.unlinkSync(configFilePath);
  });

  it("should throw an error if Discord bot token is missing", () => {
    process.env.DISCORD_BOT_TOKEN = undefined;
    process.env.CHAT_THYME_MODEL = "test_model";

    expect(() => parseConfig()).toThrow(ZodError);
    try {
      parseConfig();
    } catch (error) {
      const errorMsg = (error as ZodError).message;
      const expectedMsg = `\
[
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "discordBotToken"
    ],
    "message": "Required"
  }
]`;
      expect(errorMsg).toContain(expectedMsg);
    }
  });

  it("should throw an error if model is default", () => {
    process.env.CHAT_THYME_MODEL = undefined;

    expect(() => parseConfig()).toThrow(ZodError);
    try {
      parseConfig();
    } catch (error) {
      const errorMsg = (error as ZodError).message;
      const expectedMsg = `\
[
  {
    "code": "too_small",
    "minimum": 1,
    "type": "string",
    "inclusive": true,
    "exact": false,
    "message": "Model name cannot be empty",
    "path": [
      "model"
    ]
  }
]`;
      expect(errorMsg).toContain(expectedMsg);
    }
  });
});
