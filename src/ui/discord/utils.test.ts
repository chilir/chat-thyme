// src/ui/discord/utils.test.ts

import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from "bun:test";
import { ChannelType } from "discord.js";
import type {
  ChatInputCommandInteraction,
  Client,
  Message,
  TextChannel,
  ThreadChannel,
} from "discord.js";
import type OpenAI from "openai";
import type { ChatThymeConfig } from "../../config";
import type {
  ChatMessageQueue,
  ChatThreadInfo,
  DbCache,
} from "../../interfaces";
import {
  createDiscordThread,
  getModelOptions,
  processMessageFromQueue,
  startArchivedThreadEviction,
  startQueueWorker,
} from "./utils";

describe("getModelOptions", () => {
  it("should extract provided parameters in strict mode", () => {
    const mockInteraction = {
      options: {
        getBoolean: (name: string) => (name === "strict" ? true : null),
        getNumber: (name: string) => {
          const values: Record<string, number> = {
            temperature: 0.7,
            frequency_penalty: 0.5,
          };
          return values[name] ?? null;
        },
        getInteger: (name: string) => {
          const values: Record<string, number> = {
            max_tokens: 100,
          };
          return values[name] ?? null;
        },
      },
    } as ChatInputCommandInteraction;

    const options = getModelOptions(mockInteraction);
    expect(options).toEqual({
      temperature: 0.7,
      frequency_penalty: 0.5,
      max_tokens: 100,
    });
    expect(options).not.toHaveProperty("min_p");
    expect(options).not.toHaveProperty("include_reasoning");
  });

  it("should include additional parameters in non-strict mode", () => {
    const mockInteraction = {
      options: {
        getBoolean: () => false,
        getNumber: (name: string) => {
          const values: Record<string, number> = {
            temperature: 0.7,
            min_p: 0.1,
            top_k: 40,
          };
          return values[name] ?? null;
        },
        getInteger: () => null,
      },
    } as unknown as ChatInputCommandInteraction;

    const options = getModelOptions(mockInteraction);
    expect(options).toEqual({
      temperature: 0.7,
      min_p: 0.1,
      top_k: 40,
      include_reasoning: true,
    });
  });
});

describe("startArchivedThreadEviction", () => {
  let intervalCallback: () => Promise<void>;
  let originalSetInterval: typeof setInterval;
  let activeChatThreads: Map<string, ChatThreadInfo>;
  let chatMessageQueues: Map<string, ChatMessageQueue>;

  beforeEach(() => {
    originalSetInterval = global.setInterval;
    spyOn(global, "setInterval").mockImplementation(
      // @ts-ignore
      (fn: () => Promise<void>) => {
        intervalCallback = fn;
        return { unref: () => {} } as unknown as NodeJS.Timeout;
      },
    );
    activeChatThreads = new Map<string, ChatThreadInfo>();
    chatMessageQueues = new Map<string, ChatMessageQueue>();
  });

  afterEach(() => {
    global.setInterval = originalSetInterval;
    mock.restore();
  });

  it("should remove archived threads and lock them", async () => {
    const mockThread = {
      id: "123",
      isThread: () => true,
      archived: true,
      setLocked: mock(() => Promise.resolve(undefined)),
    };
    const mockDiscordClient = {
      channels: {
        fetch: mock(() => Promise.resolve(mockThread)),
      },
    } as unknown as Client;
    activeChatThreads.set("123", {
      chatId: "chat123",
      userId: "user1",
      modelOptions: {},
    });
    startArchivedThreadEviction(
      mockDiscordClient,
      activeChatThreads,
      chatMessageQueues,
    );

    // manually trigger the interval callback
    await intervalCallback();

    expect(mockThread.setLocked).toHaveBeenCalledTimes(1);
    expect(mockThread.setLocked).toHaveBeenCalledWith(
      true,
      "Thread archived and locked",
    );
    expect(activeChatThreads.size).toBe(0);
  });

  it("should handle deleted threads", async () => {
    const mockDiscordClient = {
      channels: {
        fetch: mock(() => Promise.resolve(null)),
      },
    } as unknown as Client;
    activeChatThreads.set("123", {
      chatId: "chat123",
      userId: "user1",
      modelOptions: {},
    });
    chatMessageQueues.set("chat123", { queue: [], stopSignal: false });
    startArchivedThreadEviction(
      mockDiscordClient,
      activeChatThreads,
      chatMessageQueues,
    );

    await intervalCallback();

    expect(activeChatThreads.size).toBe(0);
    expect(chatMessageQueues.has("chat123")).toBe(false);
  });

  it("should handle errors gracefully", async () => {
    const mockDiscordClient = {
      channels: {
        fetch: mock(() => Promise.reject(new Error("Network error"))),
      },
    } as unknown as Client;
    activeChatThreads.set("123", {
      chatId: "chat123",
      userId: "user1",
      modelOptions: {},
    });
    const consoleSpy = spyOn(console, "warn").mockImplementation(() => {});
    startArchivedThreadEviction(
      mockDiscordClient,
      activeChatThreads,
      chatMessageQueues,
    );

    await intervalCallback();

    expect(consoleSpy).toHaveBeenCalled();
    expect(activeChatThreads.size).toBe(1); // Should not remove thread on error
  });
});

