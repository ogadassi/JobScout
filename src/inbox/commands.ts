/**
 * commands.ts — the reply-by-email commands, parsed and applied.
 *
 * A reply to a JobScout email holds one command per line, for example:
 *
 *   applied 3f9c2
 *   interview 3f9c2 2026-12-03 phone screen with the team lead
 *   note 7ab10 recruiter is Dana, asked for salary range
 *   skip 99e01
 *   list
 *
 * The id is the 5-character code shown in [brackets] in the digest (any longer prefix of
 * the url hash works too). Quoted text from the email being replied to is ignored.
 * Lines that are not commands are skipped silently, so a short human note above the
 * commands is fine.
 */

import { shortId } from "../digest/format.js";
import type { JobPatch, JobStore } from "../storage/types.js";
import type { JobRow, JobStatus } from "../types/schemas.js";
import { israelDate } from "../utils/text.js";

export type Command =
  | { kind: "status"; status: JobStatus; id: string; date?: string; text?: string }
  | { kind: "note"; id: string; text: string }
  | { kind: "followup"; id: string; date: string }
  | { kind: "list" }
  | { kind: "help" };

const ID = "#?\\[?([0-9a-f]{4,64})\\]?";
const DATE = "(\\d{4}-\\d{2}-\\d{2})";

const STATUS_WORDS: Record<string, JobStatus> = {
  applied: "applied",
  apply: "applied",
  interview: "interview",
  replied: "replied",
  reply: "replied",
  rejected: "rejected",
  reject: "rejected",
  skip: "skipped",
  skipped: "skipped",
  pass: "skipped",
  "not for me": "skipped",
  star: "starred",
  starred: "starred",
  unstar: "new",
};

/** Keeps only what the sender wrote: drops quoted lines and everything after a reply header. */
export function stripQuoted(text: string): string {
  const out: string[] = [];
  for (const line of text.replace(/\r/g, "").split("\n")) {
    const t = line.trim();
    if (/^(on .+ wrote:|.+ wrote:|-{2,} ?original message ?-{2,}|from: .+|בתאריך .+|.+ כתב(ה)?:)$/i.test(t)) break;
    if (t.startsWith(">")) continue;
    out.push(t);
  }
  return out.join("\n");
}

export function parseCommands(text: string): Command[] {
  const commands: Command[] = [];
  const words = Object.keys(STATUS_WORDS)
    .sort((a, b) => b.length - a.length)
    .map((w) => w.replace(/ /g, "\\s+"))
    .join("|");
  const statusRe = new RegExp(`^(${words})\\s+${ID}(?:\\s+${DATE})?(?:\\s+(.+))?$`, "i");
  const noteRe = new RegExp(`^note\\s+${ID}\\s*[:\\-–]?\\s+(.+)$`, "i");
  const followRe = new RegExp(`^follow[\\s-]?up\\s+${ID}\\s+${DATE}$`, "i");

  for (const raw of stripQuoted(text).split("\n")) {
    const line = raw.replace(/^[-*•\d.)\s]+(?=[a-z])/i, "").trim();
    if (!line) continue;
    let m: RegExpMatchArray | null;
    if (/^(list|status|active)$/i.test(line)) commands.push({ kind: "list" });
    else if (/^help\??$/i.test(line)) commands.push({ kind: "help" });
    else if ((m = line.match(noteRe))) commands.push({ kind: "note", id: m[1]!.toLowerCase(), text: m[2]!.trim() });
    else if ((m = line.match(followRe))) commands.push({ kind: "followup", id: m[1]!.toLowerCase(), date: m[2]! });
    else if ((m = line.match(statusRe))) {
      const status = STATUS_WORDS[m[1]!.toLowerCase().replace(/\s+/g, " ")];
      if (status) commands.push({ kind: "status", status, id: m[2]!.toLowerCase(), date: m[3], text: m[4]?.trim() });
    }
  }
  return commands;
}

const label = (r: JobRow) => `${r.title} — ${r.company} [${shortId(r)}]`;

function appendNote(r: JobRow, text: string): string {
  const line = `${israelDate()}: ${text}`;
  return r.notes ? `${r.notes}\n${line}` : line;
}

export const HELP_TEXT = [
  "JobScout reply commands (one per line; ID = the code in [brackets]):",
  "  applied ID [YYYY-MM-DD]        you applied (follow-up reminder 7 days later)",
  "  interview ID [YYYY-MM-DD] [text]  an interview; the date becomes the reminder",
  "  replied ID                     they answered",
  "  rejected ID [text]             they said no",
  "  skip ID                        not for me; it stops showing up",
  "  star ID / unstar ID            shortlist it",
  "  note ID text                   add a note",
  "  follow up ID YYYY-MM-DD        set the reminder date",
  "  list                           everything in progress",
  "  help                           this list",
].join("\n");

/** Applies commands to the store. Returns plain-text result lines for the confirmation email. */
export async function applyCommands(store: JobStore, commands: Command[]): Promise<string[]> {
  const out: string[] = [];
  for (const c of commands) {
    if (c.kind === "help") {
      out.push(HELP_TEXT);
      continue;
    }
    if (c.kind === "list") {
      const rows = await store.active();
      out.push(
        rows.length
          ? ["In progress:", ...rows.map((r) => `  ${r.status.padEnd(9)} ${label(r)}${r.follow_up_date ? ` · next step ${r.follow_up_date}` : ""}`)].join("\n")
          : "Nothing in progress yet.",
      );
      continue;
    }
    const found = await store.findById(c.id);
    if (found.length === 0) {
      out.push(`✗ No job with id ${c.id}.`);
      continue;
    }
    if (found.length > 1) {
      out.push(`✗ Id ${c.id} matches ${found.length} jobs; use more characters: ${found.map((r) => r.url_hash.slice(0, 8)).join(", ")}.`);
      continue;
    }
    const row = found[0]!;
    const patch: JobPatch = {};
    if (c.kind === "note") patch.notes = appendNote(row, c.text);
    else if (c.kind === "followup") patch.follow_up_date = c.date;
    else {
      patch.status = c.status;
      if (c.status === "applied") {
        patch.applied_date = c.date ?? row.applied_date ?? israelDate();
        if (!row.follow_up_date || c.date) patch.follow_up_date = israelDate(7, new Date(`${patch.applied_date}T12:00:00Z`));
      }
      if (c.status === "interview" && c.date) patch.follow_up_date = c.date;
      if (c.status === "rejected" || c.status === "skipped") patch.follow_up_date = null;
      const note = [c.status === "interview" && c.date ? `interview ${c.date}` : "", c.text ?? ""].filter(Boolean).join(" — ");
      if (note) patch.notes = appendNote(row, note);
    }
    const updated = await store.update(row.url_hash, patch);
    const what =
      c.kind === "note" ? "note added" : c.kind === "followup" ? `follow-up set to ${c.date}` : `now ${updated.status}`;
    out.push(`✓ ${label(updated)}: ${what}${updated.follow_up_date && c.kind === "status" ? ` (next step ${updated.follow_up_date})` : ""}`);
  }
  return out;
}
