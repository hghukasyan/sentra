export interface CircuitBreakerState {
  consecutiveFailures: number;
  openedAt: number | null;
}

export function createCircuitBreakerState(): CircuitBreakerState {
  return { consecutiveFailures: 0, openedAt: null };
}

export interface RetryOptions {
  retries?: number;
  delay?: number | ((attempt: number) => number);
  maxDelay?: number;
  factor?: number;
  jitter?: boolean | "full" | "equal";
  timeout?: number;
  signal?: AbortSignal;
  retryOn?: (error: unknown, attempt: number) => boolean | Promise<boolean>;
  onRetry?: (error: unknown, attempt: number, nextDelay: number) => void;
  maxDuration?: number;
  circuitBreaker?: {
    failureThreshold: number;
    cooldown: number;
    state: CircuitBreakerState;
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const id = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Operation timed out")), ms)
    ),
  ]);
}

function applyJitter(
  amount: number,
  mode?: boolean | "full" | "equal"
): number {
  if (mode === "full" || mode === true) {
    return Math.random() * amount;
  }
  if (mode === "equal") {
    return amount / 2 + Math.random() * (amount / 2);
  }
  return amount;
}

function createRetryError(
  lastError: unknown,
  attempts: number,
  elapsed: number
): Error {
  const err = new Error(
    `Retry failed after ${attempts} attempts (${elapsed}ms)`
  );
  (err as Error & { cause?: unknown }).cause = lastError;
  return err;
}

export class CircuitOpenError extends Error {
  constructor(
    message = "Circuit breaker is open",
    public readonly cooldownRemaining?: number
  ) {
    super(message);
    this.name = "CircuitOpenError";
  }
}

function checkCircuitBreaker(
  cb: NonNullable<RetryOptions["circuitBreaker"]>
): void {
  const { state, cooldown } = cb;
  if (state.openedAt === null) return;

  const elapsed = Date.now() - state.openedAt;
  if (elapsed < cooldown) {
    throw new CircuitOpenError("Circuit breaker is open", cooldown - elapsed);
  }
  // Cooldown passed; allow single test call (state reset on success below)
}

export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    retries = 3,
    delay: delayOption = 100,
    maxDelay,
    factor = 2,
    jitter,
    timeout: attemptTimeout,
    signal,
    retryOn,
    onRetry,
    maxDuration,
    circuitBreaker,
  } = options;

  if (circuitBreaker) {
    checkCircuitBreaker(circuitBreaker);
  }

  const startTime = Date.now();
  let lastError: unknown;
  let delay =
    typeof delayOption === "function" ? delayOption(0) : delayOption;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    try {
      let promise = Promise.resolve(fn(attempt));
      if (attemptTimeout != null) {
        promise = withTimeout(promise, attemptTimeout);
      }
      const result = await promise;
      if (circuitBreaker?.state) {
        circuitBreaker.state.consecutiveFailures = 0;
        circuitBreaker.state.openedAt = null;
      }
      return result;
    } catch (err) {
      lastError = err;

      if (circuitBreaker?.state) {
        const { state, failureThreshold } = circuitBreaker;
        state.consecutiveFailures++;
        if (state.consecutiveFailures >= failureThreshold) {
          state.openedAt = Date.now();
        }
      }
      const elapsed = Date.now() - startTime;

      if (retryOn !== undefined) {
        const shouldRetry = await Promise.resolve(retryOn(err, attempt));
        if (!shouldRetry) {
          throw createRetryError(lastError, attempt + 1, elapsed);
        }
      }

      if (attempt === retries) {
        throw createRetryError(lastError, attempt + 1, elapsed);
      }

      if (maxDuration != null && elapsed >= maxDuration) {
        throw createRetryError(lastError, attempt + 1, elapsed);
      }

      const baseDelay =
        typeof delayOption === "function"
          ? delayOption(attempt)
          : delay;
      let waitTime = applyJitter(baseDelay, jitter);
      if (maxDelay != null && waitTime > maxDelay) {
        waitTime = maxDelay;
      }

      onRetry?.(err, attempt, waitTime);

      await sleep(waitTime, signal);

      if (typeof delayOption === "number") {
        delay = Math.min(
          delay * factor,
          maxDelay ?? Number.POSITIVE_INFINITY
        );
      }
    }
  }

  throw createRetryError(
    lastError!,
    retries + 1,
    Date.now() - startTime
  );
}
