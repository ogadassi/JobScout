/**
 * text.ts — small text helpers (HTML to plain text, URL normalization, hashing, dates).
 */

import { createHash } from "node:crypto";

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, code: string) => {
    const c = code.toLowerCase();
    if (c.startsWith("#x")) return String.fromCodePoint(parseInt(c.slice(2), 16));
    if (c.startsWith("#")) return String.fromCodePoint(parseInt(c.slice(1), 10));
    return NAMED[c] ?? m;
  });
}

/** Strips tags and collapses whitespace. Handles entity-escaped HTML (Greenhouse). */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  let s = html.includes("&lt;") ? decodeEntities(html) : html;
  s = s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/li|\/h\d|\/div)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(s)
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Query params that identify a job and must survive normalization. */
const KEEP_PARAMS = new Set(["gh_jid", "jobid", "job_id", "id"]);

/**
 * Normalizes a job URL so the same posting always hashes the same:
 * lowercase host, no fragment, no tracking params, no trailing slash.
 */
export function normalizeUrl(raw: string): string {
  const u = new URL(raw.trim());
  u.hash = "";
  u.hostname = u.hostname.toLowerCase();
  for (const key of [...u.searchParams.keys()]) {
    if (!KEEP_PARAMS.has(key.toLowerCase())) u.searchParams.delete(key);
  }
  u.searchParams.sort();
  u.pathname = u.pathname.replace(/\/+$/, "") || "/";
  return u.toString();
}

export function urlHash(raw: string): string {
  return createHash("sha256").update(normalizeUrl(raw)).digest("hex").slice(0, 32);
}

/** YYYY-MM-DD in Israel time, offset by `addDays`. */
export function israelDate(addDays = 0, from: Date = new Date()): string {
  const d = new Date(from.getTime() + addDays * 86_400_000);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

/** 0 = Sunday ... 4 = Thursday, in Israel time. */
export function israelWeekday(from: Date = new Date()): number {
  const name = from.toLocaleDateString("en-US", { timeZone: "Asia/Jerusalem", weekday: "short" });
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
