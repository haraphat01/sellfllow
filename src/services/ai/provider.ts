import "server-only";

import { createDeepSeek } from "@ai-sdk/deepseek";
import { isStepCount, ToolLoopAgent, type LanguageModel, type ModelMessage, type ToolSet } from "ai";

import { serverEnv } from "@/lib/env/server";

/**
 * Provider-agnostic AI interface. The rest of SellFlow depends on this, not on
 * a vendor SDK. The default implementation uses the AI SDK with Vercel AI
 * Gateway model strings ("anthropic/claude-sonnet-5", "openai/…"), so switching
 * vendor is a configuration change; a different SDK is a new implementation.
 */
export type AIMessage = { role: "user" | "assistant"; content: string };

export type AIInput = {
  model: string;
  system: string;
  messages: AIMessage[];
  tools: ToolSet;
  maxSteps?: number;
  temperature?: number;
};

export type AIToolCall = { name: string; input: unknown; output: unknown };

export type AIResponse = {
  text: string;
  toolCalls: AIToolCall[];
  usage: { inputTokens: number; outputTokens: number };
  finishReason: string;
  model: string;
};

export interface AIProvider {
  generateResponse(input: AIInput): Promise<AIResponse>;
}

/**
 * "deepseek/<model>" → DeepSeek's API directly (DEEPSEEK_API_KEY).
 * Anything else ("anthropic/…", "openai/…") → Vercel AI Gateway.
 */
export function resolveModel(id: string): LanguageModel {
  if (id.startsWith("deepseek/")) {
    return createDeepSeek({ apiKey: serverEnv().DEEPSEEK_API_KEY })(id.slice("deepseek/".length));
  }
  return id;
}

export class AISdkProvider implements AIProvider {
  /** `resolveModel` lets tests inject a mock model. */
  constructor(private resolve: (id: string) => LanguageModel = resolveModel) {}

  async generateResponse(input: AIInput): Promise<AIResponse> {
    const agent = new ToolLoopAgent({
      model: this.resolve(input.model),
      instructions: input.system,
      tools: input.tools,
      stopWhen: isStepCount(input.maxSteps ?? 6),
      temperature: input.temperature ?? 0.3,
      maxOutputTokens: 800,
      // DeepSeek V4 thinks by default: slower, and ignores temperature. Replies on WhatsApp should be quick.
      providerOptions: { deepseek: { thinking: { type: "disabled" } } },
    });

    const result = await agent.generate({ messages: input.messages as ModelMessage[] });

    const toolCalls: AIToolCall[] = result.steps.flatMap((step) =>
      step.toolResults.map((r) => ({ name: r.toolName, input: r.input, output: r.output })),
    );

    return {
      text: result.text.trim(),
      toolCalls,
      usage: {
        inputTokens: result.totalUsage.inputTokens ?? 0,
        outputTokens: result.totalUsage.outputTokens ?? 0,
      },
      finishReason: result.finishReason,
      model: input.model,
    };
  }
}

let defaultProvider: AIProvider | undefined;
export function getAIProvider(): AIProvider {
  defaultProvider ??= new AISdkProvider();
  return defaultProvider;
}
/** Tests only. */
export function setAIProviderForTesting(p: AIProvider | undefined) {
  defaultProvider = p;
}
