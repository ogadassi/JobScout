// TEMPORARY, read-only: shows how Gmail presents recent command emails. Removed before merge.
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { env } from "../src/utils/config.js";

const redact = (s: string) => s.replace(/[A-Za-z0-9._%+-]+@/g, "***@");
const client = new ImapFlow({ host: env.IMAP_HOST, port: 993, secure: true, auth: { user: env.SMTP_USER!, pass: env.SMTP_PASSWORD! }, logger: false });
await client.connect();
const lock = await client.getMailboxLock("INBOX");
try {
  const uids = (await client.search({ gmraw: "subject:JobScout newer_than:1d" }, { uid: true })) || [];
  for (const uid of uids) {
    const msg = await client.fetchOne(String(uid), { source: true, labels: true, flags: true }, { uid: true });
    if (!msg || !msg.source) continue;
    const mail = await simpleParser(msg.source);
    if (mail.headers.get("x-jobscout")) continue;
    const from = mail.from?.value[0]?.address?.toLowerCase() ?? "";
    const raw = msg.source.toString("utf8");
    const headerBlock = raw.split(/\r?\n\r?\n/)[0] ?? "";
    console.log(JSON.stringify({
      uid,
      date: mail.date,
      fromIsMailbox: from === env.SMTP_USER?.toLowerCase(),
      labels: msg.labels ? [...msg.labels] : null,
      flags: msg.flags ? [...msg.flags] : null,
      headerNames: [...new Set([...headerBlock.matchAll(/^([A-Za-z0-9-]+):/gm)].map((m) => m[1]))],
      authResults: redact(String(mail.headers.get("authentication-results") ?? "")).slice(0, 300),
      received: redact(headerBlock.match(/^Received:.*(\r?\n[ \t].*)*/m)?.[0] ?? "").slice(0, 300),
    }));
  }
} finally {
  lock.release();
  await client.logout();
}
