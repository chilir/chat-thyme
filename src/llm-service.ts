// src/llm-service.ts

import type { OpenAI } from "openai";
import type { ChatParameters, ChatPrompt, ChatResponse } from "./interfaces";
import { CHAT_THYME_TOOLS } from "./tools";
/**
 * Sends a chat request to the model and returns the response.
 * This function handles the direct interaction with the model server via
 * the OpenAI client.
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
  options: Partial<ChatParameters>,
): Promise<OpenAI.Chat.ChatCompletion> => {
  const response = (await modelClient.chat.completions.create({
    model: prompt.modelName,
    messages: prompt.messages,
    tools: prompt.useTools ? CHAT_THYME_TOOLS : undefined,
    ...options,
  })) as ChatResponse;

  if (response.error) {
    console.debug(response.error);
    console.debug(`Model response error code: ${response.error.code}`);
    console.debug(`Model response error message: ${response.error.message}`);
    console.debug(`Model response error metadata: ${response.error.metadata}`);
    throw new Error(
      `Error during model interaction: ${response.error.message}`,
    );
  }

  return response;
};
