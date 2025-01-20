// src/ui/discord/bot.ts

import type { Database } from "bun:sqlite";
import type {
  ChatInputCommandInteraction,
  Client,
  Message,
  TextChannel,
  ThreadChannel,
} from "discord.js";
import type { Ollama } from "ollama";
import {
  adjectives,
  animals,
  colors,
  uniqueNamesGenerator,
} from "unique-names-generator";
import { processUserMessage } from "../../chat";
import { getOrInitUserDb } from "../../db/sqlite";
import type { ChatIdExistence, OllamaModelOptions } from "../../interfaces";
import { resumeChatCommandData, startChatCommandData } from "./commands";

export const setupDiscordBot = (
  discordClient: Client,
  ollamaClient: Ollama,
) => {
  // Command registration
  discordClient.on("ready", async () => {
    console.log(`Logged in as ${discordClient.user?.tag}!`);
    try {
      // Register commands on all the guilds bot is in
      for (const guild of discordClient.guilds.cache.values()) {
        // First, delete all existing commands
        await guild.commands.set([]);
        // Then register the new commands
        await guild.commands.create(startChatCommandData);
        await guild.commands.create(resumeChatCommandData);
      }
      console.log(
        "start-chat and resume-chat slash commands registered successfully.",
      );
    } catch (error) {
      console.error("Error registering slash command:", error);
    }
  });

  // Slash command interaction
  discordClient.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === "start-chat") {
      await handleStartChatCommand(interaction, discordClient, ollamaClient);
    } else if (interaction.commandName === "resume-chat") {
      await handleResumeChatCommand(interaction, discordClient, ollamaClient);
    }
  });
};

const chatIdentifierExistenceQuery =
  "SELECT EXISTS(SELECT 1 FROM chat_messages WHERE chat_id = ?) AS 'exists'";

const getModelOptions = (
  interaction: ChatInputCommandInteraction,
): OllamaModelOptions => {
  const temperature = interaction.options.getNumber("temperature") ?? undefined;
  const topK = interaction.options.getNumber("top_k") ?? undefined;
  const topP = interaction.options.getNumber("top_p") ?? undefined;
  const repeatPenalty =
    interaction.options.getNumber("repeat_penalty") ?? undefined;
  const frequencyPenalty =
    interaction.options.getNumber("frequency_penalty") ?? undefined;
  const presencePenalty =
    interaction.options.getNumber("presence_penalty") ?? undefined;
  const numCtx = interaction.options.getNumber("num_ctx") ?? undefined;

  return {
    temperature: temperature,
    topK: topK,
    topP: topP,
    repeatPenalty: repeatPenalty,
    frequencyPenalty: frequencyPenalty,
    presencePenalty: presencePenalty,
    numCtx: numCtx,
  };
};

const createNewDiscordThreadAndUserMessageListener = async (
  interaction: ChatInputCommandInteraction,
  chatIdentifier: string,
  newDiscordThreadReason: string,
  discordClient: Client,
  ollamaClient: Ollama,
  userDb: Database,
): Promise<void> => {
  // Get user specified Discord thread properties
  const threadName = interaction.options.getString("thread_name")
    ? `(${chatIdentifier}) ${interaction.options.getString("thread_name")}`
    : `Chat with ${interaction.user.username}: ${chatIdentifier}`;
  const autoArchiveMinutes =
    interaction.options.getNumber("auto_archive_minutes") ?? 60;

  // Create a new Discord thread
  let discordThread: ThreadChannel;
  try {
    // TODO: add retry logic and exponential backoff
    const newDiscordThread = (await (
      interaction.channel as TextChannel
    )?.threads.create({
      name: threadName,
      autoArchiveDuration: autoArchiveMinutes,
      reason: newDiscordThreadReason,
    })) as ThreadChannel;

    if (!newDiscordThread) {
      await interaction.editReply(
        "Failed to create Discord thread - no Discord thread channel returned",
      );
      return;
    }
    discordThread = newDiscordThread;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    await interaction.editReply(
      `Error creating Discord thread: ${errorMessage}`,
    );
    return;
  }

  // Respond in the new thread
  await interaction.editReply(
    `Started a new chat thread: <#${discordThread.id}>`,
  );

  // Setup event listener for every new message in the thread
  discordClient.on("messageCreate", async (message) => {
    if (message.channelId !== discordThread.id) return;
    // Ignore messages from the bot itself
    if (message.author.id === discordClient.user?.id) return;

    await handleUserMessage(
      message,
      ollamaClient,
      chatIdentifier,
      getModelOptions(interaction),
      userDb,
    );
  });
};

const handleStartChatCommand = async (
  interaction: ChatInputCommandInteraction,
  discordClient: Client,
  ollamaClient: Ollama,
) => {
  await interaction.deferReply();

  const userDb = await getOrInitUserDb(interaction.user.id);

  // Generate a unique chat identifier - regenerate if value already exists in
  // user DB
  let chatIdentifier: string;
  let chatIdExists: ChatIdExistence;
  do {
    chatIdentifier = uniqueNamesGenerator({
      dictionaries: [adjectives, colors, animals],
      separator: "-",
    });
    chatIdExists = userDb
      .query(chatIdentifierExistenceQuery)
      .get(chatIdentifier) as ChatIdExistence;
  } while (chatIdExists.exists === 1);

  createNewDiscordThreadAndUserMessageListener(
    interaction,
    chatIdentifier,
    `New LLM chat requested by ${interaction.user.username}`,
    discordClient,
    ollamaClient,
    userDb,
  );
};

const handleResumeChatCommand = async (
  interaction: ChatInputCommandInteraction,
  discordClient: Client,
  ollamaClient: Ollama,
) => {
  await interaction.deferReply();

  const userDb = await getOrInitUserDb(interaction.user.id);
  const chatIdentifier = interaction.options.getString("chat_identifier", true);

  // Check if the user provided chat identifier exists in the user DB
  const chatIdExists = userDb
    .query(chatIdentifierExistenceQuery)
    .get(chatIdentifier) as ChatIdExistence;
  if (chatIdExists.exists !== 1) {
    await interaction.editReply(`Chat "${chatIdentifier}" does not exist.`);
    return;
  }

  createNewDiscordThreadAndUserMessageListener(
    interaction,
    chatIdentifier,
    `LLM chat resumption requested by ${interaction.user.username}`,
    discordClient,
    ollamaClient,
    userDb,
  );
};

const handleUserMessage = async (
  message: Message,
  ollamaClient: Ollama,
  chatIdentifier: string,
  modelOptions: OllamaModelOptions,
  userDb: Database,
) => {
  if (message.channel.isTextBased() && "sendTyping" in message.channel) {
    await message.channel.sendTyping(); // Show typing indicator to the user
  }

  try {
    const response = await processUserMessage(
      userDb,
      ollamaClient,
      chatIdentifier,
      message.content,
      message.createdAt,
      modelOptions,
    );

    message.reply(response).catch((err) => {
      console.log("There was an error sending the message", err);
    });
  } catch (error) {
    console.error("Error during chat:", error);
    message.reply(
      "Sorry, I encountered an error while processing your request.",
    );
  }
};
