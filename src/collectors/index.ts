/**
 * Collector registry (factory): picks the collector for each company's ATS
 * and runs all companies, one ATS host at a time per request gap (see http.ts).
 */

import { readFileSync } from "node:fs";
import { CompanyListSchema, type Ats, type Company, type JobPosting } from "../types/schemas.js";
import { Logger } from "../utils/logger.js";
import { AshbyCollector } from "./ashby.js";
import { ComeetCollector } from "./comeet.js";
import { GreenhouseCollector } from "./greenhouse.js";
import { LeverCollector } from "./lever.js";
import { SmartRecruitersCollector } from "./smartrecruiters.js";
import type { CompanyCollector } from "./types.js";

const COLLECTORS: Record<Ats, CompanyCollector> = {
  greenhouse: new GreenhouseCollector(),
  lever: new LeverCollector(),
  ashby: new AshbyCollector(),
  comeet: new ComeetCollector(),
  smartrecruiters: new SmartRecruitersCollector(),
};

export function loadCompanies(path = "config/companies.json"): Company[] {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  return CompanyListSchema.parse(raw).companies.filter((c) => c.enabled);
}

export interface CollectResult {
  jobs: JobPosting[];
  failures: { company: string; error: string }[];
}

/**
 * Runs every company. Companies on different ATS hosts run in parallel;
 * companies on the same host run one after another (rate limit in http.ts).
 * A failing company is logged and skipped, never fatal.
 */
export async function collectAll(companies: Company[]): Promise<CollectResult> {
  const jobs: JobPosting[] = [];
  const failures: CollectResult["failures"] = [];
  const byAts = new Map<Ats, Company[]>();
  for (const c of companies) byAts.set(c.ats, [...(byAts.get(c.ats) ?? []), c]);

  await Promise.all(
    [...byAts.entries()].map(async ([ats, list]) => {
      for (const company of list) {
        try {
          const found = await COLLECTORS[ats].collect(company);
          jobs.push(...found);
          Logger.info("Collected", { company: company.name, ats, jobs: found.length });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          failures.push({ company: company.name, error });
          Logger.warn("Collector failed", { company: company.name, ats, error });
        }
      }
    }),
  );
  return { jobs, failures };
}
