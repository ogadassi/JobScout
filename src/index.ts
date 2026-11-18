/**
 * index.ts — command-line entry point.
 *
 *   npm run pipeline                 full run (collect, score, store, digest; weekly on Thursdays)
 *   npm run pipeline -- --dry-run    nothing written or sent; digest printed here
 *   npm run weekly                   send the weekly summary now
 *
 * Flags: --dry-run --no-claude --no-digest --weekly / --no-weekly
 *        --only=comeet,greenhouse,"Riskified"  --max-companies=5  --weekly-only
 */

import { parseArgs } from "node:util";
import { openStore, runPipeline, runWeekly } from "./pipeline.js";
import { Logger } from "./utils/logger.js";

const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    "no-claude": { type: "boolean", default: false },
    "no-digest": { type: "boolean", default: false },
    weekly: { type: "boolean", default: false },
    "no-weekly": { type: "boolean", default: false },
    "weekly-only": { type: "boolean", default: false },
    only: { type: "string" },
    "max-companies": { type: "string" },
  },
});

try {
  if (values["weekly-only"]) {
    await runWeekly(openStore(values["dry-run"]), values["dry-run"]);
  } else {
    await runPipeline({
      dryRun: values["dry-run"],
      claude: !values["no-claude"],
      digest: !values["no-digest"],
      weekly: values.weekly ? "always" : values["no-weekly"] ? "never" : "auto",
      only: values.only?.split(",").map((s) => s.trim()).filter(Boolean),
      maxCompanies: values["max-companies"] ? Number(values["max-companies"]) : undefined,
    });
  }
} catch (err) {
  Logger.error("Run failed", { error: err instanceof Error ? err.message : String(err) });
  process.exitCode = 1;
}
