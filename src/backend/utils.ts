// src/backend/utils.ts

import type { Database } from "bun:sqlite";
import type OpenAI from "openai";
import type {
  DbChatMessageToSave,
  ExpandedChatCompletionMessage,
  ProcessedMessageContent,
} from "../interfaces";

/**
 * Converts a database message row into an OpenAI compatible chat completion
 * message.
 * Handles special parsing for tool messages by converting their content from
 * stringified JSON stored in the DB to an array of content parts.
 *
 * @param {DbChatMessageToSave} row - Database row containing message data
 * @returns {OpenAI.ChatCompletionMessageParam} Formatted message
 * @throws When tool message content contains invalid JSON that cannot be parsed
 */
export const parseDbRow = (
  row: DbChatMessageToSave,
): OpenAI.ChatCompletionMessageParam => {
  if (row.role === "tool") {
    let content: OpenAI.ChatCompletionContentPart[];
    try {
      // Parse the outer array structure but keep text field as string
      content = JSON.parse(
        row.content as string,
      ) as OpenAI.ChatCompletionContentPart[];
      console.debug("checking content parsing??");
      console.debug(content);
    } catch (error) {
      console.error(
        `Error parsing tool call (id: ${row.tool_call_id}) content from \
database. Raw JSON string: ${row.content}:`,
        error,
      );
      throw error;
    }

    return {
      role: "tool",
      content: content,
      tool_call_id: row.tool_call_id,
    } as OpenAI.ChatCompletionToolMessageParam;
  }

  return {
    role: row.role,
    content: row.content,
  } as OpenAI.ChatCompletionMessageParam;
};

/**
 * Retrieves chat history for a specific user and chat session from the database
 * and prepends the system prompt.
 *
 * @param {Database} userDb - User DB connection
 * @param {string} userId - Discord user ID
 * @param {string} chatId - Chat session ID
 * @param {string} systemPrompt - System prompt to prepend to the chat history
 * @returns {Promise<OpenAI.ChatCompletionMessageParam[]>} Array of past
 *   messages in chat session
 * @throws If database query fails
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
      SELECT role, content, tool_call_id, timestamp
      FROM chat_messages
      WHERE chat_id = ?
      ORDER BY timestamp ASC
    `)
        .all(chatId) as DbChatMessageToSave[]
    ).map(parseDbRow) as OpenAI.ChatCompletionMessageParam[];
  } catch (error) {
    console.error(
      `Error getting chat history from database for ${userId} in chat \
${chatId}:`,
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
 * Extracts main content and optional reasoning from an OpenAI compatible chat
 * completion message with optional additional reasoning fields.
 * Handles refusal scenarios if present.
 *
 * @param {ExpandedChatCompletionMessage} message - Chat completion message with
 *   optional reasoning
 * @returns {{ msgContent: string | null; reasoningContent?: string }} Extracted
 *   message and optional reasoning
 */
export const extractMessageContent = (
  message: ExpandedChatCompletionMessage,
): { msgContent: string | null; reasoningContent?: string } => {
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
 * Handles cases where reasoning and message content are split across multiple
 * choices.
 *
 * @param {string | null} firstChoiceContent - Message content from the first
 *   choice
 * @param {string | undefined} firstChoiceReasoning - Reasoning from the first
 *   choice
 * @param {OpenAI.ChatCompletion.Choice[]} remainingChoices - Remaining choices
 *   from the chat completion
 * @returns {ProcessedMessageContent} Processed chat completion content
 */
export const processOpenRouterContent = (
  timestamp: Date,
  firstChoiceContent: string | null,
  firstChoiceReasoning: string | undefined,
  remainingChoices: OpenAI.ChatCompletion.Choice[],
): ProcessedMessageContent => {
  if (
    firstChoiceReasoning &&
    !firstChoiceContent &&
    remainingChoices.length > 0
  ) {
    const contentChoice = remainingChoices.find(
      (choice) => choice.message.content,
    );
    return {
      timestamp: timestamp,
      msgContent:
        contentChoice?.message.content || "No valid response was generated",
      reasoningContent: firstChoiceReasoning,
    };
  }

  return {
    timestamp: timestamp,
    msgContent: firstChoiceContent || "No valid response was generated",
    reasoningContent: firstChoiceReasoning,
  };
};

/**
 * Formats the final model response with reasoning if present.
 *
 * @param {string} msgContent - The main message text
 * @param {string} [reasoningContent] - Optional reasoning text
 * @returns {string} Combined message with reasoning if provided
 */
export const formatModelResponse = (
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
 * @param {Database} userDb - User DB connection
 * @param {string} userId - Discord user ID
 * @param {string} chatId - Chat session ID
 * @param {"user" | "assistant" | "tool"} role - Role that produced message
 * @param {string} content - Message content
 * @param {Date} timestamp - Message timestamp
 * @param {string | null} [toolCallId] - Tool call ID if the message is a tool
 *   call result, `null` otherwise
 * @returns {Promise<void>} Resolves when the message is saved
 */
export const saveChatMessageToDb = async (
  userDb: Database,
  userId: string,
  chatId: string,
  role: "user" | "assistant" | "tool",
  content: string | OpenAI.ChatCompletionContentPart[],
  timestamp: Date,
  toolCallId: string | null = null,
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
