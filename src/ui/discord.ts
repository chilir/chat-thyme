// src/ui/discord.ts

import {
  type ChatInputCommandInteraction,
  type Client,
  type Message,
  SlashCommandBuilder,
  type TextChannel,
  type ThreadChannel,
} from "discord.js";
import type { Ollama } from "ollama";
import { processUserMessage } from "../chat";
import { getOrInitializeDatabase } from "../db/sqlite";
import type { OllamaModelOptions } from "../interfaces";

export const setupDiscordBot = (
  discordClient: Client,
  ollamaClient: Ollama,
) => {
  // Command registration
  discordClient.on("ready", async () => {
    console.log(`Logged in as ${discordClient.user?.tag}!`);
    // Register the slash command
    try {
      const commandData = new SlashCommandBuilder()
        .setName("startchat")
        .setDescription("Start a chat with the LLM.")
        .addNumberOption((option) =>
          option
            .setName("temperature")
            .setDescription("The temperature of the model (0-2)")
            .setMinValue(0)
            .setMaxValue(2),
        )
        .addNumberOption((option) =>
          option
            .setName("top_k")
            .setDescription("The top_k of the model (0-100)")
            .setMinValue(0)
            .setMaxValue(100),
        )
        .addNumberOption((option) =>
          option
            .setName("top_p")
            .setDescription("The top_p of the model (0-1)")
            .setMinValue(0)
            .setMaxValue(1),
        )
        .addNumberOption((option) =>
          option
            .setName("repeat_penalty")
            .setDescription("The repeat_penalty of the model (0-2)")
            .setMinValue(0)
            .setMaxValue(2),
        )
        .addNumberOption((option) =>
          option
            .setName("frequency_penalty")
            .setDescription("The frequency_penalty of the model (0-2)")
            .setMinValue(0)
            .setMaxValue(2),
        )
        .addNumberOption((option) =>
          option
            .setName("presence_penalty")
            .setDescription("The presence_penalty of the model (0-2)")
            .setMinValue(0)
            .setMaxValue(2),
        )
        .addNumberOption((option) =>
          option
            .setName("num_ctx")
            .setDescription(
              "Sets the size of the context window used to generate the next token",
            )
            .setMinValue(1),
        );

      // Register command on all the guilds bot is in
      for (const guild of discordClient.guilds.cache.values()) {
        await guild.commands.create(commandData);
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
  client: Client,
  ollama: Ollama,
) => {
  await interaction.deferReply();

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

  // Create a new thread
  const thread = (await (interaction.channel as TextChannel)?.threads.create({
    name: `Chat with ${interaction.user.username}`,
    autoArchiveDuration: 60,
    reason: `LLM chat requested by ${interaction.user.username}`,
  })) as ThreadChannel;

  if (!thread) {
    await interaction.editReply("There was an error creating a new thread.");
    return;
  }

  // Respond in the new thread
  await interaction.editReply(`Started a new chat thread: <#${thread.id}>`);

  // Setup event listener for every new message in the thread
  client.on("messageCreate", async (message) => {
    if (message.channelId !== thread.id) return;
    // Ignore messages from the bot itself
    if (message.author.id === client.user?.id) return;

    await handleUserMessage(message, ollama, thread, {
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
  thread: ThreadChannel,
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
      thread.id,
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
