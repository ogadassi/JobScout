/**
 * supabase.ts — stores jobs in the Supabase table (default `jobscout_jobs`).
 * Uses the secret (service-role) key; the table has row-level security on
 * with no policies, so the public/anon key cannot read it.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { JobRowSchema, type JobRow } from "../types/schemas.js";
import { env } from "../utils/config.js";
import type { JobStore, NewJobRow } from "./types.js";

const COLUMNS = "url_hash,date_found,company,title,link,location,source,score,reason,status,applied_date,follow_up_date,notes,digested_at";

function rows(data: unknown): JobRow[] {
  return z.array(JobRowSchema).parse(data ?? []);
}

export class SupabaseStore implements JobStore {
  readonly name = "supabase";
  private readonly db: SupabaseClient;
  private readonly table: string;

  constructor() {
    if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) throw new Error("Supabase is not configured");
    this.db = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
    this.table = env.SUPABASE_TABLE;
  }

  async existingHashes(hashes: string[]): Promise<Set<string>> {
    const found = new Set<string>();
    for (let i = 0; i < hashes.length; i += 200) {
      const { data, error } = await this.db.from(this.table).select("url_hash").in("url_hash", hashes.slice(i, i + 200));
      if (error) throw new Error(`Supabase read failed: ${error.message}`);
      for (const r of z.array(z.object({ url_hash: z.string() })).parse(data)) found.add(r.url_hash);
    }
    return found;
  }

  async insert(newRows: NewJobRow[]): Promise<void> {
    for (let i = 0; i < newRows.length; i += 200) {
      const { error } = await this.db
        .from(this.table)
        .upsert(newRows.slice(i, i + 200), { onConflict: "url_hash", ignoreDuplicates: true });
      if (error) throw new Error(`Supabase insert failed: ${error.message}`);
    }
  }

  async pendingDigest(minScore: number, limit: number): Promise<JobRow[]> {
    const { data, error } = await this.db
      .from(this.table)
      .select(COLUMNS)
      .eq("status", "new")
      .is("digested_at", null)
      .gte("score", minScore)
      .order("score", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`Supabase read failed: ${error.message}`);
    return rows(data);
  }

  async markDigested(hashes: string[]): Promise<void> {
    if (hashes.length === 0) return;
    const { error } = await this.db.from(this.table).update({ digested_at: new Date().toISOString() }).in("url_hash", hashes);
    if (error) throw new Error(`Supabase update failed: ${error.message}`);
  }

  async followUpsDue(today: string): Promise<JobRow[]> {
    const { data, error } = await this.db
      .from(this.table)
      .select(COLUMNS)
      .eq("status", "applied")
      .lte("follow_up_date", today)
      .order("follow_up_date");
    if (error) throw new Error(`Supabase read failed: ${error.message}`);
    return rows(data);
  }

  async activitySince(date: string): Promise<JobRow[]> {
    const { data, error } = await this.db
      .from(this.table)
      .select(COLUMNS)
      .or(`date_found.gte.${date},applied_date.gte.${date},updated_at.gte.${date}`)
      .limit(5000);
    if (error) throw new Error(`Supabase read failed: ${error.message}`);
    return rows(data);
  }
}
