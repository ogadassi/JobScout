/**
 * schemas.ts
 *
 * Public contracts for the whole application.
 * Only two schemas live here — the internal job shape and the config shape.
 * These are the only types that cross module boundaries.
 *
 * Raw SerpApi response schemas are a private concern of SerpApiService.ts.
 * They live there because they describe the API's format, not ours.
 *
 * Why Zod? It validates at runtime AND gives us compile-time types via
 * z.infer<> — so we define a shape once and get both for free.
 * This replaces the old pattern of writing `interface Foo {}` and separately
 * hoping the API matches it.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// 1. Internal Normalized Type — JobEntry
// ---------------------------------------------------------------------------

/**
 * The application's canonical job representation.
 * Every module (filter engine, Excel writer, orchestrator) speaks this shape.
 *
 * `priority` and `status` use z.enum() which gives us TypeScript union types
 * like "High" | "Medium" | "Low" for free — no manual type definition needed.
 *
 * Jobs start as raw API data and are mapped INTO this shape inside
 * SerpApiService.ts before anything else in the app ever sees them.
 */
export const JobEntrySchema = z.object({
  jobId: z.string(),               // SerpApi's job_id — used for deduplication
  title: z.string(),
  company: z.string(),
  location: z.string(),
  link: z.string(),                // Direct apply link (or SerpApi fallback link)
  description: z.string(),         // Full text — used by the filter engine to score
  postedAt: z.string().optional(), // Human-readable, e.g. "3 days ago"
  priority: z.enum(["High", "Medium", "Low"]).default("Low"),
  score: z.number().default(0),    // Numeric score assigned by the filter engine
  status: z.enum(["New", "Saved", "Applied", "Rejected"]).default("New"),
  foundAt: z.string(),             // ISO timestamp of when WE discovered this job
});

// ---------------------------------------------------------------------------
// 2. App Configuration Schema
// ---------------------------------------------------------------------------

/**
 * Validated shape of our .env variables.
 *
 * `z.string().min(1)` rejects both missing AND empty-string values —
 * a misconfigured key fails loudly at startup rather than silently
 * crashing mid-run with a cryptic "Cannot read properties of undefined".
 */
export const AppConfigSchema = z.object({
  SERPAPI_KEY: z.string().min(1, "SERPAPI_KEY is required and cannot be empty"),
  OUTPUT_PATH: z
    .string()
    .min(1, "OUTPUT_PATH is required and cannot be empty")
    .default("./output/jobs.xlsx"),
});

// ---------------------------------------------------------------------------
// 3. Exported Inferred Types
// ---------------------------------------------------------------------------

/**
 * How to read `z.infer<typeof Schema>`:
 * TypeScript extracts the static type that the Zod schema represents.
 * Define the shape once in Zod → get runtime validation + compile-time
 * type safety simultaneously. No duplication.
 */
export type JobEntry = z.infer<typeof JobEntrySchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;

// Convenience union types — useful for function parameter annotations
// How to read `JobEntry["priority"]`: index into the JobEntry type to get
// just the type of the `priority` field → "High" | "Medium" | "Low"
export type Priority = JobEntry["priority"];
export type JobStatus = JobEntry["status"];

