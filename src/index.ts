// src/index.ts

import { Client, GatewayIntentBits } from "discord.js";
import { Ollama } from "ollama";
import { config } from "./config";
import { setupDiscordBot } from "./ui/discord/bot";

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
