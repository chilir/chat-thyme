// src/llm-service/ollama.test.ts

import { describe, expect, it, mock } from "bun:test";
import type { ChatResponse, Ollama } from "ollama";
import { chatWithModel } from "./ollama";

describe("chatWithModel - Ollama LLM chat interaction", () => {
  it("successfully processes chat request", async () => {
    const mockResponse: ChatResponse = {
      model: "test-model",
      message: { role: "assistant", content: "Test response" },
      done: true,
      created_at: new Date(),
      done_reason: "",
      total_duration: 0,
      load_duration: 0,
      prompt_eval_count: 0,
      prompt_eval_duration: 0,
      eval_count: 0,
      eval_duration: 0,
    };

    const mockOllamaClient = {
      chat: mock(() => Promise.resolve(mockResponse)),
    };

    const prompt = {
      modelName: "test-model",
      messages: [{ role: "user", content: "Hello" }],
      options: {},
    };

    const response = await chatWithModel(
      mockOllamaClient as unknown as Ollama,
      prompt,
    );

    expect(response).toEqual(mockResponse);
    expect(mockOllamaClient.chat).toHaveBeenCalledWith({
      model: prompt.modelName,
      messages: prompt.messages,
      options: prompt.options,
      stream: false,
    });
  });

  it("handles errors properly", async () => {
    const mockError = new Error("Test error");
    const mockOllamaClient = {
      chat: mock(() => Promise.reject(mockError)),
    };

    const prompt = {
      modelName: "test-model",
      messages: [{ role: "user", content: "Hello" }],
      options: {},
    };

    expect(
      chatWithModel(mockOllamaClient as unknown as Ollama, prompt),
    ).rejects.toEqual(mockError);
  });
});
