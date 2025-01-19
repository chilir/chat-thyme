// src/ui/discord/commands.ts

import { SlashCommandBuilder } from "discord.js";

export const startChatCommandData = new SlashCommandBuilder()
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
