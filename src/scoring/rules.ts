/**
 * rules.ts — keyword-based filter and score (0-10). Always runs; free.
 *
 * Order: location filter -> seniority exclusion -> role match -> small boosts.
 * A job that matches no target role scores 0 and is not stored.
 * Edit the lists below to change what counts as a fit.
 */

import type { JobPosting } from "../types/schemas.js";

export interface RuleResult {
  keep: boolean;
  score: number;
  /** Short human-readable explanation, used as the reason when Claude is off. */
  reason: string;
  /** Why it was dropped, for the run summary. */
  dropped?: "location" | "seniority" | "no-role-match";
}

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

const ISRAEL = /\b(israel|tel[\s-]?aviv|tlv|herzliya|herzlia|ramat[\s-]?gan|petah[\s-]?tikva|petach[\s-]?tikva|givatayim|bnei[\s-]?brak|holon|bat[\s-]?yam|ra'?anana|kfar[\s-]?saba|hod[\s-]?hasharon|netanya|rosh[\s-]?ha'?ayin|airport[\s-]?city|or[\s-]?yehuda|rishon|rehovot|ness[\s-]?ziona|lod|modi'?in|haifa|yokneam|jerusalem|be'?er[\s-]?sheva|caesarea)\b|,\s*IL\b|^IL\b|\bIL\s*-/i;
/** Tel Aviv metro: easy commute from Ramat Gan. */
const TLV_AREA = /\b(tel[\s-]?aviv|tlv|ramat[\s-]?gan|givatayim|bnei[\s-]?brak|petah[\s-]?tikva|petach[\s-]?tikva|herzliya|herzlia|holon|bat[\s-]?yam|or[\s-]?yehuda|airport[\s-]?city|kiryat[\s-]?ono|ra'?anana|hod[\s-]?hasharon|kfar[\s-]?saba|rishon|ramat[\s-]?hasharon)\b/i;
/** True when the location names a specific place other than "Israel" (used after the TLV check). */
function namesNonTlvPlace(location: string): boolean {
  const rest = location
    .replace(/\b(israel|il|remote|hybrid|on[\s-]?site|office|hq|district|center|centre|central)\b/gi, "")
    .replace(/[^a-z֐-׿]+/gi, "");
  return rest.length > 0;
}
/** Remote roles that can be done from Israel. */
const REMOTE_OK = /\b(israel|emea|europe|worldwide|anywhere|global)\b/i;

export function locationFit(job: Pick<JobPosting, "location" | "remote">): "tlv" | "israel" | "remote" | null {
  const loc = job.location;
  if (TLV_AREA.test(loc)) return "tlv";
  if (ISRAEL.test(loc)) return "israel";
  if (job.remote && (REMOTE_OK.test(loc) || loc.trim() === "" || /^remote$/i.test(loc.trim()))) return "remote";
  return null;
}

// ---------------------------------------------------------------------------
// Seniority exclusion
// ---------------------------------------------------------------------------

const SENIOR_TITLE =
  /\b(senior|sr\.?|staff|principal|lead|leader|head|director|vp|vice president|chief|architect|manager|expert)\b|team[\s-]?lead|tech[\s-]?lead|\bmgr\b/i;
/** "Manager" titles that are still in scope (customer-facing, not people management). */
const MANAGER_OK = /customer success manager|technical account manager|implementation manager|onboarding manager/i;
const SENIOR_LEVELS = /^(senior|executive|director|manager|lead)/i;

/** Smallest "N years" requirement mentioned near the word experience, if any. */
export function minYearsRequired(text: string): number | null {
  const re = /(\d{1,2})\s*(?:\+|plus)?\s*(?:-|–|to)?\s*(\d{1,2})?\s*\+?\s*(?:years?|yrs?)(?:\s+of)?[^.\n]{0,60}?experience|experience[^.\n]{0,40}?(\d{1,2})\s*\+?\s*(?:years?|yrs?)/gi;
  let min: number | null = null;
  for (const m of text.matchAll(re)) {
    const n = Number(m[1] ?? m[3]);
    if (!Number.isFinite(n) || n > 20) continue;
    min = min === null ? n : Math.min(min, n);
  }
  return min;
}

// ---------------------------------------------------------------------------
// Role match (title). First match wins, so order = priority.
// ---------------------------------------------------------------------------

interface RoleRule {
  label: string;
  re: RegExp;
  base: number;
}

export const ROLE_RULES: RoleRule[] = [
  { label: "Technical Support Engineer", re: /\b(technical|tech|product|application|customer|cloud|saas|integration)?\s*support\s+(engineer|specialist|analyst|developer)\b|\btier\s*(2|ii|3|iii)\b.*support|support.*\btier\s*(2|ii|3|iii)\b/i, base: 9 },
  { label: "Implementation / Integration / Onboarding Engineer", re: /\b(implementation|integration|integrations|onboarding|deployment|forward[\s-]deployed|professional services|delivery|solution delivery|delivery solutions?)\s+(engineer|specialist|consultant|developer)\b/i, base: 9 },
  { label: "Customer Success Engineer", re: /\bcustomer\s+(success|solutions?|reliability)\s+engineer\b|\bcustomer\s+engineer\b|\btechnical\s+customer\s+success\b/i, base: 9 },
  { label: "AI automation / internal tools", re: /\b(ai|gen[\s-]?ai|llm)\s+(automation|solutions?|applications?|enablement)\b|\b(workflow|business|process|it|gtm|revops|ops)\s+automation\b|\binternal\s+(tools|tooling|systems|applications)\b|\bbusiness\s+(systems|applications)\s+(engineer|developer|analyst)\b|\bgtm\s+engineer\b|\bautomation\s+(developer|specialist)\b|\bai\s+(builder|implementation)\b/i, base: 8.5 },
  { label: "Solutions / Sales Engineer", re: /\b(solutions?|sales|pre[\s-]?sales?|technical)\s+(engineer|consultant)\b/i, base: 6.5 },
  { label: "Technical Account Manager / CSM", re: /technical account manager|\btam\b|customer success manager|implementation manager|onboarding manager/i, base: 6 },
  { label: "NOC / IT / Production support", re: /\b(noc|soc tier 1|production support|it support|helpdesk|help desk|system administrator|sysadmin|it specialist|it engineer|it operations)\b/i, base: 6 },
  { label: "Junior full-stack", re: /\b(junior|jr\.?|entry[\s-]level|graduate)\b.*\b(full[\s-]?stack|fullstack|back[\s-]?end|front[\s-]?end|software|web|node|react)\b/i, base: 6 },
  { label: "Full-stack developer", re: /\b(full[\s-]?stack|fullstack)\s+(developer|engineer)\b|\bnode(\.js)?\s+(developer|engineer)\b/i, base: 4 },
];

/** Fields outside the candidate's background, even when the title says "integration" or "support". */
const OFF_FIELD = /\b(hardware|electrical|electronics?|mechanical|rf|fpga|asic|chip|silicon|firmware|embedded|optical|physicist|physics|chemist|clinical|medical device|network integration)\b/i;

const STACK =/\b(javascript|typescript|node(\.js)?|react|sql|mysql|postgres|rest(ful)?\s+api|apis?|python|linux|docker|zapier|n8n|make\.com|llm|openai|claude|salesforce|hubspot|jira)\b/gi;
const JUNIOR = /\b(junior|entry[\s-]level|0-2 years|1-2 years|no experience required|graduates?)\b/i;
const STUDENT = /\b(student|intern|internship)\b/i;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const clamp = (n: number) => Math.max(0, Math.min(10, Math.round(n * 2) / 2));

export function scoreByRules(job: JobPosting): RuleResult {
  const fit = locationFit(job);
  if (!fit) return { keep: false, score: 0, reason: "Outside Israel and not remote-friendly", dropped: "location" };

  const title = job.title;
  if ((SENIOR_TITLE.test(title) && !MANAGER_OK.test(title)) || SENIOR_LEVELS.test(job.experienceLevel ?? "")) {
    return { keep: false, score: 0, reason: "Senior / lead / manager role", dropped: "seniority" };
  }
  const years = minYearsRequired(job.description);
  if (years !== null && years >= 5) {
    return { keep: false, score: 0, reason: `Asks for ${years}+ years`, dropped: "seniority" };
  }

  const role = OFF_FIELD.test(title) ? undefined : ROLE_RULES.find((r) => r.re.test(title));
  if (!role) return { keep: false, score: 0, reason: "No target role in title", dropped: "no-role-match" };

  let score = role.base;
  const notes: string[] = [role.label];

  if (fit === "tlv") notes.push("Tel Aviv area");
  else if (fit === "israel") {
    if (namesNonTlvPlace(job.location)) {
      score -= 1;
      notes.push("outside Tel Aviv area");
    } else notes.push("Israel");
  } else {
    score -= 0.5;
    notes.push("remote");
  }

  if (JUNIOR.test(`${title}\n${job.description}`) || /entry|junior/i.test(job.experienceLevel ?? "")) {
    score += 1;
    notes.push("junior-friendly");
  }
  if (years !== null && years >= 3) {
    score -= years >= 4 ? 2 : 1;
    notes.push(`asks ${years}+ yrs`);
  }
  if (STUDENT.test(title)) {
    score -= 5;
    notes.push("student-only role");
  }

  const stack = [...new Set([...job.description.matchAll(STACK)].map((m) => m[0].toLowerCase()))];
  if (stack.length) {
    score += Math.min(1.5, stack.length * 0.3);
    notes.push(`+${stack.slice(0, 4).join(", ")}`);
  }

  return { keep: true, score: clamp(score), reason: notes.join("; ") };
}
