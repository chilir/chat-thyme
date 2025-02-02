// src/backend/utils.test.ts

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type OpenAI from "openai";
import tmp from "tmp";
import type {
  DbChatMessageToSave,
  ExpandedChatCompletionMessage,
} from "../interfaces";
import {
  extractMessageContent,
  formatModelResponse,
  getChatHistoryFromDb,
  parseDbRow,
  processOpenRouterContent,
  saveChatMessageToDb,
} from "./utils";

const systemRole = "system";
const testSystemPrompt = "You are a helpful assistant.";
const userRole = "user";
const assistantRole = "assistant";
const toolRole = "tool";
const tmpDirPrefix = "chat-thyme-test-backend-utils-";
const toolContent: OpenAI.ChatCompletionContentPart[] = [
  { type: "text", text: "Tool output" },
];

describe("Message Content Extraction", () => {
  it("should extract content and reasoning from message", () => {
    const message: ExpandedChatCompletionMessage = {
      role: assistantRole,
      content: "Hello world",
      reasoning_content: "Thinking about greeting",
      refusal: null,
    };
    const result = extractMessageContent(message);
    expect(result.msgContent).toBe("Hello world");
    expect(result.reasoningContent).toBe("Thinking about greeting");
  });

  it("should handle refusal messages", () => {
    const message: ExpandedChatCompletionMessage = {
      role: assistantRole,
      content: "",
      refusal: "I cannot help with that",
    };

    const result = extractMessageContent(message);
    expect(result.msgContent).toBe("I cannot help with that");
    expect(result.reasoningContent).toBeUndefined();
  });

  it("should use reasoning field if reasoning_content is not present", () => {
    const message: ExpandedChatCompletionMessage = {
      role: assistantRole,
      content: "Hello",
      reasoning: "Simple greeting",
      refusal: null,
    };

    const result = extractMessageContent(message);
    expect(result.msgContent).toBe("Hello");
    expect(result.reasoningContent).toBe("Simple greeting");
  });
});

describe("Model Response Formatting", () => {
  it("should format response with reasoning", () => {
    const result = formatModelResponse("Hello", "Thinking process");
    expect(result).toBe("<thinking>Thinking process</thinking>\n\nHello");
  });

  it("should return only message when no reasoning provided", () => {
    const result = formatModelResponse("Hello");
    expect(result).toBe("Hello");
  });
});

describe("OpenRouter Response Processing", () => {
  const timestamp = new Date();

  it("should handle standard content with reasoning", () => {
    const result = processOpenRouterContent(
      timestamp,
      "Hello world",
      "Thinking about greeting",
      [],
    );
    expect(result).toEqual({
      timestamp,
      msgContent: "Hello world",
      reasoningContent: "Thinking about greeting",
    });
  });

  it("should handle OpenRouter style split content and reasoning", () => {
    const result = processOpenRouterContent(
      timestamp,
      null,
      "Thinking process",
      [
        {
          message: {
            content: "Final answer",
            role: assistantRole,
            refusal: null,
          },
          index: 0,
          finish_reason: "stop",
          logprobs: null,
        },
      ],
    );
    expect(result).toEqual({
      timestamp,
      msgContent: "Final answer",
      reasoningContent: "Thinking process",
    });
  });

  it("should handle missing content with fallback", () => {
    const result = processOpenRouterContent(timestamp, null, "Some reasoning", [
      {
        message: {
          content: null,
          role: assistantRole,
          refusal: null,
        },
        index: 0,
        finish_reason: "stop",
        logprobs: null,
      },
    ]);
    expect(result.msgContent).toBe("No valid response was generated");
    expect(result.reasoningContent).toBe("Some reasoning");
  });
});

describe("Database Message Operations", () => {
  let db: Database;
  let tmpDir: tmp.DirResult;
  const timestamp = new Date();

  beforeEach(() => {
    tmpDir = tmp.dirSync({
      prefix: tmpDirPrefix,
      unsafeCleanup: true,
    });
    db = new Database(`${tmpDir.name}/test.db`);
    db.run(`CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_call_id TEXT,
      timestamp DATETIME NOT NULL
    )`);
  });

  afterEach(() => {
    db.close();
    tmpDir.removeCallback();
  });

  it("should save and parse a user chat message", async () => {
    await saveChatMessageToDb(
      db,
      "user123",
      "chat456",
      "user",
      "Hello",
      timestamp,
    );
    const result = parseDbRow(
      db
        .query("SELECT * FROM chat_messages WHERE chat_id = ?")
        .get("chat456") as DbChatMessageToSave,
    );
    expect(result).toEqual({
      role: userRole,
      content: "Hello",
    });
  });

  it("should save and parse a tool message with tool call ID", async () => {
    await saveChatMessageToDb(
      db,
      "user123",
      "chat456",
      "tool",
      toolContent,
      timestamp,
      "call_123",
    );
    const result = parseDbRow(
      db
        .query("SELECT * FROM chat_messages WHERE chat_id = ?")
        .get("chat456") as DbChatMessageToSave,
    );
    expect(result).toEqual({
      role: toolRole,
      content: toolContent,
      tool_call_id: "call_123",
    } as OpenAI.ChatCompletionToolMessageParam);
  });

  it("should handle database errors", async () => {
    db.run("DROP TABLE chat_messages");
    expect(
      saveChatMessageToDb(
        db,
        "user123",
        "chat456",
        "user",
        "Hello",
        new Date(),
        null,
      ),
    ).rejects.toThrow();
  });

  it("should be able to handle very long content data", async () => {
    const longContent = "a".repeat(10000);
    await saveChatMessageToDb(
      db,
      "user123",
      "chat456",
      "user",
      longContent,
      timestamp,
      null,
    );
    const result = db
      .query("SELECT * FROM chat_messages WHERE chat_id = ?")
      .get("chat456") as { content: string };
    expect(result.content.length).toBe(longContent.length);
  });
});

