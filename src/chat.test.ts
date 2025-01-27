// src/chat.test.ts

import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import type OpenAI from "openai";
import tmp from "tmp";
import {
  getChatHistoryFromDb,
  processUserMessage,
  saveChatMessageToDb,
} from "./chat";
import type { ChatThymeConfig } from "./config/schema";
import type { dbCache } from "./interfaces";

describe("Chat Module", () => {
  let mockDb: Database;
  let mockOpenAIClient: OpenAI;
  let mockDbCache: dbCache;
  let mockConfig: ChatThymeConfig;
  let tempDbDir: string;

  beforeEach(() => {
    // Create temporary directory for database files
    tempDbDir = tmp.dirSync({ unsafeCleanup: true }).name;

    // Mock Database
    const defaultMockMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ];
    mockDb = {
      query: mock(() => ({
        all: mock((): OpenAI.Chat.ChatCompletionMessageParam[] => defaultMockMessages),
      })),
      run: mock(() => {}),
    } as unknown as Database;

    // Mock OpenAI client
    mockOpenAIClient = {
      chat: {
        completions: {
          create: mock(async () => ({
            id: 'mock-id',
            object: 'chat.completion',
            created: Date.now(),
            model: 'mock-model',
            choices: [{
              index: 0,
              message: {
                role: "assistant",
                content: "Mock response"
              },
              finish_reason: "stop"
            }],
          }))
        }
      }
    } as unknown as OpenAI;

    // Mock dbCache
    mockDbCache = {
      cache: new Map(),
      mutex: {
        acquire: mock(async () => () => {}),
      },
      checkIntervalId: undefined,
    } as unknown as dbCache;

    // Mock config with temporary directory
    mockConfig = {
      model: "mock-model",
      systemPrompt: "You are a test assistant",
      dbDir: tempDbDir,
    } as ChatThymeConfig;
  });

  describe("getChatHistoryFromDb", () => {
    it("should return chat history with system prompt for empty history", async () => {
      mockDb.query = mock(() => ({
        all: mock((): OpenAI.Chat.ChatCompletionMessageParam[] => []),
        get: mock(() => null),
        run: mock(() => {}),
        values: mock(() => []),
        iterate: mock(() => ({ next: () => ({ value: null, done: true }) })),
        finalize: mock(() => {}),
        toString: mock(() => ""),
        columnNames: [],
        paramsCount: 0,
        native: false,
        as: () => ({}),
        expand: () => [],
        [Symbol.iterator]: function* () {
          yield* [];
        },
        [Symbol.dispose]: () => {},
      })) as unknown as Database["query"];

      const history = await getChatHistoryFromDb(
        mockDb,
        "user123",
        "chat456",
        "Test system prompt",
      );

      expect(history).toHaveLength(1);
      expect(history[0]).toEqual({
        role: "system",
        content: "Test system prompt",
      });
    });

    it("should prepend system prompt to existing chat history", async () => {
      const mockMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ];
      mockDb.query = mock(() => ({
        all: mock((): OpenAI.Chat.ChatCompletionMessageParam[] => structuredClone(mockMessages)),
      })) as unknown as Database["query"];

      const history = await getChatHistoryFromDb(
        mockDb,
        "user123",
        "chat456",
        "Test system prompt",
      );

      console.log(history);
      expect(history).toHaveLength(3);
      expect(history[0]).toEqual({
        role: "system",
        content: "Test system prompt",
      });
      console.log(history[1]);
      console.log(mockMessages[0]);
      expect(history[1]).toEqual(mockMessages[0] as OpenAI.Chat.ChatCompletionMessageParam);
      expect(history[2]).toEqual(mockMessages[1] as OpenAI.Chat.ChatCompletionMessageParam);
    });

    it("should handle database query errors", async () => {
      mockDb.query = mock(() => {
        throw new Error("Database error");
      });

      expect(
        getChatHistoryFromDb(
          mockDb,
          "user123",
          "chat456",
          "Test system prompt",
        ),
      ).rejects.toThrow("Database error");
    });
  });

  describe("saveChatMessageToDb", () => {
    it("should save message to database", async () => {
      const timestamp = new Date();
      await saveChatMessageToDb(
        mockDb,
        "user123",
        "chat456",
        "user",
        "Test message",
        timestamp,
      );

      expect(mockDb.run).toHaveBeenCalledWith(
        "INSERT INTO chat_messages (chat_id, role, content, timestamp) VALUES (?, ?, ?, ?)",
        ["chat456", "user", "Test message", timestamp.toISOString()],
      );
    });
  });

  describe("processUserMessage", () => {
    it("should process message and return response", async () => {
      const response = await processUserMessage(
        "user123",
        mockOpenAIClient,
        "chat456",
        "Test message",
        new Date(),
        {},
        mockConfig,
        mockDbCache,
      );

      expect(response).toBe("Mock response");
      expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalled();
    });

    it("should handle errors gracefully", async () => {
      mockOpenAIClient.chat.completions.create = mock(() => {
        throw new Error("API Error");
      });

      expect(
        processUserMessage(
          "user123",
          mockOpenAIClient,
          "chat456",
          "Test message",
          new Date(),
          {},
          mockConfig,
          mockDbCache,
        ),
      ).rejects.toThrow("API Error");
    });
  });
});
