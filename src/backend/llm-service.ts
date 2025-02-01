// src/backend/llm-service.ts

import { APIError, type OpenAI } from "openai";
import pRetry from "p-retry";
import type { ChatParameters, ChatPrompt, ChatResponse } from "../interfaces";
import { CHAT_THYME_TOOLS } from "./tools";

/**
 * Sends a chat request to the model and returns the response.
 * This function handles the direct interaction with the model server via
 * the OpenAI client, including retry logic and error handling.
 *
 * @param {OpenAI} modelClient - OpenAI client instance for making API calls
 * @param {ChatPrompt} prompt - The chat prompt containing model name, messages,
 *   and tool usage preferences
 * @param {Partial<ChatParameters>} options - Additional model parameters such
 *   as temperature, top_p, etc.
 * @returns {Promise<OpenAI.Chat.ChatCompletion>} The model's response
 * @throws {Error} With specific error messages:
 *   - Rate limit exceeded (429)
 *   - Original error message for other API errors
 *   - Unknown error occurred during model interaction
 */
export const chatWithModel = async (
  modelClient: OpenAI,
  prompt: ChatPrompt,
  options: Partial<ChatParameters>,
): Promise<OpenAI.Chat.ChatCompletion> => {
  try {
    const response = await pRetry(
      async () => {
        const chatResponse = (await modelClient.chat.completions.create({
          model: prompt.modelName,
          messages: prompt.messages,
          tools: prompt.useTools ? CHAT_THYME_TOOLS : undefined,
          ...options,
        })) as ChatResponse;

        if (chatResponse.error) {
          throw new APIError(
            chatResponse.error.code,
            chatResponse.error,
            chatResponse.error.message,
            chatResponse.error.metadata as Record<
              string,
              string | null | undefined
            >,
          );
        }

        return chatResponse;
      },
      {
        retries: 3,
        factor: 2,
        minTimeout: 1000,
        maxTimeout: 15000,
        shouldRetry: (error) => {
          console.debug(error);
          return error instanceof APIError
            ? error.status === 429 ||
                (error.status >= 500 && error.status < 600)
            : true;
        },
        onFailedAttempt: (error) => {
          console.debug(error);
          console.debug(
            `Chat response attempt ${error.attemptNumber} failed. There are \
${error.retriesLeft} retries left...`,
          );
        },
      },
    );
    return response;
  } catch (error) {
    let errorMsg: string;
    let errorCode: number | undefined = undefined;
    let errorMetadata: Record<string, unknown> | undefined = undefined;
    if (error instanceof APIError) {
      errorMsg = error.message;
      errorCode = error.status;
      errorMetadata = error.headers;
    } else {
      errorMsg = error instanceof Error ? error.message : "Unknown error";
    }
    console.debug("\n----------");
    console.debug(error);
    console.debug(`Model response error code: ${errorCode}`);
    console.debug(`Model response error message: ${errorMsg}`);
    console.debug("Model response error metadata:");
    console.debug(errorMetadata);

    if (!errorCode) {
      throw new Error("Unknown error occurred during model interaction.");
    }
    const rethrowErrorMsg: string =
      errorCode === 429 ? "Rate limit exceeded" : errorMsg;
    prompt.messages.pop(); // remove the unprocessed message
    throw new Error(rethrowErrorMsg);
  }
};