describe("Chat History Retrieval", () => {
  let db: Database;
  let tmpDir: tmp.DirResult;

  beforeEach(() => {
    tmpDir = tmp.dirSync({
      prefix: tmpDirPrefix,
      unsafeCleanup: true,
    });
    db = new Database(`${tmpDir.name}/test.db`);
    db.run(`CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_call_id TEXT,
      timestamp TEXT NOT NULL
    )`);
  });

  afterEach(() => {
    db.close();
    tmpDir.removeCallback();
  });

  it("should retrieve chat history and prepend system prompt", async () => {
    const messages = [
      {
        chat_id: "test-chat",
        role: userRole,
        content: "Hello",
        timestamp: new Date().toISOString(),
      },
      {
        chat_id: "test-chat",
        role: assistantRole,
        content: "Hi there",
        timestamp: new Date().toISOString(),
      },
    ];
    for (const msg of messages) {
      db.run(
        "INSERT INTO chat_messages (chat_id, role, content, timestamp) VALUES (?, ?, ?, ?)",
        [msg.chat_id, msg.role, msg.content, msg.timestamp],
      );
    }
    const history = await getChatHistoryFromDb(
      db,
      "user123",
      "test-chat",
      testSystemPrompt,
    );
    expect(history.length).toBe(3); // 2 messages + system prompt
    expect(history[0]).toEqual({
      role: systemRole,
      content: testSystemPrompt,
    });
    expect(history[1]?.content).toBe("Hello");
    expect(history[2]?.content).toBe("Hi there");
  });

  it("should handle empty chat history", async () => {
    const history = await getChatHistoryFromDb(
      db,
      "user123",
      "nonexistent-chat",
      testSystemPrompt,
    );
    expect(history.length).toBe(1);
    expect(history[0]).toEqual({
      role: systemRole,
      content: testSystemPrompt,
    });
  });

  it("should handle database errors", async () => {
    db.run("DROP TABLE chat_messages");
    expect(
      getChatHistoryFromDb(db, "user123", "test-chat", "system prompt"),
    ).rejects.toThrow();
  });

  it("should parse tool messages correctly", async () => {
    const timestamp = new Date();
    db.run(
      "INSERT INTO chat_messages (chat_id, role, content, tool_call_id, timestamp) VALUES (?, ?, ?, ?, ?)",
      [
        "test-chat",
        "tool",
        JSON.stringify(toolContent),
        "call_123",
        timestamp.toISOString(),
      ],
    );
    const history = await getChatHistoryFromDb(
      db,
      "user123",
      "test-chat",
      testSystemPrompt,
    );
    expect(history.length).toBe(2); // system prompt + tool message
    expect(history[1]).toEqual({
      role: toolRole,
      content: toolContent,
      tool_call_id: "call_123",
    } as OpenAI.ChatCompletionToolMessageParam);
  });

  it("should retrieve chat history with tool messages in correct order", async () => {
    const timestamp = new Date();
    const messages = [
      {
        chat_id: "test-chat",
        role: userRole,
        content: "Use tool",
        timestamp: new Date(timestamp.getTime() - 2000).toISOString(),
      },
      {
        chat_id: "test-chat",
        role: toolRole,
        content: JSON.stringify([{ type: "text", text: "Tool result" }]),
        tool_call_id: "call_123",
        timestamp: new Date(timestamp.getTime() - 1000).toISOString(),
      },
    ];
    for (const msg of messages) {
      db.run(
        "INSERT INTO chat_messages (chat_id, role, content, tool_call_id, timestamp) VALUES (?, ?, ?, ?, ?)",
        [
          msg.chat_id,
          msg.role,
          msg.content,
          msg.tool_call_id || null,
          msg.timestamp,
        ],
      );
    }
    const history = await getChatHistoryFromDb(
      db,
      "user123",
      "test-chat",
      testSystemPrompt,
    );

    expect(history).toHaveLength(3); // system + 2 messages
    expect(history[0]).toEqual({ role: systemRole, content: testSystemPrompt });
    expect(history[1]?.role).toBe("user");
    expect(history[2]?.role).toBe("tool");
    expect(
      (history[2] as OpenAI.ChatCompletionToolMessageParam).tool_call_id,
    ).toBe("call_123");
  });
});
