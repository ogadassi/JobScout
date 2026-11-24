import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { dailyDigest, shortId } from "../src/digest/format.js";
import { applyCommands, parseCommands, stripQuoted } from "../src/inbox/commands.js";
import { senderAuthenticated, sentByMailbox } from "../src/inbox/mailbox.js";
import { parseScore } from "../src/scoring/gemini.js";
import { LocalFileStore } from "../src/storage/localFile.js";

test("Reply commands are parsed, quoted text is ignored", () => {
  const text = [
    "Done a few, thanks!",
    "applied 3f9c2",
    "- interview [7ab10] 2026-12-03 phone screen",
    "Note 99e01: recruiter is Dana",
    "follow up 3f9c2 2026-12-10",
    "not for me 12abc",
    "list",
    "",
    "On Mon, Nov 24, 2026 at 8:00 AM JobScout <x@gmail.com> wrote:",
    "> applied deadb",
  ].join("\n");
  assert.deepEqual(parseCommands(text), [
    { kind: "status", status: "applied", id: "3f9c2", date: undefined, text: undefined },
    { kind: "status", status: "interview", id: "7ab10", date: "2026-12-03", text: "phone screen" },
    { kind: "note", id: "99e01", text: "recruiter is Dana" },
    { kind: "followup", id: "3f9c2", date: "2026-12-10" },
    { kind: "status", status: "skipped", id: "12abc", date: undefined, text: undefined },
    { kind: "list" },
  ]);
  assert.equal(stripQuoted("a\n> b\nc"), "a\nc");
});

test("Only DKIM or SPF passes for the sender's own domain count", () => {
  const ok = "mx.google.com; dkim=pass header.i=@mail.instinct.com header.s=s1; spf=pass (google.com: domain of a@mail.instinct.com designates 1.2.3.4) smtp.mailfrom=a@mail.instinct.com";
  assert.equal(senderAuthenticated(ok, "fnonbi@mail.instinct.com"), true);
  assert.equal(senderAuthenticated("mx.google.com; dkim=pass header.i=@evil.com; spf=fail smtp.mailfrom=x@evil.com", "fnonbi@mail.instinct.com"), false);
  assert.equal(senderAuthenticated("", "fnonbi@mail.instinct.com"), false);
});

test("Mail the account sent to itself counts only when Gmail filed it under Sent", () => {
  const me = "me@gmail.com";
  assert.equal(sentByMailbox(me, new Set(["\Sent", "\Inbox"]), "Me@Gmail.com"), true);
  assert.equal(sentByMailbox(me, new Set(["\Inbox"]), me), false);
  assert.equal(sentByMailbox(me, undefined, me), false);
  assert.equal(sentByMailbox("other@gmail.com", new Set(["\Sent"]), me), false);
  assert.equal(sentByMailbox(me, new Set(["\Sent"]), undefined), false);
});

test("Commands update the store: applied sets dates, ambiguous ids are refused", async () => {
  const store = new LocalFileStore(join(mkdtempSync(join(tmpdir(), "jobscout-")), "jobs.json"));
  const base = { date_found: "2026-11-24", location: "Tel Aviv", source: "greenhouse", score: 8, reason: "fits" };
  await store.insert([
    { ...base, url_hash: "3f9c2aaaa", company: "Kaltura", title: "Support Engineer", link: "https://x.com/1" },
    { ...base, url_hash: "7ab10bbbb", company: "JFrog", title: "Developer Support", link: "https://x.com/2" },
    { ...base, url_hash: "7ab10cccc", company: "Wix", title: "Integrations", link: "https://x.com/3" },
  ]);
  const out = await applyCommands(store, parseCommands("applied 3f9c2 2026-11-20\nskip 7ab10\nnote 3f9c2 sent CV v2\nlist"));
  assert.match(out[0]!, /now applied \(next step 2026-11-27\)/);
  assert.match(out[1]!, /matches 2 jobs/);
  assert.match(out[2]!, /note added/);
  assert.match(out[3]!, /applied\s+Support Engineer — Kaltura \[3f9c2\]/);
  const [row] = await store.findById("3f9c2");
  assert.equal(row?.applied_date, "2026-11-20");
  assert.match(row?.notes ?? "", /sent CV v2/);
});

test("Gemini's CV pick and opener are kept; an unknown CV name is dropped", () => {
  assert.deepEqual(parseScore('{"score": 8, "reason": "fits", "cv": "support", "opener": " I fixed things. "}'), {
    score: 8,
    reason: "fits",
    cv: "support",
    opener: "I fixed things.",
  });
  assert.deepEqual(parseScore('{"score": 6, "reason": "ok", "cv": "pilot"}'), { score: 6, reason: "ok" });
});

test("The digest shows each job's id, CV pick, opener and the reply commands", () => {
  const html = dailyDigest(
    "2026-11-24",
    [
      {
        url_hash: "3f9c2aaaa", date_found: "2026-11-24", company: "Kaltura", title: "Support Engineer", link: "https://x.com/1",
        location: "Tel Aviv", source: "greenhouse", score: 8, reason: "fits", status: "new", applied_date: null,
        follow_up_date: null, notes: null, digested_at: null, cv_variant: "support", pitch: "I kept a city running.",
      },
    ],
    [],
    { companies: 84, failedCompanies: 0, scanned: 4300, matched: 60, newJobs: 1 },
  );
  assert.equal(shortId({ url_hash: "3f9c2aaaa" }), "3f9c2");
  assert.match(html, /\[3f9c2\]/);
  assert.match(html, /CV: Support Engineer/);
  assert.match(html, /Opener: "I kept a city running\."/);
  assert.match(html, /Reply to this email to update jobs/);
});
