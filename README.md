# retri

Async retry with configurable backoff for Node.js and browsers. Retries on thrown or rejected errors; supports per-attempt timeout, optional jitter, circuit breaker, and cancellation via `AbortSignal`.

## Installation

```bash
npm install retri
```

## Usage

```typescript
import { retry } from "retri";

const data = await retry(
  async () => {
    const res = await fetch("https://api.example.com/data");
    if (!res.ok) throw new Error(res.statusText);
    return res.json();
  },
  { retries: 5, delay: 200, factor: 2 }
);
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `retries` | number | 3 | Number of retries after the first attempt. |
| `delay` | number \| (attempt: number) => number | 100 | Initial delay in ms, or function for custom delay per attempt. |
| `maxDelay` | number | — | Maximum delay between attempts (caps exponential backoff). |
| `factor` | number | 2 | Multiplier for delay after each attempt. |
| `jitter` | boolean \| "full" \| "equal" | — | Add randomness: `true`/`"full"` = 0..delay, `"equal"` = delay/2..delay. |
| `timeout` | number | — | Per-attempt timeout in ms. |
| `maxDuration` | number | — | Stop retrying after this many ms from the start. |
| `signal` | AbortSignal | — | Abort retries when signal is aborted. |
| `retryOn` | (error, attempt) => boolean \| Promise\<boolean\> | — | Predicate to decide whether to retry; if false, last error is thrown. |
| `onRetry` | (error, attempt, nextDelay) => void | — | Called before each wait. |
| `circuitBreaker` | object | — | `{ failureThreshold, cooldown, state }` to fail fast after N failures until cooldown. |

After all attempts are used (or `maxDuration` / `retryOn` stops retries), the last error is rethrown with a wrapper that includes attempt count and elapsed time as `cause`.

## AbortSignal

Pass an `AbortSignal` to cancel retries when the user navigates away or a parent operation is cancelled.

```typescript
import { retry } from "retri";

const controller = new AbortController();

const result = await retry(
  async () => fetch("https://api.example.com/data").then((r) => r.json()),
  { retries: 10, delay: 1000, signal: controller.signal }
);

// Later: controller.abort() rejects with DOMException "AbortError"
```

## License

MIT
