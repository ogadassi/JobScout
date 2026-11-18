/**
 * format.ts — builds the morning digest and the Thursday weekly summary as
 * Telegram-flavored HTML (only <b>, <i>, <a> tags).
 */

import type { JobRow } from "../types/schemas.js";
import { escapeHtml as e } from "../utils/text.js";

function jobLine(r: JobRow, i: number): string {
  const loc = r.location ? ` · ${e(r.location.length > 40 ? `${r.location.slice(0, 40)}…` : r.location)}` : "";
  return [
    `${i + 1}. <b>${e(r.title)}</b> — ${e(r.company)}`,
    `⭐ ${r.score}/10${loc}`,
    r.reason ? `<i>${e(r.reason)}</i>` : "",
    `<a href="${e(r.link)}">Open job</a>`,
  ]
    .filter(Boolean)
    .join("\n");
}

function followUpLine(r: JobRow): string {
  return `• <b>${e(r.title)}</b> — ${e(r.company)} (applied ${r.applied_date ?? "?"}) <a href="${e(r.link)}">link</a>`;
}

export interface RunStats {
  companies: number;
  failedCompanies: number;
  scanned: number;
  matched: number;
  newJobs: number;
}

export function dailyDigest(date: string, jobs: JobRow[], followUps: JobRow[], stats: RunStats): string {
  const head = `🔎 <b>JobScout · ${date}</b>\n${stats.newJobs} new matching jobs (scanned ${stats.scanned} ads at ${stats.companies} companies${stats.failedCompanies ? `, ${stats.failedCompanies} boards failed` : ""}).`;
  const body = jobs.length ? jobs.map(jobLine).join("\n\n") : "No new jobs above the score cut-off today.";
  const fu = followUps.length ? `\n\n📬 <b>Follow-ups due</b>\n${followUps.map(followUpLine).join("\n")}` : "";
  return `${head}\n\n${body}${fu}\n\n<i>Update status in the Supabase table: starred / applied / replied / interview / rejected.</i>`;
}

export function weeklySummary(fromDate: string, toDate: string, rows: JobRow[], followUps: JobRow[]): string {
  const found = rows.filter((r) => r.date_found >= fromDate);
  const applied = rows.filter((r) => r.applied_date !== null && r.applied_date >= fromDate);
  const replies = rows.filter((r) => r.status === "replied" || r.status === "interview");
  const missed = found
    .filter((r) => r.status === "new" || r.status === "starred")
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const lines = [
    `📅 <b>JobScout weekly · ${fromDate} → ${toDate}</b>`,
    "",
    `• Jobs found: <b>${found.length}</b> (${found.filter((r) => r.score >= 7).length} scored 7+)`,
    `• Applications sent: <b>${applied.length}</b>`,
    `• Replies / interviews: <b>${replies.length}</b>`,
    `• Follow-ups due: <b>${followUps.length}</b>`,
  ];
  if (applied.length) lines.push("", "<b>Applied this week</b>", ...applied.map((r) => `• ${e(r.title)} — ${e(r.company)}`));
  if (replies.length) lines.push("", "<b>Replies / interviews</b>", ...replies.map((r) => `• ${e(r.title)} — ${e(r.company)} (${r.status})`));
  if (missed.length) lines.push("", "<b>Best jobs not applied to yet</b>", ...missed.map((r) => `• ${r.score}/10 <a href="${e(r.link)}">${e(r.title)}</a> — ${e(r.company)}`));
  if (followUps.length) lines.push("", "<b>Follow-ups due</b>", ...followUps.map(followUpLine));
  return lines.join("\n");
}
