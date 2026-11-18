/**
 * config.ts
 *
 * The only module that reads `process.env`. Every setting is optional so the
 * pipeline can run with whatever is configured: no Supabase -> local JSON file,
 * no Telegram -> digest printed to the console, no Anthropic key -> rule-based
 * scores only.
 *
 * Uses Node's built-in `process.loadEnvFile()` (Node 20.12+), which replaces
 * the `dotenv` package.
 */

import { existsSync } from "node:fs";
import { z } from "zod";

if (existsSync(".env")) process.loadEnvFile(".env");

/** Treat empty strings (common in CI when a secret is not set) as missing. */
const optional = z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());
const intWithDefault = (d: number) =>
  z.preprocess((v) => (v === "" || v === undefined ? d : Number(v)), z.number().int().nonnegative());

const EnvSchema = z.object({
  SUPABASE_URL: optional,
  SUPABASE_SECRET_KEY: optional,
  SUPABASE_TABLE: z.preprocess((v) => (v === "" ? undefined : v), z.string().default("jobscout_jobs")),

  TELEGRAM_BOT_TOKEN: optional,
  TELEGRAM_CHAT_ID: optional,

  ANTHROPIC_API_KEY: optional,
  CLAUDE_MODEL: z.preprocess((v) => (v === "" ? undefined : v), z.string().default("claude-opus-5-5")),
  /** Max new jobs per run sent to Claude for scoring (cost cap). */
  CLAUDE_MAX_JOBS: intWithDefault(40),

  GMAIL_USER: optional,
  GMAIL_APP_PASSWORD: optional,

  DIGEST_SIZE: intWithDefault(10),
  /** Jobs below this final score are stored but never sent in the digest. */
  DIGEST_MIN_SCORE: intWithDefault(5),
  /** Contact shown in the User-Agent header sent to job-board APIs. */
  CONTACT: optional,
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:\n", JSON.stringify(z.flattenError(parsed.error).fieldErrors, null, 2));
  process.exit(1);
}

export const env = Object.freeze(parsed.data);

export const features = Object.freeze({
  supabase: Boolean(env.SUPABASE_URL && env.SUPABASE_SECRET_KEY),
  telegram: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
  claude: Boolean(env.ANTHROPIC_API_KEY),
  linkedinEmail: Boolean(env.GMAIL_USER && env.GMAIL_APP_PASSWORD),
});
