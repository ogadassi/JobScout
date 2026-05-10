/**
 * logger.ts
 *
 * Structured JSON logger for the entire application.
 * Every log line is a valid JSON object, which makes it easy to:
 *  - Search logs (grep for `"level":"error"`)
 *  - Parse logs programmatically (pipe into any JSON tool)
 *  - Debug issues with timestamps + context data
 *
 * Why not just `console.log("something broke")`?
 * That works for debugging, but when a bot runs unattended, you need
 * machine-readable output. A JSON line like:
 *   {"timestamp":"...","level":"error","message":"API failed","status":429}
 * is infinitely more useful than:
 *   "something broke"
 *
 * Why not use a logging library like Winston or Pino?
 * For a small bot, they're overkill. This is ~30 lines and does the job.
 * If the project grows, we'd swap this file for Pino (same interface).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The three severity levels our app uses */
type LogLevel = "info" | "warn" | "error";

/**
 * Shape of every log line we output.
 * `[key: string]: unknown` lets callers attach any extra data they want.
 *
 * How to read this syntax: it's an intersection type (&).
 * The left side defines the required fields, the right side says
 * "...and also allow any other string keys with unknown values".
 */
type LogEntry = {
  timestamp: string;
  level: LogLevel;
  message: string;
} & { [key: string]: unknown };

// ---------------------------------------------------------------------------
// Core log function
// ---------------------------------------------------------------------------

/**
 * Writes a single JSON line to the appropriate output stream.
 *
 * @param level   - Severity: "info" | "warn" | "error"
 * @param message - Human-readable description of what happened
 * @param data    - Optional extra context (e.g. { query: "...", count: 5 })
 *
 * `data` gets spread into the JSON object, so calling:
 *   log("info", "Fetched jobs", { query: "Electron", count: 12 })
 * outputs:
 *   {"timestamp":"...","level":"info","message":"Fetched jobs","query":"Electron","count":12}
 */
function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...data, // Spread extra context into the log line
  };

  const line = JSON.stringify(entry);

  // Errors and warnings go to stderr (so they're separable from normal output).
  // Info goes to stdout.
  if (level === "error" || level === "warn") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * The Logger every module imports.
 *
 * Usage:
 *   import { Logger } from "../utils/logger.js";
 *   Logger.info("Fetched jobs", { query: "Electron", count: 12 });
 *   Logger.warn("Rate limit close", { remaining: 2 });
 *   Logger.error("API call failed", { status: 429 });
 */
export const Logger = {
  info:  (message: string, data?: Record<string, unknown>) => log("info", message, data),
  warn:  (message: string, data?: Record<string, unknown>) => log("warn", message, data),
  error: (message: string, data?: Record<string, unknown>) => log("error", message, data),
} as const;
