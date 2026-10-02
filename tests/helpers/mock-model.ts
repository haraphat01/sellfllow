import { MockLanguageModelV4 } from "ai/test";

type Call = { tool: string; input: Record<string, unknown> };
type Step = Call | { parallel: Call[] } | { text: string };

const usage = { inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 20, text: 20, reasoning: undefined } };

/** A scripted model: each step is either one tool call or a final text answer. */
export function scriptedModel(steps: Step[]) {
  let i = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      const step = steps[Math.min(i, steps.length - 1)];
      i++;
      if ("tool" in step || "parallel" in step) {
        const calls = "parallel" in step ? step.parallel : [step];
        return {
          content: calls.map((c, j) => ({ type: "tool-call" as const, toolCallId: `call_${i}_${j}`, toolName: c.tool, input: JSON.stringify(c.input) })),
          finishReason: { unified: "tool-calls" as const, raw: undefined },
          usage,
          warnings: [],
        };
      }
      return { content: [{ type: "text" as const, text: step.text }], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] };
    },
  });
  return model;
}
