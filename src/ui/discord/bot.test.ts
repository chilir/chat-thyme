// src/ui/discord/bot.test.ts

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
import type { Client, Guild, GuildApplicationCommandManager } from "discord.js";
import type OpenAI from "openai";
import tmp from "tmp";
import type { ChatThymeConfig } from "../../config";
import type { ChatThymeClients, DbCache } from "../../interfaces";
import { setupDiscordBot } from "./bot";
import * as DiscordHandlers from "./handlers";

tmp.setGracefulCleanup();

describe("Discord Bot", () => {
  let mockDiscordClient: Client;
  let mockGuild: Guild;
  let mockClients: ChatThymeClients;
  let mockConfig: ChatThymeConfig;
  let mockDbCache: DbCache;
  let tmpDir: tmp.DirResult;

  beforeEach(() => {
    tmpDir = tmp.dirSync({
      prefix: "chat-thyme-bot-test-",
      unsafeCleanup: true,
      keep: false,
    });

    mockGuild = {
      id: "guild1",
      name: "Test Guild",
      valueOf: () => "guild1",
      commands: {
        set: mock(() => Promise.resolve()),
        create: mock(() => Promise.resolve()),
        fetch: mock(() => Promise.resolve([])),
        guild: mockGuild,
      } as unknown as GuildApplicationCommandManager,
    } as Guild;

    mockDiscordClient = {
      user: { tag: "TestBot#1234" },
      guilds: {
        cache: new Map([["guild1", mockGuild as Guild]]),
      },
      on: mock(),
    } as unknown as Client;

    mockClients = {
      discordClient: mockDiscordClient as Client,
      modelClient: {} as unknown as OpenAI,
    } as ChatThymeClients;

    mockConfig = {
      dbDir: tmpDir.name,
      dbConnectionCacheSize: 10,
      discordSlowModeInterval: 5,
    } as ChatThymeConfig;

    mockDbCache = {
      cache: new Map(),
      mutex: { acquire: () => Promise.resolve(() => {}) } as Mutex,
      evictionInterval: undefined,
    };
  });

  afterEach(() => {
    mock.restore();
    tmpDir.removeCallback();
  });

  it("should register event handlers on initialization", () => {
    setupDiscordBot(
      mockClients as ChatThymeClients,
      mockConfig as ChatThymeConfig,
      mockDbCache as DbCache,
    );

    expect(mockDiscordClient.on).toHaveBeenCalledWith(
      "ready",
      expect.any(Function),
    );
    expect(mockDiscordClient.on).toHaveBeenCalledWith(
      "interactionCreate",
      expect.any(Function),
    );
    expect(mockDiscordClient.on).toHaveBeenCalledWith(
      "messageCreate",
      expect.any(Function),
    );
  });

  it("should register slash commands on ready event", async () => {
    setupDiscordBot(
      mockClients as ChatThymeClients,
      mockConfig as ChatThymeConfig,
      mockDbCache as DbCache,
    );

    // @ts-ignore
    const readyHandler = mockDiscordClient.on.mock.calls.find(
      (call: string[]) => call[0] === "ready",
    )[1];

    await readyHandler();

    expect(mockGuild.commands.fetch).toHaveBeenCalled();
    expect(mockGuild.commands.create).toHaveBeenCalledTimes(2);
  }, 6000);

  it("should handle start-chat command interactions", async () => {
    const handleStartChatSpy = spyOn(DiscordHandlers, "handleStartChatCommand");
    setupDiscordBot(
      mockClients as ChatThymeClients,
      mockConfig as ChatThymeConfig,
      mockDbCache as DbCache,
    );

    // @ts-ignore
    const interactionHandler = mockDiscordClient.on.mock.calls.find(
      (call: string[]) => call[0] === "interactionCreate",
    )[1];

    const mockInteraction = {
      isChatInputCommand: () => true,
      commandName: "start-chat",
      options: {
        data: [],
        getInteger: (name: string) =>
          name === "auto_archive_minutes" ? 60 : null,
        getString: () => null,
        getBoolean: () => false,
        getNumber: () => null,
      },
      user: {
        tag: "user#1234",
        id: "test-user-id",
        username: "test-user",
      },
      deferReply: mock(() =>
        Promise.resolve({
          interaction: mockInteraction,
          webhook: mockInteraction,
        }),
      ),
      editReply: mock(() => Promise.resolve()),
      guildId: "test-guild-id",
      channelId: "test-channel-id",
      channel: {
        id: "test-channel-id",
        isThread: () => false,
        threads: {
          create: mock(() =>
            Promise.resolve({
              id: "new-thread-id",
              send: mock(() => Promise.resolve()),
              setRateLimitPerUser: mock(() => Promise.resolve()),
              setAutoArchiveDuration: mock(() => Promise.resolve()),
            }),
          ),
        },
      },
    };

    await interactionHandler(mockInteraction);

    expect(handleStartChatSpy).toHaveBeenCalled();
  });

  it("should handle resume-chat command interactions", async () => {
    const handleResumeChatSpy = spyOn(
      DiscordHandlers,
      "handleResumeChatCommand",
    );
    setupDiscordBot(
      mockClients as ChatThymeClients,
      mockConfig as ChatThymeConfig,
      mockDbCache as DbCache,
    );

    // @ts-ignore
    const interactionHandler = mockDiscordClient.on.mock.calls.find(
      (call: string[]) => call[0] === "interactionCreate",
    )[1];

    const mockInteraction = {
      isChatInputCommand: () => true,
      commandName: "resume-chat",
      options: {
        data: [],
        getString: mock((name: string) =>
          name === "chat_identifier" ? "test-chat-id" : null,
        ),
      },
      user: {
        tag: "user#1234",
        id: "test-user-id",
        username: "test-user",
      },
      deferReply: mock(() =>
        Promise.resolve({
          interaction: mockInteraction,
          webhook: mockInteraction,
        }),
      ),
      editReply: mock(() => Promise.resolve()),
      guildId: "test-guild-id",
      channelId: "test-channel-id",
      channel: {
        id: "test-channel-id",
        isThread: () => false,
        threads: {
          create: mock(() =>
            Promise.resolve({
              id: "new-thread-id",
              send: mock(() => Promise.resolve()),
              setRateLimitPerUser: mock(() => Promise.resolve()),
              setAutoArchiveDuration: mock(() => Promise.resolve()),
            }),
          ),
        },
      },
    };

    await interactionHandler(mockInteraction);

    expect(handleResumeChatSpy).toHaveBeenCalled();
  });

  it("should ignore bot messages", async () => {
    const handleUserMessageSpy = spyOn(DiscordHandlers, "handleUserMessage");

    setupDiscordBot(
      mockClients as ChatThymeClients,
      mockConfig as ChatThymeConfig,
      mockDbCache as DbCache,
    );

    // @ts-ignore
    const messageHandler = mockDiscordClient.on.mock.calls.find(
      (call: string[]) => call[0] === "messageCreate",
    )[1];

    await messageHandler({ author: { bot: true } });

    expect(handleUserMessageSpy).not.toHaveBeenCalled();
  });
});
