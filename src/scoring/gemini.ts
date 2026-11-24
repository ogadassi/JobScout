/**
 * gemini.ts — optional AI scoring with Google's Gemini API (free tier).
 *
 * Same job as claude.ts: a 0-10 fit score and a one-line reason for each new
 * job, judged against config/profile.md. Runs when GEMINI_API_KEY is set, and
 * takes priority over Claude because it costs nothing. The free tier allows
 * only a few requests a minute, so jobs are scored one at a time with a pause
 * between calls. If a call fails, the job keeps its rule-based score.
 */

import type { JobPosting } from "../types/schemas.js";
import { env } from "../utils/config.js";
import { Logger } from "../utils/logger.js";
import { type ClaudeScore, clampScore, jobPrompt, ScoreSchema, SYSTEM } from "./claude.js";

const API = "https://generativelanguage.googleapis.com/v1beta";
/** Free-tier flash models allow about 10 requests a minute; 6.5 s apart stays under that. */
const PAUSE_MS = 6_500;
const RATE_LIMIT_WAIT_MS = 30_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "gemini-3.8-flash" -> [3, 8]; used to pick the newest version. */
const version = (name: string) => (name.match(/gemini-([\d.]+)/)?.[1] ?? "0").split(".").map(Number);
const newerFirst = (a: string, b: string) => {
  const [va, vb] = [version(a), version(b)];
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const d = (vb[i] ?? 0) - (va[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
};

/**
 * Google retires model names often and the free tier doesn't allow every model,
 * so unless GEMINI_MODEL is set, list what this key can use, newest first:
 * stable "gemini-X.Y-flash", then "flash-lite".
 */
async function candidates(): Promise<string[]> {
  if (env.GEMINI_MODEL) return [env.GEMINI_MODEL];
  const res = await fetch(`${API}/models?pageSize=1000`, { headers: { "x-goog-api-key": env.GEMINI_API_KEY ?? "" } });
  if (!res.ok) throw new Error(`Gemini model list ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
  const names = (body.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""));
  const media = /image|tts|audio|live|exp/;
  const stable = names.filter((n) => /^gemini-[\d.]+-flash$/.test(n)).sort(newerFirst);
  const lite = names.filter((n) => /^gemini-[\d.]+-flash-lite/.test(n) && !media.test(n)).sort(newerFirst);
  const ordered = [...new Set([...stable, ...lite])];
  if (!ordered.length) throw new Error("No Gemini flash model is available for this key");
  return ordered;
}

/** Parses the model's JSON reply (tolerating ```json fences) into a clamped score. */
export function parseScore(text: string): ClaudeScore | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let data: unknown;
  try {
    data = JSON.parse(cleaned);
  } catch {
    return null;
  }
  // An unknown CV name only loses the CV pick, not the score.
  if (data && typeof data === "object" && "cv" in data && !["support", "implementation", "automation", "fullstack"].includes(String(data.cv))) {
    delete (data as { cv?: unknown }).cv;
  }
  const parsed = ScoreSchema.safeParse(data);
  if (!parsed.success) return null;
  return clampScore(parsed.data);
}

let models: string[] | null = null;

function call(model: string, job: JobPosting): Promise<Response> {
  return fetch(`${API}/models/${model}:generateContent`, {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
    headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY ?? "" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text: `${SYSTEM}\n\nReply with JSON only, exactly: {"score": <number 0-10>, "reason": "<one short line>", "cv": "<support|implementation|automation|fullstack>", "opener": "<one or two sentences>"}`,
          },
        ],
      },
      contents: [{ role: "user", parts: [{ text: jobPrompt(job) }] }],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });
}

/** Scores one job. Throws only when scoring should stop for the whole run (bad key, daily quota). */
export async function scoreWithGemini(job: JobPosting): Promise<ClaudeScore | null> {
  models ??= await candidates();
  let waited = false;
  let busy = 0;
  // An overloaded or slow model goes to the back of the list and the next one is tried,
  // so a model that answers stays first for the rest of the run.
  const tryNext = (model: string, why: string) => {
    Logger.warn("Gemini model busy, trying the next one", { model, why, title: job.title });
    models?.push(models.shift() as string);
    busy++;
  };
  while (models.length) {
    if (busy >= models.length) return null;
    const model = models[0] as string;
    let res: Response;
    try {
      res = await call(model, job);
    } catch (err) {
      tryNext(model, String(err));
      continue;
    }
    if (res.ok) {
      const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      const score = parseScore(text);
      if (!score) Logger.warn("Gemini gave no score", { model, title: job.title });
      return score;
    }
    const detail = (await res.text()).replace(/\s+/g, " ").slice(0, 200);
    if (res.status === 429) {
      // A second 429 after waiting means the daily free quota is used up: stop for this run.
      if (waited) throw new Error(`Gemini quota reached (${model}): ${detail}`);
      Logger.warn("Gemini rate limit, waiting", { model, seconds: RATE_LIMIT_WAIT_MS / 1000 });
      waited = true;
      await sleep(RATE_LIMIT_WAIT_MS);
      continue;
    }
    if (res.status >= 500) {
      tryNext(model, `${res.status}`);
      continue;
    }
    if (res.status === 403 || res.status === 404) {
      Logger.warn("Gemini model unavailable, trying the next one", { model, status: res.status });
      models.shift();
      continue;
    }
    if (res.status === 400 && /api key/i.test(detail)) throw new Error(`Gemini key rejected: ${detail}`);
    Logger.warn("Gemini API error", { model, status: res.status, title: job.title, error: detail });
    return null;
  }
  throw new Error("No Gemini model accepted this key");
}

/** Scores jobs one at a time (free-tier rate limit). Returns a map index -> score. */
export async function scoreManyGemini(jobs: JobPosting[]): Promise<Map<number, ClaudeScore>> {
  const out = new Map<number, ClaudeScore>();
  try {
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      if (!job) continue;
      if (i > 0) await sleep(PAUSE_MS);
      const s = await scoreWithGemini(job);
      if (s) out.set(i, s);
    }
  } catch (err) {
    Logger.error("Gemini scoring stopped (check GEMINI_API_KEY)", { error: String(err), scored: out.size });
  }
  return out;
}
