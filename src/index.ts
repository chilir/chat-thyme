// src/index.ts

import { Client, GatewayIntentBits } from "discord.js";
import OpenAI from "openai";
import { parseConfig } from "./config";
import { initUserDbCache } from "./db";
import { setupSignalHandlers } from "./signal-handlers";
import { setupDiscordBot } from "./ui/discord";

const main = () => {
  const userDbCache = initUserDbCache();
  setupSignalHandlers(userDbCache);

  const config = parseConfig();

  const modelClient = new OpenAI({
    baseURL: config.serverUrl,
    apiKey: config.apiKey,
  });
  const discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  setupDiscordBot(discordClient, modelClient, config, userDbCache);
  discordClient.login(config.discordBotToken);
};

main();
