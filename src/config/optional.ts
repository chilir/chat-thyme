// src/config/optional.ts

export const defaultAppConfig = {
  DESIRED_MAX_DB_CACHE_SIZE: 100,
  DB_CACHE_TTL_MILLISECONDS: 3600000, // default 1 hour
  DB_CACHE_CHECK_INTERVAL_MILLISECONDS: 600000, // default 10 minutes
  DB_DIR: ".sqlite",
  DISCORD_SLOW_MODE_SECONDS: 10,
  OLLAMA_MODEL_SYSTEM_PROMPT:
    "You are a helpful assistant interacting with the user through Discord messages.",
  OLLAMA_SERVER_URL: "http://localhost:11434",
  OLLAMA_MODEL: "",
};
