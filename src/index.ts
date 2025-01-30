// src/index.ts

import { Client, GatewayIntentBits } from "discord.js";
import Exa from "exa-js";
import OpenAI from "openai";
import { parseConfig } from "./config";
import { backgroundEvictExpiredDbs, initUserDbCache } from "./db";
import { setupSignalHandlers } from "./signal-handlers";
import { setupDiscordBot } from "./ui/discord";

const main = () => {
  const userDbCache = initUserDbCache();
  setupSignalHandlers(userDbCache);

  const config = parseConfig();
  backgroundEvictExpiredDbs(
    userDbCache,
    config.dbConnectionCacheTtl,
    config.dbConnectionCacheEvictionInterval,
  );

  const modelClient = new OpenAI({
    baseURL: config.serverUrl,
    apiKey: config.apiKey,
    maxRetries: 5,
  });
  const discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });
  const exaClient = config.useTools ? new Exa(config.exaApiKey) : undefined;

  setupDiscordBot(
    {
      modelClient: modelClient,
      discordClient: discordClient,
      exaClient: exaClient,
    },
    config,
    userDbCache,
  );
  discordClient.login(config.discordBotToken);
};

main();
