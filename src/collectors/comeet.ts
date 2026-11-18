/**
 * Comeet public careers pages.
 *
 * Comeet's official Careers API (https://developers.comeet.com/reference/careers-api-overview)
 * needs a company UID + token that the company's admin hands to its own web
 * developer, so it is not meant for third parties. Instead this reads the
 * public, Comeet-hosted careers page (https://www.comeet.com/jobs/{slug}/{UID}),
 * which embeds the same position objects as JSON in `COMPANY_POSITIONS_DATA`.
 * One request per company per night.
 */

import { z } from "zod";
import type { Company, JobPosting } from "../types/schemas.js";
import { getText } from "../utils/http.js";
import { htmlToText } from "../utils/text.js";
import type { CompanyCollector } from "./types.js";

const PositionSchema = z.object({
  name: z.string(),
  department: z.string().nullable().optional(),
  location: z
    .object({
      name: z.string().nullable().optional(),
      country: z.string().nullable().optional(),
      city: z.string().nullable().optional(),
      is_remote: z.boolean().nullable().optional(),
    })
    .nullable()
    .optional(),
  url_active_page: z.string().nullable().optional(),
  url_comeet_hosted_page: z.string().nullable().optional(),
  experience_level: z.string().nullable().optional(),
  workplace_type: z.string().nullable().optional(),
  time_updated: z.string().nullable().optional(),
  is_internal: z.boolean().nullable().optional(),
  custom_fields: z
    .object({ details: z.array(z.object({ name: z.string(), value: z.string().nullable() })).optional() })
    .nullable()
    .optional(),
});

const MARKER = "COMPANY_POSITIONS_DATA = ";

/** Pulls the JSON array that follows the marker, using bracket matching (robust to `;` inside strings). */
export function extractPositionsJson(html: string): unknown {
  const start = html.indexOf(MARKER);
  if (start < 0) throw new Error("Comeet page has no COMPANY_POSITIONS_DATA (page layout changed?)");
  let i = start + MARKER.length;
  if (html[i] !== "[") throw new Error("Comeet positions data is not an array");
  let depth = 0;
  let inStr = false;
  for (let k = i; k < html.length; k++) {
    const ch = html[k];
    if (inStr) {
      if (ch === "\\") k++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return JSON.parse(html.slice(i, k + 1));
    }
  }
  throw new Error("Unterminated Comeet positions JSON");
}

export class ComeetCollector implements CompanyCollector {
  readonly ats = "comeet" as const;

  async collect(company: Company): Promise<JobPosting[]> {
    const html = await getText(`https://www.comeet.com/jobs/${company.board}`);
    const positions = z.array(PositionSchema).parse(extractPositionsJson(html));
    return positions
      .filter((p) => p.is_internal !== true)
      .flatMap((p): JobPosting[] => {
        const link = p.url_comeet_hosted_page ?? p.url_active_page;
        if (!link) return [];
        const loc = p.location;
        const name = loc?.name ?? loc?.city ?? "";
        const country = loc?.country === "IL" ? "Israel" : loc?.country ?? "";
        const location = country && !name.toLowerCase().includes(country.toLowerCase()) ? [name, country].filter(Boolean).join(", ") : name;
        const description = (p.custom_fields?.details ?? [])
          .map((d) => `${d.name}:\n${htmlToText(d.value)}`)
          .join("\n\n");
        return [
          {
            source: "comeet",
            company: company.name,
            title: p.name.trim(),
            link,
            location,
            remote: p.workplace_type === "Remote" || loc?.is_remote === true,
            description,
            department: p.department ?? undefined,
            experienceLevel: p.experience_level ?? undefined,
            postedAt: p.time_updated ?? undefined,
          },
        ];
      });
  }
}
