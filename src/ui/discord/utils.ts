// src/ui/discord/utils.ts

import {
  ChannelType,
  type ChatInputCommandInteraction,
  type Client as DiscordClient,
  type Message as DiscordMessage,
  type TextChannel,
  type ThreadChannel,
} from "discord.js";
import type Exa from "exa-js";
import type OpenAI from "openai";
import pRetry from "p-retry";
import { processUserMessage } from "../../backend";
import type { ChatThymeConfig } from "../../config";
import type {
  ChatMessageQueue,
  ChatThreadInfo,
  DbCache,
  ExpandedChatParameters,
} from "../../interfaces";

/**
 * Periodically checks for archived threads and removes them from active tracking.
 * Also locks archived threads to prevent further interactions.
 *
 * @param {DiscordClient} discordClient Discord client instance used to fetch channel information
 * @param {Map<string, ChatThreadInfo>} activeChatThreads Map of active chat threads keyed by channel ID
 * @param {Map<string, ChatMessageQueue>} chatMessageQueues Map of message queues for each chat
 * @returns {void}
 */
export const startArchivedThreadEviction = (
  discordClient: DiscordClient,
  activeChatThreads: Map<string, ChatThreadInfo>,
  chatMessageQueues: Map<string, ChatMessageQueue>,
): void => {
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
            chatMessageQueues.delete(threadInfo.chatId);
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

export const chatIdentifierExistenceQuery =
  "SELECT EXISTS(SELECT 1 FROM chat_messages WHERE chat_id = ?) AS 'exists'";

/**
 * Extracts and validates model parameters from a Discord command interaction.
 * Only includes parameters that were explicitly provided in the interaction.
 * In non-strict mode, includes additional parameters.
 *
 * @param {ChatInputCommandInteraction} interaction Slash command interaction
 * @returns {Partial<ExpandedChatParameters>} Object containing provided parameters
 */
export const getModelOptions = (
  interaction: ChatInputCommandInteraction,
): Partial<ExpandedChatParameters> => {
  const strict = interaction.options.getBoolean("strict") ?? false;
  const options: Partial<ExpandedChatParameters> = {};

  const addIfProvided = (
    key: keyof ExpandedChatParameters,
    value: number | null,
  ) => {
    if (value !== null) {
      Object.assign(options, { [key]: value });
    }
  };

  // Core parameters available in both modes
  addIfProvided(
    "frequency_penalty",
    interaction.options.getNumber("frequency_penalty"),
  );
  addIfProvided("max_tokens", interaction.options.getInteger("max_tokens"));
  addIfProvided(
    "presence_penalty",
    interaction.options.getNumber("presence_penalty"),
  );
  addIfProvided(
    "repeat_penalty",
    interaction.options.getNumber("repeat_penalty"),
  );
  addIfProvided("seed", interaction.options.getInteger("seed"));
  addIfProvided("temperature", interaction.options.getNumber("temperature"));
  addIfProvided("top_p", interaction.options.getNumber("top_p"));

  // Additional parameters for non-strict mode
  if (!strict) {
    addIfProvided("min_p", interaction.options.getNumber("min_p"));
    addIfProvided("top_a", interaction.options.getNumber("top_a"));
    addIfProvided("top_k", interaction.options.getNumber("top_k"));
    options.include_reasoning = true;
  }

  return options;
};

/**
 * Creates a new Discord thread for chat interaction with retry logic.
 * Uses exponential backoff for retries on failure.
 *
 * @param {ChatInputCommandInteraction} interaction - Slash command interaction
 *   containing thread creation options
 * @param {string} chatId - Chat session ID
 * @param {string} newDiscordThreadReason - Audit log reason for creating the
 *   new thread
 * @param {number} slowModeInterval - Slow mode interval in seconds
 * @param {Map<string, ChatThreadInfo>} activeChatThreads - Map to track active
 *   chat threads
 * @throws Will throw an error if thread creation fails after all retries
 * @returns {Promise<void>}
 */
export const createDiscordThread = async (
  interaction: ChatInputCommandInteraction,
  chatId: string,
  newDiscordThreadReason: string,
  slowModeInterval: number,
  activeChatThreads: Map<string, ChatThreadInfo>,
): Promise<void> => {
  const autoArchiveMinutes =
    interaction.options.getInteger("auto_archive_minutes") ?? 60;
  const threadName = interaction.options.getString("thread_name")
    ? `(${chatId}) ${interaction.options.getString("thread_name")}`
    : `Chat with ${interaction.user.username}: ${chatId}`;

  try {
    const newDiscordThread = await pRetry(
      async () => {
        const newDiscordThread = (await (
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
          );
        }

        newDiscordThread.setRateLimitPerUser(slowModeInterval);
        return newDiscordThread;
      },
      {
        retries: 5,
        factor: 2,
        minTimeout: 100,
        maxTimeout: 60000,
        onFailedAttempt: (error) => {
          console.warn(
            `Discord thread creation attempt ${error.attemptNumber} failed. \
There are ${error.retriesLeft} retries left...`,
          );
        },
      },
    );

    await interaction.editReply(
      `Started a new chat thread: <#${newDiscordThread.id}>`,
    );

    activeChatThreads.set(newDiscordThread.id, {
      chatId: chatId,
      userId: interaction.user.id,
      modelOptions: getModelOptions(interaction),
    });
  } catch (error) {
    // all retry attempts have failed
    const errorMessage = error instanceof Error ? error.message : `${error}`;
    await interaction.editReply(
      `Error creating Discord thread after multiple retries: ${errorMessage}`,
    );
    console.error("Error creating Discord thread after retries failed:", error);
    throw error;
  }
};

/**
 * Initiates a worker to process messages from a chat queue.
 * Handles message processing until receiving a stop signal.
 *
 * @param {Map<string, ChatMessageQueue>} chatMessageQueues - Map of message
 *   queues for each chat
 * @param {ChatThreadInfo} chatThreadInfo - Information about the chat thread
 * @param {DbCache} userDbCache - Database connection cache
 * @param {ChatThymeConfig} config - Application configuration
 * @param {OpenAI} modelClient - Authenticated OpenAI client
 * @param {Exa | undefined} exaClient - Optional authenticated Exa client for
 *   web searches
 * @returns {void}
 */
export const startQueueWorker = (
  chatMessageQueues: Map<string, ChatMessageQueue>,
  chatThreadInfo: ChatThreadInfo,
  userDbCache: DbCache,
  config: ChatThymeConfig,
  modelClient: OpenAI,
  exaClient: Exa | undefined,
): void => {
  let messageQueueEntry = chatMessageQueues.get(chatThreadInfo.chatId);
  if (!messageQueueEntry) {
    console.warn(
      `Queue not found for chat ${chatThreadInfo.chatId}, stopping worker`,
    );
    messageQueueEntry = { queue: [], stopSignal: true };
  }

  (async () => {
    while (true) {
      if (messageQueueEntry.stopSignal) {
        console.info(
          `Queue worker for chat ${chatThreadInfo.chatId} received stop signal \
and is exiting.`,
        );
        return; // exit worker loop
      }
      if (messageQueueEntry.queue.length > 0) {
        const discordMessage = messageQueueEntry.queue.shift(); // fifo
        if (!discordMessage) continue; // sanity check

        if (
          discordMessage.channel.isTextBased() &&
          "sendTyping" in discordMessage.channel
        ) {
          await discordMessage.channel.sendTyping();
        }
        await processMessageFromQueue(
          chatThreadInfo,
          userDbCache,
          config.dbDir,
          config.dbConnectionCacheSize,
          config.systemPrompt,
          discordMessage,
          modelClient,
          config.model,
          config.useTools,
          exaClient,
        );
      } else {
        // wait for new messages
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  })();
};

/**
 * Processes a single message from the queue and sends the response.
 * Handles message splitting with pagination for responses exceeding Discord's
 * 2000-character limit.
 * Splits messages at word boundaries and adds pagination indicators.
 *
 * @param {ChatThreadInfo} chatThreadInfo - Information about the chat thread
 * @param {DbCache} userDbCache - Database connection cache
 * @param {string} dbDir - Directory path where database files are stored
 * @param {number} dbConnectionCacheSize - Desired maximum number of database
 *   connections to keep in cache
 * @param {string} systemPrompt - System prompt to prepend to chat history
 * @param {DiscordMessage} discordMessage - User Discord message to process
 * @param {OpenAI} modelClient - Authenticated OpenAI client
 * @param {string} model - Model name
 * @param {boolean} useTools - Whether to allow the model to use tools
 * @param {Exa | undefined} exaClient - Optional authenticated Exa client for
 *   web searches
 * @returns {Promise<void>}
 */
export const processMessageFromQueue = async (
  chatThreadInfo: ChatThreadInfo,
  userDbCache: DbCache,
  dbDir: string,
  dbConnectionCacheSize: number,
  systemPrompt: string,
  discordMessage: DiscordMessage,
  modelClient: OpenAI,
  model: string,
  useTools: boolean,
  exaClient: Exa | undefined,
): Promise<void> => {
  try {
    const response = await processUserMessage(
      chatThreadInfo,
      userDbCache,
      dbDir,
      dbConnectionCacheSize,
      systemPrompt,
      discordMessage.content,
      discordMessage.createdAt,
      modelClient,
      model,
      useTools,
      exaClient,
    );

    // split long messages
    if (response.length > 2000) {
      const chunks: string[] = [];
      const words = response.split(/(\s+)/);
      let currentChunk = "";

      // Try splitting by words first
      for (const word of words) {
        if ((currentChunk + word).length <= 1990) {
          currentChunk += word;
        } else {
          // If the current word alone is too long, split it by characters
          if (word.length > 1990) {
            if (currentChunk.trim().length > 0) {
              chunks.push(currentChunk.trim());
            }
            for (let i = 0; i < word.length; i += 1990) {
              chunks.push(word.slice(i, i + 1990));
            }
            currentChunk = "";
          } else {
            if (currentChunk.trim().length > 0) {
              chunks.push(currentChunk.trim());
            }
            currentChunk = word;
          }
        }
      }

      // Add the last chunk if not empty
      if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
      }

      for (let i = 0; i < chunks.length; i++) {
        const paginationSuffix =
          chunks.length > 1 ? `\n\n(${i + 1}/${chunks.length})` : "";
        await discordMessage
          .reply(chunks[i] + paginationSuffix)
          .catch((err) => {
            console.error(
              `There was an error sending a message chunk \
${i + 1}/${chunks.length}`,
              err,
            );
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
    const errorMessage = error instanceof Error ? error.message : `${error}`;
    discordMessage.reply(
      `Sorry, I encountered an error while processing your request: \
${errorMessage}.`,
    );
  }
};