describe("createDiscordThread", () => {
  let activeChatThreads: Map<string, ChatThreadInfo>;
  const mockEditReply = mock(() => Promise.resolve());

  beforeEach(() => {
    activeChatThreads = new Map<string, ChatThreadInfo>();
  });

  it("should create a thread successfully", async () => {
    const mockThread = {
      id: "thread123",
      setRateLimitPerUser: mock(() => Promise.resolve()),
    };
    const mockCreateThread = mock(() => Promise.resolve(mockThread));
    const mockInteraction = {
      channel: {
        threads: { create: mockCreateThread },
      } as unknown as TextChannel,
      user: { id: "user1", username: "testuser" },
      options: {
        getInteger: (name: string) =>
          name === "auto_archive_minutes" ? 60 : null,
        getString: () => null,
        getBoolean: () => false,
        getNumber: () => null,
      },
      editReply: mockEditReply,
    } as unknown as ChatInputCommandInteraction;

    await createDiscordThread(
      mockInteraction,
      "chat123",
      "Test thread",
      10,
      activeChatThreads,
    );

    expect(mockCreateThread).toHaveBeenCalledWith({
      name: "Chat with testuser: chat123",
      type: ChannelType.PrivateThread,
      autoArchiveDuration: 60,
      reason: "Test thread",
    });
    expect(activeChatThreads.size).toBe(1);
    expect(activeChatThreads.get("thread123")).toBeDefined();
  });

  it("should handle thread creation failure", async () => {
    const mockCreateThread = mock(() =>
      Promise.reject(new Error("Creation failed")),
    );
    const mockInteraction = {
      channel: {
        threads: { create: mockCreateThread },
      } as unknown as TextChannel,
      user: { id: "user1", username: "testuser" },
      options: {
        getInteger: () => null,
        getString: () => null,
      },
      editReply: mockEditReply,
    } as unknown as ChatInputCommandInteraction;

    expect(
      createDiscordThread(
        mockInteraction,
        "chat123",
        "Test thread",
        10,
        activeChatThreads,
      ),
    ).rejects.toThrow();
    expect(mockEditReply).toHaveBeenCalledWith(
      expect.stringContaining("Error creating Discord thread"),
    );
    expect(activeChatThreads.size).toBe(0);
  });
});

describe("startQueueWorker", () => {
  let chatMessageQueues: Map<string, ChatMessageQueue>;
  let mockMessage: Message;
  const mockChatThreadInfo: ChatThreadInfo = {
    chatId: "chat123",
    userId: "user1",
    modelOptions: {},
  };
  const mockDbCache: DbCache = {} as DbCache;
  const mockAppConfig: ChatThymeConfig = {} as ChatThymeConfig;
  const mockModelClient: OpenAI = {} as OpenAI;
  const mockExaClient = undefined;

  beforeEach(() => {
    chatMessageQueues = new Map<string, ChatMessageQueue>();
    mockMessage = {
      content: "test message",
      channel: {
        isTextBased: () => true,
        sendTyping: mock(() => Promise.resolve()),
      },
    } as unknown as Message;
  });

  afterEach(() => {
    mock.restore();
  });

  it("should process messages from queue", async () => {
    chatMessageQueues.set("chat123", {
      queue: [mockMessage],
      stopSignal: false,
    });

    // Mock processMessageFromQueue to simulate message processing
    const processMessageMock = mock(() => Promise.resolve());
    spyOn(
      await import("./utils"),
      "processMessageFromQueue",
    ).mockImplementation(processMessageMock);

    startQueueWorker(
      chatMessageQueues,
      mockChatThreadInfo,
      mockDbCache,
      mockAppConfig,
      mockModelClient,
      mockExaClient,
    );

    // Wait briefly for the worker to process the message
    await new Promise((resolve) => setTimeout(resolve, 50));

    // biome-ignore lint/style/noNonNullAssertion: chat123 exists
    const queue = chatMessageQueues.get("chat123")!;
    queue.stopSignal = true;

    // Wait for worker to stop
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(processMessageMock).toHaveBeenCalled();
    expect(queue.queue.length).toBe(0);
  });

  it("should handle missing queue gracefully", () => {
    const consoleSpy = spyOn(console, "warn").mockImplementation(() => {});

    startQueueWorker(
      new Map(),
      mockChatThreadInfo,
      mockDbCache,
      mockAppConfig,
      mockModelClient,
      mockExaClient,
    );

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Queue not found"),
    );
  });
});

