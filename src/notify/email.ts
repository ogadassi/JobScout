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

export async function sendEmail(html: string): Promise<void> {
  if (!env.SMTP_USER || !env.SMTP_PASSWORD || !env.DIGEST_EMAIL_TO) throw new Error("Email is not configured");
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
  });
  const { subject, text, html: body } = toEmail(html);
  await transport.sendMail({
    from: `JobScout <${env.SMTP_USER}>`,
    to: env.DIGEST_EMAIL_TO,
    subject,
    text,
    html: body,
  });
}
