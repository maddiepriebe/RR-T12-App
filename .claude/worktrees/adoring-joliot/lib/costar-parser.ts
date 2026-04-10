import { callClaude, parseClaudeJSON } from "./anthropic";
import type { RentCompsData, CompSummary, CompDetail } from "./schemas";

// ── Prompt 1: summary-level data (one entry per property) ─────────────────────

const SUMMARY_PROMPT = `You are extracting data from a CoStar Rent Comps PDF report.
Focus ONLY on the Rent Comps section. Ignore Sale Comps, Construction, Demographics, and Submarket/Market sections.

Return a single JSON object with exactly this structure (no markdown, no explanation):

{
  "reportDate": "readable date or null",
  "comps": [
    {
      "rank": 1,
      "name": "string",
      "address": "string",
      "city": "string",
      "state": "2-letter code",
      "yearBuilt": null,
      "totalUnits": null,
      "stories": null,
      "avgUnitSF": null,
      "distanceToSubjectMiles": null,
      "coStarRating": 4.0,
      "studioAskingRent": null,
      "oneBedAskingRent": null,
      "twoBedAskingRent": null,
      "threeBedAskingRent": null,
      "rentPerSF": null,
      "totalVacancyPct": null,
      "totalAvailabilityPct": null,
      "askingRentPerUnit": null,
      "askingRentPerSF": null,
      "effectiveRentPerUnit": null,
      "effectiveRentPerSF": null,
      "concessionsPct": null,
      "owner": null,
      "propertyManager": null
    }
  ]
}

Field rules:
- rank: 1-based integer from the report. For the subject property, set rank to 0 and add "isSubject": true.
- Include ALL properties from the Rent Comps section, both the subject and all comps.
- coStarRating: count the filled stars (★) in the rating display (e.g. ★★★★☆ = 4.0, ★★★☆☆ = 3.0). Use null if no rating is shown.
- concessionsPct, totalVacancyPct, totalAvailabilityPct: decimal fractions (e.g. 5% → 0.05).
- Use null for any value not found in the text. Never omit a field.`;

// ── Prompt 2: per-batch unit breakdown (sent once per 3-page chunk) ───────────

const BATCH_DETAILS_PROMPT = `You are extracting unit breakdown data from pages of a CoStar Rent Comps PDF.
These pages each contain a UNIT BREAKDOWN section for one property.
Extract all unit type rows from every UNIT BREAKDOWN section you find.

Return a single JSON object with exactly this structure (no markdown, no explanation):

{
  "compDetails": [
    {
      "propertyName": "string",
      "yearBuilt": null,
      "address": null,
      "unitTypes": [
        {
          "label": "original label from PDF e.g. Studio, 1BR/1BA, 2BR/2BA+Den",
          "bed": 1,
          "bath": null,
          "avgSF": null,
          "units": null,
          "mixPct": null,
          "availableUnits": null,
          "availabilityPct": null,
          "askingRentPerUnit": null,
          "askingRentPerSF": null,
          "effectiveRentPerUnit": null,
          "effectiveRentPerSF": null,
          "concessionsPct": null
        }
      ],
      "amenities": null,
      "parking": null,
      "petPolicy": null
    }
  ]
}

Field rules:
- bed: 0=Studio, 1=1BR, 2=2BR, 3=3BR.
- For the subject property, add "isSubject": true.
- Keep distinct rows for every separate unit type (e.g. "1BR/1BA" and "1BR/1BA+Den" are separate rows).
- mixPct, concessionsPct, availabilityPct: decimal fractions (e.g. 5% → 0.05).
- Use null for any value not found. Never omit a row.`;

// ── Parser ────────────────────────────────────────────────────────────────────

export async function parseCoStarPDF(pages: string[]): Promise<RentCompsData> {
  // Summary: first 10 pages contain the Rent Comparables Summary table.
  const summaryText = pages.slice(0, 10).join("\n\n");
  console.log("[summary] sending first", Math.min(10, pages.length), "pages");

  // Details: only pages that contain a UNIT BREAKDOWN section.
  const detailPages = pages.filter((p) => p.includes("UNIT BREAKDOWN"));
  console.log("[details] found", detailPages.length, "pages with UNIT BREAKDOWN");

  const batches = chunkBy(detailPages, 3);

  type SummaryResult = { reportDate?: string | null; comps: CompSummary[] };
  type DetailsResult = { compDetails: CompDetail[] };

  // All calls fire at once via Promise.all — truly parallel, not sequential.
  const allPromises = [
    callClaude(SUMMARY_PROMPT, summaryText, 8192),
    ...batches.map((batch) => callClaude(BATCH_DETAILS_PROMPT, batch.join("\n\n"), 8192)),
  ];
  const [summaryRaw, ...batchRaws] = await Promise.all(allPromises);

  const summaryResult = parseClaudeJSON<SummaryResult>(summaryRaw);
  if (!summaryResult) {
    throw new Error("Claude returned invalid JSON for comp summary");
  }

  // Merge compDetails across all batches; partial parse failures are skipped gracefully.
  const allCompDetails: CompDetail[] = [];
  for (const raw of batchRaws) {
    const result = parseClaudeJSON<DetailsResult>(raw);
    if (result?.compDetails) allCompDetails.push(...result.compDetails);
  }

  // Find subject in compDetails — isSubject flag first, then name match.
  const subjectComp = summaryResult.comps.find((c) => c.isSubject);
  const subjectProperty =
    allCompDetails.find((d) => d.isSubject) ??
    (subjectComp
      ? allCompDetails.find(
          (d) => normalize(d.propertyName) === normalize(subjectComp.name)
        )
      : null) ??
    null;

  return {
    reportDate: summaryResult.reportDate ?? undefined,
    comps: summaryResult.comps,
    compDetails: allCompDetails,
    subjectProperty,
  };
}

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

function chunkBy<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}
