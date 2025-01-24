// src/index.ts

import { Client, GatewayIntentBits } from "discord.js";
import { Ollama as OllamaClient } from "ollama";
import { config } from "./config";
import { setupSignalHandlers } from "./signalhandlers";
import { setupDiscordBot } from "./ui/discord";

setupSignalHandlers();

const ollamaClient = new OllamaClient({
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
