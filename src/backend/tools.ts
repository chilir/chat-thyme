// src/backend/tools.ts

import type { Database } from "bun:sqlite";
import { sleep } from "bun";
import type Exa from "exa-js";
import type OpenAI from "openai";
import pRetry from "p-retry";
import type {
  ChatParameters,
  DbChatMessage,
  LLMChatMessage,
  ProcessedMessageContent,
} from "../interfaces";
import { chatWithModel } from "./llm-service";
import {
  extractMessageContent,
  processOpenRouterContent,
  saveChatMessagesToDb,
} from "./utils";

/**
 * Array of available tools that the LLM can use.
 * Currently includes only the Exa search function.
 */
export const CHAT_THYME_TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "exa_search",
      description:
        "Perform a search query on the web with Exa, and retrieve the most relevant URLs/web data.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query to perform.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
];

/**
 * Processes an Exa search tool call and returns the search results.
 * Implements retry logic and error handling for the search operation.
 *
 * @param {OpenAI.ChatCompletionMessageToolCall} toolCall - The tool call from the LLM
 * @param {Exa} exaClient - The Exa client instance for performing web searches
 * @returns {Promise<OpenAI.ChatCompletionToolMessageParam>} Tool response message with search results
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
      retries: 3,
      onFailedAttempt: (error) => {
        console.warn(
          `Search attempt ${error.attemptNumber} failed. ${error.retriesLeft} retries left.`,
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
 * Process a series of tool calls and generate a response based on their results.
 * This function handles executing tool calls, collecting their results, and generating
 * a final response using the model.
 *
 * @param {OpenAI.Chat.Completions.ChatCompletionMessageToolCall[]} toolCalls - Array of tool calls to process
 * @param {Exa} exaClient - The Exa client for web searches
 * @param {OpenAI.Chat.Completions.ChatCompletionMessageParam[]} currentChatMessages - The current conversation history
 * @param {OpenAI} modelClient - The OpenAI client for model interactions
 * @param {string} model - Name of the model to use
 * @param {Partial<ChatParameters>} modelOptions - Model parameters
 * @param {Database} userDb - User's database instance
 * @param {string} userId - Unique identifier for the user
 * @param {string} chatId - Unique identifier for the chat session
 * @returns {Promise<ProcessedMessageContent>} The final processed response
 */
export const processToolCalls = async (
  toolCalls: OpenAI.ChatCompletionMessageToolCall[],
  exaClient: Exa,
  currentChatMessages: OpenAI.ChatCompletionMessageParam[],
  modelClient: OpenAI,
  model: string,
  modelOptions: Partial<ChatParameters>,
  userDb: Database,
  userId: string,
  chatId: string,
): Promise<ProcessedMessageContent> => {
  const messagesToSave: DbChatMessage[] = [];

  console.debug("\n----------");
  console.debug("Tool calls:");
  console.debug(toolCalls);
  for (const toolCall of toolCalls) {
    if (toolCall.function.name === "exa_search") {
      const toolResponse = await processExaSearchCall(toolCall, exaClient);
      currentChatMessages.push(toolResponse);
      messagesToSave.push({
        role: "tool",
        content: toolResponse.content,
        timestamp: new Date(),
        tool_call_id: toolResponse.tool_call_id,
      });
    } else {
      console.warn(`Unknown tool call: ${toolCall.function.name}`);
    }
  }

  // Get model's response to the tool results
  sleep(3000);
  const response = await chatWithModel(
    modelClient,
    {
      modelName: model,
      messages: currentChatMessages.slice(-toolCalls.length),
      useTools: false, // Prevent infinite tool call loops
    },
    modelOptions,
  );

  if (!response.choices.length) {
    console.warn(
      "Received empty choices array in model response for tool call results",
    );
    return {
      msgContent: "Failed to process search results",
      reasoningContent: undefined,
    };
  }

  const firstChoice = response.choices[0] as OpenAI.ChatCompletion.Choice;
  const { msgContent, reasoningContent } = extractMessageContent(
    firstChoice.message as LLMChatMessage,
  );
  const { msgContent: finalContent, reasoningContent: finalReasoning } =
    processOpenRouterContent(msgContent, reasoningContent, response.choices);

  await saveChatMessagesToDb(userDb, userId, chatId, messagesToSave);

  return {
    msgContent: finalContent,
    reasoningContent: finalReasoning,
  };
};
