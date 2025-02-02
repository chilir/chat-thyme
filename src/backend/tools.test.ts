// src/backend/tools.test.ts

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
import type Exa from "exa-js";
import type { OpenAI } from "openai";
import { CHAT_THYME_TOOLS } from "./constants";
import * as LlmService from "./llm-service";
import { processToolCalls } from "./tools";

describe("Tool Definitions and Schema", () => {
  it("should define exa_search tool with correct schema and parameters", () => {
    expect(CHAT_THYME_TOOLS).toHaveLength(1);
    const searchTool =
      CHAT_THYME_TOOLS[0] as OpenAI.Chat.Completions.ChatCompletionTool;
    expect(searchTool.type).toBe("function");
    expect(searchTool.function.name).toBe("exa_search");
    // @ts-ignore
    expect(searchTool.function.parameters.required).toContain("query");
    // @ts-ignore
    expect(searchTool.function.parameters.properties).toHaveProperty("query");
  });
});

describe("Tool Call Processing and Integration", () => {
  let mockDb: Database;
  let mockExaClient: Exa;
  let mockModelClient: OpenAI;
  const testToolCalls = [
    {
      id: "test-call",
      type: "function" as const,
      function: {
        name: "exa_search",
        arguments: JSON.stringify({ query: "test search" }),
      },
    },
  ];
  const mockTimestamp = new Date("2024-01-01T00:00:00Z");

  beforeEach(() => {
    mockDb = {
      run: mock(() => {}),
    } as unknown as Database;

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
              content: "Here are the search results",
              reasoning_content: "Analyzed search data for relevance",
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
  });

  afterEach(() => {
    mock.restore();
  });

  it("should process Exa search tool calls and generate formatted response", async () => {
    const result = await processToolCalls(
      testToolCalls,
      mockExaClient,
      [],
      mockModelClient,
      "gpt-4",
      {},
      mockDb,
      "user123",
      "chat456",
    );
    expect(result).toEqual({
      timestamp: mockTimestamp,
      msgContent: "Here are the search results",
      reasoningContent: "Analyzed search data for relevance",
    });
    expect(mockExaClient.searchAndContents).toHaveBeenCalledWith(
      "test search",
      expect.any(Object),
    );
  });

  it("should gracefully handle unrecognized tool calls", async () => {
    const toolCalls = [
      {
        id: "test-call",
        type: "function" as const,
        function: {
          name: "unknown_tool",
          arguments: "{}",
        },
      },
    ];
    const result = await processToolCalls(
      toolCalls,
      mockExaClient,
      [],
      mockModelClient,
      "gpt-4",
      {},
      mockDb,
      "user123",
      "chat456",
    );
    expect(result.timestamp).toEqual(mockTimestamp);
    expect(mockExaClient.searchAndContents).not.toHaveBeenCalled();
  });

  it("should handle model response with empty choices", async () => {
    spyOn(LlmService, "chatWithModel").mockImplementation(() =>
      Promise.resolve({
        choices: [],
        created: mockTimestamp.getTime() / 1000,
        id: "mock-id",
        model: "gpt-4",
        object: "chat.completion",
      }),
    );
    const result = await processToolCalls(
      testToolCalls,
      mockExaClient,
      [],
      mockModelClient,
      "gpt-4",
      {},
      mockDb,
      "user123",
      "chat456",
    );
    expect(result).toEqual({
      timestamp: mockTimestamp,
      msgContent: "Failed to process search results",
      reasoningContent: undefined,
    });
  });

  it("should handle Exa search errors with retry and fallback", async () => {
    mockExaClient.searchAndContents = mock(() =>
      Promise.reject(new Error("Search failed")),
    );
    const result = await processToolCalls(
      testToolCalls,
      mockExaClient,
      [],
      mockModelClient,
      "gpt-4",
      {},
      mockDb,
      "user123",
      "chat456",
    );
    expect(result.timestamp).toEqual(mockTimestamp);
    expect(result.msgContent).toBe("Here are the search results");
    expect(mockDb.run).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO chat_messages"),
      expect.arrayContaining(["chat456", "tool"]),
    );
  }, 10000);
});
