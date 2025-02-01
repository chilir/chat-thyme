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
  ChatParameters,
  ChatThreadInfo,
  DbCache,
} from "../../interfaces";

/**
 * Periodically checks for archived threads and removes them from active tracking.
 * Also locks archived threads to prevent further interactions.
 *
 * @param discordClient - Discord client instance used to fetch channel information
 * @param activeChatThreads - Map of active chat threads keyed by channel ID
 * @param chatMessageQueues - Map of message queues for each chat
 * @returns NodeJS.Timeout - Interval handle for the eviction process
 */
export const startArchivedThreadEviction = (
  discordClient: DiscordClient,
  activeChatThreads: Map<string, ChatThreadInfo>,
  chatMessageQueues: Map<string, ChatMessageQueue>,
) => {
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
 * Extracts model-specific parameters from a Discord command interaction.
 * Returns a combined object of ChatParameters and top_k value.
 *
 * @param interaction - Discord command interaction containing the parameter options
 * @returns Object containing model parameters and top_k value
 */
export const getModelOptions = (
  interaction: ChatInputCommandInteraction,
): Partial<ChatParameters> & {
  top_k: number | null;
} => {
  const frequencyPenalty =
    interaction.options.getNumber("frequency_penalty") ?? null;
  const maxTokens = interaction.options.getInteger("max_tokens") ?? null;
  const minP = interaction.options.getNumber("min_p") ?? null;
  const presencePenalty =
    interaction.options.getNumber("presence_penalty") ?? null;
  const repeatPenalty = interaction.options.getNumber("repeat_penalty") ?? null;
  const temperature = interaction.options.getNumber("temperature") ?? null;
  const topA = interaction.options.getNumber("top_a") ?? null;
  const topK = interaction.options.getNumber("top_k") ?? null;
  const topP = interaction.options.getNumber("top_p") ?? null;

  return {
    frequency_penalty: frequencyPenalty,
    max_tokens: maxTokens,
    min_p: minP,
    presence_penalty: presencePenalty,
    repeat_penalty: repeatPenalty,
    temperature: temperature,
    top_a: topA,
    top_k: topK,
    top_p: topP,
    include_reasoning: true,
  };
};

/**
 * Creates a new Discord thread for chat interaction with retry logic.
 * Configures thread settings and adds it to active threads tracking.
 *
 * @param interaction - Discord command interaction
 * @param chatId - Unique identifier for the chat session
 * @param newDiscordThreadReason - Reason for creating the new thread
 * @param slowModeInterval - Slow mode interval in seconds
 * @param activeChatThreads - Map to track active chat threads
 * @throws Will throw an error if thread creation fails after all retries
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

  // retryable operation
  const operation = async () => {
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
      ); // Throw error to trigger retry
    }

    newDiscordThread.setRateLimitPerUser(slowModeInterval);
    return newDiscordThread;
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
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    await interaction.editReply(
      `Error creating Discord thread after multiple retries: ${errorMessage}`,
    );
    console.error("Error creating Discord thread after retries failed:", error);
    throw error;
  }
};

/**
 * Initiates a worker to process messages from a chat queue.
 * Handles message processing and error handling in an infinite loop.
 *
 * @param chatMessageQueues - Map of message queues for each chat
 * @param chatThreadInfo - Information about the chat thread
 * @param userDbCache - Database connection cache
 * @param config - Application configuration
 * @param modelClient - OpenAI client instance
 * @param exaClient - Optional Exa client for web searches
 */
export const startQueueWorker = (
  chatMessageQueues: Map<string, ChatMessageQueue>,
  chatThreadInfo: ChatThreadInfo,
  userDbCache: DbCache,
  config: ChatThymeConfig,
  modelClient: OpenAI,
  exaClient: Exa | undefined,
) => {
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
        } catch (error) {
          console.error(
            `Error processing message from queue for chat ${chatThreadInfo.chatId}:`,
            error,
          );
          discordMessage.reply(
            `Sorry, I encountered an error while processing your message: \
${discordMessage.content}.`,
          );
        }
      } else {
        await new Promise((resolve) => setTimeout(resolve, 100)); // Wait 100ms (adjust as needed)
      }
    }
  })();
};

/**
 * Processes a single message from the queue and sends the response.
 * Handles message splitting for responses exceeding Discord's length limit.
 *
 * @param chatThreadInfo - Information about the chat thread
 * @param userDbCache - Database connection cache
 * @param dbDir - Directory path for database files
 * @param dbConnectionCacheSize - Maximum number of cached database connections
 * @param systemPrompt - System prompt for the chat
 * @param discordMessage - Discord message to process
 * @param modelClient - OpenAI client instance
 * @param model - Name of the model to use
 * @param useTools - Whether to allow tool usage
 * @param exaClient - Optional Exa client for web searches
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
) => {
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

    // Discord has a message limit of 2000
    // TODO: break chunks at words not characters
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
      `Sorry, I encountered an error while processing your request: \
${errorMessage}.`,
    );
  }
};
