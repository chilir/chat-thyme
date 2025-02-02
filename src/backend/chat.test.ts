// src/backend/chat.test.ts

import { Database } from "bun:sqlite";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from "bun:test";
import type Exa from "exa-js";
import type { OpenAI } from "openai";
import tmp from "tmp";
import { clearUserDbCache, initUserDbCache } from "../db";
import * as SqliteModule from "../db/sqlite";
import type {
  ChatThreadInfo,
  DbCache,
  DbChatMessageToSave,
} from "../interfaces";
import { extractChoiceContent, processUserMessage } from "./chat";
import * as LlmService from "./llm-service";

tmp.setGracefulCleanup();

describe("Chat System Integration", () => {
  let db: Database;
  let tmpDir: tmp.DirResult;
  let mockModelClient: OpenAI;
  let mockExaClient: Exa;
  const mockTimestamp = new Date("2024-01-01T00:00:00Z");

  beforeEach(() => {
    tmpDir = tmp.dirSync({
      prefix: "chat-thyme-chat-test-",
      unsafeCleanup: true,
      keep: false,
    });
    db = new Database(`${tmpDir.name}/chat-test-${Date.now()}.db`);
    db.run(`CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_call_id TEXT,
      timestamp DATETIME NOT NULL
    )`);
    mockModelClient = {} as OpenAI;
    mockExaClient = {
      searchAndContents: mock(() =>
        Promise.resolve({
          results: [{ title: "Test Result", url: "https://test.com" }],
        }),
      ),
    } as unknown as Exa;
    spyOn(LlmService, "chatWithModel").mockImplementation(() =>
      Promise.resolve({
        choices: [
          {
            message: {
              role: "assistant",
              content: "Test response",
              reasoning_content: "Test reasoning",
              refusal: null,
            },
            finish_reason: "stop",
            index: 0,
            logprobs: null,
          },
        ],
        created: mockTimestamp.getTime() / 1000,
        id: "mock-id",
        model: "gpt-4",
        object: "chat.completion",
      }),
    );
    spyOn(SqliteModule, "getOrInitUserDb").mockImplementation(() =>
      Promise.resolve(db),
    );
    spyOn(SqliteModule, "releaseUserDb").mockImplementation(() =>
      Promise.resolve(),
    );
  });

  afterEach(() => {
    db.close();
    mock.restore();
    tmpDir.removeCallback();
  });

  describe("Model Response Processing", () => {
    it("should handle empty response from model", async () => {
      const result = await extractChoiceContent(
        [],
        mockTimestamp,
        [],
        mockExaClient,
        mockModelClient,
        "test-model",
        {},
        db,
        "user123",
        "chat456",
      );
      expect(result).toEqual({
        timestamp: mockTimestamp,
        msgContent: "No response was generated",
        reasoningContent: undefined,
      });
    });

    it("should handle content filtered by model safety system", async () => {
      const result = await extractChoiceContent(
        [
          {
            message: { role: "assistant", content: null, refusal: null },
            finish_reason: "content_filter",
            index: 0,
            logprobs: null,
          },
        ],
        mockTimestamp,
        [],
        mockExaClient,
        mockModelClient,
        "test-model",
        {},
        db,
        "user123",
        "chat456",
      );
      expect(result).toEqual({
        timestamp: mockTimestamp,
        msgContent: "Content was filtered",
        reasoningContent: undefined,
      });
    });

    it("should handle tool calls when tools are unavailable", async () => {
      const result = await extractChoiceContent(
        [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  type: "function",
                  function: { name: "test", arguments: "" },
                  id: "test-call",
                },
              ],
              refusal: null,
            },
            finish_reason: "tool_calls",
            index: 0,
            logprobs: null,
          },
        ],
        mockTimestamp,
        [],
        undefined,
        mockModelClient,
        "test-model",
        {},
        db,
        "user123",
        "chat456",
      );
      expect(result).toEqual({
        timestamp: mockTimestamp,
        msgContent: "Tool calls requested but no tool clients available",
        reasoningContent: undefined,
      });
    });
  });

  describe("End-to-End Message Processing", () => {
    let mockDbCache: DbCache;
    const chatThreadInfo: ChatThreadInfo = {
      chatId: "test-chat",
      userId: "test-user",
      modelOptions: {},
    };

    beforeEach(() => {
      mockDbCache = initUserDbCache();
    });

    afterEach(() => {
      clearUserDbCache(mockDbCache);
    });

    it("should process message and return formatted response with reasoning", async () => {
      const response = await processUserMessage(
        chatThreadInfo,
        mockDbCache,
        tmpDir.name,
        1,
        "You are a helpful assistant",
        "Hello",
        mockTimestamp,
        mockModelClient,
        "test-model",
        false,
        undefined,
      );
      expect(response).toBe(
        "<thinking>Test reasoning</thinking>\n\nTest response",
      );
      expect(LlmService.chatWithModel).toHaveBeenCalled();
    });

    it("should handle model errors gracefully", async () => {
      spyOn(LlmService, "chatWithModel").mockImplementation(() => {
        throw new Error("Model error");
      });
      expect(
        processUserMessage(
          chatThreadInfo,
          mockDbCache,
          tmpDir.name,
          1,
          "You are a helpful assistant",
          "Hello",
          mockTimestamp,
          mockModelClient,
          "test-model",
          false,
          undefined,
        ),
      ).rejects.toThrow("Model error");
    });

    it("should save conversation history to database", async () => {
      await processUserMessage(
        chatThreadInfo,
        mockDbCache,
        tmpDir.name,
        1,
        "You are a helpful assistant",
        "Hello",
        mockTimestamp,
        mockModelClient,
        "test-model",
        false,
        undefined,
      );
      const messages = db
        .query(
          "SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY timestamp",
        )
        .all("test-chat") as DbChatMessageToSave[];
      expect(messages).toHaveLength(2); // user message + assistant response
      // @ts-ignore
      expect(messages[0].role).toBe("user");
      // @ts-ignore
      expect(messages[0].content).toBe("Hello");
      // @ts-ignore
      expect(messages[1].role).toBe("assistant");
      // @ts-ignore
      expect(messages[1].content).toContain("Test response");
    });
  });
});
