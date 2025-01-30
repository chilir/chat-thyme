// src/ui/discord/handlers.ts

import type { Database } from "bun:sqlite";
import type {
  ChatInputCommandInteraction,
  Message as DiscordMessage,
} from "discord.js";
import type OpenAI from "openai";
import {
  adjectives,
  animals,
  colors,
  uniqueNamesGenerator,
} from "unique-names-generator";
import type { ChatThymeConfig } from "../../config";
import { getOrInitUserDb, releaseUserDb } from "../../db";
import type {
  ChatIdExistence,
  ChatMessageQueue,
  ChatThreadInfo,
  dbCache,
} from "../../interfaces";
import {
  chatIdentifierExistenceQuery,
  createDiscordThread,
  startQueueWorker,
} from "./utils";

export const handleStartChatCommand = async (
  interaction: ChatInputCommandInteraction,
  userDbCache: dbCache,
  dbDir: string,
  dbConnectionCacheSize: number,
  discordSlowModeInterval: number,
  activeChatThreads: Map<string, ChatThreadInfo>,
) => {
  await interaction.deferReply({ ephemeral: true });

  let userDb: Database;
  try {
    userDb = await getOrInitUserDb(
      interaction.user.id,
      userDbCache,
      dbDir,
      dbConnectionCacheSize,
    );
  } catch (error) {
    console.error(
      `Error getting/initializing user database for ${interaction.user.id}:`,
      error,
    );
    throw error;
  }

  // Generate a unique chat identifier - regenerate if value already exists in
  // user DB
  let chatId: string;
  let chatIdExists: ChatIdExistence;
  try {
    do {
      chatId = uniqueNamesGenerator({
        dictionaries: [adjectives, colors, animals],
        separator: "-",
      });
      chatIdExists = userDb
        .query(chatIdentifierExistenceQuery)
        .get(chatId) as ChatIdExistence;
    } while (chatIdExists.exists === 1);
  } catch (error) {
    console.error("Error checking chat identifier existence:", error);
    await interaction.editReply(
      "An error occurred while checking for existing chat identifiers.",
    );
    throw error;
  } finally {
    await releaseUserDb(interaction.user.id, userDbCache);
  }

  await createDiscordThread(
    interaction,
    chatId,
    `New LLM chat requested by ${interaction.user.username}`,
    discordSlowModeInterval,
    activeChatThreads,
  );
};

export const handleResumeChatCommand = async (
  interaction: ChatInputCommandInteraction,
  userDbCache: dbCache,
  dbDir: string,
  dbConnectionCacheSize: number,
  discordSlowModeInterval: number,
  activeChatThreads: Map<string, ChatThreadInfo>,
) => {
  await interaction.deferReply({ ephemeral: true });

  let userDb: Database;
  try {
    userDb = await getOrInitUserDb(
      interaction.user.id,
      userDbCache,
      dbDir,
      dbConnectionCacheSize,
    );
  } catch (error) {
    console.error(
      `Error getting/initializing user database for ${interaction.user.id}:`,
      error,
    );
    throw error;
  }
  const chatId = interaction.options.getString("chat_identifier", true);

  let chatIdExists: ChatIdExistence;
  try {
    // Check if the user provided chat identifier exists in the user DB
    chatIdExists = userDb
      .query(chatIdentifierExistenceQuery)
      .get(chatId) as ChatIdExistence;
  } catch (error) {
    console.error(
      `Error checking database for ${chatId} existence with ${interaction.user.id}:`,
      error,
    );
    await interaction.editReply(
      "An error occurred while checking for existing chat identifiers.",
    );
    throw error;
  } finally {
    await releaseUserDb(interaction.user.id, userDbCache);
  }

  if (chatIdExists.exists !== 1) {
    console.warn(`No existing messages found for chat ${chatId}`);
    await interaction.editReply(`Chat "${chatId}" does not exist.`);
    return;
  }

  await createDiscordThread(
    interaction,
    chatId,
    `LLM chat resumption requested by ${interaction.user.username}`,
    discordSlowModeInterval,
    activeChatThreads,
  );
};

export const handleUserMessage = async (
  chatMessageQueues: Map<string, ChatMessageQueue>,
  chatThreadInfo: ChatThreadInfo,
  modelClient: OpenAI,
  config: ChatThymeConfig,
  userDbCache: dbCache,
  discordMessage: DiscordMessage,
) => {
  let messageQueueEntry = chatMessageQueues.get(chatThreadInfo.chatId);
  if (!messageQueueEntry) {
    messageQueueEntry = { queue: [], stopSignal: false }; // new queue
    chatMessageQueues.set(chatThreadInfo.chatId, messageQueueEntry);
    startQueueWorker(
      chatMessageQueues,
      chatThreadInfo,
      modelClient,
      config,
      userDbCache,
    );
  }

  messageQueueEntry.queue.push(discordMessage);
  console.debug(
    `Queued message ${discordMessage.content} for chat \
${chatThreadInfo.chatId}. Currnet queue size: \
${messageQueueEntry.queue.length}`,
  );
};
