/**
 * config.ts
 *
 * Centralized configuration loader.
 * This is the ONLY place in the entire app that touches `process.env`.
 * Every other module imports `config` from here.
 *
 * Why centralize? If 5 modules each read `process.env.SERPAPI_KEY`,
 * any one of them could silently get `undefined` and crash later.
 * By validating once at startup and freezing the result, we guarantee
 * every consumer gets a valid, typed value — or the app never starts.
 *
 * This replaces the old pattern of `dotenv.config()` + raw `process.env`
 * access scattered across files. Modern approach: validate at the boundary,
 * trust the typed object everywhere else.
 */

import "dotenv/config"; // Side-effect import — loads .env into process.env
import { AppConfigSchema } from "../types/schemas.js";
import type { AppConfig } from "../types/schemas.js";

/**
 * Validate environment variables against our schema.
 *
 * `safeParse` returns { success: true, data } OR { success: false, error }
 * instead of throwing. This lets us handle the failure gracefully with a
 * clear error message rather than an ugly stack trace.
 */
const result = AppConfigSchema.safeParse(process.env);

if (!result.success) {
  // `flatten()` turns nested Zod errors into a flat, readable object.
  // Example output: { fieldErrors: { SERPAPI_KEY: ["Required"] } }
  console.error(
    "❌ Invalid environment configuration:\n",
    JSON.stringify(result.error.flatten().fieldErrors, null, 2)
  );
  process.exit(1);
}

/**
 * The validated, frozen config object.
 *
 * `Object.freeze` prevents accidental mutation — if any code tries
 * `config.SERPAPI_KEY = "oops"`, TypeScript catches it at compile time
 * AND JavaScript throws at runtime. Belt and suspenders.
 */
export const config: AppConfig = Object.freeze(result.data);
