// src/backend/llm-service.test.ts

import { describe, expect, it, mock } from "bun:test";
import { APIError, type OpenAI } from "openai";
import type { ChatPrompt } from "../interfaces";
import { CHAT_THYME_TOOLS } from "./constants";
import { chatWithModel } from "./llm-service";

const testModel = "test-model";
const userRole = "user";
const testNoToolsChatPrompt: ChatPrompt = {
  modelName: testModel,
  messages: [{ role: userRole, content: "Hello" }],
  useTools: false,
};

describe("LLM Service", () => {
  const mockResponse: OpenAI.ChatCompletion = {
    id: "mock-completion-id",
    object: "chat.completion",
    created: Date.now(),
    model: testModel,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: "Test response",
          refusal: null,
        },
        finish_reason: "stop",
        logprobs: null,
      },
    ],
  };
  const mockOpenAIClient = {
    chat: {
      completions: {
        create: mock(async () => mockResponse),
      },
    },
  } as unknown as OpenAI;

  it("should successfully send chat completion request", async () => {
    const options = { temperature: 0.7 };
    const response = await chatWithModel(
      mockOpenAIClient,
      testNoToolsChatPrompt,
      options,
    );
    expect(response).toEqual(mockResponse);
    expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledWith({
      model: testNoToolsChatPrompt.modelName,
      messages: testNoToolsChatPrompt.messages,
      tools: undefined,
      temperature: 0.7,
    });
  });

  it("should include tools when useTools is true", async () => {
    const prompt: ChatPrompt = {
      modelName: testModel,
      messages: [{ role: userRole, content: "Hello" }],
      useTools: true,
    };
    const response = await chatWithModel(mockOpenAIClient, prompt, {});
    expect(response).toEqual(mockResponse);
    expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledWith({
      model: prompt.modelName,
      messages: prompt.messages,
      tools: CHAT_THYME_TOOLS,
    });
  });

  it("should handle rate limit errors specifically", async () => {
    const mockErrorClient = {
      chat: {
        completions: {
          create: mock(async () => {
            throw new APIError(
              429,
              { message: "Too many requests" },
              "Too many requests",
              {},
            );
          }),
        },
      },
    } as unknown as OpenAI;
    expect(
      chatWithModel(mockErrorClient, testNoToolsChatPrompt, {}),
    ).rejects.toThrow("Rate limit exceeded");
  }, 10000);

  it("should pass through other API error messages", async () => {
    const mockErrorClient = {
      chat: {
        completions: {
          create: mock(async () => {
            throw new APIError(
              500,
              { message: "Server error" },
              "Server error",
              {},
            );
          }),
        },
      },
    } as unknown as OpenAI;
    expect(
      chatWithModel(mockErrorClient, testNoToolsChatPrompt, {}),
    ).rejects.toThrow("Server error");
  }, 10000);

  it("should handle unknown errors", async () => {
    const mockErrorClient = {
      chat: {
        completions: {
          create: mock(async () => {
            throw new Error("Unknown error occurred");
          }),
        },
      },
    } as unknown as OpenAI;
    expect(
      chatWithModel(mockErrorClient, testNoToolsChatPrompt, {}),
    ).rejects.toThrow(
      "Unknown error occurred during model interaction: Unknown error occurred",
    );
  }, 10000);
});
