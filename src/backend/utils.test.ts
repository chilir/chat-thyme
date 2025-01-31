// src/backend/utils.test.ts

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import tmp from "tmp";
import type { DbChatMessage, LLMChatMessage } from "../interfaces";
import {
  extractMessageContent,
  formatResponse,
  processOpenRouterContent,
  saveChatMessageToDb,
  saveChatMessagesToDb,
} from "./utils";

describe("extractMessageContent", () => {
  it("should extract content and reasoning from message", () => {
    const message: LLMChatMessage = {
      role: "assistant",
      content: "Hello world",
      reasoning_content: "Thinking about greeting",
      refusal: null,
    };

    const result = extractMessageContent(message);
    expect(result.msgContent).toBe("Hello world");
    expect(result.reasoningContent).toBe("Thinking about greeting");
  });

  it("should handle refusal messages", () => {
    const message: LLMChatMessage = {
      role: "assistant",
      content: "",
      refusal: "I cannot help with that",
    };

    const result = extractMessageContent(message);
    expect(result.msgContent).toBe("I cannot help with that");
    expect(result.reasoningContent).toBeUndefined();
  });

  it("should use reasoning field if reasoning_content is not present", () => {
    const message: LLMChatMessage = {
      role: "assistant",
      content: "Hello",
      reasoning: "Simple greeting",
      refusal: null,
    };

    const result = extractMessageContent(message);
    expect(result.msgContent).toBe("Hello");
    expect(result.reasoningContent).toBe("Simple greeting");
  });
});

describe("formatResponse", () => {
  it("should format response with reasoning", () => {
    const result = formatResponse("Hello", "Thinking process");
    expect(result).toBe("<thinking>\nThinking process</thinking>\nHello");
  });

  it("should return only message when no reasoning provided", () => {
    const result = formatResponse("Hello");
    expect(result).toBe("Hello");
  });
});

describe("processOpenRouterContent", () => {
  it("should handle standard content with reasoning", () => {
    const result = processOpenRouterContent(
      "Hello world",
      "Thinking about greeting",
      [{
        message: {
          content: "Hello world", role: "assistant",
          refusal: null
        },
        index: 0,
        finish_reason: "stop",
        logprobs: null
      }],
    );
    expect(result.msgContent).toBe("Hello world");
    expect(result.reasoningContent).toBe("Thinking about greeting");
  });

  it("should handle OpenRouter style split content and reasoning", () => {
    const result = processOpenRouterContent(
      null,
      "Thinking process",
      [
        {
          message: {
            content: null, role: "assistant",
            refusal: null
          },
          index: 0,
          finish_reason: "stop",
          logprobs: null
        },
        {
          message: {
            content: "Final answer", role: "assistant",
            refusal: null
          },
          index: 1,
          finish_reason: "stop",
          logprobs: null
        },
      ],
    );
    expect(result.msgContent).toBe("Final answer");
    expect(result.reasoningContent).toBe("Thinking process");
  });

  it("should handle missing content with fallback", () => {
    const result = processOpenRouterContent(
      null,
      "Some reasoning",
      [{
        message: {
          content: null, role: "assistant",
          refusal: null
        },
        index: 0,
        finish_reason: "stop",
        logprobs: null
      }],
    );
    expect(result.msgContent).toBe("No valid response was generated");
    expect(result.reasoningContent).toBe("Some reasoning");
  });
});

describe("database operations", () => {
  let db: Database;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = tmp.dirSync({
      prefix: "chat-thyme-test-",
      unsafeCleanup: true,
    }).name;
    db = new Database(`${tmpDir}/test.db`);

    // Initialize test database schema
    db.run(`CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL
    )`);
  });

  afterEach(() => {
    db.close();
    Bun.write(tmpDir, ""); // Clear tmp directory
  });

  it("should save single chat message to database", async () => {
    const timestamp = new Date();
    await saveChatMessageToDb(
      db,
      "user123",
      "chat456",
      "user",
      "Hello",
      timestamp,
    );

    const result = db
      .query("SELECT * FROM chat_messages WHERE chat_id = ?")
      .get("chat456") as { content: string; role: string; timestamp: string };
    expect(result).toBeDefined();
    expect(result.content).toBe("Hello");
    expect(result.role).toBe("user");
    expect(result.timestamp).toBe(timestamp.toISOString());
  });

  it("should save multiple chat messages to database", async () => {
    const messages: DbChatMessage[] = [
      {
        role: "user",
        content: "Hello",
        timestamp: new Date(),
      },
      {
        role: "assistant",
        content: "Hi there",
        timestamp: new Date(),
      },
    ];

    await saveChatMessagesToDb(db, "user123", "chat456", messages);

    const results = db
      .query("SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY timestamp")
      .all("chat456") as { content: string; role: string; timestamp: string }[];
    expect(results.length).toBe(2);
    expect(results[0]?.content).toBe("Hello");
    expect(results[1]?.content).toBe("Hi there");
  });

  it("should handle database errors", async () => {
    // Drop the table to simulate a database error
    db.run("DROP TABLE chat_messages");

    expect(
      saveChatMessageToDb(
        db,
        "user123",
        "chat456",
        "user",
        "Hello",
        new Date(),
      ),
    ).rejects.toThrow();
  });

  it("should handle malformed data", async () => {
    const timestamp = new Date();
    // Test with very long content
    const longContent = "a".repeat(10000);

    await saveChatMessageToDb(
      db,
      "user123",
      "chat456",
      "user",
      longContent,
      timestamp,
    );

    const result = db
      .query("SELECT * FROM chat_messages WHERE chat_id = ?")
      .get("chat456") as { content: string };
    expect(result.content.length).toBe(longContent.length);
  });
});
