/**
 * localFile.ts — JSON-file store (data/jobs.json) used when Supabase is not
 * configured. Same behavior as the Supabase store, for local trials.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { JobRowSchema, type JobRow } from "../types/schemas.js";
import { israelDate } from "../utils/text.js";
import type { JobPatch, JobStore, KitUpdate, NewJobRow } from "./types.js";

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

  async needsKit(hashes: string[]): Promise<Set<string>> {
    const set = new Set(hashes);
    return new Set(
      this.rows.filter((r) => set.has(r.url_hash) && (r.status === "new" || r.status === "starred") && !r.cv_variant).map((r) => r.url_hash),
    );
  }

  async updateKits(updates: KitUpdate[]): Promise<void> {
    for (const u of updates) {
      const row = this.rows.find((r) => r.url_hash === u.url_hash);
      if (row) Object.assign(row, u);
    }
    this.save();
  }

  async findById(shortId: string): Promise<JobRow[]> {
    return this.rows.filter((r) => r.url_hash.startsWith(shortId)).slice(0, 5);
  }

  async update(urlHash: string, patch: JobPatch): Promise<JobRow> {
    const row = this.rows.find((r) => r.url_hash === urlHash);
    if (!row) throw new Error(`No job ${urlHash}`);
    Object.assign(row, patch);
    // Same rule as the Supabase trigger: applying fills the applied and follow-up dates.
    if (row.status === "applied" && !row.applied_date) row.applied_date = israelDate();
    if (row.applied_date && !row.follow_up_date) row.follow_up_date = israelDate(7, new Date(`${row.applied_date}T12:00:00Z`));
    this.save();
    return row;
  }

  async active(): Promise<JobRow[]> {
    return this.rows.filter((r) => ["starred", "applied", "replied", "interview"].includes(r.status));
  }
}
