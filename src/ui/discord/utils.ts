// src/ui/discord/utils.ts

import {
  ChannelType,
  type ChatInputCommandInteraction,
  type Client as DiscordClient,
  type Message as DiscordMessage,
  type TextChannel,
  type ThreadChannel,
} from "discord.js";

import type OpenAI from "openai";
import pRetry from "p-retry";
import { processUserMessage } from "../../chat";
import type { ChatThymeConfig } from "../../config";
import type {
  ChatMessageQueue,
  ChatParameters,
  ChatThreadInfo,
  dbCache,
} from "../../interfaces";

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

export const createDiscordThread = async (
  interaction: ChatInputCommandInteraction,
  chatId: string,
  newDiscordThreadReason: string,
  slowModeInterval: number,
  activeChatThreads: Map<string, ChatThreadInfo>,
): Promise<void> => {
  // Get user specified Discord thread properties
  const autoArchiveMinutes =
    interaction.options.getInteger("auto_archive_minutes") ?? 60;
  const threadName = interaction.options.getString("thread_name")
    ? `(${chatId}) ${interaction.options.getString("thread_name")}`
    : `Chat with ${interaction.user.username}: ${chatId}`;

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

      newDiscordThread.setRateLimitPerUser(slowModeInterval);
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
  }
};

export const startQueueWorker = (
  chatMessageQueues: Map<string, ChatMessageQueue>,
  chatThreadInfo: ChatThreadInfo,
  modelClient: OpenAI,
  config: ChatThymeConfig,
  userDbCache: dbCache,
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
            modelClient,
            chatThreadInfo,
            discordMessage,
            config,
            userDbCache,
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

export const processMessageFromQueue = async (
  modelClient: OpenAI,
  chatThreadInfo: ChatThreadInfo,
  discordMessage: DiscordMessage,
  config: ChatThymeConfig,
  userDbCache: dbCache,
) => {
  try {
    const response = await processUserMessage(
      modelClient,
      chatThreadInfo.userId,
      chatThreadInfo.chatId,
      discordMessage.content,
      discordMessage.createdAt,
      chatThreadInfo.modelOptions,
      config,
      userDbCache,
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
      `Sorry, I encountered an error while processing your request: ${errorMessage}.`,
    );
  }
};
