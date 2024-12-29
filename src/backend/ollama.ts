import type { Ollama } from "ollama";
import type { OllamaChatPrompt } from "../types";

export async function chatWithModel(
  ollama_client: Ollama,
  prompt: OllamaChatPrompt,
): Promise<string> {
  try {
    const response = await ollama_client.chat({
      model: prompt.model_name,
      messages: prompt.past_messages,
      options: prompt.options,
      stream: false,
    });
    return response.message.content;
  } catch (error) {
    console.error("Error during Ollama interaction:", error);
    throw new Error("Failed to get response from Ollama");
  }
}
