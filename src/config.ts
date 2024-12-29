// src/config.ts

import dotenv from "dotenv";

dotenv.config();

const {
  DISCORD_TOKEN,
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
  DISCORD_TOKEN: DISCORD_TOKEN,
  OLLAMA_MODEL: OLLAMA_MODEL,
  OLLAMA_MODEL_SYSTEM_PROMPT:
    OLLAMA_MODEL_SYSTEM_PROMPT ||
    "You are a helpful assistant interacting with the user through Discord messages.",
  OLLAMA_SERVER_URL: OLLAMA_SERVER_URL || "http://localhost:11434",
};
