/**
 * SmartRecruiters public Posting API (no auth).
 * GET https://api.smartrecruiters.com/v1/companies/{company}/postings?limit=100&offset=N[&country=xx]
 * GET https://api.smartrecruiters.com/v1/companies/{company}/postings/{id}   (description + public link)
 *
 * The list has no description, so each posting needs one more request. Set
 * "country" on the company to fetch only that country's postings.
 */

import { z } from "zod";
import type { Company, JobPosting } from "../types/schemas.js";
import { getJson } from "../utils/http.js";
import { Logger } from "../utils/logger.js";
import { htmlToText } from "../utils/text.js";
import type { CompanyCollector } from "./types.js";

const API = "https://api.smartrecruiters.com/v1/companies";
const PAGE_SIZE = 100;
const MAX_POSTINGS = 500;

const Label = z.object({ label: z.string().optional() }).optional();

const ListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  releasedDate: z.string().optional(),
  location: z
    .object({
      city: z.string().optional(),
      country: z.string().optional(),
      fullLocation: z.string().optional(),
      remote: z.boolean().optional(),
    })
    .optional(),
  department: Label,
  function: Label,
});
type ListItem = z.infer<typeof ListItemSchema>;

const ListSchema = z.object({ totalFound: z.number(), content: z.array(ListItemSchema) });

const DetailSchema = z.object({
  postingUrl: z.string().optional(),
  jobAd: z
    .object({
      sections: z.record(z.string(), z.object({ title: z.string().optional(), text: z.string().optional() })),
    })
    .optional(),
});
type Detail = z.infer<typeof DetailSchema>;

/** Maps one list item (plus its detail, if fetched) to a JobPosting. Exported for tests. */
export function mapSmartRecruitersPosting(company: Company, item: ListItem, detail?: Detail): JobPosting {
  const loc = item.location;
  const location = loc?.fullLocation ?? [loc?.city, loc?.country === "il" ? "Israel" : loc?.country].filter(Boolean).join(", ");
  const sections = Object.entries(detail?.jobAd?.sections ?? {})
    .filter(([key]) => key !== "companyDescription")
    .map(([, s]) => htmlToText(s.text ?? ""))
    .filter(Boolean);
  return {
    source: "smartrecruiters",
    company: company.name,
    title: item.name.trim(),
    link: detail?.postingUrl ?? `https://jobs.smartrecruiters.com/${encodeURIComponent(company.board)}/${item.id}`,
    location,
    remote: loc?.remote === true || /remote/i.test(location),
    description: sections.join("\n").trim(),
    department: item.department?.label ?? item.function?.label,
    postedAt: item.releasedDate,
  };
}

export class SmartRecruitersCollector implements CompanyCollector {
  readonly ats = "smartrecruiters" as const;

  async collect(company: Company): Promise<JobPosting[]> {
    const base = `${API}/${encodeURIComponent(company.board)}/postings`;
    const country = company.country ? `&country=${company.country.toLowerCase()}` : "";

    const items: ListItem[] = [];
    for (let offset = 0; offset < MAX_POSTINGS; offset += PAGE_SIZE) {
      const page = ListSchema.parse(await getJson(`${base}?limit=${PAGE_SIZE}&offset=${offset}${country}`));
      items.push(...page.content);
      if (page.content.length < PAGE_SIZE || items.length >= page.totalFound) break;
    }

    const jobs: JobPosting[] = [];
    for (const item of items) {
      let detail: Detail | undefined;
      try {
        detail = DetailSchema.parse(await getJson(`${base}/${encodeURIComponent(item.id)}`));
      } catch (err) {
        // Keep the job without a description rather than lose it.
        Logger.warn("SmartRecruiters detail failed", { company: company.name, id: item.id, error: String(err) });
      }
      jobs.push(mapSmartRecruitersPosting(company, item, detail));
    }
    return jobs;
  }
}
