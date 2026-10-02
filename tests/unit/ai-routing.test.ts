import { beforeAll, describe, expect, it } from "vitest";

describe("model routing", () => {
  beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "x".repeat(40);
    process.env.DEEPSEEK_API_KEY = "sk-test-not-real";
  });

  it("sends deepseek/* to DeepSeek directly and everything else to AI Gateway", async () => {
    const { resolveModel } = await import("@/services/ai/provider");
    expect(resolveModel("anthropic/claude-sonnet-5")).toBe("anthropic/claude-sonnet-5");
    const ds = resolveModel("deepseek/deepseek-flash") as { provider: string; modelId: string };
    expect(ds.provider).toMatch(/deepseek/);
    expect(ds.modelId).toBe("deepseek-flash");
  });

  it("reports availability per provider", async () => {
    const { isModelAvailable } = await import("@/lib/env/server");
    expect(isModelAvailable("deepseek/deepseek-flash")).toBe(true);
  });
});
