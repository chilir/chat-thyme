// src/ui/discord/bot.ts

import type { ChatThymeConfig } from "../../config";
import type {
  ChatMessageQueue,
  ChatThreadInfo,
  ChatThymeClients,
  DbCache,
} from "../../interfaces";
import { resumeChatCommandData, startChatCommandData } from "./commands";
import {
  handleResumeChatCommand,
  handleStartChatCommand,
  handleUserMessage,
} from "./handlers";
import { startArchivedThreadEviction } from "./utils";

export const setupDiscordBot = (
  clients: ChatThymeClients,
  config: ChatThymeConfig,
  userDbCache: DbCache,
) => {
  const activeChatThreads = new Map<string, ChatThreadInfo>();
  const chatMessageQueues = new Map<string, ChatMessageQueue>();

  // Command registration
  clients.discordClient.on("ready", async () => {
    console.info(`Logged in as ${clients.discordClient.user?.tag}!`);
    try {
      for (const guild of clients.discordClient.guilds.cache.values()) {
        console.debug(
          `Deleting existing commands for guild ${guild.name} (${guild.id})...`,
        );
        await guild.commands.set([]);
        console.debug(
          `Creating start-chat command for guild ${guild.name} (${guild.id})...`,
        );
        await guild.commands.create(startChatCommandData);
        console.debug(
          `Creating resume-chat command for guild ${guild.name} \
(${guild.id})...`,
        );
        await guild.commands.create(resumeChatCommandData);
      }
      console.info(
        "start-chat and resume-chat slash commands registered successfully.",
      );

      // 5 second delay for propagation
      await new Promise((resolve) => setTimeout(resolve, 5000));
      console.info("Delay finished after command registration. Bot ready.");
    } catch (error) {
      console.error("Error registering slash command:", error);
    }

    startArchivedThreadEviction(
      clients.discordClient,
      activeChatThreads,
      chatMessageQueues,
    );
  });

  // Command interaction
  clients.discordClient.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    console.debug("----------\n");
    console.debug(
      `Interaction received: ${interaction.commandName}`);
    console.debug(`User: ${interaction.user.tag}`);
    console.debug("Options:"
    console.debug(JSON.stringify(interaction.options.data));
    if (interaction.commandName === "start-chat") {
      console.debug("Handling start-chat command.");
      await handleStartChatCommand(
        interaction,
        userDbCache,
        config.dbDir,
        config.dbConnectionCacheSize,
        config.discordSlowModeInterval,
        activeChatThreads,
      );
    } else if (interaction.commandName === "resume-chat") {
      console.debug("Handling resume-chat command.");
      await handleResumeChatCommand(
        interaction,
        userDbCache,
        config.dbDir,
        config.dbConnectionCacheSize,
        config.discordSlowModeInterval,
        activeChatThreads,
      );
    }
  });

  // Single message listener for all active chat threads started by slash
  // commands
  clients.discordClient.on("messageCreate", async (discordMessage) => {
    if (discordMessage.author.bot) return; // Ignore bot messages
    const chatThreadInfo = activeChatThreads.get(discordMessage.channelId);
    if (chatThreadInfo) {
      if (discordMessage.author.id === chatThreadInfo.userId) {
        await handleUserMessage(
          chatMessageQueues,
          chatThreadInfo,
          userDbCache,
          config,
          clients.modelClient,
          clients.exaClient,
          discordMessage,
        );
      }
    }
  });
};
