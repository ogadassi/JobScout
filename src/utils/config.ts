/**
 * config.ts
 *
 * The only module that reads `process.env`. Every setting is optional so the
 * pipeline can run with whatever is configured: no Supabase -> local JSON file,
 * no email or Telegram -> digest printed to the console, no Gemini or Anthropic key ->
 * rule-based scores only.
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

  /** Where the digest goes: "email" (default) or "telegram". */
  DIGEST_CHANNEL: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["email", "telegram"]).default("email")),

  /** Email digest over SMTP. Defaults are Gmail's; use a Gmail app password. */
  SMTP_HOST: z.preprocess((v) => (v === "" ? undefined : v), z.string().default("smtp.gmail.com")),
  SMTP_PORT: intWithDefault(465),
  SMTP_USER: optional,
  SMTP_PASSWORD: optional,
  /** Who gets the digest; several addresses can be separated by commas. */
  DIGEST_EMAIL_TO: optional,
  /** Who may send reply commands (comma-separated). Default: DIGEST_EMAIL_TO and SMTP_USER. */
  COMMAND_SENDERS: optional,
  /** IMAP server of the SMTP_USER mailbox, read for reply commands. */
  IMAP_HOST: z.preprocess((v) => (v === "" ? undefined : v), z.string().default("imap.gmail.com")),

  TELEGRAM_BOT_TOKEN: optional,
  TELEGRAM_CHAT_ID: optional,

  /** Free AI scoring (Google AI Studio key). Used instead of Claude when set. */
  GEMINI_API_KEY: optional,
  /** Pin a Gemini model; empty = newest flash model the key can use. */
  GEMINI_MODEL: optional,

  ANTHROPIC_API_KEY: optional,
  CLAUDE_MODEL: z.preprocess((v) => (v === "" ? undefined : v), z.string().default("claude-opus-5-5")),
  /** Max jobs per run sent to AI scoring (Gemini or Claude): new jobs first, then apply-kit backfill. */
  CLAUDE_MAX_JOBS: intWithDefault(40),
  /** Of that budget, how many already-stored open jobs get their apply kit filled in per run. */
  KIT_BACKFILL_PER_RUN: intWithDefault(15),

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
  email: Boolean(env.SMTP_USER && env.SMTP_PASSWORD && env.DIGEST_EMAIL_TO),
  telegram: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
  gemini: Boolean(env.GEMINI_API_KEY),
  claude: Boolean(env.ANTHROPIC_API_KEY),
  linkedinEmail: Boolean(env.GMAIL_USER && env.GMAIL_APP_PASSWORD),
});

/** The digest channel picked by DIGEST_CHANNEL, if it is configured; null = print to the console. */
export const digestChannel: "email" | "telegram" | null = features[env.DIGEST_CHANNEL] ? env.DIGEST_CHANNEL : null;
