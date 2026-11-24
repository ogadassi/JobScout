/**
 * email.ts — sends the digest by email over SMTP (Gmail by default).
 *
 * Takes the same HTML the digest formatter builds for Telegram (only <b>, <i>
 * and <a> tags, with \n line breaks), so the content is identical. Each email
 * has an HTML part and a plain-text part, where links are written out in full.
 */

import nodemailer from "nodemailer";
import { env } from "../utils/config.js";
import { decodeEntities } from "../utils/text.js";

/** Digest HTML -> plain text, with each link written as "label: url". */
export function toPlainText(html: string): string {
  return decodeEntities(html.replace(/<a href="([^"]+)">([^<]*)<\/a>/g, "$2: $1").replace(/<[^>]+>/g, ""));
}

export interface EmailParts {
  subject: string;
  text: string;
  html: string;
}

/** Subject = the digest's first line; body = the digest as HTML and as plain text. */
export function toEmail(html: string): EmailParts {
  const text = toPlainText(html);
  const subject = (text.split("\n")[0] ?? "JobScout").replace(/^\W+/u, "").trim() || "JobScout";
  const body = html.replace(/\n/g, "<br>\n");
  return {
    subject,
    text,
    html: `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.45;color:#1f2a26;max-width:640px">\n${body}\n</body></html>`,
  };
}

export interface SendOptions {
  /** Default: DIGEST_EMAIL_TO. */
  to?: string;
  /** Default: the first line of the message. */
  subject?: string;
  /** Threading, so a confirmation lands under the message it answers. */
  inReplyTo?: string;
  references?: string;
  /** A ready plain-text part; when set, `html` is sent as is (no line-break conversion). */
  plain?: string;
}

export async function sendEmail(html: string, opts: SendOptions = {}): Promise<void> {
  const to = opts.to ?? env.DIGEST_EMAIL_TO;
  if (!env.SMTP_USER || !env.SMTP_PASSWORD || !to) throw new Error("Email is not configured");
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
  });
  const parts = opts.plain ? { subject: "JobScout", text: opts.plain, html } : toEmail(html);
  await transport.sendMail({
    from: `JobScout <${env.SMTP_USER}>`,
    to,
    subject: opts.subject ?? parts.subject,
    text: parts.text,
    html: parts.html,
    inReplyTo: opts.inReplyTo,
    references: opts.references,
    // Marks JobScout's own mail, so the inbox reader never treats it as commands.
    headers: { "X-JobScout": "1" },
  });
}
