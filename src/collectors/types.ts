/**
 * types.ts — the collector abstraction.
 *
 * Strategy pattern: each ATS has its own collector class; the pipeline only
 * knows this interface. Adding a new board type = a new class + one line in
 * the registry (collectors/index.ts), no pipeline changes.
 */

import type { Ats, Company, JobPosting } from "../types/schemas.js";

export interface CompanyCollector {
  readonly ats: Ats;
  /** Fetches all open postings for one company. Throws on network/format errors. */
  collect(company: Company): Promise<JobPosting[]>;
}
