/**
 * index.ts — command-line entry point.
 *
 *   npm run pipeline                 full run (collect, score, store, digest; weekly on Thursdays)
 *   npm run pipeline -- --dry-run    nothing written or sent; digest printed here
 *   npm run weekly                   send the weekly summary now
 *   npm run inbox                    apply reply commands from the inbox, nothing else
 *
 * Flags: --dry-run --no-claude --no-digest --weekly / --no-weekly --inbox-only
 *        --only=comeet,greenhouse,"Riskified"  --max-companies=5  --weekly-only
 */

import { parseArgs } from "node:util";
import { processInbox } from "./inbox/mailbox.js";
import { sendEmail } from "./notify/email.js";
import { openStore, runPipeline, runWeekly } from "./pipeline.js";
import { digestChannel } from "./utils/config.js";
import { Logger } from "./utils/logger.js";
import { escapeHtml } from "./utils/text.js";

const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    "no-claude": { type: "boolean", default: false },
    "no-digest": { type: "boolean", default: false },
    weekly: { type: "boolean", default: false },
    "no-weekly": { type: "boolean", default: false },
    "weekly-only": { type: "boolean", default: false },
    "inbox-only": { type: "boolean", default: false },
    only: { type: "string" },
    "max-companies": { type: "string" },
  },
});

try {
  if (values["inbox-only"]) {
    await processInbox(openStore(false));
  } else if (values["weekly-only"]) {
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
  const message = err instanceof Error ? err.message : String(err);
  Logger.error("Run failed", { error: message });
  process.exitCode = 1;
  // Tell the people relying on the digest, so a silent morning is never a mystery.
  if (digestChannel === "email" && !values["dry-run"]) {
    const what = values["inbox-only"] ? "reading reply commands" : values["weekly-only"] ? "the weekly summary" : "the nightly run";
    const body = [
      `⚠️ <b>JobScout failed during ${what}</b>`,
      escapeHtml(message),
      "Nothing was lost; it tries again on its next run. Details are in the GitHub Actions log.",
    ].join("\n\n");
    await sendEmail(body).catch((e: unknown) => Logger.error("Failure email not sent", { error: String(e) }));
  }
}
