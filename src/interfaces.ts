// src/interfaces.ts

export interface OllamaModelOptions {
  temperature?: number;
  topK?: number;
  topP?: number;
  repeatPenalty?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  numCtx?: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OllamaChatPrompt {
  modelName: string;
  messages: ChatMessage[];
  options: OllamaModelOptions;
}
