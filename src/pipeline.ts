/**
 * pipeline.ts — the nightly run:
 *   collect -> location/seniority/role rules -> dedupe (URL hash) -> Claude score
 *   -> store -> morning digest (+ weekly summary on Thursdays).
 */

import { collectAll, loadCompanies } from "./collectors/index.js";
import { collectLinkedInAlerts } from "./collectors/linkedinEmail.js";
import { dailyDigest, weeklySummary, type RunStats } from "./digest/format.js";
import { sendTelegram } from "./notify/telegram.js";
import { scoreMany } from "./scoring/claude.js";
import { scoreByRules } from "./scoring/rules.js";
import { LocalFileStore } from "./storage/localFile.js";
import { SupabaseStore } from "./storage/supabase.js";
import type { JobStore, NewJobRow } from "./storage/types.js";
import type { JobPosting, JobRow } from "./types/schemas.js";
import { env, features } from "./utils/config.js";
import { Logger } from "./utils/logger.js";
import { decodeEntities, israelDate, israelWeekday, urlHash } from "./utils/text.js";

export interface RunOptions {
  /** Collect and score, but write nothing and send nothing; print the digest. */
  dryRun: boolean;
  claude: boolean;
  digest: boolean;
  /** "auto" = only on Thursdays (Israel time). */
  weekly: "auto" | "always" | "never";
  /** Only run these ATS types / companies (for quick tests). */
  only?: string[];
  maxCompanies?: number;
}

export function openStore(dryRun: boolean): JobStore {
  if (features.supabase) return new SupabaseStore();
  return new LocalFileStore("data/jobs.json", dryRun);
}

/** Sends to Telegram, or prints to the console when Telegram is off / dry run. */
async function deliver(html: string, dryRun: boolean, label: string): Promise<void> {
  if (dryRun || !features.telegram) {
    const plain = decodeEntities(html.replace(/<a href="([^"]+)">([^<]*)<\/a>/g, "$2: $1").replace(/<[^>]+>/g, ""));
    console.log(`\n===== ${label} ${dryRun ? "(dry run, not sent)" : "(Telegram not configured, not sent)"} =====\n${plain}\n`);
    return;
  }
  await sendTelegram(html);
  Logger.info(`${label} sent to Telegram`);
}

export async function runWeekly(store: JobStore, dryRun: boolean): Promise<void> {
  const today = israelDate();
  const from = israelDate(-7);
  const [rows, followUps] = await Promise.all([store.activitySince(from), store.followUpsDue(today)]);
  await deliver(weeklySummary(from, today, rows, followUps), dryRun, "Weekly summary");
}

export async function runPipeline(opts: RunOptions): Promise<RunStats> {
  const started = Date.now();
  const store = openStore(opts.dryRun);
  Logger.info("Run started", { store: store.name, ...features, dryRun: opts.dryRun });

  // 1. Collect --------------------------------------------------------------
  let companies = loadCompanies();
  if (opts.only?.length) {
    const only = opts.only.map((s) => s.toLowerCase());
    companies = companies.filter((c) => only.includes(c.ats) || only.includes(c.name.toLowerCase()));
  }
  if (opts.maxCompanies) companies = companies.slice(0, opts.maxCompanies);

  const { jobs: boardJobs, failures } = await collectAll(companies);
  let emailJobs: JobPosting[] = [];
  if (features.linkedinEmail && !opts.only?.length) {
    try {
      emailJobs = await collectLinkedInAlerts();
    } catch (err) {
      Logger.warn("LinkedIn alert emails skipped", { error: String(err) });
    }
  }
  const all = [...boardJobs, ...emailJobs];

  // 2. Rules + in-run dedupe ------------------------------------------------
  const drops = { location: 0, seniority: 0, "no-role-match": 0 };
  const seen = new Set<string>();
  const matched: { job: JobPosting; hash: string; score: number; reason: string }[] = [];
  for (const job of all) {
    const r = scoreByRules(job);
    if (!r.keep) {
      if (r.dropped) drops[r.dropped]++;
      continue;
    }
    const hash = urlHash(job.link);
    const sameJobKey = `${job.company}|${job.title}`.toLowerCase();
    if (seen.has(hash) || seen.has(sameJobKey)) continue;
    seen.add(hash).add(sameJobKey);
    matched.push({ job, hash, score: r.score, reason: r.reason });
  }

  // 3. Dedupe against storage ----------------------------------------------
  const existing = await store.existingHashes(matched.map((m) => m.hash));
  const fresh = matched.filter((m) => !existing.has(m.hash)).sort((a, b) => b.score - a.score);
  Logger.info("Filtered", { scanned: all.length, matched: matched.length, new: fresh.length, dropped: drops });

  // 4. Claude scoring (top N by rule score) ----------------------------------
  if (opts.claude && features.claude && fresh.length) {
    const top = fresh.slice(0, env.CLAUDE_MAX_JOBS);
    const scores = await scoreMany(top.map((m) => m.job));
    for (const [i, s] of scores) {
      const m = top[i];
      if (m) {
        m.score = s.score;
        m.reason = s.reason;
      }
    }
    Logger.info("Claude scored", { scored: scores.size, of: top.length, model: env.CLAUDE_MODEL });
  }

  // 5. Store ----------------------------------------------------------------
  const today = israelDate();
  const newRows: NewJobRow[] = fresh.map((m) => ({
    url_hash: m.hash,
    date_found: today,
    company: m.job.company,
    title: m.job.title,
    link: m.job.link,
    location: m.job.location || null,
    source: m.job.source,
    score: m.score,
    reason: m.reason,
  }));
  if (!opts.dryRun) await store.insert(newRows);

  const stats: RunStats = {
    companies: companies.length,
    failedCompanies: failures.length,
    scanned: all.length,
    matched: matched.length,
    newJobs: fresh.length,
  };

  // 6. Digest ---------------------------------------------------------------
  if (opts.digest) {
    const digestJobs: JobRow[] = opts.dryRun
      ? newRows
          .filter((r) => r.score >= env.DIGEST_MIN_SCORE)
          .sort((a, b) => b.score - a.score)
          .slice(0, env.DIGEST_SIZE)
          .map((r) => ({ ...r, status: "new", applied_date: null, follow_up_date: null, notes: null, digested_at: null }))
      : await store.pendingDigest(env.DIGEST_MIN_SCORE, env.DIGEST_SIZE);
    const followUps = await store.followUpsDue(today);
    await deliver(dailyDigest(today, digestJobs, followUps, stats), opts.dryRun, "Morning digest");
    if (!opts.dryRun && (features.telegram || store instanceof LocalFileStore)) {
      await store.markDigested(digestJobs.map((j) => j.url_hash));
    }
  }

  if (opts.weekly === "always" || (opts.weekly === "auto" && israelWeekday() === 4)) {
    await runWeekly(store, opts.dryRun);
  }

  Logger.info("Run finished", { ...stats, seconds: Math.round((Date.now() - started) / 1000), failures });
  return stats;
}
