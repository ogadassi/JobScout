import assert from "node:assert/strict";
import { test } from "node:test";
import { extractPositionsJson } from "../src/collectors/comeet.js";
import { parseAlertText } from "../src/collectors/linkedinEmail.js";
import { splitMessage } from "../src/notify/telegram.js";
import { htmlToText, normalizeUrl, urlHash } from "../src/utils/text.js";

test("URL normalization drops tracking but keeps job ids", () => {
  assert.equal(
    normalizeUrl("https://Careers.Example.com/job/?gh_jid=123&utm_source=x#apply"),
    "https://careers.example.com/job?gh_jid=123",
  );
  assert.equal(urlHash("https://a.com/x/?coref=1"), urlHash("https://a.com/x"));
  assert.notEqual(urlHash("https://a.com/x?gh_jid=1"), urlHash("https://a.com/x?gh_jid=2"));
});

test("htmlToText handles entity-escaped Greenhouse HTML", () => {
  assert.equal(htmlToText("&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;&lt;ul&gt;&lt;li&gt;SQL&lt;/li&gt;&lt;/ul&gt;"), "Hello & welcome\nSQL");
});

test("Comeet embedded JSON is extracted even with ; and ] inside strings", () => {
  const html = `<script>var COMPANY_DATA = {}; COMPANY_POSITIONS_DATA = [{"name": "Support; Tier 2 [TLV]", "x": "a\\"b"}];\nvar y = 1;</script>`;
  const data = extractPositionsJson(html);
  assert.deepEqual(data, [{ name: "Support; Tier 2 [TLV]", x: 'a"b' }]);
});

test("LinkedIn alert email text is parsed into jobs without fetching LinkedIn", () => {
  const text = [
    "Your job alert for technical support engineer in Israel",
    "",
    "Technical Support Engineer",
    "Acme Ltd",
    "Tel Aviv-Yafo, Tel Aviv District, Israel",
    "Actively recruiting",
    "View job: https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=abc",
    "",
    "---------------------------------------------------------",
    "",
    "Implementation Engineer",
    "Beta Inc",
    "Israel (Remote)",
    "View job: https://www.linkedin.com/comm/jobs/view/4099999999/?trk=x",
  ].join("\n");
  const jobs = parseAlertText(text);
  assert.equal(jobs.length, 2);
  assert.deepEqual(
    jobs.map((j) => [j.title, j.company, j.location, j.link]),
    [
      ["Technical Support Engineer", "Acme Ltd", "Tel Aviv-Yafo, Tel Aviv District, Israel", "https://www.linkedin.com/jobs/view/4012345678/"],
      ["Implementation Engineer", "Beta Inc", "Israel (Remote)", "https://www.linkedin.com/jobs/view/4099999999/"],
    ],
  );
  assert.equal(jobs[1]?.remote, true);
});

test("Telegram messages are split under the size limit", () => {
  const parts = splitMessage(Array.from({ length: 50 }, (_, i) => `job ${i} ${"x".repeat(150)}`).join("\n\n"));
  assert.ok(parts.length > 1);
  for (const p of parts) assert.ok(p.length <= 4096);
});

test("parseScore reads Gemini JSON, with or without fences, and clamps the score", async () => {
  const { parseScore } = await import("../src/scoring/gemini.js");
  assert.deepEqual(parseScore('{"score": 7.3, "reason": " Good fit "}'), { score: 7.5, reason: "Good fit" });
  assert.deepEqual(parseScore('```json\n{"score": 12, "reason": "x"}\n```'), { score: 10, reason: "x" });
  assert.equal(parseScore("not json"), null);
  assert.equal(parseScore('{"score": "high"}'), null);
});
