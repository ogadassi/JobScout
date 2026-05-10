/**
 * rateLimiter.ts
 *
 * Enforces a minimum delay between async operations.
 * Used to prevent hammering the SerpApi with rapid-fire requests.
 *
 * Why a class instead of a plain function?
 * Because we need to track WHEN the last call happened — that's internal
 * state that lives across multiple calls. A class holds that state cleanly.
 *
 * How it works:
 *   const limiter = new RateLimiter(2000); // 2 seconds between calls
 *   await limiter.throttle(() => fetch(url1)); // runs immediately
 *   await limiter.throttle(() => fetch(url2)); // waits ~2s, then runs
 *   await limiter.throttle(() => fetch(url3)); // waits ~2s more, then runs
 */

import { Logger } from "./logger.js";

export class RateLimiter {
  /**
   * Stores when the last throttled call finished executing.
   * Starts at 0 (epoch) so the very first call runs immediately.
   */
  private lastCallTime = 0;

  /**
   * @param delayMs - Minimum milliseconds between calls. Default: 2000 (2s).
   *
   * Why 2 seconds? Our project rules (§3) require 1 request per 2 seconds,
   * and SerpApi's free tier has per-minute limits too.
   */
  constructor(private readonly delayMs: number = 2000) {}

  /**
   * Wraps an async function so it respects the rate limit.
   *
   * How to read the generic `<T>`:
   * `T` is a placeholder for "whatever type the wrapped function returns".
   * If you pass a function that returns `Promise<JobEntry[]>`, then
   * `throttle` returns `Promise<JobEntry[]>` too. TypeScript figures out
   * what `T` is automatically — you never need to specify it.
   *
   * @param fn - The async function to execute after the delay
   * @returns Whatever `fn` returns, with the same type
   */
  async throttle<T>(fn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const timeSinceLastCall = now - this.lastCallTime;
    const waitTime = this.delayMs - timeSinceLastCall;

    // Only wait if we're calling too soon. If enough time has passed, skip.
    if (waitTime > 0) {
      Logger.info("Rate limiter: waiting", { waitMs: waitTime });
      await this.sleep(waitTime);
    }

    // Execute the actual function and track when it finished
    const result = await fn();
    this.lastCallTime = Date.now();

    return result;
  }

  /**
   * Promise-based delay. Pauses execution for the given milliseconds.
   *
   * How to read this: `new Promise<void>(resolve => ...)` creates a promise
   * that resolves (completes) after `setTimeout` fires. `await this.sleep(2000)`
   * pauses the function for 2 seconds without blocking the rest of Node.js.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
