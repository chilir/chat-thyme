import type Exa from "exa-js";
import type OpenAI from "openai";

export const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "exa_search",
      description:
        "Perform a search query on the web, and retrieve the world's most relevant information.",
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

export const processExaSearchCall = async (
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[],
  exaClient: Exa,
): Promise<OpenAI.Chat.Completions.ChatCompletionToolMessageParam[]> => {
  const toolMsgs: OpenAI.Chat.Completions.ChatCompletionToolMessageParam[] = [];
  for (const toolCall of toolCalls) {
    const funcName = toolCall.function.name;
    const funcArgs = JSON.parse(toolCall.function.arguments);

    let searchResults = {};
    if (funcName === "exa_search") {
      searchResults = await exaClient.searchAndContents(funcArgs.query, {
        type: "auto",
        highlights: true,
        numResults: 3,
      });
    }

    toolMsgs.push({
      role: "tool",
      content: JSON.stringify(searchResults),
      tool_call_id: toolCall.id,
    });
  }

  return toolMsgs;
};
