// src/backend/llm-service.test.ts

import { describe, expect, it, mock } from "bun:test";
import { APIError, type OpenAI } from "openai";
import type { ChatPrompt } from "../interfaces";
import { chatWithModel } from "./llm-service";
import { CHAT_THYME_TOOLS } from "./tools";

describe("LLM Service", () => {
  const mockResponse: OpenAI.ChatCompletion = {
    id: "mock-completion-id",
    object: "chat.completion",
    created: Date.now(),
    model: "test-model",
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
    const prompt: ChatPrompt = {
      modelName: "test-model",
      messages: [{ role: "user", content: "Hello" }],
      useTools: false,
    };
    const options = { temperature: 0.7 };

    const response = await chatWithModel(mockOpenAIClient, prompt, options);

    expect(response).toEqual(mockResponse);
    expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledWith({
      model: prompt.modelName,
      messages: prompt.messages,
      tools: undefined,
      temperature: 0.7,
    });
  });

  it("should include tools when useTools is true", async () => {
    const prompt: ChatPrompt = {
      modelName: "test-model",
      messages: [{ role: "user", content: "Hello" }],
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

    const prompt: ChatPrompt = {
      modelName: "test-model",
      messages: [{ role: "user", content: "Hello" }],
      useTools: false,
    };

    expect(chatWithModel(mockErrorClient, prompt, {})).rejects.toThrow(
      "Rate limit exceeded",
    );
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

    const prompt: ChatPrompt = {
      modelName: "test-model",
      messages: [{ role: "user", content: "Hello" }],
      useTools: false,
    };

    expect(chatWithModel(mockErrorClient, prompt, {})).rejects.toThrow(
      "Server error",
    );
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

    const prompt: ChatPrompt = {
      modelName: "test-model",
      messages: [{ role: "user", content: "Hello" }],
      useTools: false,
    };

    expect(chatWithModel(mockErrorClient, prompt, {})).rejects.toThrow(
      "Unknown error occurred during model interaction.",
    );
  }, 10000);

  it("should remove unprocessed message on error", async () => {
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

    const prompt: ChatPrompt = {
      modelName: "test-model",
      messages: [
        { role: "user", content: "First message" },
        { role: "user", content: "Second message" },
      ],
      useTools: false,
    };

    try {
      await chatWithModel(mockErrorClient, prompt, {});
    } catch (error) {
      expect(prompt.messages).toHaveLength(1);
      expect(prompt.messages[0]?.content).toBe("First message");
    }
  }, 10000);
});
