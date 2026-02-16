import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  retry,
  createCircuitBreakerState,
  CircuitOpenError,
} from "retri";

describe("retry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns result on first successful attempt", async () => {
    const fn = vi.fn().mockResolvedValue(42);
    const p = retry(fn, { retries: 2, delay: 100 });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and resolves when attempt succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce("ok");
    const p = retry(fn, { retries: 3, delay: 10 });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("passes attempt index (0-based) to fn", async () => {
    const fn = vi.fn((attempt: number) =>
      attempt === 2 ? Promise.resolve(attempt) : Promise.reject(new Error("x"))
    );
    const p = retry(fn, { retries: 3, delay: 10 });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe(2);
    expect(fn).toHaveBeenCalledWith(0);
    expect(fn).toHaveBeenCalledWith(1);
    expect(fn).toHaveBeenCalledWith(2);
  });

  it("throws after all retries exhausted with cause and message", async () => {
    const err = new Error("original");
    const fn = vi.fn().mockRejectedValue(err);
    const p = retry(fn, { retries: 2, delay: 10 });
    await Promise.all([
      vi.runAllTimersAsync(),
      expect(p).rejects.toMatchObject({
        message: expect.stringMatching(/Retry failed after 3 attempts \(\d+ms\)/),
        cause: err,
      }),
    ]);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("uses default retries (3) when not specified", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("x"));
    const p = retry(fn, { delay: 10 });
    await Promise.all([vi.runAllTimersAsync(), expect(p).rejects.toThrow(/4 attempts/)]);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("respects retries: 0 (one attempt only)", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("x"));
    const p = retry(fn, { retries: 0, delay: 10 });
    await Promise.all([vi.runAllTimersAsync(), expect(p).rejects.toThrow(/1 attempts/)]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("applies exponential backoff with factor", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("x"));
    const delays: number[] = [];
    const p = retry(fn, {
      retries: 3,
      delay: 10,
      factor: 2,
      jitter: false,
      onRetry: (_err, _attempt, nextDelay) => delays.push(nextDelay),
    });
    await Promise.all([vi.runAllTimersAsync(), expect(p).rejects.toThrow()]);
    expect(delays).toEqual([10, 20, 40]);
  });

  it("caps delay at maxDelay", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("x"));
    const delays: number[] = [];
    const p = retry(fn, {
      retries: 3,
      delay: 100,
      factor: 2,
      maxDelay: 150,
      jitter: false,
      onRetry: (_err, _attempt, nextDelay) => delays.push(nextDelay),
    });
    await Promise.all([vi.runAllTimersAsync(), expect(p).rejects.toThrow()]);
    expect(delays).toEqual([100, 150, 150]);
  });

  it("uses custom delay function", async () => {
    const delayFn = vi.fn((attempt: number) => attempt * 50);
    const fn = vi.fn().mockRejectedValue(new Error("x"));
    const delays: number[] = [];
    const p = retry(fn, {
      retries: 2,
      delay: delayFn,
      jitter: false,
      onRetry: (_err, _attempt, nextDelay) => delays.push(nextDelay),
    });
    await Promise.all([vi.runAllTimersAsync(), expect(p).rejects.toThrow()]);
    expect(delays).toEqual([0, 50]);
  });

  it("calls onRetry with error, attempt, and nextDelay", async () => {
    const err = new Error("fail");
    const fn = vi.fn().mockRejectedValue(err);
    const onRetry = vi.fn();
    const p = retry(fn, { retries: 1, delay: 10, jitter: false, onRetry });
    await Promise.all([vi.runAllTimersAsync(), expect(p).rejects.toThrow()]);
    expect(onRetry).toHaveBeenCalledWith(err, 0, 10);
  });

  it("times out a single attempt when timeout option is set", async () => {
    const fn = vi.fn(() => new Promise<void>(() => {})); // never settles
    const p = retry(fn, { retries: 1, delay: 10, timeout: 50 });
    await Promise.all([
      vi.runAllTimersAsync(),
      expect(p).rejects.toMatchObject({
        cause: expect.objectContaining({ message: "Operation timed out" }),
      }),
    ]);
  });

  it("stops when maxDuration is exceeded", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("x"));
    const p = retry(fn, {
      retries: 10,
      delay: 1000,
      jitter: false,
      maxDuration: 100,
    });
    await Promise.all([
      vi.runAllTimersAsync(),
      expect(p).rejects.toThrow(/Retry failed after \d+ attempts/),
    ]);
    expect(fn).toHaveBeenCalledTimes(2); // attempt 0, wait 1000ms, attempt 1, then elapsed >= 100
  });

  it("retries when retryOn returns true", async () => {
    const err = new Error("retry me");
    const fn = vi
      .fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce("ok");
    const p = retry(fn, {
      retries: 2,
      delay: 10,
      retryOn: (e) => e === err,
    });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws immediately when retryOn returns false", async () => {
    const err = new Error("do not retry");
    const fn = vi.fn().mockRejectedValue(err);
    const p = retry(fn, {
      retries: 5,
      delay: 10,
      retryOn: () => false,
    });
    await Promise.all([
      vi.runAllTimersAsync(),
      expect(p).rejects.toMatchObject({
        message: expect.stringMatching(/1 attempts/),
        cause: err,
      }),
    ]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("supports async retryOn", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("a"))
      .mockResolvedValueOnce("ok");
    const p = retry(fn, {
      retries: 2,
      delay: 10,
      retryOn: async (e) => (e as Error).message === "a",
    });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("aborts when signal is aborted before first attempt", async () => {
    const controller = new AbortController();
    controller.abort();
    const fn = vi.fn().mockResolvedValue(1);
    await expect(
      retry(fn, { retries: 2, delay: 10, signal: controller.signal })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fn).not.toHaveBeenCalled();
  });

  it("aborts when signal is aborted during wait", async () => {
    const controller = new AbortController();
    const fn = vi.fn().mockRejectedValue(new Error("x"));
    const p = retry(fn, {
      retries: 2,
      delay: 10_000,
      signal: controller.signal,
    });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await Promise.all([
      vi.runAllTimersAsync(),
      expect(p).rejects.toMatchObject({ name: "AbortError" }),
    ]);
  });

  it("opens circuit after failureThreshold and throws CircuitOpenError", async () => {
    const state = createCircuitBreakerState();
    const fn = vi.fn().mockRejectedValue(new Error("x"));
    const opts = {
      retries: 1,
      delay: 10,
      circuitBreaker: {
        failureThreshold: 2,
        cooldown: 1000,
        state,
      },
    };
    const p1 = retry(fn, opts);
    await Promise.all([vi.runAllTimersAsync(), expect(p1).rejects.toThrow()]);
    expect(fn).toHaveBeenCalledTimes(2);

    const p2 = retry(fn, opts);
    await expect(p2).rejects.toThrow(CircuitOpenError);
    expect((await p2.catch((e) => e)) as CircuitOpenError).toMatchObject({
      name: "CircuitOpenError",
      message: "Circuit breaker is open",
    });
    expect(fn).toHaveBeenCalledTimes(2); // no new calls
  });

  it("allows one test call after cooldown and resets circuit on success", async () => {
    const state = createCircuitBreakerState();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("x"))
      .mockRejectedValueOnce(new Error("x"))
      .mockResolvedValueOnce("recovered");
    const opts = {
      retries: 1,
      delay: 10,
      circuitBreaker: {
        failureThreshold: 2,
        cooldown: 100,
        state,
      },
    };
    const p1 = retry(fn, opts);
    await Promise.all([vi.runAllTimersAsync(), expect(p1).rejects.toThrow()]);
    vi.advanceTimersByTime(150);
    const p2 = retry(fn, opts);
    await vi.runAllTimersAsync();
    await expect(p2).resolves.toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("resets circuit breaker state on success", async () => {
    const state = createCircuitBreakerState();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("x"))
      .mockResolvedValueOnce("ok");
    const p = retry(fn, {
      retries: 2,
      delay: 10,
      circuitBreaker: { failureThreshold: 5, cooldown: 1000, state },
    });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe("ok");
    expect(state.consecutiveFailures).toBe(0);
    expect(state.openedAt).toBeNull();
  });
});

describe("createCircuitBreakerState", () => {
  it("returns state with consecutiveFailures 0 and openedAt null", () => {
    const state = createCircuitBreakerState();
    expect(state).toEqual({ consecutiveFailures: 0, openedAt: null });
  });
});

describe("CircuitOpenError", () => {
  it("has name CircuitOpenError and optional cooldownRemaining", () => {
    const err = new CircuitOpenError("open", 500);
    expect(err.name).toBe("CircuitOpenError");
    expect(err.message).toBe("open");
    expect(err.cooldownRemaining).toBe(500);
  });
});
