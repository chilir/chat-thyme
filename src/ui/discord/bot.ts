// src/ui/discord/bot.ts

import {
  type ChatInputCommandInteraction,
  type Client,
  type Message,
  SlashCommandBuilder,
  type TextChannel,
  type ThreadChannel,
} from "discord.js";
import type { Ollama } from "ollama";
import {
  adjectives,
  animals,
  colors,
  uniqueNamesGenerator,
} from "unique-names-generator";
import { processUserMessage } from "../../chat";
import { getOrInitializeDatabase } from "../../db/sqlite";
import type { OllamaModelOptions } from "../../interfaces";
import { startChatCommandData } from "./commands";

export const setupDiscordBot = (
  discordClient: Client,
  ollamaClient: Ollama,
) => {
  // Command registration
  discordClient.on("ready", async () => {
    console.log(`Logged in as ${discordClient.user?.tag}!`);
    try {
      // Register command on all the guilds bot is in
      for (const guild of discordClient.guilds.cache.values()) {
        await guild.commands.create(startChatCommandData);
      }
      console.log("Slash command registered successfully.");
    } catch (error) {
      console.error("Error registering slash command:", error);
    }
  });

  // Slash command interaction
  discordClient.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === "startchat") {
      await handleStartChatCommand(interaction, discordClient, ollamaClient);
    }
  });
};

const handleStartChatCommand = async (
  interaction: ChatInputCommandInteraction,
  discordClient: Client,
  ollamaClient: Ollama,
) => {
  await interaction.deferReply();

  // TODO: need to add a check at some point for uniqueness against existing
  // DB values, but it's a bit complex because DB access isn't available until
  // message handling below
  const chatIdentifier = uniqueNamesGenerator({
    dictionaries: [adjectives, colors, animals],
    separator: "-",
  });

  // Get options values from the command, or fallback to defaults
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
  const threadName = interaction.options.getString("thread_name")
    ? `(${chatIdentifier}) ${interaction.options.getString("thread_name")}`
    : `Chat with ${interaction.user.username}: ${chatIdentifier}`;
  const autoArchiveMinutes =
    interaction.options.getNumber("auto_archive_minutes") ?? 60;

  // Create a new thread
  const thread = (await (interaction.channel as TextChannel)?.threads.create({
    name: threadName,
    autoArchiveDuration: autoArchiveMinutes,
    reason: `LLM chat requested by ${interaction.user.username}`,
  })) as ThreadChannel;

  if (!thread) {
    await interaction.editReply("There was an error creating a new thread.");
    return;
  }

  // Respond in the new thread
  await interaction.editReply(`Started a new chat thread: <#${thread.id}>`);

  // Setup event listener for every new message in the thread
  discordClient.on("messageCreate", async (message) => {
    if (message.channelId !== thread.id) return;
    // Ignore messages from the bot itself
    if (message.author.id === discordClient.user?.id) return;

    await handleUserMessage(message, ollamaClient, chatIdentifier, {
      temperature,
      topK: topK,
      topP: topP,
      repeatPenalty: repeatPenalty,
      frequencyPenalty: frequencyPenalty,
      presencePenalty: presencePenalty,
      numCtx: numCtx,
    });
  });
};

const handleUserMessage = async (
  message: Message,
  ollamaClient: Ollama,
  chatIdentifier: string,
  options: OllamaModelOptions,
) => {
  if (message.channel.isTextBased() && "sendTyping" in message.channel) {
    await message.channel.sendTyping(); // Show typing indicator to the user
  }

  const userDb = await getOrInitializeDatabase(message.author.id);

  try {
    const response = await processUserMessage(
      userDb,
      ollamaClient,
      chatIdentifier,
      message.content,
      options,
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
