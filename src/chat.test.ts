// src/chat.test.ts

import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Message as ChatMessage, ChatResponse, Ollama } from "ollama";
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
  let mockOllamaClient: Ollama;
  let mockDbCache: dbCache;
  let mockConfig: ChatThymeConfig;
  let tempDbDir: string;

  beforeEach(() => {
    // Create temporary directory for database files
    tempDbDir = tmp.dirSync({ unsafeCleanup: true }).name;

    // Mock Database
    mockDb = {
      query: mock(() => ({
        all: mock((chatId: string) => [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there" },
        ]),
      })),
      run: mock(() => {}),
    } as unknown as Database;

    // Mock Ollama client
    mockOllamaClient = {
      chat: mock(async () => ({
        message: {
          role: "assistant",
          content: "Mock response",
        },
        created_at: new Date().toISOString(),
      })),
    } as unknown as Ollama;

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
        all: mock(() => []),
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

    it("should return existing chat history", async () => {
      const history = await getChatHistoryFromDb(
        mockDb,
        "user123",
        "chat456",
        "Test system prompt",
      );

      expect(history).toHaveLength(2);
      expect(history[0]).toEqual({
        role: "user",
        content: "Hello",
      });
    });

    it("should handle database query errors", async () => {
      mockDb.query = mock(() => {
        throw new Error("Database error");
      });

      await expect(
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
        mockOllamaClient,
        "chat456",
        "Test message",
        new Date(),
        {},
        mockConfig,
        mockDbCache,
      );

      expect(response).toBe("Mock response");
      expect(mockOllamaClient.chat).toHaveBeenCalled();
    });

    it("should handle errors gracefully", async () => {
      mockOllamaClient.chat = mock(() => {
        throw new Error("API Error");
      });

      await expect(
        processUserMessage(
          "user123",
          mockOllamaClient,
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
