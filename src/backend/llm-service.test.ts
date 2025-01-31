// src/llm-service.test.ts

import { describe, expect, it, mock } from "bun:test";
import type OpenAI from "openai";
import { CHAT_THYME_TOOLS } from "./tools";
import type { ChatPrompt } from "../interfaces";
import { chatWithModel } from "./llm-service";

describe("LLM Service", () => {
  const mockResponse: OpenAI.Chat.ChatCompletion = {
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

  it("should handle error response from API", async () => {
    const mockErrorResponse = {
      error: {
        code: 500,
        message: "Internal Server Error",
        metadata: { detail: "Test error" },
      },
    };

    const mockOpenAIClient = {
      chat: {
        completions: {
          create: mock(async () => mockErrorResponse),
        },
      },
    } as unknown as OpenAI;

    const prompt: ChatPrompt = {
      modelName: "test-model",
      messages: [{ role: "user", content: "Hello" }],
      useTools: false,
    };

    expect(chatWithModel(mockOpenAIClient, prompt, {})).rejects.toThrow(
      "Error during model interaction: Internal Server Error",
    );
  });
});
