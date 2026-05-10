/**
 * serpapi.smoke.ts
 *
 * Final smoke test — runs fetchJobs through the actual pipeline
 * and prints real results to verify everything works end-to-end.
 *
 * Run with: npx tsx src/services/__tests__/serpapi.smoke.ts
 */

import { fetchJobs } from "../SerpApiService.js";
import { Logger } from "../../utils/logger.js";

async function main(): Promise<void> {
  Logger.info("Smoke test: fetching one query through the full pipeline");

  const jobs = await fetchJobs("Junior Full Stack Developer remote");

  Logger.info("Smoke test complete", {
    totalJobs: jobs.length,
    firstJob: jobs[0] ?? "No results returned",
  });

  // Print a few more if we got them, so we can eyeball the mapping
  if (jobs.length > 1) {
    Logger.info("Second job", { job: jobs[1] });
  }
}

main().catch((err: unknown) => {
  Logger.error("Smoke test failed", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
