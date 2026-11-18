/**
 * Lever Postings API (public, no auth).
 * GET https://api.lever.co/v0/postings/{company}?mode=json
 */

import { z } from "zod";
import type { Company, JobPosting } from "../types/schemas.js";
import { getJson } from "../utils/http.js";
import { htmlToText } from "../utils/text.js";
import type { CompanyCollector } from "./types.js";

const PostingSchema = z.object({
  text: z.string(),
  hostedUrl: z.string(),
  createdAt: z.number().optional(),
  workplaceType: z.string().optional(),
  country: z.string().nullable().optional(),
  descriptionPlain: z.string().optional(),
  additionalPlain: z.string().optional(),
  lists: z.array(z.object({ text: z.string(), content: z.string() })).optional(),
  categories: z
    .object({
      location: z.string().optional(),
      allLocations: z.array(z.string()).optional(),
      department: z.string().optional(),
      team: z.string().optional(),
      commitment: z.string().optional(),
    })
    .optional(),
});

export class LeverCollector implements CompanyCollector {
  readonly ats = "lever" as const;

  async collect(company: Company): Promise<JobPosting[]> {
    const raw = await getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(company.board)}?mode=json`);
    const postings = z.array(PostingSchema).parse(raw);
    return postings.map((p) => {
      const locs = p.categories?.allLocations?.length ? p.categories.allLocations : [p.categories?.location ?? ""];
      const location = [...locs, p.country === "IL" ? "Israel" : ""].filter(Boolean).join(" / ");
      const lists = (p.lists ?? []).map((l) => `${l.text}\n${htmlToText(l.content)}`).join("\n");
      return {
        source: "lever",
        company: company.name,
        title: p.text.trim(),
        link: p.hostedUrl,
        location,
        remote: p.workplaceType === "remote" || /remote/i.test(location),
        description: [p.descriptionPlain ?? "", lists, p.additionalPlain ?? ""].join("\n").trim(),
        department: p.categories?.department ?? p.categories?.team,
        postedAt: p.createdAt ? new Date(p.createdAt).toISOString() : undefined,
      };
    });
  }
}
