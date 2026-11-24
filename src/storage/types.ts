/**
 * types.ts — storage abstraction. Supabase in production, a local JSON file
 * when Supabase is not configured (handy for trying the pipeline locally).
 */

import type { JobRow, JobStatus } from "../types/schemas.js";

export type NewJobRow = Omit<JobRow, "status" | "applied_date" | "follow_up_date" | "notes" | "digested_at">;

/** A fresh AI score and apply kit for a job that is already stored. */
export interface KitUpdate {
  url_hash: string;
  score: number;
  reason: string;
  cv_variant: string | null;
  pitch: string | null;
}

/** Fields an email command may change. */
export interface JobPatch {
  status?: JobStatus;
  applied_date?: string | null;
  follow_up_date?: string | null;
  notes?: string | null;
}

export interface JobStore {
  readonly name: string;
  /** Returns which of these url hashes are already stored. */
  existingHashes(hashes: string[]): Promise<Set<string>>;
  insert(rows: NewJobRow[]): Promise<void>;
  /** New, never-digested jobs, best score first. */
  pendingDigest(minScore: number, limit: number): Promise<JobRow[]>;
  markDigested(hashes: string[]): Promise<void>;
  /** Applied jobs whose follow-up date is today or earlier. */
  followUpsDue(today: string): Promise<JobRow[]>;
  /** Every row found or applied on/after this date (for the weekly summary). */
  activitySince(date: string): Promise<JobRow[]>;
  /** Of these hashes, the still-open jobs (new / starred) that have no apply kit yet. */
  needsKit(hashes: string[]): Promise<Set<string>>;
  updateKits(updates: KitUpdate[]): Promise<void>;
  /** Jobs whose url hash starts with this short id (the id shown in emails). */
  findById(shortId: string): Promise<JobRow[]>;
  update(urlHash: string, patch: JobPatch): Promise<JobRow>;
  /** Starred, applied, replied and interview jobs: the ones being worked on. */
  active(): Promise<JobRow[]>;
}
