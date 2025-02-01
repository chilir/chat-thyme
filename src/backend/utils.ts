// src/backend/utils.ts

import type { Database } from "bun:sqlite";
import type OpenAI from "openai";
import type {
  DbChatMessage,
  LLMChatMessage,
  ProcessedMessageContent,
} from "../interfaces";

function parseDbMessage(row: DbChatMessage): OpenAI.ChatCompletionMessageParam {
  if (row.role === "tool" && row.tool_call_id) {
    // Parse the outer array structure but keep text field as string
    const content = JSON.parse(
      row.content as string,
    ) as OpenAI.ChatCompletionContentPart[];

    return {
      role: "tool",
      content: content,
      tool_call_id: row.tool_call_id,
      timestamp: row.timestamp,
    } as OpenAI.ChatCompletionToolMessageParam;
  }

  return {
    role: row.role,
    content: row.content,
    timestamp: row.timestamp,
  } as OpenAI.ChatCompletionMessageParam;
}

/**
 * Retrieves chat history for a specific user and chat from the database and
 * prepends the system prompt.
 *
 * @param userDb - SQLite database instance for the user
 * @param userId - Unique identifier for the user
 * @param chatId - Unique identifier for the chat session
 * @param systemPrompt - System prompt to prepend to the chat history
 * @returns {Promise<OpenAI.ChatCompletionMessageParam[]>}
 * Array of messages in OpenAI chat format
 * @throws {Error} If database query fails
 */
export const getChatHistoryFromDb = async (
  userDb: Database,
  userId: string,
  chatId: string,
  systemPrompt: string,
): Promise<OpenAI.ChatCompletionMessageParam[]> => {
  let chatHistory: OpenAI.ChatCompletionMessageParam[];
  try {
    chatHistory = (
      userDb
        .query(`
      SELECT role, content, tool_call_id
      FROM chat_messages
      WHERE chat_id = ?
      ORDER BY id ASC
    `)
        .all(chatId) as DbChatMessage[]
    ).map(parseDbMessage) as OpenAI.ChatCompletionMessageParam[];
  } catch (error) {
    console.error(
      `Error getting chat history from database for ${userId} in chat ${chatId}:`,
      error,
    );
    throw error;
  }

  chatHistory.unshift({
    role: "system",
    content: systemPrompt,
  });

  return chatHistory;
};

/**
 * Extracts main content and optional reasoning from an LLMChatMessage.
 * Handles refusal scenarios if present.
 *
 * @param {LLMChatMessage} message - The message containing content and
 *   optional reasoning
 * @returns {ProcessedMessageContent} An object with the extracted message and
 *   reasoning
 */
export const extractMessageContent = (
  message: LLMChatMessage,
): ProcessedMessageContent => {
  const reasoningContent = message.reasoning_content || message.reasoning || "";

  if (message.refusal) {
    return {
      msgContent: message.refusal,
      reasoningContent: undefined,
    };
  }

  return {
    msgContent: message.content,
    reasoningContent,
  };
};

/**
 * Processes model response content in OpenRouter format.
 * Handles cases where reasoning and content are split across multiple choices.
 *
 * @param {string | null} firstChoiceContent - The content from the first choice's message
 * @param {string | undefined} firstChoiceReasoning - The reasoning from the first choice's message
 * @param {OpenAI.ChatCompletion.Choice[]} choices - All choices from the response
 * @returns {ProcessedMessageContent} Processed content
 */
export const processOpenRouterContent = (
  firstChoiceContent: string | null,
  firstChoiceReasoning: string | undefined,
  choices: OpenAI.ChatCompletion.Choice[],
): ProcessedMessageContent => {
  if (firstChoiceReasoning && !firstChoiceContent && choices.length > 1) {
    const contentChoice = choices.find((choice) => choice.message.content);
    return {
      msgContent:
        contentChoice?.message.content ||
        "No valid response content was generated",
      reasoningContent: firstChoiceReasoning,
    };
  }

  return {
    msgContent: firstChoiceContent || "No valid response was generated",
    reasoningContent: firstChoiceReasoning,
  };
};

/**
 * Formats the final response with reasoning if present.
 *
 * @param {string} msgContent - The main message text
 * @param {string} [reasoningContent] - Optional reasoning text
 * @returns {string} Combined message with reasoning if provided
 */
export const formatResponse = (
  msgContent: string,
  reasoningContent?: string | undefined,
): string => {
  return reasoningContent
    ? `<thinking>${reasoningContent}</thinking>\n\n${msgContent}`
    : msgContent;
};

/**
 * Saves a single chat message to the database with error handling.
 *
 * @param {Database} userDb - The database instance for the user
 * @param {string} userId - A unique identifier for the user
 * @param {string} chatId - A unique identifier for the chat session
 * @param {"user" | "assistant" | "tool"} role - The role of the message
 * @param {string} content - The message text
 * @param {Date} timestamp - The timestamp of the message
 * @returns {Promise<void>} Resolves when the message is saved
 */
export const saveChatMessageToDb = async (
  userDb: Database,
  userId: string,
  chatId: string,
  role: "user" | "assistant" | "tool",
  content: string | OpenAI.ChatCompletionContentPart[],
  timestamp: Date,
  toolCallId: string | null,
): Promise<void> => {
  const chatContent = Array.isArray(content)
    ? JSON.stringify(content)
    : content;
  try {
    userDb.run(
      "INSERT INTO chat_messages (chat_id, role, content, tool_call_id, timestamp) VALUES (?, ?, ?, ?, ?)",
      [chatId, role, chatContent, toolCallId, timestamp.toISOString()],
    );
  } catch (error) {
    console.error(
      `Error saving chat message to database for ${userId} in chat ${chatId}:`,
      error,
    );
    throw error;
  }
};

/**
 * Saves multiple chat messages in sequence, wrapping each with error handling.
 *
 * @param {Database} userDb - The database instance
 * @param {string} userId - A unique identifier for the user
 * @param {string} chatId - A unique identifier for the chat session
 * @param {DbChatMessage[]} messages - An array of messages to save
 * @returns {Promise<void>} Resolves when all messages are saved
 */
export const saveChatMessagesToDb = async (
  userDb: Database,
  userId: string,
  chatId: string,
  messages: DbChatMessage[],
): Promise<void> => {
  for (const msg of messages) {
    await saveChatMessageToDb(
      userDb,
      userId,
      chatId,
      msg.role,
      msg.content,
      msg.timestamp,
      msg.tool_call_id || null,
    );
  }
};
