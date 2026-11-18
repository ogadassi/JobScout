/**
 * localFile.ts — JSON-file store (data/jobs.json) used when Supabase is not
 * configured. Same behavior as the Supabase store, for local trials.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { JobRowSchema, type JobRow } from "../types/schemas.js";
import type { JobStore, NewJobRow } from "./types.js";

export class LocalFileStore implements JobStore {
  readonly name: string;
  private rows: JobRow[];

  constructor(private readonly path = "data/jobs.json", private readonly readOnly = false) {
    this.name = `local file (${path})`;
    this.rows = existsSync(path) ? z.array(JobRowSchema).parse(JSON.parse(readFileSync(path, "utf8"))) : [];
  }

  private save(): void {
    if (this.readOnly) return;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.rows, null, 2));
  }

  async existingHashes(hashes: string[]): Promise<Set<string>> {
    const all = new Set(this.rows.map((r) => r.url_hash));
    return new Set(hashes.filter((h) => all.has(h)));
  }

  async insert(newRows: NewJobRow[]): Promise<void> {
    const have = new Set(this.rows.map((r) => r.url_hash));
    for (const r of newRows) {
      if (have.has(r.url_hash)) continue;
      this.rows.push({ ...r, status: "new", applied_date: null, follow_up_date: null, notes: null, digested_at: null });
    }
    this.save();
  }

  async pendingDigest(minScore: number, limit: number): Promise<JobRow[]> {
    return this.rows
      .filter((r) => r.status === "new" && !r.digested_at && r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async markDigested(hashes: string[]): Promise<void> {
    const set = new Set(hashes);
    const now = new Date().toISOString();
    for (const r of this.rows) if (set.has(r.url_hash)) r.digested_at = now;
    this.save();
  }

  async followUpsDue(today: string): Promise<JobRow[]> {
    return this.rows.filter((r) => r.status === "applied" && r.follow_up_date !== null && r.follow_up_date <= today);
  }

  async activitySince(date: string): Promise<JobRow[]> {
    return this.rows.filter((r) => r.date_found >= date || (r.applied_date !== null && r.applied_date >= date));
  }
}
