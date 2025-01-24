// src/llm-service/ollama.ts

import type { ChatResponse, Ollama as OllamaClient } from "ollama";
import type { OllamaChatPrompt } from "../interfaces";

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
