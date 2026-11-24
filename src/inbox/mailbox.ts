/**
 * mailbox.ts — reads reply commands from the Gmail inbox that sends the digest.
 *
 * Only messages that pass every check are acted on:
 *   - the subject contains "JobScout" (replies to the digest keep it),
 *   - the sender is on COMMAND_SENDERS (default: DIGEST_EMAIL_TO and SMTP_USER),
 *   - Gmail's own Authentication-Results say DKIM or SPF passed for the sender's
 *     domain, so a forged From: address is not enough,
 *   - it is not one of JobScout's own emails (they carry an X-JobScout header).
 * A handled message gets the Gmail label "JobScout-done", so it is never applied twice,
 * even if someone has already opened it. Each sender gets one confirmation email
 * listing what changed.
 */

import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import { sendEmail } from "../notify/email.js";
import type { JobStore } from "../storage/types.js";
import { env } from "../utils/config.js";
import { Logger } from "../utils/logger.js";
import { escapeHtml } from "../utils/text.js";
import { applyCommands, HELP_TEXT, parseCommands } from "./commands.js";

export const DONE_LABEL = "JobScout-done";

export function allowedSenders(): string[] {
  const list = env.COMMAND_SENDERS ?? [env.DIGEST_EMAIL_TO, env.SMTP_USER].filter(Boolean).join(",");
  return list
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** True when Gmail recorded a DKIM or SPF pass for the sender's own domain. */
export function senderAuthenticated(authResults: string, from: string): boolean {
  const domain = from.split("@")[1]?.toLowerCase();
  if (!domain) return false;
  const text = authResults.toLowerCase();
  const dkim = [...text.matchAll(/dkim=pass[^;]*?header\.(?:i|d)=@?([a-z0-9.-]+)/g)].map((m) => m[1]!);
  const spf = [...text.matchAll(/spf=pass[^;]*?smtp\.mailfrom=(?:[^@\s;]+@)?([a-z0-9.-]+)/g)].map((m) => m[1]!);
  const aligned = (d: string) => d === domain || domain.endsWith(`.${d}`) || d.endsWith(`.${domain}`);
  return [...dkim, ...spf].some(aligned);
}

function header(mail: ParsedMail, name: string): string {
  const v = mail.headers.get(name);
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.map(String).join("; ");
  return typeof v === "string" ? v : JSON.stringify(v);
}

export interface InboxResult {
  messages: number;
  applied: number;
  rejected: number;
}

export async function processInbox(store: JobStore): Promise<InboxResult> {
  const result: InboxResult = { messages: 0, applied: 0, rejected: 0 };
  if (!env.SMTP_USER || !env.SMTP_PASSWORD) {
    Logger.info("Inbox skipped: SMTP_USER / SMTP_PASSWORD not set");
    return result;
  }
  const senders = allowedSenders();
  const client = new ImapFlow({
    host: env.IMAP_HOST,
    port: 993,
    secure: true,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    logger: false,
  });
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      // Gmail search syntax: recent JobScout mail not yet handled.
      const uids = await client.search({ gmraw: `subject:JobScout newer_than:14d -label:${DONE_LABEL.toLowerCase()}` }, { uid: true });
      for (const uid of uids || []) {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!msg || !msg.source) continue;
        const mail = await simpleParser(msg.source);
        const from = mail.from?.value[0]?.address?.toLowerCase() ?? "";
        const done = () => client.messageFlagsAdd(String(uid), [DONE_LABEL], { uid: true, useLabels: true });

        if (header(mail, "x-jobscout")) {
          await done(); // our own digest or confirmation
          continue;
        }
        result.messages++;
        if (!senders.includes(from)) {
          Logger.warn("Inbox: sender not allowed, ignored", { from });
          result.rejected++;
          await done();
          continue;
        }
        if (!senderAuthenticated(header(mail, "authentication-results"), from)) {
          Logger.warn("Inbox: sender failed DKIM/SPF, ignored", { from });
          result.rejected++;
          await done();
          continue;
        }
        const commands = parseCommands(mail.text ?? "");
        if (commands.length === 0) {
          await done();
          continue;
        }
        const lines = await applyCommands(store, commands);
        result.applied += commands.length;
        Logger.info("Inbox: commands applied", { from, commands: commands.length });
        await sendEmail(`<pre style="font: 15px/1.5 Menlo, Consolas, monospace; white-space: pre-wrap">${escapeHtml(lines.join("\n\n"))}</pre>`, {
          to: from,
          subject: `Re: ${(mail.subject ?? "JobScout").replace(/^(re:\s*)+/i, "")}`,
          inReplyTo: mail.messageId,
          references: mail.messageId,
          plain: `${lines.join("\n\n")}\n\n---\n${HELP_TEXT}`,
        });
        await done();
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
  Logger.info("Inbox checked", { ...result });
  return result;
}
