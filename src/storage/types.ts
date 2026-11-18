/**
 * types.ts — storage abstraction. Supabase in production, a local JSON file
 * when Supabase is not configured (handy for trying the pipeline locally).
 */

import type { JobRow } from "../types/schemas.js";

export type NewJobRow = Omit<JobRow, "status" | "applied_date" | "follow_up_date" | "notes" | "digested_at">;

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
}
