/**
 * claude.ts — optional AI scoring with the Claude API.
 *
 * Each new job that passed the rules gets a 0-10 fit score and a one-line
 * reason, judged against config/profile.md. Runs only when ANTHROPIC_API_KEY
 * is set, and only for the top CLAUDE_MAX_JOBS jobs per run (cost cap).
 * If a call fails, the job keeps its rule-based score.
 */

import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { CvVariantSchema, type JobPosting } from "../types/schemas.js";
import { env } from "../utils/config.js";
import { Logger } from "../utils/logger.js";

export const ScoreSchema = z.object({
  score: z.number().describe("Fit score from 0 (no fit) to 10 (ideal fit)"),
  reason: z.string().describe("One short line (max ~20 words) explaining the score"),
  cv: CvVariantSchema.optional().describe("Which CV version to send: support, implementation, automation or fullstack"),
  opener: z
    .string()
    .optional()
    .describe("One or two sentences the job seeker could open a cover note with, using only facts from the profile"),
});
export type ClaudeScore = z.infer<typeof ScoreSchema>;

export const SYSTEM = `You screen job ads for one job seeker and rate how well each ad fits them.

Rate fit from 0 to 10:
- 9-10: one of their top target roles, junior-friendly, location works.
- 6-8: a good fit with a gap (e.g. asks 2-3 years, or an adjacent role).
- 3-5: possible stretch.
- 0-2: not a fit (senior, wrong field, wrong location, sales quota role).

Reply with the score and one short reason line written to the job seeker (no preamble).

Also pick which of their CV versions to send (cv: support, implementation, automation or fullstack;
see "CV versions" in the profile), and write an opener: ONE sentence, at most 30 words, first person,
that the job seeker could start a recruiter message with. Name one concrete item from "Facts an opener
may use" (a project, a number, a role) and tie it to one thing this ad asks for. Plain and specific:
no "I am eager", "I would love", "I excel", "passionate", "strong foundation". Use only facts listed
in the profile; never add skills, tools or experience that are not written there.

Job seeker profile:
${readFileSync("config/profile.md", "utf8")}`;

let client: Anthropic | null = null;

/** Rounds the score to the nearest 0.5 within 0-10 and trims the text fields. */
export function clampScore(s: ClaudeScore): ClaudeScore {
  return {
    score: Math.max(0, Math.min(10, Math.round(s.score * 2) / 2)),
    reason: s.reason.trim(),
    ...(s.cv ? { cv: s.cv } : {}),
    ...(s.opener?.trim() ? { opener: s.opener.trim() } : {}),
  };
}

/** Description is passed in full; ads are typically 2-8K characters. */
export function jobPrompt(job: JobPosting): string {
  return [
    `Company: ${job.company}`,
    `Title: ${job.title}`,
    `Location: ${job.location || "(not given)"}${job.remote ? " (remote)" : ""}`,
    job.experienceLevel ? `Seniority label: ${job.experienceLevel}` : "",
    "",
    job.description || "(no description available; judge from the title)",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export async function scoreWithClaude(job: JobPosting): Promise<ClaudeScore | null> {
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 3 });
  try {
    const res = await client.beta.messages.parse({
      model: env.CLAUDE_MODEL,
      max_tokens: 4000,
      system: SYSTEM,
      messages: [{ role: "user", content: jobPrompt(job) }],
      output_config: { effort: "low", format: betaZodOutputFormat(ScoreSchema) },
      // Server-side refusal fallback (routes by refusal category); harmless for normal ads.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (res.stop_reason === "refusal" || !res.parsed_output) {
      Logger.warn("Claude gave no score", { title: job.title, stop: res.stop_reason });
      return null;
    }
    return clampScore(res.parsed_output);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw err; // bad key: stop scoring entirely
    if (err instanceof Anthropic.APIError) Logger.warn("Claude API error", { status: err.status, title: job.title, error: err.message });
    else Logger.warn("Claude call failed", { title: job.title, error: String(err) });
    return null;
  }
}

/** Scores jobs with limited concurrency. Returns a map index -> score. */
export async function scoreMany(jobs: JobPosting[], concurrency = 3): Promise<Map<number, ClaudeScore>> {
  const out = new Map<number, ClaudeScore>();
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      const job = jobs[i];
      if (!job) continue;
      const s = await scoreWithClaude(job);
      if (s) out.set(i, s);
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  } catch (err) {
    Logger.error("Claude scoring stopped (check ANTHROPIC_API_KEY)", { error: String(err) });
  }
  return out;
}
