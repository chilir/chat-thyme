// src/ui/discord/handlers.test.ts

import type { Database } from "bun:sqlite";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from "bun:test";
import type { Mutex } from "async-mutex";
import {
  type ChatInputCommandInteraction,
  type InteractionResponse,
  type Message,
  MessageFlags,
} from "discord.js";
import type OpenAI from "openai";
import type { ChatThymeConfig } from "../../config";
import * as DbModule from "../../db";
import type { ChatThreadInfo, DbCache } from "../../interfaces";
import {
  handleResumeChatCommand,
  handleStartChatCommand,
  handleUserMessage,
} from "./handlers";
import * as DiscordUtils from "./utils";

describe("Discord Command and Message Handlers", () => {
  let mockInteraction: Partial<ChatInputCommandInteraction>;
  let mockDbCache: DbCache;
  let mockActiveChatThreads: Map<string, ChatThreadInfo>;
  let createDiscordThreadSpy: ReturnType<typeof spyOn>;
  let startQueueWorkerSpy: ReturnType<typeof spyOn>;
  let getOrInitUserDbSpy: ReturnType<typeof spyOn>;
  let releaseUserDbSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    mockInteraction = {
      deferReply: mock(
        async () =>
          ({
            interaction: mockInteraction,
            webhook: mockInteraction,
          }) as unknown as InteractionResponse,
      ),
      editReply: mock(
        async (content) =>
          ({
            id: "mock-message-id",
            content: typeof content === "string" ? content : content.content,
          }) as Message,
      ),
      user: {
        id: "test-user-id",
        username: "test-user",
        toString: () => "<@test-user-id>",
      },
      options: {
        getString: mock((name: string, required?: boolean) => {
          if (name === "chat_identifier") {
            return "test-chat-id";
          }
          return null;
        }),
      },
      guildId: "test-guild-id",
      channelId: "test-channel-id",
      channel: {
        id: "test-channel-id",
        isThread: () => false,
      },
    } as unknown as Partial<ChatInputCommandInteraction>;

    mockDbCache = {
      cache: new Map(),
      mutex: { acquire: () => Promise.resolve(() => {}) } as Mutex,
      evictionInterval: undefined,
    };
    mockActiveChatThreads = new Map();

    // Set up spies
    createDiscordThreadSpy = spyOn(DiscordUtils, "createDiscordThread");
    startQueueWorkerSpy = spyOn(DiscordUtils, "startQueueWorker");
    getOrInitUserDbSpy = spyOn(DbModule, "getOrInitUserDb");
    releaseUserDbSpy = spyOn(DbModule, "releaseUserDb");

    startQueueWorkerSpy.mockImplementation(() => {
      // no-op to avoid starting a real worker
    });
  });

  afterEach(() => {
    mock.restore();
  });

  describe("handleStartChatCommand - New chat thread creation", () => {
    it("should create a new chat thread with unique identifier", async () => {
      const mockDb = {
        query: mock(() => ({
          get: mock((param: string) => ({ exists: 0 })),
        })),
      } as unknown as Database;

      getOrInitUserDbSpy.mockImplementation(() => Promise.resolve(mockDb));
      createDiscordThreadSpy.mockImplementation(() => Promise.resolve());

      await handleStartChatCommand(
        mockInteraction as ChatInputCommandInteraction,
        mockDbCache,
        "test-db-dir",
        10,
        5,
        mockActiveChatThreads,
      );

      expect(getOrInitUserDbSpy).toHaveBeenCalled();
      expect(mockInteraction.deferReply).toHaveBeenCalledWith({
        flags: MessageFlags.Ephemeral,
      });
      expect(createDiscordThreadSpy).toHaveBeenCalled();
    });

    it("should handle database errors", async () => {
      const mockDb: Partial<Database> = {
        query: () => {
          throw new Error("DB Error");
        },
      };
      getOrInitUserDbSpy.mockImplementation(() => Promise.resolve(mockDb));

      try {
        await handleStartChatCommand(
          mockInteraction as ChatInputCommandInteraction,
          mockDbCache,
          "test-db-dir",
          10,
          5,
          mockActiveChatThreads,
        );
      } catch (error) {
        // @ts-ignore
        expect(error.message).toBe("DB Error");
      }

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.stringContaining("An error occurred"),
      );
    });
  });

  describe("handleResumeChatCommand - Existing chat thread resumption", () => {
    it("should resume existing chat thread", async () => {
      const mockDb = {
        query: () => ({
          get: () => ({ exists: 1 }),
        }),
      } as unknown as Database;

      getOrInitUserDbSpy.mockImplementation(() => Promise.resolve(mockDb));
      createDiscordThreadSpy.mockImplementation(() => Promise.resolve());

      await handleResumeChatCommand(
        mockInteraction as ChatInputCommandInteraction,
        mockDbCache,
        "test-db-dir",
        10,
        5,
        mockActiveChatThreads,
      );

      expect(getOrInitUserDbSpy).toHaveBeenCalled();
      expect(mockInteraction.deferReply).toHaveBeenCalledWith({
        flags: MessageFlags.Ephemeral,
      });
      expect(createDiscordThreadSpy).toHaveBeenCalled();
    });

    it("should handle non-existent chat IDs", async () => {
      const mockDb = {
        query: () => ({
          get: () => ({ exists: 0 }),
        }),
      } as unknown as Database;

      getOrInitUserDbSpy.mockImplementation(() => Promise.resolve(mockDb));

      await handleResumeChatCommand(
        mockInteraction as ChatInputCommandInteraction,
        mockDbCache,
        "test-db-dir",
        10,
        5,
        mockActiveChatThreads,
      );

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.stringContaining("does not exist"),
      );
    });
  });

  describe("handleUserMessage - User message queueing and processing", () => {
    it("should queue new messages and start worker", async () => {
      const mockMessageQueues = new Map();
      const mockThreadInfo: ChatThreadInfo = {
        userId: "test-user-id",
        chatId: "test-chat-id",
        modelOptions: {
          model: "gpt-4",
          temperature: 0.7,
          max_tokens: 500,
        },
      };
      const mockMessage = {
        content: "test message",
        author: { id: "test-user-id" },
        id: "test-message-id",
        channel: {
          isTextBased: () => true, // ensure channel is defined
        },
      } as Message;
      const mockModelClient = {
        chat: { completions: { create: mock() } },
      } as unknown as OpenAI;

      await handleUserMessage(
        mockMessageQueues,
        mockThreadInfo,
        mockDbCache,
        { modelClient: mockModelClient } as unknown as ChatThymeConfig,
        mockModelClient,
        undefined,
        mockMessage,
      );

      expect(mockMessageQueues.has("test-chat-id")).toBe(true);
      expect(mockMessageQueues.get("test-chat-id").queue.length).toBe(1);
      expect(startQueueWorkerSpy).toHaveBeenCalled();
    });
  });
});
