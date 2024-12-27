import { Client, GatewayIntentBits } from "discord.js";
import { Ollama } from "ollama";
import { config } from "./config";
import { setupDiscordBot } from "./services/discord_bot";

const ollama_client = new Ollama({
  host: config.OLLAMA_SERVER_URL,
});

const discord_client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

setupDiscordBot(discord_client, ollama_client);

discord_client.login(config.DISCORD_TOKEN);
