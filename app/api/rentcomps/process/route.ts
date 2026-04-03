import { NextRequest, NextResponse } from "next/server";
import { callClaude, parseClaudeJSON } from "@/lib/anthropic";
import { parsePDF, extractPageRange } from "@/lib/pdf-parser";
import type { RentCompsData, CompSummary, CompDetail } from "@/lib/schemas";

// App Router: formData() reads the body stream directly — no Next.js body parser,
// no hard-coded size limit. Large CoStar PDFs (15-20 MB) are supported.
// maxDuration gives Vercel enough time for PDF parsing + multiple Claude calls.
export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconds (requires Vercel Pro for values > 10)

const SUMMARY_SYSTEM_PROMPT = `You are a multifamily real estate analyst. Extract rent comp summary data from CoStar report text.

Return ONLY a valid JSON array of comp objects — no markdown, no commentary.

Schema for each comp:
{
  "rank": number,
  "isSubject": boolean,
  "name": string,
  "address": string,
  "city": string,
  "state": string,
  "yearBuilt": number | null,
  "totalUnits": number | null,
  "stories": number | null,
  "avgUnitSF": number | null,
  "distanceToSubjectMiles": number | null,
  "studioAskingRent": number | null,
  "oneBedAskingRent": number | null,
  "twoBedAskingRent": number | null,
  "threeBedAskingRent": number | null,
  "rentPerSF": number | null,
  "totalVacancyPct": number | null,
  "totalAvailabilityPct": number | null,
  "askingRentPerUnit": number | null,
  "askingRentPerSF": number | null,
  "effectiveRentPerUnit": number | null,
  "effectiveRentPerSF": number | null,
  "concessionsPct": number | null,
  "owner": string | null,
  "propertyManager": string | null
}

Rules:
- All dollar values as plain numbers (no $ or commas)
- Percentages as plain numbers (e.g. 22.1, not 0.221)
- If a column says "N/A" or "-", use null
- The subject property gets rank 0 and isSubject: true
- Include ALL comps in the table`;

const UNIT_MIX_SYSTEM_PROMPT = `You are a multifamily real estate analyst. Extract unit mix detail data from a CoStar comp detail page.

Return ONLY a valid JSON object — no markdown, no commentary.

Schema:
{
  "propertyName": string,
  "address": string | null,
  "yearBuilt": number | null,
  "isSubject": boolean,
  "unitTypes": [
    {
      "bed": number,
      "bath": number | null,
      "avgSF": number | null,
      "units": number | null,
      "mixPct": number | null,
      "availableUnits": number | null,
      "availabilityPct": number | null,
      "askingRentPerUnit": number | null,
      "askingRentPerSF": number | null,
      "effectiveRentPerUnit": number | null,
      "effectiveRentPerSF": number | null,
      "concessionsPct": number | null,
      "label": string
    }
  ],
  "parking": string | null,
  "petPolicy": string | null,
  "amenities": {}
}

Rules:
- bed: 0=Studio, 1=1BR, 2=2BR, 3=3BR
- label: e.g. "1/1", "2/2", "All Studios", "All 1 Beds", "Totals"
- Include ALL rows including summary rows ("All Studios", "All 1 Beds", etc.)
- Summary rows have the same bed count, just label them properly
- Percentages as plain numbers (22.1, not 0.221)
- Dollar values as plain numbers`;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const subjectName = (formData.get("subjectName") as string) || "";

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const pdf = await parsePDF(buffer);

    const { pages } = pdf;
    const totalPages = pages.length;

    // Step 1: Extract summary (scan first ~15 pages for summary tables)
    const summaryText = extractPageRange(pages, 0, Math.min(15, totalPages - 1));

    const summaryRaw = await callClaude(
      SUMMARY_SYSTEM_PROMPT,
      `CoStar report pages 1-${Math.min(15, totalPages)}:\n\n${summaryText.slice(0, 60000)}`,
      8192
    );

    let comps: CompSummary[] = [];
    try {
      comps = parseClaudeJSON<CompSummary[]>(summaryRaw);
    } catch {
      // Try wrapping if Claude returned an object instead of array
      comps = [parseClaudeJSON<CompSummary>(summaryRaw)];
    }

    // Step 2: Extract unit mix from remaining pages
    // Find pages with unit mix tables (look for pages containing "Bed" + "Bath" + "Rent" columns)
    const unitMixPageGroups = identifyUnitMixPageGroups(pages);

    const compDetails: CompDetail[] = [];
    let subjectDetail: CompDetail | null = null;

    // Process unit mix pages in batches
    for (const group of unitMixPageGroups) {
      const pageText = extractPageRange(pages, group.startPage, group.endPage);

      const isSubjectPage =
        subjectName
          ? pageText.toLowerCase().includes(subjectName.toLowerCase())
          : group.startPage < 8; // heuristic: subject is in early pages

      try {
        const detailRaw = await callClaude(
          UNIT_MIX_SYSTEM_PROMPT,
          `${isSubjectPage ? "This is the SUBJECT PROPERTY page.\n" : ""}Property detail page:\n\n${pageText.slice(0, 30000)}`,
          4096
        );

        const detail = parseClaudeJSON<CompDetail>(detailRaw);
        detail.isSubject = isSubjectPage;

        if (isSubjectPage) {
          subjectDetail = detail;
        } else {
          compDetails.push(detail);
        }
      } catch (err) {
        console.warn(`Failed to parse unit mix for pages ${group.startPage}-${group.endPage}:`, err);
      }
    }

    const result: RentCompsData = {
      subjectProperty: subjectDetail,
      comps,
      compDetails,
      reportDate: new Date().toISOString().split("T")[0],
    };

    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    console.error("Rent comps processing error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Processing failed" },
      { status: 500 }
    );
  }
}

interface PageGroup {
  startPage: number;
  endPage: number;
  name?: string;
}

function identifyUnitMixPageGroups(pages: string[]): PageGroup[] {
  const groups: PageGroup[] = [];
  let currentGroupStart = -1;
  let lastUnitMixPage = -1;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i].toLowerCase();
    const hasUnitMix =
      (page.includes("bed") && page.includes("bath") && page.includes("asking rent")) ||
      page.includes("unit mix") ||
      (page.includes("all 1 bed") || page.includes("all 2 bed") || page.includes("all studio"));

    if (hasUnitMix) {
      if (currentGroupStart === -1 || i > lastUnitMixPage + 2) {
        if (currentGroupStart !== -1) {
          groups.push({ startPage: currentGroupStart, endPage: lastUnitMixPage });
        }
        currentGroupStart = i;
      }
      lastUnitMixPage = i;
    }
  }

  if (currentGroupStart !== -1) {
    groups.push({ startPage: currentGroupStart, endPage: lastUnitMixPage });
  }

  return groups;
}
