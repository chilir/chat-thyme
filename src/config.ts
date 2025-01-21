// src/config.ts

import dotenv from "dotenv";

dotenv.config();

const {
  DESIRED_MAX_DB_CACHE_SIZE,
  DB_CACHE_TTL_MILLISECONDS,
  DB_CACHE_CHECK_INTERVAL_MILLISECONDS,
  DISCORD_TOKEN,
  DISCORD_SLOW_MODE_SECONDS,
  OLLAMA_MODEL,
  OLLAMA_MODEL_SYSTEM_PROMPT,
  OLLAMA_SERVER_URL,
} = process.env;

if (!DISCORD_TOKEN) {
  throw new Error("DISCORD_TOKEN is not set in environmental variables.");
}

if (!OLLAMA_MODEL) {
  throw new Error("OLLAMA_MODEL is not set in environmental variables.");
}

export const config = {
  DESIRED_MAX_DB_CACHE_SIZE: Number.parseInt(
    DESIRED_MAX_DB_CACHE_SIZE || "100",
  ),
  DB_CACHE_TTL_MILLISECONDS: Number.parseInt(
    DB_CACHE_TTL_MILLISECONDS || "3600000", // default 1 hour
  ),
  DB_CACHE_CHECK_INTERVAL_MILLISECONDS: Number.parseInt(
    DB_CACHE_CHECK_INTERVAL_MILLISECONDS || "600000", // default 10 minutes
  ),
  DISCORD_TOKEN: DISCORD_TOKEN,
  DISCORD_SLOW_MODE_SECONDS: Number.parseInt(DISCORD_SLOW_MODE_SECONDS || "10"),
  OLLAMA_MODEL: OLLAMA_MODEL,
  OLLAMA_MODEL_SYSTEM_PROMPT:
    OLLAMA_MODEL_SYSTEM_PROMPT ||
    "You are a helpful assistant interacting with the user through Discord messages.",
  OLLAMA_SERVER_URL: OLLAMA_SERVER_URL || "http://localhost:11434",
};
