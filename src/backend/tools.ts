// src/backend/tools.ts

import type { Database } from "bun:sqlite";
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
  formatResponse,
  processOpenRouterContent,
  saveChatMessagesToDb,
} from "./utils";

/**
 * Array of available tools that the LLM can use.
 * Currently includes only the Exa search function.
 */
export const CHAT_THYME_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
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
 * @param {OpenAI.Chat.Completions.ChatCompletionMessageToolCall} toolCall - The tool call from the LLM
 * @param {Exa} exaClient - The Exa client instance for performing web searches
 * @returns {Promise<OpenAI.Chat.Completions.ChatCompletionToolMessageParam>} Tool response message with search results
 */
const processExaSearchCall = async (
  toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
  exaClient: Exa,
): Promise<OpenAI.Chat.Completions.ChatCompletionToolMessageParam> => {
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

  return {
    role: "tool",
    content: searchResults
      ? JSON.stringify(searchResults)
      : JSON.stringify({ error: "Search failed", results: [] }),
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
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[],
  exaClient: Exa,
  currentChatMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  modelClient: OpenAI,
  model: string,
  modelOptions: Partial<ChatParameters>,
  userDb: Database,
  userId: string,
  chatId: string,
): Promise<ProcessedMessageContent> => {
  const timestamp = new Date();
  const messagesToSave: DbChatMessage[] = [];

  for (const toolCall of toolCalls) {
    if (toolCall.function.name === "exa_search") {
      const toolResponse = await processExaSearchCall(toolCall, exaClient);
      currentChatMessages.push(toolResponse);

      // Save tool response to messages to be saved
      messagesToSave.push({
        role: "tool",
        content: toolResponse.content as string,
        timestamp: new Date(),
      });
    } else {
      console.warn(`Unknown tool call: ${toolCall.function.name}`);
    }
  }

  const useToolResponsePrompt: OpenAI.Chat.Completions.ChatCompletionUserMessageParam =
    {
      role: "user",
      content:
        "Please summarize this information and answer my previous query based on these results.",
    };
  currentChatMessages.push(useToolResponsePrompt);
  messagesToSave.push({
    role: "user",
    content: useToolResponsePrompt.content as string,
    timestamp: new Date(),
  });

  // Get model's response to the tool results
  const response = await chatWithModel(
    modelClient,
    {
      modelName: model,
      messages: currentChatMessages,
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

  const firstChoice = response
    .choices[0] as OpenAI.Chat.Completions.ChatCompletion.Choice;
  const { msgContent, reasoningContent } = extractMessageContent(
    firstChoice.message as LLMChatMessage,
  );
  const { msgContent: finalContent, reasoningContent: finalReasoning } =
    processOpenRouterContent(msgContent, reasoningContent, response.choices);
  // const formattedContent = formatResponse(
  //   finalContent as string,
  //   finalReasoning,
  // );

  // messagesToSave.push({
  //   role: "assistant",
  //   content: formattedContent,
  //   timestamp: new Date(response.created * 1000),
  // });

  await saveChatMessagesToDb(userDb, userId, chatId, messagesToSave);

  return {
    msgContent: finalContent,
    reasoningContent: finalReasoning,
  };
};
