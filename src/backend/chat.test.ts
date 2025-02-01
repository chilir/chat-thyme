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
import type { ChatThreadInfo, DbCache } from "../interfaces";
import { extractChoiceContent, processUserMessage } from "./chat";
import * as LlmService from "./llm-service";

tmp.setGracefulCleanup();

describe("chat module", () => {
  let db: Database;
  let tmpDir: tmp.DirResult;
  let mockModelClient: OpenAI;
  let mockExaClient: Exa;

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
      timestamp TEXT NOT NULL
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
        created: Date.now() / 1000,
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

  describe("extractChoiceContent", () => {
    it("should handle empty choices array", async () => {
      const result = await extractChoiceContent(
        [],
        [],
        mockExaClient,
        mockModelClient,
        "test-model",
        {},
        db,
        "user123",
        "chat456",
      );

      expect(result.msgContent).toBe("No response was generated");
      expect(result.reasoningContent).toBeUndefined();
    });

    it("should handle content filter", async () => {
      const result = await extractChoiceContent(
        [
          {
            message: {
              role: "assistant",
              content: null,
              refusal: null,
            },
            finish_reason: "content_filter",
            index: 0,
            logprobs: null,
          },
        ],
        [],
        mockExaClient,
        mockModelClient,
        "test-model",
        {},
        db,
        "user123",
        "chat456",
      );

      expect(result.msgContent).toBe("Content was filtered");
      expect(result.reasoningContent).toBeUndefined();
    });

    it("should handle tool calls without Exa client", async () => {
      const result = await extractChoiceContent(
        [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  type: "function",
                  function: {
                    name: "test",
                    arguments: "",
                  },
                  id: "",
                },
              ],
              refusal: null,
            },
            finish_reason: "tool_calls",
            index: 0,
            logprobs: null,
          },
        ],
        [],
        undefined,
        mockModelClient,
        "test-model",
        {},
        db,
        "user123",
        "chat456",
      );

      expect(result.msgContent).toBe(
        "Tool calls requested but no tool clients available",
      );
    });
  });

  describe("processUserMessage", () => {
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

    it("should process user message and return formatted response", async () => {
      const response = await processUserMessage(
        chatThreadInfo,
        mockDbCache,
        tmpDir.name,
        1,
        "You are a helpful assistant",
        "Hello",
        new Date(),
        mockModelClient,
        "test-model",
        false,
        undefined,
      );

      expect(response).toContain("Test response");
      expect(LlmService.chatWithModel).toHaveBeenCalled();
    });

    it("should handle errors during message processing", async () => {
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
          new Date(),
          mockModelClient,
          "test-model",
          false,
          undefined,
        ),
      ).rejects.toThrow("Model error");
    });

    it("should save messages to database", async () => {
      await processUserMessage(
        chatThreadInfo,
        mockDbCache,
        tmpDir.name,
        1,
        "You are a helpful assistant",
        "Hello",
        new Date(),
        mockModelClient,
        "test-model",
        false,
        undefined,
      );

      const messages = db
        .query("SELECT * FROM chat_messages WHERE chat_id = ?")
        .all("test-chat");
      expect(messages.length).toBeGreaterThan(0);
    });
  });
});
