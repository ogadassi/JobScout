import assert from "node:assert/strict";
import { test } from "node:test";
import { locationFit, minYearsRequired, scoreByRules } from "../src/scoring/rules.js";
import type { JobPosting } from "../src/types/schemas.js";

const job = (over: Partial<JobPosting>): JobPosting => ({
  source: "greenhouse",
  company: "Acme",
  title: "Technical Support Engineer",
  link: "https://example.com/jobs/1",
  location: "Tel Aviv, Israel",
  remote: false,
  description: "",
  ...over,
});

test("location: Tel Aviv area, Israel, remote-from-Israel, and abroad", () => {
  assert.equal(locationFit(job({ location: "Ramat Gan" })), "tlv");
  assert.equal(locationFit(job({ location: "TLV" })), "tlv");
  assert.equal(locationFit(job({ location: "Haifa, Israel" })), "israel");
  assert.equal(locationFit(job({ location: "IL - Herzliya" })), "tlv");
  assert.equal(locationFit(job({ location: "Remote - EMEA", remote: true })), "remote");
  assert.equal(locationFit(job({ location: "Remote - US", remote: true })), null);
  assert.equal(locationFit(job({ location: "New York, NY" })), null);
});

test("years of experience parsing", () => {
  assert.equal(minYearsRequired("At least 5+ years of experience with SaaS"), 5);
  assert.equal(minYearsRequired("3-5 years of hands-on experience"), 3);
  assert.equal(minYearsRequired("Experience of at least 2 years in support"), 2);
  assert.equal(minYearsRequired("Great team, free lunch"), null);
});

test("excludes senior, lead, manager and 5+ years", () => {
  assert.equal(scoreByRules(job({ title: "Senior Technical Support Engineer" })).keep, false);
  assert.equal(scoreByRules(job({ title: "Support Team Lead" })).keep, false);
  assert.equal(scoreByRules(job({ title: "Head of Customer Success" })).keep, false);
  assert.equal(scoreByRules(job({ description: "5+ years of experience in tier 2 support" })).keep, false);
  assert.equal(scoreByRules(job({ source: "comeet", experienceLevel: "Senior" })).keep, false);
});

test("ranks target roles above junior full-stack", () => {
  const support = scoreByRules(job({ title: "Technical Support Engineer" }));
  const impl = scoreByRules(job({ title: "Implementation Engineer" }));
  const cse = scoreByRules(job({ title: "Customer Success Engineer" }));
  const ai = scoreByRules(job({ title: "AI Automation Developer" }));
  const fs = scoreByRules(job({ title: "Junior Full Stack Developer" }));
  for (const r of [support, impl, cse, ai, fs]) assert.equal(r.keep, true);
  assert.ok(support.score > fs.score && impl.score > fs.score && cse.score > fs.score && ai.score > fs.score);
});

test("customer success manager is kept, unrelated titles are dropped", () => {
  assert.equal(scoreByRules(job({ title: "Customer Success Manager" })).keep, true);
  assert.equal(scoreByRules(job({ title: "Account Executive" })).dropped, "no-role-match");
  assert.equal(scoreByRules(job({ title: "Backend Engineer" })).dropped, "no-role-match");
});

test("student roles and 3+ years are pushed down", () => {
  const normal = scoreByRules(job({})).score;
  assert.ok(scoreByRules(job({ title: "Technical Support Engineer - Student" })).score <= normal - 4);
  assert.ok(scoreByRules(job({ description: "3+ years of experience" })).score < normal);
});
