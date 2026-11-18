/**
 * Ashby public Job Posting API (no auth).
 * GET https://api.ashbyhq.com/posting-api/job-board/{name}
 */

import { z } from "zod";
import type { Company, JobPosting } from "../types/schemas.js";
import { getJson } from "../utils/http.js";
import type { CompanyCollector } from "./types.js";

const AddressSchema = z
  .object({
    postalAddress: z
      .object({
        addressLocality: z.string().nullable().optional(),
        addressRegion: z.string().nullable().optional(),
        addressCountry: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
  })
  .nullable()
  .optional();

const ResponseSchema = z.object({
  jobs: z.array(
    z.object({
      title: z.string(),
      jobUrl: z.string(),
      location: z.string().nullable().optional(),
      secondaryLocations: z.array(z.object({ location: z.string().nullable().optional() })).nullable().optional(),
      isRemote: z.boolean().nullable().optional(),
      workplaceType: z.string().nullable().optional(),
      isListed: z.boolean().nullable().optional(),
      department: z.string().nullable().optional(),
      publishedAt: z.string().nullable().optional(),
      descriptionPlain: z.string().nullable().optional(),
      address: AddressSchema,
    }),
  ),
});

export class AshbyCollector implements CompanyCollector {
  readonly ats = "ashby" as const;

  async collect(company: Company): Promise<JobPosting[]> {
    const raw = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(company.board)}`);
    const data = ResponseSchema.parse(raw);
    return data.jobs
      .filter((j) => j.isListed !== false)
      .map((j) => {
        const pa = j.address?.postalAddress;
        const parts = [
          j.location ?? "",
          ...(j.secondaryLocations ?? []).map((s) => s.location ?? ""),
          pa?.addressLocality ?? "",
          pa?.addressCountry ?? "",
        ];
        const location = [...new Set(parts.filter(Boolean))].join(" / ");
        return {
          source: "ashby",
          company: company.name,
          title: j.title.trim(),
          link: j.jobUrl,
          location,
          remote: j.isRemote === true || /remote/i.test(j.workplaceType ?? ""),
          description: j.descriptionPlain ?? "",
          department: j.department ?? undefined,
          postedAt: j.publishedAt ?? undefined,
        };
      });
  }
}
