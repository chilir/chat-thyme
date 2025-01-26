// tests/config/parse.test.ts

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { parseConfig } from "../../src/config/parse";
import { defaultAppConfig } from "../../src/config/schema";

describe("Configuration Parsing and Loading", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("should load default configuration", () => {
    vi.stubEnv("CHAT_THYME_MODEL", "test_model");
    vi.stubEnv("DB_DIR", undefined);

    const config = parseConfig();
    expect(config.discordBotToken).toBe("test_token");
    expect(config.model).toBe("test_model");
    expect(config.serverUrl).toBe(defaultAppConfig.serverUrl);
    expect(config.systemPrompt).toBe(defaultAppConfig.systemPrompt);
    expect(config.dbDir).toBe(defaultAppConfig.dbDir);
    expect(config.dbConnectionCacheSize).toBe(
      defaultAppConfig.dbConnectionCacheSize,
    );
    expect(config.dbConnectionCacheTtl).toBe(
      defaultAppConfig.dbConnectionCacheTtl,
    );
    expect(config.dbConnectionCacheCheckInterval).toBe(
      defaultAppConfig.dbConnectionCacheCheckInterval,
    );
    expect(config.discordSlowModeInterval).toBe(
      defaultAppConfig.discordSlowModeInterval,
    );
  });

  it("should override default config with environment variables", () => {
    vi.stubEnv("CHAT_THYME_MODEL", "env_model");
    vi.stubEnv("MODEL_SERVER_URL", "http://env-server:5000");
    vi.stubEnv("MODEL_SYSTEM_PROMPT", "Environment system prompt");
    vi.stubEnv("DB_DIR", "./env_db");
    vi.stubEnv("DESIRED_MAX_DB_CONNECTION_CACHE_SIZE", "200");
    vi.stubEnv("DB_CONNECTION_CACHE_TTL_MILLISECONDS", "7200000");
    vi.stubEnv("DB_CONNECTION_CACHE_CHECK_INTERVAL_MILLISECONDS", "1200000");
    vi.stubEnv("DISCORD_SLOW_MODE_SECONDS", "20");

    const config = parseConfig();
    expect(config.discordBotToken).toBe("test_token");
    expect(config.model).toBe("env_model");
    expect(config.serverUrl).toBe("http://env-server:5000");
    expect(config.systemPrompt).toBe("Environment system prompt");
    expect(config.dbDir).toBe("./env_db");
    expect(config.dbConnectionCacheSize).toBe(200);
    expect(config.dbConnectionCacheTtl).toBe(7200000);
    expect(config.dbConnectionCacheCheckInterval).toBe(1200000);
    expect(config.discordSlowModeInterval).toBe(20);
  });

  it("should override default and env config with command line arguments", () => {
    const originalArgv = process.argv;
    process.argv = [
      ...originalArgv.slice(0, 2), // runtime executable and script path
      "--model",
      "cli_model",
      "--server-url",
      "http://cli-server:6000",
      "--system-prompt",
      "CLI system prompt",
      "--db-dir",
      "./cli_db",
      "--db-connection-cache-size",
      "300",
      "--db-connection-cache-ttl",
      "10800000",
      "--db-connection-cache-check-interval",
      "1800000",
      "--discord-slow-mode-interval",
      "30",
    ];

    // Set environment variables as well to ensure CLI args take precedence
    vi.stubEnv("CHAT_THYME_MODEL", "env_model");
    vi.stubEnv("MODEL_SERVER_URL", "http://env-server:5000");
    vi.stubEnv("MODEL_SYSTEM_PROMPT", "Environment system prompt");
    vi.stubEnv("DB_DIR", "./env_db");
    vi.stubEnv("DESIRED_MAX_DB_CONNECTION_CACHE_SIZE", "200");
    vi.stubEnv("DB_CONNECTION_CACHE_TTL_MILLISECONDS", "7200000");
    vi.stubEnv("DB_CONNECTION_CACHE_CHECK_INTERVAL_MILLISECONDS", "1200000");
    vi.stubEnv("DISCORD_SLOW_MODE_SECONDS", "20");

    const config = parseConfig();
    expect(config.discordBotToken).toBe("test_token");
    expect(config.model).toBe("cli_model");
    expect(config.serverUrl).toBe("http://cli-server:6000");
    expect(config.systemPrompt).toBe("CLI system prompt");
    expect(config.dbDir).toBe("./cli_db");
    expect(config.dbConnectionCacheSize).toBe(300);
    expect(config.dbConnectionCacheTtl).toBe(10800000);
    expect(config.dbConnectionCacheCheckInterval).toBe(1800000);
    expect(config.discordSlowModeInterval).toBe(30);

    process.argv = originalArgv; // Restore original argv
  });

  it("should load YAML config file and be overridden by CLI and env config", () => {
    const originalArgv = process.argv;
    const tempDir = os.tmpdir();
    const configFilePath = path.join(tempDir, "test-config.yaml");
    const configFileContent = `
model: yaml_model
serverUrl: http://yaml-server:7000
systemPrompt: YAML system prompt
dbDir: ./yaml_db
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
      "cli_model",
      "--server-url",
      "http://cli-server:6000",
    ];

    vi.stubEnv("CHAT_THYME_MODEL", "env_model");
    vi.stubEnv("MODEL_SERVER_URL", "http://env-server:5000");
    vi.stubEnv("MODEL_SYSTEM_PROMPT", "Environment system prompt");
    vi.stubEnv("DB_DIR", "./env_db");
    vi.stubEnv("DESIRED_MAX_DB_CONNECTION_CACHE_SIZE", "200");
    vi.stubEnv("DB_CONNECTION_CACHE_TTL_MILLISECONDS", "7200000");
    vi.stubEnv("DB_CONNECTION_CACHE_CHECK_INTERVAL_MILLISECONDS", "1200000");
    vi.stubEnv("DISCORD_SLOW_MODE_SECONDS", "20");

    const config = parseConfig();
    expect(config.model).toBe("cli_model");
    expect(config.serverUrl).toBe("http://cli-server:6000");
    expect(config.systemPrompt).toBe("Environment system prompt");
    expect(config.dbDir).toBe("./env_db");
    expect(config.dbConnectionCacheSize).toBe(200);
    expect(config.dbConnectionCacheTtl).toBe(7200000);
    expect(config.dbConnectionCacheCheckInterval).toBe(1200000);
    expect(config.discordSlowModeInterval).toBe(20);
    expect(config.discordBotToken).toBe("test_token");

    process.argv = originalArgv; // Restore original argv
    fs.unlinkSync(configFilePath); // Clean up temp config file
  });

  it("should load config from all sources with correct priority", () => {
    const originalArgv = process.argv;
    const tempDir = os.tmpdir();
    const configFilePath = path.join(tempDir, "test-config.yaml");
    const configFileContent = `
model: yaml_model_value
serverUrl: http://yaml-server-value:7000
systemPrompt: YAML system prompt value
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

    vi.stubEnv("CHAT_THYME_MODEL", "env_model_value");
    vi.stubEnv("MODEL_SERVER_URL", "http://env-server-value:5000"); // .env and actual env var
    vi.stubEnv("MODEL_SYSTEM_PROMPT", "Environment system prompt value"); // actual env var only (simulating .env not set)
    vi.stubEnv("DB_DIR", "./env_db_value"); // actual env var only (simulating .env not set)
    vi.stubEnv("DESIRED_MAX_DB_CONNECTION_CACHE_SIZE", "200"); // .env only (simulating actual env var not set)
    vi.stubEnv("DB_CONNECTION_CACHE_TTL_MILLISECONDS", "7200000"); // .env only (simulating actual env var not set)
    vi.stubEnv("DB_CONNECTION_CACHE_CHECK_INTERVAL_MILLISECONDS", "1200000"); // actual env var - no .env
    vi.stubEnv("DISCORD_SLOW_MODE_SECONDS", "20"); // actual env var - no .env
    vi.stubEnv("DISCORD_BOT_TOKEN", "stubbed_token");

    const config = parseConfig();
    expect(config.discordBotToken).toBe("stubbed_token");
    expect(config.model).toBe("cli_model_value");
    expect(config.serverUrl).toBe("http://cli-server:6000");
    expect(config.systemPrompt).toBe("Environment system prompt value");
    expect(config.dbDir).toBe("./env_db_value");
    expect(config.dbConnectionCacheSize).toBe(200);
    expect(config.dbConnectionCacheTtl).toBe(7200000);
    expect(config.dbConnectionCacheCheckInterval).toBe(1200000);
    expect(config.discordSlowModeInterval).toBe(20);
    expect(config.dbDir).not.toBe(defaultAppConfig.dbDir);
    expect(config.dbConnectionCacheCheckInterval).not.toBe(
      defaultAppConfig.dbConnectionCacheCheckInterval,
    ); // Assert some values are NOT default to ensure overrides worked

    process.argv = originalArgv;
    fs.unlinkSync(configFilePath);
  });

  it("should throw an error if Discord bot token is missing", () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", undefined);
    vi.stubEnv("CHAT_THYME_MODEL", "test_model");

    expect(parseConfig).toThrowError(ZodError);
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
    vi.stubEnv("CHAT_THYME_MODEL", undefined);

    expect(parseConfig).toThrowError(ZodError);
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
