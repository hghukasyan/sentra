# sentra

Async retry with configurable backoff for Node.js and browsers. Retries on thrown or rejected errors; supports per-attempt timeout, optional jitter, circuit breaker, and cancellation via `AbortSignal`.

[![npm version](https://img.shields.io/npm/v/sentra.svg)](https://www.npmjs.com/package/sentra)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js version](https://img.shields.io/node/v/sentra.svg)](https://nodejs.org)

## Table of Contents

- [Installation](#installation)
- [Usage](#usage)
- [Options](#options)
- [AbortSignal](#abortsignal)
- [API](#api)
- [Requirements](#requirements)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

## Installation

```bash
npm install sentra
```

## Usage

```typescript
import { retry } from "sentra";

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
import { retry } from "sentra";

const controller = new AbortController();

const result = await retry(
  async () => fetch("https://api.example.com/data").then((r) => r.json()),
  { retries: 10, delay: 1000, signal: controller.signal }
);

// Later: controller.abort() rejects with DOMException "AbortError"
```

## API

The package exports:

- **`retry<T>(fn, options?)`** — Runs the async function with retries. Returns a Promise that resolves with the function’s result or rejects with the last error (with attempt info on `cause`).

TypeScript types are included.

## Requirements

- **Node.js:** >= 18 (see [engines](package.json))
- **Browsers:** Any environment that supports `Promise`, `AbortSignal`, and ES modules.

## Contributing

Contributions are welcome. Please open an [issue](https://github.com/hghukasyan/sentra/issues) or [pull request](https://github.com/hghukasyan/sentra/pulls) on GitHub.

## Security

To report a security vulnerability, please open a [GitHub Security Advisory](https://github.com/hghukasyan/sentra/security/advisories/new) or contact the maintainers responsibly. Do not open public issues for security-sensitive topics.

## License

**MIT License.** You may use, copy, modify, and distribute this software under the terms of the [MIT License](https://opensource.org/licenses/MIT). See the [LICENSE](LICENSE) file in the repository for the full text.
