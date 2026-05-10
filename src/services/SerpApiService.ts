/**
 * SerpApiService.ts
 *
 * Fetches job listings from SerpApi's Google Jobs endpoint.
 * This is the only file that knows about the raw API response shape.
 * Everything else in the app only sees the clean `JobEntry` type.
 *
 * The flow:
 *   1. Build the API URL with query + location + API key
 *   2. Make the HTTP request (throttled by RateLimiter)
 *   3. Validate the raw JSON with a Zod schema (catch API drift)
 *   4. Map each raw job → our internal JobEntry shape
 *   5. Return JobEntry[]
 */

import axios from "axios";
import { z } from "zod";
import { config } from "../utils/config.js";
import { Logger } from "../utils/logger.js";
import { RateLimiter } from "../utils/rateLimiter.js";
import type { JobEntry } from "../types/schemas.js";

// ---------------------------------------------------------------------------
// 1. Private API Schemas (never exported — this is the encapsulation decision)
// ---------------------------------------------------------------------------
// These describe SerpApi's format, not ours. They live here because
// only this file needs to understand the raw API shape.

/**
 * A single job from SerpApi's `jobs_results[]` array.
 *
 * `.passthrough()` means: validate the fields we listed, but don't crash
 * if the API sends extra fields we didn't define. Safe for API evolution.
 *
 * `.optional()` on most fields means: if SerpApi doesn't include it for
 * a particular job, we handle it gracefully instead of crashing.
 */
const SerpApiJobResultSchema = z
  .object({
    job_id: z.string(),
    title: z.string(),
    company_name: z.string(),
    location: z.string(),
    description: z.string().optional(),
    via: z.string().optional(),
    extensions: z.array(z.string()).optional(),
    detected_extensions: z
      .object({
        posted_at: z.string().optional(),
        schedule_type: z.string().optional(),
        salary: z.string().optional(),
      })
      .passthrough()
      .optional(),
    apply_options: z
      .array(
        z.object({
          title: z.string().optional(),
          link: z.string().optional(),
        }).passthrough()
      )
      .optional(),
  })
  .passthrough();

/** The full API response wrapper. We only care about `jobs_results`. */
const SerpApiResponseSchema = z
  .object({
    jobs_results: z.array(SerpApiJobResultSchema).default([]),
  })
  .passthrough();

// Infer a type from the schema — used only inside this file for the mapping
type SerpApiJobResult = z.infer<typeof SerpApiJobResultSchema>;

// ---------------------------------------------------------------------------
// 2. Shared Instances
// ---------------------------------------------------------------------------

/** One rate limiter shared across all calls — enforces 1 request per 2 seconds */
const limiter = new RateLimiter(2000);

/** SerpApi base URL for Google Jobs searches */
const SERP_API_BASE = "https://serpapi.com/search.json";

/**
 * Descriptive User-Agent header (Rule §3: Transparency).
 * Identifies our bot to the API. In production you'd put real contact info.
 */
const USER_AGENT = "JobScout-TS/1.0 (contact: [REDACTED_EMAIL])";

// ---------------------------------------------------------------------------
// 3. The Search Queries (from the PRD)
// ---------------------------------------------------------------------------

/**
 * Search queries for the bot to run.
 *
 * IMPORTANT: Google Jobs has NO coverage for Israel via SerpApi.
 * All queries target remote positions, which are relevant for
 * Israel-based developers. For Israel-local (non-remote) jobs,
 * a different data source would be needed (e.g. LinkedIn API, AllJobs.co.il).
 */
export const SEARCH_QUERIES: readonly string[] = [
  "Junior Full Stack Developer remote",
  "Electron Developer remote",
  "Internal Tools Developer remote",
  "Node.js Developer junior remote",
  "Desktop Application Developer remote",
] as const;

// ---------------------------------------------------------------------------
// 4. Core Fetch Function
// ---------------------------------------------------------------------------

/**
 * Fetches jobs from SerpApi for a single search query.
 *
 * This is the ONLY export that matters. The rest of the app calls this
 * and gets back `JobEntry[]` — clean, validated, ready to filter and write.
 *
 * @param query - The search string (e.g. "Junior Full Stack Developer Israel")
 * @returns An array of normalized JobEntry objects
 *
 * How axios.get() works:
 *   axios.get(url, { params: {...} }) sends a GET request.
 *   `params` get appended as ?key=value&key=value to the URL automatically.
 *   The `{ data }` destructuring pulls the response body directly.
 */
export async function fetchJobs(query: string): Promise<JobEntry[]> {
  Logger.info("Fetching jobs from SerpApi", { query });

  // Wrap the API call in the rate limiter — this is where the 2-second
  // delay between calls is enforced. The limiter calls our function
  // only after enough time has passed since the last call.
  const rawData: unknown = await limiter.throttle(async () => {
    const { data } = await axios.get(SERP_API_BASE, {
      params: {
        engine: "google_jobs",  // Tells SerpApi which search engine to use
        q: query,               // The actual search query
        hl: "en",               // Results language
        api_key: config.SERPAPI_KEY,
      },
      headers: {
        "User-Agent": USER_AGENT,
      },
    });

    return data;
  });

  // ---------------------------------------------------------------------------
  // 5. Validate the raw API response
  // ---------------------------------------------------------------------------
  // `safeParse` doesn't throw — it returns { success, data } or { success, error }.
  // If SerpApi changes their response format, this catches it here instead
  // of letting bad data flow through the entire app.

  const parsed = SerpApiResponseSchema.safeParse(rawData);

  if (!parsed.success) {
    Logger.error("SerpApi response validation failed", {
      query,
      errors: parsed.error.flatten().fieldErrors,
    });
    // Return empty array instead of crashing — one bad query shouldn't
    // kill the entire run. The orchestrator will continue with the next query.
    return [];
  }

  const jobs = parsed.data.jobs_results;
  Logger.info("SerpApi returned results", { query, count: jobs.length });

  // ---------------------------------------------------------------------------
  // 6. Map raw API data → our internal JobEntry shape
  // ---------------------------------------------------------------------------
  // This is the "normalization" step — translate SerpApi's field names
  // into our field names, fill in defaults, and build a clean object.

  return jobs.map((raw) => mapToJobEntry(raw));
}

// ---------------------------------------------------------------------------
// 7. Mapping Function (private)
// ---------------------------------------------------------------------------

/**
 * Transforms a single raw SerpApi job result into our internal JobEntry.
 *
 * This is where the messy API data becomes clean app data:
 * - `company_name` → `company` (our naming convention)
 * - `apply_options[0].link` → `link` (grab the first apply link, or fallback)
 * - `detected_extensions.posted_at` → `postedAt`
 * - Adds `foundAt` (when WE found it) and defaults for priority/status/score
 */
function mapToJobEntry(raw: SerpApiJobResult): JobEntry {
  // Try to get the direct apply link. If there are no apply options,
  // fall back to a Google search link for the job title.
  const applyLink =
    raw.apply_options?.[0]?.link ??
    `https://www.google.com/search?q=${encodeURIComponent(raw.title + " " + raw.company_name)}`;

  return {
    jobId: raw.job_id,
    title: raw.title,
    company: raw.company_name,             // API says company_name, we say company
    location: raw.location,
    link: applyLink,
    description: raw.description ?? "",     // Default to empty string if missing
    postedAt: raw.detected_extensions?.posted_at,
    priority: "Low",                        // Will be set by the filter engine later
    score: 0,                               // Will be set by the filter engine later
    status: "New",
    foundAt: new Date().toISOString(),       // Timestamp of when we discovered this job
  };
}
