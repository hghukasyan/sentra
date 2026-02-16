/**
 * Minimal benchmark for retri: direct call vs retry wrapper, various retry counts.
 * Uses Node.js performance API only. No external benchmarking libraries.
 *
 * Run from repo root after build: node bench/bench.mjs
 */

import { retry } from "retri";

const ITERATIONS = 10_000;
const WARMUP = 1_000;

async function run(iterations, fn) {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    await fn();
  }
  const end = performance.now();
  return end - start;
}

async function main() {
  const noop = async () => {};
  const noopWithAttempt = async () => {};

  // Warm-up
  await run(WARMUP, noop);
  await run(WARMUP, () => retry(noopWithAttempt, { retries: 0 }));
  await run(WARMUP, () => retry(noopWithAttempt, { retries: 3 }));

  const results = [];

  // Direct call (no wrapper)
  const directMs = await run(ITERATIONS, noop);
  results.push({ name: "Direct call (no wrapper)", ms: directMs });

  // Retry wrapper with 0, 1, 3, 5 retries (all succeed on first attempt)
  for (const retries of [0, 1, 3, 5]) {
    const ms = await run(ITERATIONS, () =>
      retry(noopWithAttempt, { retries, delay: 0 })
    );
    results.push({
      name: `retry(fn, { retries: ${retries} })`,
      ms,
    });
  }

  // Print simple readable results
  console.log("retri benchmark (Node.js performance API)");
  console.log("==========================================");
  console.log(`Iterations per run: ${ITERATIONS.toLocaleString()}\n`);

  const directPerCall = results[0].ms / ITERATIONS;
  console.log("Mean time per call (ms):\n");

  for (const { name, ms } of results) {
    const perCall = ms / ITERATIONS;
    const overhead = name.startsWith("retry")
      ? (perCall - directPerCall).toFixed(4)
      : "-";
    console.log(
      `  ${name.padEnd(32)} ${perCall.toFixed(4).padStart(10)} ms  ${overhead !== "-" ? `(overhead: ${overhead} ms)` : ""}`
    );
  }

  console.log("\nTotal time (ms):");
  for (const { name, ms } of results) {
    console.log(`  ${name.padEnd(32)} ${ms.toFixed(2).padStart(10)} ms`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
