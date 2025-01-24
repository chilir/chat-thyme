// src/ui/discord/bot.ts

import {
  ChannelType,
  type ChatInputCommandInteraction,
  type Client as DiscordClient,
  type Message as DiscordMessage,
  type TextChannel,
  type ThreadChannel,
} from "discord.js";
import type { Ollama as OllamaClient, Options as OllamaOptions } from "ollama";
import {
  adjectives,
  animals,
  colors,
  uniqueNamesGenerator,
} from "unique-names-generator";
import { processUserMessage } from "../../chat";
import { config } from "../../config";
import { getOrInitUserDb, releaseUserDb } from "../../db/sqlite";
import type { ChatIdExistence } from "../../interfaces";
import { resumeChatCommandData, startChatCommandData } from "./commands";

// Keep track of active chat threads
const activeChatThreads = new Map<
  string,
  {
    chatIdentifier: string;
    userId: string;
    modelOptions: Partial<OllamaOptions>;
  }
>();

const startArchivedThreadEviction = (discordClient: DiscordClient) => {
  setInterval(
    async () => {
      for (const channelId of activeChatThreads.keys()) {
        try {
          const channel = await discordClient.channels.fetch(channelId);
          if (channel?.isThread()) {
            const thread = channel as ThreadChannel;
            if (thread.archived) {
              await thread.setLocked(true, "Thread archived and locked");
              activeChatThreads.delete(channelId);
            }
          } else {
            // If the channel is no longer a thread (e.g., deleted), remove it
            // from the map
            activeChatThreads.delete(channelId);
          }
        } catch (error) {
          console.error(
            `Error during archived thread eviction for ${channelId}:`,
            error,
          );
        }
      }
    },
    30 * 60 * 1000,
  );
};

export const setupDiscordBot = (
  discordClient: DiscordClient,
  ollamaClient: OllamaClient,
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

    startArchivedThreadEviction(discordClient);
  });

  // Slash command interaction
  discordClient.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === "start-chat") {
      await handleStartChatCommand(interaction);
    } else if (interaction.commandName === "resume-chat") {
      await handleResumeChatCommand(interaction);
    }
  });

  // Single message listener for all active chat threads started by slash
  // commands
  discordClient.on("messageCreate", async (discordMessage) => {
    if (discordMessage.author.bot) return; // Ignore bot messages
    const chatThreadInfo = activeChatThreads.get(discordMessage.channelId);
    if (chatThreadInfo) {
      if (discordMessage.author.id === chatThreadInfo.userId) {
        await handleUserMessage(
          discordMessage,
          ollamaClient,
          chatThreadInfo.chatIdentifier,
          chatThreadInfo.modelOptions,
          chatThreadInfo.userId,
        );
      }
    }
  });
};

const chatIdentifierExistenceQuery =
  "SELECT EXISTS(SELECT 1 FROM chat_messages WHERE chat_id = ?) AS 'exists'";

const getModelOptions = (
  interaction: ChatInputCommandInteraction,
): Partial<OllamaOptions> => {
  const temperature = interaction.options.getNumber("temperature") ?? undefined;
  const numCtx = interaction.options.getNumber("num_ctx") ?? undefined;
  const topK = interaction.options.getNumber("top_k") ?? undefined;
  const topP = interaction.options.getNumber("top_p") ?? undefined;
  const repeatPenalty =
    interaction.options.getNumber("repeat_penalty") ?? undefined;
  const frequencyPenalty =
    interaction.options.getNumber("frequency_penalty") ?? undefined;
  const presencePenalty =
    interaction.options.getNumber("presence_penalty") ?? undefined;

  return {
    temperature: temperature,
    top_k: topK,
    top_p: topP,
    repeat_penalty: repeatPenalty,
    frequency_penalty: frequencyPenalty,
    presence_penalty: presencePenalty,
    num_ctx: numCtx,
  };
};

