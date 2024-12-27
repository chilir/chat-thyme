import {
  type ChatInputCommandInteraction,
  type Client,
  type Message,
  SlashCommandBuilder,
  type TextChannel,
  type ThreadChannel,
} from "discord.js";
import type { Ollama } from "ollama";
import { config } from "../config";
import type {
  ChatMessage,
  OllamaChatPrompt,
  OllamaModelOptions,
} from "../types";
import { chatWithModel } from "./ollama_chat";

// Chat history cache
const chatHistories = new Map<string, ChatMessage[]>();

export const setupDiscordBot = (
  discord_client: Client,
  ollama_client: Ollama,
) => {
  // Command registration
  discord_client.on("ready", async () => {
    console.log(`Logged in as ${discord_client.user?.tag}!`);
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
      for (const guild of discord_client.guilds.cache.values()) {
        await guild.commands.create(commandData);
      }
      console.log("Slash command registered successfully.");
    } catch (error) {
      console.error("Error registering slash command:", error);
    }
  });

  // Slash command interaction
  discord_client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === "startchat") {
      await handleStartChatCommand(interaction, discord_client, ollama_client);
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
  const top_k = interaction.options.getNumber("top_k") ?? undefined;
  const top_p = interaction.options.getNumber("top_p") ?? undefined;
  const repeat_penalty =
    interaction.options.getNumber("repeat_penalty") ?? undefined;
  const frequency_penalty =
    interaction.options.getNumber("frequency_penalty") ?? undefined;
  const presence_penalty =
    interaction.options.getNumber("presence_penalty") ?? undefined;
  const num_ctx = interaction.options.getNumber("num_ctx") ?? undefined;

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

    await handleUserMessage(message, client, ollama, thread, {
      temperature,
      top_k,
      top_p,
      repeat_penalty,
      frequency_penalty,
      presence_penalty,
      num_ctx,
    });
  });
};

const handleUserMessage = async (
  message: Message,
  discord_client: Client,
  ollama_client: Ollama,
  thread: ThreadChannel,
  options: OllamaModelOptions,
) => {
  if (message.channel.isTextBased() && "sendTyping" in message.channel) {
    await message.channel.sendTyping(); // Show typing indicator to the user
  }

  let currentChatHistory: ChatMessage[] = chatHistories.get(thread.id) ?? [];

  if (currentChatHistory.length === 0) {
    // Fetch all messages in the thread
    const fetchedMessages = await thread.messages.fetch({ limit: 100 });

    currentChatHistory = fetchedMessages
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp) // Sort messages by timestamp
      .map((msg) => ({
        role: msg.author.id === discord_client.user?.id ? "assistant" : "user",
        content: msg.content,
      })) as ChatMessage[];

    // Add default system prompt message at the beginning of the history
    currentChatHistory.unshift({
      role: "system",
      content: config.OLLAMA_MODEL_SYSTEM_PROMPT,
    });
  }

  //Add the user message to the current chat history
  currentChatHistory.push({ role: "user", content: message.content });

  const prompt: OllamaChatPrompt = {
    model_name: config.OLLAMA_MODEL, // guaranteed to be set already
    past_messages: currentChatHistory,
    prompt: message.content,
    options: options,
  };

  try {
    const response = await chatWithModel(ollama_client, prompt);

    // Add the bot response to the current chat history
    currentChatHistory.push({ role: "assistant", content: response });

    // Save history in cache
    chatHistories.set(thread.id, currentChatHistory);

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
