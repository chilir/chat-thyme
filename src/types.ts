export type OllamaModelOptions = {
  temperature?: number;
  top_k?: number;
  top_p?: number;
  repeat_penalty?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  num_ctx?: number;
}

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
}

export type OllamaChatPrompt = {
  model_name: string;
  past_messages: ChatMessage[];
  prompt: string;
  options: OllamaModelOptions;
}