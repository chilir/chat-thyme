// src/ui/discord/commands.ts

import { SlashCommandBuilder } from "discord.js";

export const startChatCommandData = new SlashCommandBuilder()
  .setName("start-chat")
  .setDescription("Start a chat with the LLM.")
  .addNumberOption((option) =>
    option
      .setName("temperature")
      .setDescription("The temperature of the model (0-2)")
      .setRequired(false)
      .setMinValue(0)
      .setMaxValue(2),
  )
  .addNumberOption((option) =>
    option
      .setName("num_ctx")
      .setDescription(
        "Sets the size of the context window used to generate the next token",
      )
      .setRequired(false)
      .setMinValue(1),
  )
  .addNumberOption((option) =>
    option
      .setName("top_k")
      .setDescription("The top_k of the model (0-100)")
      .setRequired(false)
      .setMinValue(0)
      .setMaxValue(100),
  )
  .addNumberOption((option) =>
    option
      .setName("top_p")
      .setDescription("The top_p of the model (0-1)")
      .setRequired(false)
      .setMinValue(0)
      .setMaxValue(1),
  )
  .addNumberOption((option) =>
    option
      .setName("repeat_penalty")
      .setDescription("The repeat_penalty of the model (0-2)")
      .setRequired(false)
      .setMinValue(0)
      .setMaxValue(2),
  )
  .addNumberOption((option) =>
    option
      .setName("frequency_penalty")
      .setDescription("The frequency_penalty of the model (0-2)")
      .setRequired(false)
      .setMinValue(0)
      .setMaxValue(2),
  )
  .addNumberOption((option) =>
    option
      .setName("presence_penalty")
      .setDescription("The presence_penalty of the model (0-2)")
      .setRequired(false)
      .setMinValue(0)
      .setMaxValue(2),
  )
  .addStringOption((option) =>
    option
      .setName("thread_name")
      .setDescription("Custom name for the chat thread")
      .setRequired(false),
  )
  .addIntegerOption(
    (option) =>
      option
        .setName("auto_archive_minutes")
        .setDescription("Minutes until thread auto archives")
        .setRequired(false)
        .setMinValue(60) // Minimum 1 hour
        .setMaxValue(10080), // Maximum 7 days,
  );

export const resumeChatCommandData = new SlashCommandBuilder()
  .setName("resume-chat")
  .setDescription("Resume a previous chat with the LLM.")
  .addStringOption((option) =>
    option
      .setName("chat_identifier")
      .setDescription("The identifier of the chat to resume")
      .setRequired(true),
  )
  .addNumberOption((option) =>
    option
      .setName("temperature")
      .setDescription("The temperature of the model (0-2)")
      .setRequired(false)
      .setMinValue(0)
      .setMaxValue(2),
  )
  .addNumberOption((option) =>
    option
      .setName("num_ctx")
      .setDescription(
        "Sets the size of the context window used to generate the next token",
      )
      .setRequired(false)
      .setMinValue(1),
  )
  .addNumberOption((option) =>
    option
      .setName("top_k")
      .setDescription("The top_k of the model (0-100)")
      .setRequired(false)
      .setMinValue(0)
      .setMaxValue(100),
  )
  .addNumberOption((option) =>
    option
      .setName("top_p")
      .setDescription("The top_p of the model (0-1)")
      .setRequired(false)
      .setMinValue(0)
      .setMaxValue(1),
  )
  .addNumberOption((option) =>
    option
      .setName("repeat_penalty")
      .setDescription("The repeat_penalty of the model (0-2)")
      .setRequired(false)
      .setMinValue(0)
      .setMaxValue(2),
  )
  .addNumberOption((option) =>
    option
      .setName("frequency_penalty")
      .setDescription("The frequency_penalty of the model (0-2)")
      .setRequired(false)
      .setMinValue(0)
      .setMaxValue(2),
  )
  .addNumberOption((option) =>
    option
      .setName("presence_penalty")
      .setDescription("The presence_penalty of the model (0-2)")
      .setRequired(false)
      .setMinValue(0)
      .setMaxValue(2),
  )
  .addStringOption((option) =>
    option
      .setName("thread_name")
      .setDescription("Custom name for the chat thread")
      .setRequired(false),
  )
  .addIntegerOption((option) =>
    option
      .setName("auto_archive_minutes")
      .setDescription("Minutes until thread auto archives")
      .setRequired(false)
      .setMinValue(60)
      .setMaxValue(10080),
  );
