import { afterEach, describe, expect, it, vi } from "vitest";

import { debounced, inBackground, resetJobRunner, serialized, withRetries } from "@/lib/jobs/runner";

afterEach(() => {
  resetJobRunner();
  vi.useRealTimers();
});

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("serialized", () => {
  it("runs tasks with the same key one at a time, in order", async () => {
    const log: string[] = [];
    const task = (name: string, ms: number) => () => new Promise<void>((r) => setTimeout(() => (log.push(name), r()), ms));
    await Promise.all([serialized("k", task("a", 30)), serialized("k", task("b", 1)), serialized("k", task("c", 10))]);
    expect(log).toEqual(["a", "b", "c"]);
  });

  it("lets different keys run concurrently, and survives a failing task", async () => {
    const log: string[] = [];
    const slow = serialized("x", () => new Promise<void>((r) => setTimeout(() => (log.push("x"), r()), 30)));
    const fast = serialized("y", async () => void log.push("y"));
    const failing = serialized("y", async () => {
      throw new Error("boom");
    });
    const after = serialized("y", async () => void log.push("y2"));
    await Promise.allSettled([slow, fast, failing, after]);
    expect(log).toEqual(["y", "y2", "x"]);
    await expect(failing).rejects.toThrow("boom");
  });
});

describe("debounced", () => {
  it("runs once after the burst settles", async () => {
    vi.useFakeTimers();
    const fn = vi.fn(async () => undefined);
    debounced("conv", 3000, 20000, fn, 0);
    vi.advanceTimersByTime(2000);
    debounced("conv", 3000, 20000, fn, 2000);
    vi.advanceTimersByTime(2999);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("never waits longer than the maximum during a long burst", () => {
    vi.useFakeTimers();
    const fn = vi.fn(async () => undefined);
    for (let t = 0; t <= 19_000; t += 1000) {
      debounced("busy", 3000, 20000, fn, t);
      vi.advanceTimersByTime(1000);
    }
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("withRetries", () => {
  it("retries until success", async () => {
    let n = 0;
    const res = await withRetries(async () => (++n < 3 ? Promise.reject(new Error("flaky")) : "ok"), { attempts: 3, baseDelayMs: 1 });
    expect(res).toBe("ok");
    expect(n).toBe(3);
  });
  it("rethrows the last error", async () => {
    await expect(withRetries(async () => Promise.reject(new Error("down")), { attempts: 2, baseDelayMs: 1 })).rejects.toThrow("down");
  });
});

describe("inBackground", () => {
  it("still runs outside a request, and logs instead of throwing", async () => {
    const fn = vi.fn(async () => {
      throw new Error("ignored");
    });
    expect(() => inBackground("test", fn)).not.toThrow();
    await tick();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
