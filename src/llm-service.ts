// src/llm-service.ts

import type { OpenAI } from "openai";
import type { ChatPrompt, ChatResponse } from "./interfaces";

const validateResponse = (response: ChatResponse): void => {
  if (response.error) {
    console.error(response.error);
    console.error(`Error metadata: ${response.error.metadata}`);
    throw new Error(
      `Error during model interaction: ${response.error.code} - ${response.error.message}`,
    );
  }
};

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
    validateResponse(response);
    return response;
  } catch (error) {
    console.error("Error during model interaction:", error);
    throw error;
  }
};
