/**
 * Greenhouse Job Board API (public, no auth).
 * GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true
 */

import { z } from "zod";
import type { Company, JobPosting } from "../types/schemas.js";
import { getJson } from "../utils/http.js";
import { htmlToText } from "../utils/text.js";
import type { CompanyCollector } from "./types.js";

const ResponseSchema = z.object({
  jobs: z.array(
    z.object({
      title: z.string(),
      absolute_url: z.string(),
      location: z.object({ name: z.string().nullable().optional() }).nullable().optional(),
      content: z.string().nullable().optional(),
      updated_at: z.string().nullable().optional(),
      first_published: z.string().nullable().optional(),
      departments: z.array(z.object({ name: z.string() })).optional(),
      offices: z.array(z.object({ name: z.string().nullable().optional() })).optional(),
    }),
  ),
});

export class GreenhouseCollector implements CompanyCollector {
  readonly ats = "greenhouse" as const;

  async collect(company: Company): Promise<JobPosting[]> {
    const raw = await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(company.board)}/jobs?content=true`);
    const data = ResponseSchema.parse(raw);
    return data.jobs.map((j) => {
      const offices = (j.offices ?? []).map((o) => o.name ?? "").filter(Boolean);
      const location = [j.location?.name ?? "", ...offices].filter(Boolean).join(" / ");
      return {
        source: "greenhouse",
        company: company.name,
        title: j.title.trim(),
        link: j.absolute_url,
        location,
        remote: /remote/i.test(location),
        description: htmlToText(j.content),
        department: j.departments?.[0]?.name,
        postedAt: j.first_published ?? j.updated_at ?? undefined,
      };
    });
  }
}
