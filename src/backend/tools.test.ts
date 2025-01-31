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
import * as LlmService from "./llm-service";
import { CHAT_THYME_TOOLS, processToolCalls } from "./tools";

describe("CHAT_THYME_TOOLS", () => {
  it("should define exa_search tool with correct structure", () => {
    expect(CHAT_THYME_TOOLS).toHaveLength(1);
    const searchTool =
      CHAT_THYME_TOOLS[0] as OpenAI.Chat.Completions.ChatCompletionTool;

    expect(searchTool.type).toBe("function");
    expect(searchTool.function.name).toBe("exa_search");
    expect(searchTool.function.parameters?.required).toContain("query");
    expect(searchTool.function.parameters?.properties).toHaveProperty("query");
  });
});

describe("processToolCalls", () => {
  let mockDb: Database;
  let mockExaClient: Exa;
  let mockModelClient: OpenAI;

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
              content: JSON.stringify({
                summary: "Processed search results",
              }),
              reasoning_content: "Analyzed the search data",
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
  });

  afterEach(() => {
    mock.restore();
  });

  it("should process exa_search tool calls successfully", async () => {
    const toolCalls = [
      {
        id: "test-call",
        type: "function" as const,
        function: {
          name: "exa_search",
          arguments: JSON.stringify({ query: "test search" }),
        },
      },
    ];

    const currentMessages = [
      { role: "user", content: "Search for something" },
    ] as OpenAI.Chat.ChatCompletionMessageParam[];

    const result = await processToolCalls(
      toolCalls,
      mockExaClient,
      currentMessages,
      mockModelClient,
      "gpt-4",
      {},
      mockDb,
      "user123",
      "chat456",
    );

    expect(result.msgContent).toBe('{"summary":"Processed search results"}');
    expect(result.reasoningContent).toBe("Analyzed the search data");
    expect(mockExaClient.searchAndContents).toHaveBeenCalled();
  });

  it("should handle unknown tool calls", async () => {
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

    const currentMessages = [
      { role: "user", content: "Try unknown tool" },
    ] as OpenAI.Chat.ChatCompletionMessageParam[];

    const result = await processToolCalls(
      toolCalls,
      mockExaClient,
      currentMessages,
      mockModelClient,
      "gpt-4",
      {},
      mockDb,
      "user123",
      "chat456",
    );

    expect(result.msgContent).toBe('{"summary":"Processed search results"}');
    expect(mockExaClient.searchAndContents).not.toHaveBeenCalled();
  });

  it("should handle empty model response choices", async () => {
    spyOn(LlmService, "chatWithModel").mockImplementation(() =>
      Promise.resolve({
        choices: [],
        created: Date.now() / 1000,
        id: "mock-id",
        model: "gpt-4",
        object: "chat.completion",
      }),
    );

    const toolCalls = [
      {
        id: "test-call",
        type: "function" as const,
        function: {
          name: "exa_search",
          arguments: JSON.stringify({ query: "test search" }),
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

    expect(result.msgContent).toBe("Failed to process search results");
    expect(result.reasoningContent).toBeUndefined();
  });

  it("should handle Exa search failures", async () => {
    (
      mockExaClient.searchAndContents as ReturnType<typeof mock>
    ).mockImplementationOnce(() => Promise.reject(new Error("Search failed")));

    const toolCalls = [
      {
        id: "test-call",
        type: "function" as const,
        function: {
          name: "exa_search",
          arguments: JSON.stringify({ query: "test search" }),
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

    expect(result.msgContent).toBe('{"summary":"Processed search results"}');
    const toolResponse = JSON.parse(result.msgContent as string);
    expect(toolResponse.summary).toBe("Processed search results");
  });
});