describe("processMessageFromQueue", () => {
  let mockMessage: Message;
  let mockReply: Mock<() => Promise<void>>;
  const funcArgs = {
    chatThreadInfo: { chatId: "chat123", userId: "user1", modelOptions: {} },
    userDbCache: {} as DbCache,
    dbDir: "/test/path",
    dbConnectionCacheSize: 10,
    systemPrompt: "test prompt",
    modelClient: {} as OpenAI,
    model: "test-model",
    useTools: false,
    exaClient: undefined,
  };

  beforeEach(() => {
    mockReply = mock(() => Promise.resolve());
    mockMessage = {
      content: "test message",
      createdAt: new Date(),
      reply: mockReply,
    } as unknown as Message;
  });

  it("should process short messages directly", async () => {
    await processMessageFromQueue(
      funcArgs.chatThreadInfo,
      funcArgs.userDbCache,
      funcArgs.dbDir,
      funcArgs.dbConnectionCacheSize,
      funcArgs.systemPrompt,
      mockMessage,
      funcArgs.modelClient,
      funcArgs.model,
      funcArgs.useTools,
      funcArgs.exaClient,
    );

    expect(mockMessage.reply).toHaveBeenCalled();
  });

  it("should split long messages with pagination", async () => {
    // Mock processUserMessage to return a long response
    const longResponse = "a ".repeat(1500);
    spyOn(
      await import("../../backend"),
      "processUserMessage",
    ).mockImplementation(() => Promise.resolve(longResponse));

    await processMessageFromQueue(
      funcArgs.chatThreadInfo,
      funcArgs.userDbCache,
      funcArgs.dbDir,
      funcArgs.dbConnectionCacheSize,
      funcArgs.systemPrompt,
      mockMessage,
      funcArgs.modelClient,
      funcArgs.model,
      funcArgs.useTools,
      funcArgs.exaClient,
    );

    expect(mockReply).toHaveBeenCalledTimes(2); // Two chunks
    // @ts-ignore
    expect(mockReply.mock.calls[0][0]).toContain("(1/2)");
    // @ts-ignore
    expect(mockReply.mock.calls[1][0]).toContain("(2/2)");
  });

  it("should handle processing errors", async () => {
    spyOn(
      await import("../../backend"),
      "processUserMessage",
    ).mockImplementation(() => Promise.reject(new Error("Processing failed")));

    await processMessageFromQueue(
      funcArgs.chatThreadInfo,
      funcArgs.userDbCache,
      funcArgs.dbDir,
      funcArgs.dbConnectionCacheSize,
      funcArgs.systemPrompt,
      mockMessage,
      funcArgs.modelClient,
      funcArgs.model,
      funcArgs.useTools,
      funcArgs.exaClient,
    );

    expect(mockReply).toHaveBeenCalledWith(
      expect.stringContaining("Sorry, I encountered an error"),
    );
  });

  it("should handle long messages without spaces", async () => {
    // Mock processUserMessage to return a long response without spaces
    const longResponse = "a".repeat(1990) + "b".repeat(1990);
    spyOn(
      await import("../../backend"),
      "processUserMessage",
    ).mockImplementation(() => Promise.resolve(longResponse));

    await processMessageFromQueue(
      funcArgs.chatThreadInfo,
      funcArgs.userDbCache,
      funcArgs.dbDir,
      funcArgs.dbConnectionCacheSize,
      funcArgs.systemPrompt,
      mockMessage,
      funcArgs.modelClient,
      funcArgs.model,
      funcArgs.useTools,
      funcArgs.exaClient,
    );

    expect(mockReply).toHaveBeenCalledTimes(2);
    // @ts-ignore
    expect(mockReply.mock.calls[0][0]).toContain("a".repeat(1990));
    // @ts-ignore
    expect(mockReply.mock.calls[1][0]).toContain("b".repeat(1990));
  });
});
