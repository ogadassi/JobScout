/**
 * telegram.ts — sends messages through a Telegram bot (HTML formatting).
 * Splits long messages at line breaks to stay under Telegram's 4096-char limit.
 */

import { z } from "zod";
import { env } from "../utils/config.js";

const LIMIT = 3900;
const ApiResponse = z.object({ ok: z.boolean(), description: z.string().optional() });

export function splitMessage(text: string): string[] {
  const parts: string[] = [];
  let current = "";
  for (const block of text.split("\n\n")) {
    const candidate = current ? `${current}\n\n${block}` : block;
    if (candidate.length <= LIMIT) current = candidate;
    else {
      if (current) parts.push(current);
      current = block.slice(0, LIMIT);
    }
  }
  if (current) parts.push(current);
  return parts;
}

export async function sendTelegram(html: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) throw new Error("Telegram is not configured");
  for (const part of splitMessage(html)) {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: part,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = ApiResponse.safeParse(await res.json());
    if (!res.ok || !body.success || !body.data.ok) {
      throw new Error(`Telegram send failed (${res.status}): ${body.success ? body.data.description : "bad response"}`);
    }
  }
}
