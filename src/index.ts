// src/index.ts

import { Client, GatewayIntentBits } from "discord.js";
import { Ollama as OllamaClient } from "ollama";
import { parseConfig } from "./config";
import { initUserDbCache } from "./db";
import { setupSignalHandlers } from "./signal-handlers";
import { setupDiscordBot } from "./ui/discord";

const main = () => {
  const userDbCache = initUserDbCache();
  setupSignalHandlers(userDbCache);

  const config = parseConfig();

  const ollamaClient = new OllamaClient({
    host: config.serverUrl,
  });
  const discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  setupDiscordBot(discordClient, ollamaClient, config, userDbCache);
  discordClient.login(config.discordBotToken);
};

main();
