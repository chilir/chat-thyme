// src/index.ts

import { Client, GatewayIntentBits } from "discord.js";
import { Ollama } from "ollama";
import { config } from "./config";
import { clearUserDbCache } from "./db/sqlite";
import { setupDiscordBot } from "./ui/discord";

// register explicit cleanup
process.on("exit", clearUserDbCache);
process.on("SIGINT", () => {
  clearUserDbCache();
  process.exit(0);
});
process.on("SIGTERM", () => {
  clearUserDbCache();
  process.exit(0);
});
process.on("SIGQUIT", () => {
  clearUserDbCache();
  process.exit(0);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  clearUserDbCache();
  process.exit(1);
});
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  clearUserDbCache();
  process.exit(1);
});

const ollamaClient = new Ollama({
  host: config.OLLAMA_SERVER_URL,
});

const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

setupDiscordBot(discordClient, ollamaClient);

discordClient.login(config.DISCORD_TOKEN);
