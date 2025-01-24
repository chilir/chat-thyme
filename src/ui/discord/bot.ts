// src/ui/discord/bot.ts

import type { Database } from "bun:sqlite";
import {
  ChannelType,
  type ChatInputCommandInteraction,
  type Client as DiscordClient,
  type Message as DiscordMessage,
  type TextChannel,
  type ThreadChannel,
} from "discord.js";
import type { Ollama as OllamaClient, Options as OllamaOptions } from "ollama";
import pRetry from "p-retry";
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

// Map to store message queues per chatIdentifier
const chatMessageQueues = new Map<
  string,
  {
    queue: DiscordMessage[];
    stopSignal: boolean;
  }
>();

const startArchivedThreadEviction = (discordClient: DiscordClient) => {
  setInterval(
    async () => {
      for (const [channelId, threadInfo] of activeChatThreads) {
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
            chatMessageQueues.delete(threadInfo.chatIdentifier);
          }
        } catch (error) {
          console.warn(
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
    console.info(`Logged in as ${discordClient.user?.tag}!`);
    try {
      // Register commands on all the guilds bot is in
      for (const guild of discordClient.guilds.cache.values()) {
        console.debug(
          `Deleting existing commands for guild ${guild.name} (${guild.id})...`,
        );
        await guild.commands.set([]);
        console.debug(
          `Creating start-chat command for guild ${guild.name} (${guild.id})...`,
        );
        await guild.commands.create(startChatCommandData);
        console.debug(
          `Creating resume-chat command for guild ${guild.name} (${guild.id})...`,
        );
        await guild.commands.create(resumeChatCommandData);
      }
      console.info(
        "start-chat and resume-chat slash commands registered successfully.",
      );
      await new Promise((resolve) => setTimeout(resolve, 5000)); // 5 second delay
      console.info("Delay finished after command registration. Bot ready.");
    } catch (error) {
      console.error("Error registering slash command:", error);
    }

    startArchivedThreadEviction(discordClient);
  });

  // Slash command interaction
  discordClient.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    console.debug(
      `Interaction received: ${interaction.commandName}, User: ${interaction.user.tag}, Options: ${JSON.stringify(interaction.options.data)}`,
    );
    if (interaction.commandName === "start-chat") {
      console.debug("Handling start-chat command.");
      await handleStartChatCommand(interaction);
    } else if (interaction.commandName === "resume-chat") {
      console.debug("Handling resume-chat command.");
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
  const numCtx = interaction.options.getInteger("num_ctx") ?? undefined;
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
  await interaction.deferReply(); // Defer reply at the beginning

  // Get user specified Discord thread properties
  const threadName = interaction.options.getString("thread_name")
    ? `(${chatIdentifier}) ${interaction.options.getString("thread_name")}`
    : `Chat with ${interaction.user.username}: ${chatIdentifier}`;
  const autoArchiveMinutes =
    interaction.options.getInteger("auto_archive_minutes") ?? 60;

  // Define the retryable operation (thread creation logic)
  const operation = async () => {
    let newDiscordThread: ThreadChannel;
    try {
      newDiscordThread = (await (
        interaction.channel as TextChannel
      )?.threads.create({
        name: threadName,
        type: ChannelType.PrivateThread,
        autoArchiveDuration: autoArchiveMinutes,
        reason: newDiscordThreadReason,
      })) as ThreadChannel;

      if (!newDiscordThread) {
        throw new Error(
          "Failed to create Discord thread - no Discord thread channel returned",
        ); // Throw error to trigger retry
      }

      newDiscordThread.setRateLimitPerUser(config.DISCORD_SLOW_MODE_SECONDS);
      return newDiscordThread; // Return successful thread object
    } catch (error) {
      console.error("Error creating Discord thread (attempting retry):", error);
      throw error; // Re-throw error to trigger p-retry
    }
  };

  // retry + exponential backoff for thread creation
  try {
    const newDiscordThread = await pRetry(operation, {
      retries: 3,
      factor: 2,
      minTimeout: 1000, // Initial delay (1 second)
      maxTimeout: 15000, // Max delay (15 seconds)
      onFailedAttempt: (error) => {
        console.warn(
          `Discord thread creation attempt ${error.attemptNumber} failed. \
          There are ${error.retriesLeft} retries left...`,
        );
      },
    });

    // Respond to the interaction after successful thread creation
    await interaction.editReply(
      `Started a new chat thread: <#${newDiscordThread.id}>`,
    );

    activeChatThreads.set(newDiscordThread.id, {
      chatIdentifier: chatIdentifier,
      userId: interaction.user.id,
      modelOptions: getModelOptions(interaction),
    });
  } catch (error) {
    // all retry attempts have failed
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    await interaction.editReply(
      `Error creating Discord thread after multiple retries: ${errorMessage}`,
    );
    console.error("Error creating Discord thread after retries failed:", error);
  }
};

const handleStartChatCommand = async (
  interaction: ChatInputCommandInteraction,
) => {
  let userDb: Database;
  try {
    userDb = await getOrInitUserDb(interaction.user.id);
  } catch (error) {
    console.error(
      `Error getting/initializing user database for ${interaction.user.id}:`,
      error,
    );
    throw error;
  }

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
  let userDb: Database;
  try {
    userDb = await getOrInitUserDb(interaction.user.id);
  } catch (error) {
    console.error(
      `Error getting/initializing user database for ${interaction.user.id}:`,
      error,
    );
    throw error;
  }
  const chatIdentifier = interaction.options.getString("chat_identifier", true);

  let chatIdExists: ChatIdExistence;
  try {
    // Check if the user provided chat identifier exists in the user DB
    chatIdExists = userDb
      .query(chatIdentifierExistenceQuery)
      .get(chatIdentifier) as ChatIdExistence;
  } catch (error) {
    console.error(
      `Error checking database for ${chatIdentifier} existence with ${interaction.user.id}:`,
      error,
    );
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
  let messageQueueEntry = chatMessageQueues.get(chatIdentifier);
  if (!messageQueueEntry) {
    messageQueueEntry = { queue: [], stopSignal: false };
    chatMessageQueues.set(chatIdentifier, messageQueueEntry);
    startQueueWorker(chatIdentifier, ollamaClient, modelOptions, userId);
  }

  messageQueueEntry.queue.push(discordMessage);
  console.debug(
    `Enqueued message ${discordMessage.content} for chat ${chatIdentifier}. Queue size: ${messageQueueEntry.queue.length}`,
  );
};

const startQueueWorker = (
  chatIdentifier: string,
  ollamaClient: OllamaClient,
  modelOptions: Partial<OllamaOptions>,
  userId: string,
) => {
  let messageQueueEntry = chatMessageQueues.get(chatIdentifier);
  if (!messageQueueEntry) {
    console.warn(`Queue not found for chat ${chatIdentifier}, stopping worker`);
    messageQueueEntry = { queue: [], stopSignal: true };
  }

  (async () => {
    while (true) {
      if (messageQueueEntry.stopSignal) {
        console.info(
          `Queue worker for chat ${chatIdentifier} received stop signal and is exiting.`,
        );
        return; // Exit worker loop
      }
      if (messageQueueEntry.queue.length > 0) {
        const discordMessage = messageQueueEntry.queue.shift(); // fifo
        if (!discordMessage) continue; // sanity check

        try {
          if (
            discordMessage.channel.isTextBased() &&
            "sendTyping" in discordMessage.channel
          ) {
            await discordMessage.channel.sendTyping(); // Typing indicator
          }

          await processMessageFromQueue(
            discordMessage,
            ollamaClient,
            chatIdentifier,
            modelOptions,
            userId,
          );
        } catch (error) {
          console.error(
            `Error processing message from queue for chat ${chatIdentifier}:`,
            error,
          );
          discordMessage.reply(
            `Sorry, I encountered an error while processing your message: ${discordMessage.content}.`,
          );
        }
      } else {
        await new Promise((resolve) => setTimeout(resolve, 100)); // Wait 100ms (adjust as needed)
      }
    }
  })();
};

const processMessageFromQueue = async (
  discordMessage: DiscordMessage,
  ollamaClient: OllamaClient,
  chatIdentifier: string,
  modelOptions: Partial<OllamaOptions>,
  userId: string,
) => {
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
          console.error("There was an error sending a message chunk", err);
          throw err;
        });
      }
    } else {
      await discordMessage.reply(response).catch((err) => {
        console.error("There was an error sending the message", err);
        throw err;
      });
    }
  } catch (error) {
    console.error("Error during chat:", error);
    const errorMessage = error instanceof Error ? error.message : `${error}`;
    discordMessage.reply(
      `Sorry, I encountered an error while processing your request: ${errorMessage}.`,
    );
  }
};