const createDiscordThread = async (
  interaction: ChatInputCommandInteraction,
  chatIdentifier: string,
  newDiscordThreadReason: string,
): Promise<void> => {
  // Get user specified Discord thread properties
  const threadName = interaction.options.getString("thread_name")
    ? `(${chatIdentifier}) ${interaction.options.getString("thread_name")}`
    : `Chat with ${interaction.user.username}: ${chatIdentifier}`;
  const autoArchiveMinutes =
    interaction.options.getNumber("auto_archive_minutes") ?? 60;

  // Create a new Discord thread
  let newDiscordThread: ThreadChannel;
  try {
    // TODO: add retry logic and exponential backoff
    newDiscordThread = (await (
      interaction.channel as TextChannel
    )?.threads.create({
      name: threadName,
      type: ChannelType.PrivateThread,
      autoArchiveDuration: autoArchiveMinutes,
      reason: newDiscordThreadReason,
    })) as ThreadChannel;

    if (!newDiscordThread) {
      await interaction.editReply(
        "Failed to create Discord thread - no Discord thread channel returned",
      );
      return;
    }

    newDiscordThread.setRateLimitPerUser(config.DISCORD_SLOW_MODE_SECONDS);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    await interaction.editReply(
      `Error creating Discord thread: ${errorMessage}`,
    );
    console.error("Error creating Discord thread:", error);
    return;
  }

  // Respond to the interaction
  await interaction.editReply(
    `Started a new chat thread: <#${newDiscordThread.id}>`,
  );

  activeChatThreads.set(newDiscordThread.id, {
    chatIdentifier: chatIdentifier,
    userId: interaction.user.id,
    modelOptions: getModelOptions(interaction),
  });
};

const handleStartChatCommand = async (
  interaction: ChatInputCommandInteraction,
) => {
  await interaction.deferReply();

  const userDb = await getOrInitUserDb(interaction.user.id);

  // Generate a unique chat identifier - regenerate if value already exists in
  // user DB
  let chatIdentifier: string;
  let chatIdExists: ChatIdExistence;
  try {
    do {
      chatIdentifier = uniqueNamesGenerator({
        dictionaries: [adjectives, colors, animals],
        separator: "-",
      });
      chatIdExists = userDb
        .query(chatIdentifierExistenceQuery)
        .get(chatIdentifier) as ChatIdExistence;
    } while (chatIdExists.exists === 1);
  } catch (error) {
    console.error("Error checking chat identifier existence:", error);
    await interaction.editReply(
      "An error occurred while checking for existing chat identifiers.",
    );
    throw error;
  } finally {
    await releaseUserDb(interaction.user.id);
  }

  await createDiscordThread(
    interaction,
    chatIdentifier,
    `New LLM chat requested by ${interaction.user.username}`,
  );
};

const handleResumeChatCommand = async (
  interaction: ChatInputCommandInteraction,
) => {
  await interaction.deferReply();

  const userDb = await getOrInitUserDb(interaction.user.id);
  const chatIdentifier = interaction.options.getString("chat_identifier", true);

  let chatIdExists: ChatIdExistence;
  try {
    // Check if the user provided chat identifier exists in the user DB
    chatIdExists = userDb
      .query(chatIdentifierExistenceQuery)
      .get(chatIdentifier) as ChatIdExistence;
  } catch (error) {
    console.error("Error checking chat identifier existence:", error);
    await interaction.editReply(
      "An error occurred while checking for existing chat identifiers.",
    );
    throw error;
  } finally {
    await releaseUserDb(interaction.user.id);
  }

  if (chatIdExists.exists !== 1) {
    await interaction.editReply(`Chat "${chatIdentifier}" does not exist.`);
    return;
  }

  await createDiscordThread(
    interaction,
    chatIdentifier,
    `LLM chat resumption requested by ${interaction.user.username}`,
  );
};

const handleUserMessage = async (
  discordMessage: DiscordMessage,
  ollamaClient: OllamaClient,
  chatIdentifier: string,
  modelOptions: Partial<OllamaOptions>,
  userId: string,
) => {
  if (
    discordMessage.channel.isTextBased() &&
    "sendTyping" in discordMessage.channel
  ) {
    await discordMessage.channel.sendTyping(); // Show typing indicator to the user
  }

  try {
    const response = await processUserMessage(
      userId,
      ollamaClient,
      chatIdentifier,
      discordMessage.content,
      discordMessage.createdAt,
      modelOptions,
    );

    // Discord has a message limit of 2000
    if (response.length > 2000) {
      const chunks = response.match(/[\s\S]{1,2000}/g) || [];
      for (const chunk of chunks) {
        await discordMessage.reply(chunk).catch((err) => {
          console.log("There was an error sending a message chunk", err);
          throw err; // make sure this still bubbles up
        });
      }
    } else {
      await discordMessage.reply(response).catch((err) => {
        console.log("There was an error sending the message", err);
        throw err; // make sure this still bubbles up
      });
    }
  } catch (error) {
    console.error("Error during chat:", error);
    discordMessage.reply(
      "Sorry, I encountered an error while processing your request.",
    );
  }
};
