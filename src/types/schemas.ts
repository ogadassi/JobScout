/**
 * schemas.ts
 *
 * Public contracts shared across modules. Raw API response shapes stay
 * private to each collector; everything is mapped into `JobPosting` before
 * the rest of the app sees it.
 *
 * Why Zod? One definition gives runtime validation AND a compile-time type
 * via z.infer<>, so external data is checked at the boundary.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Target companies (config/companies.json)
// ---------------------------------------------------------------------------

export const AtsSchema = z.enum(["greenhouse", "lever", "ashby", "comeet"]);
export type Ats = z.infer<typeof AtsSchema>;

export const CompanySchema = z.object({
  name: z.string().min(1),
  ats: AtsSchema,
  /** Greenhouse/Lever/Ashby board token, or "slug/UID" for Comeet. */
  board: z.string().min(1),
  /** Which kinds of teams the company hires for that fit the search. */
  teams: z.array(z.string()).default([]),
  notes: z.string().optional(),
  enabled: z.boolean().default(true),
});
export type Company = z.infer<typeof CompanySchema>;

export const CompanyListSchema = z.object({
  companies: z.array(CompanySchema),
});

// ---------------------------------------------------------------------------
// Normalized job posting (output of every collector)
// ---------------------------------------------------------------------------

export const SourceSchema = z.enum(["greenhouse", "lever", "ashby", "comeet", "linkedin-email"]);
export type Source = z.infer<typeof SourceSchema>;

export const JobPostingSchema = z.object({
  source: SourceSchema,
  company: z.string(),
  title: z.string(),
  link: z.string().url(),
  location: z.string(),
  remote: z.boolean(),
  /** Plain text (HTML stripped). May be empty, e.g. for LinkedIn alert emails. */
  description: z.string(),
  department: z.string().optional(),
  /** ATS-provided seniority label when available (Comeet). */
  experienceLevel: z.string().optional(),
  postedAt: z.string().optional(),
});
export type JobPosting = z.infer<typeof JobPostingSchema>;

// ---------------------------------------------------------------------------
// Stored row (Supabase table `jobscout_jobs`, or data/jobs.json locally)
// ---------------------------------------------------------------------------

export const JobStatusSchema = z.enum(["new", "starred", "applied", "replied", "interview", "rejected"]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobRowSchema = z.object({
  url_hash: z.string(),
  date_found: z.string(), // YYYY-MM-DD, Israel time
  company: z.string(),
  title: z.string(),
  link: z.string(),
  location: z.string().nullable(),
  source: z.string(),
  score: z.coerce.number(),
  reason: z.string().nullable(),
  status: JobStatusSchema,
  applied_date: z.string().nullable(),
  follow_up_date: z.string().nullable(),
  notes: z.string().nullable().optional(),
  digested_at: z.string().nullable(),
});
export type JobRow = z.infer<typeof JobRowSchema>;
