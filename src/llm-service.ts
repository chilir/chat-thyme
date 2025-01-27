// src/llm-service.ts

import type { OpenAI } from "openai";
import type { ChatPrompt } from "./interfaces";

/**
 * Sends a chat request to the model and returns the response.
 * This function handles the direct interaction with the model server via
 * the OpenAI library.
 *
 * @param {OpenAI} modelClient - LLM service client
 * @param {ChatPrompt} prompt - The chat prompt containing model name and
 * messages
 * @returns {Promise<OpenAI.Chat.ChatCompletion>} The response from the model
 * @throws Will throw an error if the request fails
 */
export const chatWithModel = async (
  modelClient: OpenAI,
  prompt: ChatPrompt,
): Promise<OpenAI.Chat.ChatCompletion> => {
  try {
    const response = await modelClient.chat.completions.create({
      model: prompt.modelName,
      messages: prompt.messages,
    });
    return response;
  } catch (error) {
    console.error("Error during model interaction:", error);
    throw error;
  }
};
