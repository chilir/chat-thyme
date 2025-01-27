// src/llm-service.test.ts

import { describe, expect, it, mock } from "bun:test";
import type OpenAI from "openai";
import type { ChatPrompt } from "./interfaces";
import { chatWithModel } from "./llm-service";

describe("LLM Service", () => {
  it("should successfully send chat completion request", async () => {
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

    const prompt: ChatPrompt = {
      modelName: "test-model",
      messages: [{ role: "user", content: "Hello" }],
    };

    const response = await chatWithModel(mockOpenAIClient, prompt);

    expect(response).toEqual(mockResponse);
    expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledWith({
      model: prompt.modelName,
      messages: prompt.messages,
    });
  });

  it("should handle API errors", async () => {
    const mockOpenAIClient = {
      chat: {
        completions: {
          create: mock(() => {
            throw new Error("API Error");
          }),
        },
      },
    } as unknown as OpenAI;

    const prompt: ChatPrompt = {
      modelName: "test-model",
      messages: [{ role: "user", content: "Hello" }],
    };

    expect(chatWithModel(mockOpenAIClient, prompt)).rejects.toThrow(
      "API Error",
    );
  });
});
