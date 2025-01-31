// src/backend/utils.ts

import type { Database } from "bun:sqlite";
import type OpenAI from "openai";
import type {
  DbChatMessage,
  LLMChatMessage,
  ProcessedMessageContent,
} from "../interfaces";

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
 * @param {OpenAI.Chat.Completions.ChatCompletion.Choice[]} choices - All choices from the response
 * @returns {ProcessedMessageContent} Processed content
 */
export const processOpenRouterContent = (
  firstChoiceContent: string | null,
  firstChoiceReasoning: string | undefined,
  choices: OpenAI.Chat.Completions.ChatCompletion.Choice[],
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
    ? `<thinking>\n${reasoningContent}</thinking>\n${msgContent}`
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
  content: string,
  timestamp: Date,
): Promise<void> => {
  try {
    userDb.run(
      "INSERT INTO chat_messages (chat_id, role, content, timestamp) VALUES (?, ?, ?, ?)",
      [chatId, role, content, timestamp.toISOString()],
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
    );
  }
};
