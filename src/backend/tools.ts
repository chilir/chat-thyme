// src/backend/tools.ts

import type { Database } from "bun:sqlite";
import { sleep } from "bun";
import type Exa from "exa-js";
import type OpenAI from "openai";
import pRetry from "p-retry";
import type {
  ExpandedChatCompletionMessage,
  ExpandedChatParameters,
  ProcessedMessageContent,
} from "../interfaces";
import { chatWithModel } from "./llm-service";
import {
  extractMessageContent,
  processOpenRouterContent,
  saveChatMessageToDb,
} from "./utils";

/**
 * Processes an Exa search tool call and returns the search results.
 * Implements retry logic and error handling for the search operation.
 *
 * @param {OpenAI.ChatCompletionMessageToolCall} toolCall - Model tool call
 * @param {Exa} exaClient - Authenticated Exa client
 * @returns {Promise<OpenAI.ChatCompletionToolMessageParam>} Tool response
 *   message with search results to send to the model
 */
const processExaSearchCall = async (
  toolCall: OpenAI.ChatCompletionMessageToolCall,
  exaClient: Exa,
): Promise<OpenAI.ChatCompletionToolMessageParam> => {
  const funcArgs = JSON.parse(toolCall.function.arguments);
  const searchResults = await pRetry(
    async () => {
      const result = await exaClient.searchAndContents(funcArgs.query, {
        type: "auto",
        highlights: true,
        numResults: 3,
      });
      if (!result) throw new Error("Search returned no results");
      return result;
    },
    {
      retries: 5,
      factor: 2,
      minTimeout: 100,
      maxTimeout: 60000,
      // TODO: use `shouldRetry` to not retry on 402s (insufficient balance)
      onFailedAttempt: (error) => {
        console.warn(
          `Search attempt ${error.attemptNumber} failed. ${error.retriesLeft} \
retries left.`,
        );
      },
    },
  ).catch((error) => {
    console.error("Search failed after all retries:", error);
    return null;
  });

  console.debug("\n----------");
  console.debug("Exa search results:");
  console.debug(searchResults);

  return {
    role: "tool",
    content: searchResults
      ? [
          {
            type: "text",
            text: JSON.stringify({
              name: "exa_search",
              response: searchResults,
            }),
          },
        ]
      : [
          {
            type: "text",
            text: JSON.stringify({
              name: "exa_search",
              response: { error: "Search failed", results: [] },
            }),
          },
        ],
    tool_call_id: toolCall.id,
  };
};

/**
 * Process a series of tool calls and generate a response based on their
 * results.
 * This function handles executing tool calls, collecting their results, and
 * generating a final response using the model.
 *
 * @param {OpenAI.ChatCompletionMessageToolCall[]} toolCalls - Tool calls to
 *   process
 * @param {Exa} exaClient - Authenticated Exa client
 * @param {OpenAI.ChatCompletionMessageParam[]} currentChatMessages - Current
 *   chat history
 * @param {OpenAI} modelClient - Authenticated OpenAI client
 * @param {string} model - Model name
 * @param {Partial<ExpandedChatParameters>} modelOptions - Model parameters
 * @param {Database} userDb - User DB connection
 * @param {string} userId - Discord user ID
 * @param {string} chatId - Chat session ID
 * @returns {Promise<ProcessedMessageContent>} The final processed response
 */
export const processToolCalls = async (
  toolCalls: OpenAI.ChatCompletionMessageToolCall[],
  exaClient: Exa,
  currentChatMessages: OpenAI.ChatCompletionMessageParam[],
  modelClient: OpenAI,
  model: string,
  modelOptions: Partial<ExpandedChatParameters>,
  userDb: Database,
  userId: string,
  chatId: string,
): Promise<ProcessedMessageContent> => {
  console.debug("\n----------");
  console.debug("Tool calls:");
  console.debug(toolCalls);

  for (const toolCall of toolCalls) {
    if (toolCall.function.name === "exa_search") {
      const toolResponse = await processExaSearchCall(toolCall, exaClient);
      currentChatMessages.push(toolResponse);
      await saveChatMessageToDb(
        userDb,
        userId,
        chatId,
        "tool",
        toolResponse.content,
        new Date(),
        toolResponse.tool_call_id,
      );
    } else {
      console.warn(`Unknown tool call: ${toolCall.function.name}`);
    }
  }

  let responseToToolCallResults: OpenAI.ChatCompletion;
  try {
    responseToToolCallResults = await chatWithModel(
      modelClient,
      {
        modelName: model,
        messages: currentChatMessages.slice(-toolCalls.length),
        useTools: false, // prevent infinite tool call loops
      },
      modelOptions,
    );
  } catch (error) {
    // make sure record of error is saved to chat history + db before bubbling
    // up error
    const errorMessage = error instanceof Error ? error.message : `${error}`;
    currentChatMessages.push({
      role: "assistant",
      content: `Failed to process search results: ${errorMessage}`,
    });
    await saveChatMessageToDb(
      userDb,
      userId,
      chatId,
      "assistant",
      `Failed to process search results: ${errorMessage}`,
      new Date(),
    );
    throw error;
  }

  if (!responseToToolCallResults.choices.length) {
    console.warn(
      "Received empty choices array in model response for tool call results",
    );
    return {
      timestamp: new Date(responseToToolCallResults.created * 1000),
      msgContent: "Failed to process search results",
      reasoningContent: undefined,
    };
  }

  const firstChoice = responseToToolCallResults
    .choices[0] as OpenAI.ChatCompletion.Choice;
  const { msgContent, reasoningContent } = extractMessageContent(
    firstChoice.message as ExpandedChatCompletionMessage,
  );

  return processOpenRouterContent(
    new Date(responseToToolCallResults.created * 1000),
    msgContent,
    reasoningContent,
    responseToToolCallResults.choices.slice(1),
  );
};
