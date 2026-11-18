/**
 * LinkedIn job-alert emails, read from Gmail over IMAP (optional).
 *
 * LinkedIn itself is never fetched, scraped or automated (LinkedIn User
 * Agreement section 8.2). This only reads the alert emails LinkedIn already
 * sent to your inbox, opens the mailbox read-only (nothing is marked read or
 * moved), and keeps the job title, company, location and a link.
 *
 * Needs GMAIL_USER and GMAIL_APP_PASSWORD (a Google "app password", not your
 * normal password; requires 2-step verification on the Google account).
 */

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { env } from "../utils/config.js";
import { Logger } from "../utils/logger.js";
import type { JobPosting } from "../types/schemas.js";

const ALERT_SENDERS = ["jobalerts-noreply@linkedin.com", "jobs-noreply@linkedin.com"];
const JOB_ID = /linkedin\.com\/(?:comm\/)?jobs\/view\/(\d+)/i;
const SKIP_LINE = /^(view job|apply|easy apply|promoted|actively recruiting|be an early applicant|\d+ (connection|alumni|school)|see all jobs|----)/i;

/**
 * Parses the plain-text part of a LinkedIn job-alert email. Each job block
 * ends with a "View job: <url>" line; the lines above it are title, company,
 * location (in that order).
 */
export function parseAlertText(text: string): JobPosting[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const out: JobPosting[] = [];
  let block: string[] = [];
  for (const line of lines) {
    const m = JOB_ID.exec(line);
    if (m && /view job/i.test(line)) {
      const fields = block.filter((l) => l && !SKIP_LINE.test(l) && !/^https?:\/\//.test(l)).slice(-3);
      const [title, company, location] = fields.length === 3 ? fields : [fields[0], fields[1], ""];
      if (title && company) {
        out.push({
          source: "linkedin-email",
          company,
          title,
          link: `https://www.linkedin.com/jobs/view/${m[1]}/`,
          location: location ?? "",
          remote: /remote/i.test(location ?? ""),
          description: "",
        });
      }
      block = [];
    } else if (line === "" && block.length > 6) {
      block = block.slice(-6);
    } else {
      block.push(line);
    }
  }
  return out;
}

/** Reads alert emails from the last `days` days. Returns [] if Gmail is not configured. */
export async function collectLinkedInAlerts(days = 2): Promise<JobPosting[]> {
  if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) return [];
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD },
    logger: false,
  });
  await client.connect();
  const jobs: JobPosting[] = [];
  try {
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    try {
      const since = new Date(Date.now() - days * 86_400_000);
      for (const from of ALERT_SENDERS) {
        const uids = await client.search({ from, since }, { uid: true });
        if (!uids || uids.length === 0) continue;
        for await (const msg of client.fetch(uids, { source: true }, { uid: true })) {
          if (!msg.source) continue;
          const mail = await simpleParser(msg.source);
          jobs.push(...parseAlertText(mail.text ?? ""));
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
  Logger.info("LinkedIn alert emails parsed", { jobs: jobs.length });
  return jobs;
}
