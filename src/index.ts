// src/index.ts

import { Client, GatewayIntentBits } from "discord.js";
import { Ollama } from "ollama";
import { config } from "./config";
import { clearUserDbCache } from "./db/sqlite";
import { setupDiscordBot } from "./ui/discord";

// register explicit cleanup
process.on("SIGINT", async () => {
  console.log("SIGINT received. Cleaning up user DB cache...");
  await clearUserDbCache();
  console.log("Cleanup complete. Exiting...");
  process.exit(0);
});
process.on("SIGTERM", async () => {
  console.log("SIGTERM received. Cleaning up user DB cache...");
  await clearUserDbCache();
  console.log("Cleanup complete. Exiting...");
  process.exit(0);
});
process.on("SIGQUIT", async () => {
  console.log("SIGQUIT received. Cleaning up user DB cache...");
  await clearUserDbCache();
  console.log("Cleanup complete. Exiting...");
  process.exit(0);
});
process.on("uncaughtException", async (err) => {
  console.error("Uncaught Exception:", err);
  console.log("Cleaning up user DB cache...");
  await clearUserDbCache();
  console.log("Cleanup complete. Exiting...");
  process.exit(1);
});
process.on("unhandledRejection", async (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  console.log("Cleaning up user DB cache...");
  await clearUserDbCache();
  console.log("Cleanup complete. Exiting...");
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
