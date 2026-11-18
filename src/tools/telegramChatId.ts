/**
 * Prints the chat id(s) that have messaged your bot, so you can fill in
 * TELEGRAM_CHAT_ID. Steps: create the bot with @BotFather, put
 * TELEGRAM_BOT_TOKEN in .env, send your bot any message, then run:
 *   npm run telegram:chat-id
 * Add --test to also send a test message to TELEGRAM_CHAT_ID.
 */

import { z } from "zod";
import { sendTelegram } from "../notify/telegram.js";
import { env, features } from "../utils/config.js";

if (!env.TELEGRAM_BOT_TOKEN) {
  console.error("Set TELEGRAM_BOT_TOKEN in .env first.");
  process.exit(1);
}

const Updates = z.object({
  ok: z.boolean(),
  result: z.array(
    z.object({
      message: z
        .object({ chat: z.object({ id: z.number(), type: z.string(), username: z.string().optional(), first_name: z.string().optional() }) })
        .optional(),
    }),
  ),
});

const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getUpdates`);
const data = Updates.parse(await res.json());
const chats = new Map<number, string>();
for (const u of data.result) if (u.message) chats.set(u.message.chat.id, `${u.message.chat.type} ${u.message.chat.username ?? u.message.chat.first_name ?? ""}`);

if (chats.size === 0) console.log("No messages yet. Send your bot any message in Telegram, then run this again.");
for (const [id, who] of chats) console.log(`TELEGRAM_CHAT_ID=${id}   (${who.trim()})`);

if (process.argv.includes("--test")) {
  if (!features.telegram) {
    console.error("Set TELEGRAM_CHAT_ID in .env to send a test message.");
    process.exit(1);
  }
  await sendTelegram("✅ <b>JobScout</b> test message. The morning digest will arrive here.");
  console.log("Test message sent.");
}
