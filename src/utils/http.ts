/**
 * http.ts
 *
 * Polite fetch helper: descriptive User-Agent, timeout, one retry on network
 * errors / 429 / 5xx, and a minimum gap between requests to the same host
 * (default 1 request per second per host).
 */

import { env } from "./config.js";

const USER_AGENT = `JobScout/2.0 (personal job-search bot; ${env.CONTACT ?? "contact: see repo README"})`;
const MIN_GAP_MS = 1000;
const lastHit = new Map<string, number>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits until at least MIN_GAP_MS has passed since the last request to this host. */
async function throttle(host: string): Promise<void> {
  const now = Date.now();
  const next = Math.max(now, (lastHit.get(host) ?? 0) + MIN_GAP_MS);
  lastHit.set(host, next);
  if (next > now) await sleep(next - now);
}

export class HttpError extends Error {
  constructor(public readonly status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
  }
}

async function request(url: string, accept: string): Promise<Response> {
  const host = new URL(url).host;
  for (let attempt = 1; ; attempt++) {
    await throttle(host);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: accept },
        signal: AbortSignal.timeout(60_000),
      });
      if ((res.status === 429 || res.status >= 500) && attempt < 2) {
        await sleep(5000);
        continue;
      }
      if (!res.ok) throw new HttpError(res.status, url);
      return res;
    } catch (err) {
      if (err instanceof HttpError || attempt >= 2) throw err;
      await sleep(3000);
    }
  }
}

/** GET and parse JSON. Returns `unknown`: callers validate with Zod. */
export async function getJson(url: string): Promise<unknown> {
  const res = await request(url, "application/json");
  return res.json();
}

export async function getText(url: string): Promise<string> {
  const res = await request(url, "text/html,application/xhtml+xml");
  return res.text();
}
