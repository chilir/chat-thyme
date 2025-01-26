// src/llm-service/ollama.ts

import type { ChatResponse, Ollama as OllamaClient } from "ollama";
import type { OllamaChatPrompt } from "../interfaces";

/**
 * Sends a chat request to the Ollama model and returns the response.
 * This function handles the direct interaction with the Ollama API.
 *
 * @param {OllamaClient} ollamaClient - The initialized Ollama client instance
 * @param {OllamaChatPrompt} prompt - The chat prompt containing model name,
 * messages, and options
 * @returns {Promise<ChatResponse>} The response from the Ollama model
 * @throws Will throw an error if the Ollama API interaction fails
 */
export const chatWithModel = async (
  ollamaClient: OllamaClient,
  prompt: OllamaChatPrompt,
): Promise<ChatResponse> => {
  try {
    const response = await ollamaClient.chat({
      model: prompt.modelName,
      messages: prompt.messages,
      options: prompt.options,
      stream: false,
    });
    return response;
  } catch (error) {
    console.error("Error during Ollama interaction:", error);
    throw error;
  }
};
