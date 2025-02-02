import type OpenAI from "openai";

/**
 * Array of available tools in chat-thyme.
 * Currently includes only the Exa search function.
 */
export const CHAT_THYME_TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "exa_search",
      description:
        "Perform a search query on the web with Exa, and retrieve the most relevant URLs/web data.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query to perform.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
];
