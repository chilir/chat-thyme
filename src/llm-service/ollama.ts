// src/llm-service/ollama.ts

import type { ChatResponse, Ollama } from "ollama";
import type { OllamaChatPrompt } from "../interfaces";

export async function chatWithModel(
  ollamaClient: Ollama,
  prompt: OllamaChatPrompt,
): Promise<ChatResponse> {
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
    throw new Error("Failed to get response from Ollama");
  }
}
