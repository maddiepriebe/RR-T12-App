/**
 * POST /api/costar-parse
 *
 * Receives chunked CoStar PDF text from the client, calls Claude to extract
 * structured comp data, then assembles and returns RentCompsData JSON.
 *
 * Body: { summaryChunk: string, detailChunks: string[], subjectName: string, expectedCount: number }
 * Response: RentCompsData
 */

import { auth } from "@clerk/nextjs/server";
import { callClaude, parseClaudeJSON } from "@/lib/anthropic";
import { rateLimit } from "@/lib/rate-limit";
import type {
  RentCompsData,
  CompSummary,
  CompDetail,
  UnitTypeDetail,
} from "@/lib/schemas";

// ─── Internal types for Claude-extracted data ──────────────────────

interface ClaudeSummaryComp {
  rank: number;
  name: string;
  yearBuilt: number | null;
  units: number | null;
  avgSF: number | null;
  studioRent: number | null;
  oneBedRent: number | null;
  twoBedRent: number | null;
  threeBedRent: number | null;
  rentPerSF: number | null;
}

interface ClaudePropertyDetail {
  propertyName: string;
  address: string | null;
  city: string | null;
  state: string | null;
  yearBuilt: number | null;
  totalUnits: number | null;
  stories: number | null;
  avgUnitSF: number | null;
  distanceMiles: number | null;
  coStarRating: number | null;
  unitTypes: UnitTypeDetail[];
}

// ─── Claude extraction ─────────────────────────────────────────────

/**
 * One Claude call for the summary table pages.
 * Returns an array of ranked comps with rent-by-bedroom and rent/SF.
 */
async function extractSummaryComps(
  summaryChunk: string,
  expectedCount: number
): Promise<ClaudeSummaryComp[]> {
  const system = `You are a data extraction assistant for real estate underwriting.
Extract rental comp data from CoStar Underwriting Report text.
Return ONLY valid JSON — no markdown fences, no explanation, no preamble.`;

  const user = `Extract all rental comps from this Rent Comparables Summary table.

Return a JSON array. Each element must have exactly these keys:
  rank         – integer (1-based ranking)
  name         – string (property name)
  yearBuilt    – integer or null
  units        – integer or null (total unit count)
  avgSF        – integer or null (average unit square footage)
  studioRent   – number or null (asking rent for studios)
  oneBedRent   – number or null
  twoBedRent   – number or null
  threeBedRent – number or null
  rentPerSF    – number or null (rent per SF, typically a decimal like 4.50)

Rules:
- A dash "-" in the source means null.
- rentPerSF is always a small decimal (e.g. 3.99, 4.50), NOT a dollar-per-month amount.
- Expected number of comps: ~${expectedCount || "unknown"}.
- Return the array only, starting with "[". Do not wrap in an object.

TEXT:
${summaryChunk}`;

  console.log("[costar-parse] Calling Claude for summary extraction...");
  const raw = await callClaude(system, user, 4000);
  console.log("[costar-parse] Summary raw response (first 600 chars):", raw.slice(0, 600));

  const parsed = parseClaudeJSON<ClaudeSummaryComp[]>(raw);
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * One Claude call per batch of ~3 detail pages.
 * Returns an array of property objects with unit-mix breakdowns.
 */
async function extractPropertyDetails(
  chunk: string
): Promise<ClaudePropertyDetail[]> {
  const system = `You are a data extraction assistant for real estate underwriting.
Extract property detail data from CoStar Underwriting Report text.
Return ONLY valid JSON — no markdown fences, no explanation, no preamble.`;

  const user = `Extract all property details from this CoStar report section.
Each property has a header (name, address, year built, property size, distance to subject)
followed by a UNIT BREAKDOWN table.

Return a JSON array. Each element must have:
  propertyName  – string
  address       – string or null
  city          – string or null
  state         – 2-letter abbreviation or null
  yearBuilt     – integer or null
  totalUnits    – integer or null
  stories       – integer or null
  avgUnitSF     – number or null
  distanceMiles – number or null  (the "Distance to Subject" value)
  coStarRating  – number or null
  unitTypes     – array of unit rows (see below)

Each unitTypes element must have:
  bed               – integer: 0=studio, 1=1BR, 2=2BR, 3=3BR, -1=Totals row
  bath              – number or null
  avgSF             – number or null
  units             – integer or null
  mixPct            – number or null  (e.g. 8.3 for 8.3%)
  availableUnits    – integer or null
  availabilityPct   – number or null
  askingRentPerUnit – number or null
  askingRentPerSF   – number or null
  effectiveRentPerUnit – number or null
  effectiveRentPerSF   – number or null
  concessionsPct    – number or null
  label             – string  (e.g. "Studio/1", "All Studios", "1/1", "All 1 Beds", "Totals")

Rules:
- Include individual unit-type rows, summary rows ("All Studios", "All 1 Beds", etc.), and the Totals row.
- A dash "-" means null.
- The subject property has no "Distance to Subject" — set distanceMiles to null for it.
- Return the array only, starting with "[". Do not wrap in an object.

TEXT:
${chunk}`;

  console.log(
    `[costar-parse] Calling Claude for detail extraction (chunk length: ${chunk.length} chars)...`
  );
  const raw = await callClaude(system, user, 4000);
  console.log("[costar-parse] Detail raw response (first 600 chars):", raw.slice(0, 600));

  const parsed = parseClaudeJSON<ClaudePropertyDetail[]>(raw);
  return Array.isArray(parsed) ? parsed : [];
}

// ─── Assembly ──────────────────────────────────────────────────────

/** Score how well a summary comp name/units matches a detail section. */
function scoreMatch(
  compName: string,
  compUnits: number | null,
  detailName: string,
  detailUnits: number | null
): number {
  let score = 0;
  const cn = compName.toLowerCase().trim();
  const dn = detailName.toLowerCase().trim();

  if (cn === dn) score += 100;
  else if (cn.includes(dn) || dn.includes(cn)) score += 60;
  else {
    const cWords = new Set(cn.split(/\s+/).filter((w) => w.length > 2));
    score +=
      dn
        .split(/\s+/)
        .filter((w) => w.length > 2 && cWords.has(w)).length * 20;
  }
  if (compUnits !== null && compUnits === detailUnits) score += 25;
  return score;
}

function buildCompDetail(
  det: ClaudePropertyDetail,
  isSubject: boolean
): CompDetail {
  return {
    propertyName: det.propertyName,
    isSubject,
    address: det.address ?? undefined,
    yearBuilt: det.yearBuilt,
    unitTypes: det.unitTypes ?? [],
    amenities: {},
    parking: null,
    petPolicy: null,
  };
}

function assembleRentCompsData(
  summaryComps: ClaudeSummaryComp[],
  allDetails: ClaudePropertyDetail[],
  subjectName: string
): RentCompsData {
  const nameLower = subjectName.toLowerCase().trim();

  // ── Identify subject property ────────────────────────────────────
  let subjectDetail: ClaudePropertyDetail | null = null;

  if (nameLower) {
    subjectDetail =
      allDetails.find(
        (d) =>
          d.propertyName.toLowerCase().includes(nameLower) ||
          nameLower.includes(d.propertyName.toLowerCase().trim())
      ) ?? null;
  }
  // CoStar marks the subject by having no "Distance to Subject"
  if (!subjectDetail) {
    subjectDetail = allDetails.find((d) => d.distanceMiles === null) ?? null;
  }
  // Last resort: CoStar puts the subject first
  if (!subjectDetail && allDetails.length > 0) {
    subjectDetail = allDetails[0];
  }

  const nonSubjectDetails = allDetails.filter((d) => d !== subjectDetail);

  // ── Match each summary comp to a detail section ──────────────────
  const usedDetails = new Set<ClaudePropertyDetail>();
  const matchedDetails: (ClaudePropertyDetail | null)[] = summaryComps.map(
    (comp) => {
      let best: ClaudePropertyDetail | null = null;
      let bestScore = 0;
      for (const det of nonSubjectDetails) {
        if (usedDetails.has(det)) continue;
        const s = scoreMatch(
          comp.name,
          comp.units,
          det.propertyName,
          det.totalUnits
        );
        if (s > bestScore) {
          bestScore = s;
          best = det;
        }
      }
      if (best) usedDetails.add(best);
      return best;
    }
  );

  // ── Build CompSummary[] ──────────────────────────────────────────
  const comps: CompSummary[] = [];

  if (subjectDetail) {
    const totals =
      subjectDetail.unitTypes.find((u) => u.bed === -1) ?? null;
    const studio = subjectDetail.unitTypes.find(
      (u) => u.bed === 0 && u.label?.startsWith("All")
    ) ?? null;
    const one = subjectDetail.unitTypes.find(
      (u) => u.bed === 1 && u.label?.startsWith("All")
    ) ?? null;
    const two = subjectDetail.unitTypes.find(
      (u) => u.bed === 2 && u.label?.startsWith("All")
    ) ?? null;
    const three = subjectDetail.unitTypes.find(
      (u) => u.bed === 3 && u.label?.startsWith("All")
    ) ?? null;

    comps.push({
      rank: 0,
      isSubject: true,
      name: subjectDetail.propertyName,
      address: subjectDetail.address ?? "",
      city: subjectDetail.city ?? "",
      state: subjectDetail.state ?? "",
      yearBuilt: subjectDetail.yearBuilt,
      renovYear: null,
      totalUnits: subjectDetail.totalUnits ?? totals?.units ?? null,
      stories: subjectDetail.stories,
      avgUnitSF: subjectDetail.avgUnitSF ?? totals?.avgSF ?? null,
      distanceToSubjectMiles: null,
      coStarRating: subjectDetail.coStarRating,
      studioAskingRent: studio?.askingRentPerUnit ?? null,
      oneBedAskingRent: one?.askingRentPerUnit ?? null,
      twoBedAskingRent: two?.askingRentPerUnit ?? null,
      threeBedAskingRent: three?.askingRentPerUnit ?? null,
      rentPerSF: totals?.askingRentPerSF ?? null,
      totalVacancyPct: totals?.availabilityPct ?? null,
      totalAvailabilityPct: totals?.availabilityPct ?? null,
      askingRentPerUnit: totals?.askingRentPerUnit ?? null,
      askingRentPerSF: totals?.askingRentPerSF ?? null,
      effectiveRentPerUnit: totals?.effectiveRentPerUnit ?? null,
      effectiveRentPerSF: totals?.effectiveRentPerSF ?? null,
      concessionsPct: totals?.concessionsPct ?? null,
      owner: null,
      propertyManager: null,
    });
  }

  for (let i = 0; i < summaryComps.length; i++) {
    const sc = summaryComps[i];
    const det = matchedDetails[i];
    const totals = det?.unitTypes.find((u) => u.bed === -1) ?? null;

    comps.push({
      rank: sc.rank,
      isSubject: false,
      name: sc.name || det?.propertyName || `Comp ${sc.rank}`,
      address: det?.address ?? "",
      city: det?.city ?? "",
      state: det?.state ?? "",
      yearBuilt: sc.yearBuilt ?? det?.yearBuilt ?? null,
      renovYear: null,
      totalUnits: sc.units ?? det?.totalUnits ?? null,
      stories: det?.stories ?? null,
      avgUnitSF: sc.avgSF ?? det?.avgUnitSF ?? null,
      distanceToSubjectMiles: det?.distanceMiles ?? null,
      coStarRating: det?.coStarRating ?? null,
      studioAskingRent: sc.studioRent,
      oneBedAskingRent: sc.oneBedRent,
      twoBedAskingRent: sc.twoBedRent,
      threeBedAskingRent: sc.threeBedRent,
      rentPerSF: sc.rentPerSF,
      totalVacancyPct: totals?.availabilityPct ?? null,
      totalAvailabilityPct: totals?.availabilityPct ?? null,
      askingRentPerUnit: totals?.askingRentPerUnit ?? null,
      askingRentPerSF: totals?.askingRentPerSF ?? null,
      effectiveRentPerUnit: totals?.effectiveRentPerUnit ?? null,
      effectiveRentPerSF: totals?.effectiveRentPerSF ?? null,
      concessionsPct: totals?.concessionsPct ?? null,
      owner: null,
      propertyManager: null,
    });
  }

  // ── Build CompDetail[] ───────────────────────────────────────────
  const subjectCompDetail = subjectDetail
    ? buildCompDetail(subjectDetail, true)
    : null;

  const compDetails: CompDetail[] = matchedDetails
    .map((det) => (det ? buildCompDetail(det, false) : null))
    .filter((d): d is CompDetail => d !== null);

  // ── Sanity check ─────────────────────────────────────────────────
  const compCount = comps.filter((c) => !c.isSubject).length;
  console.log(
    `[costar-parse] Assembled: ${summaryComps.length} summary comps, ` +
      `${allDetails.length} detail sections → ${compCount} ranked comps in output`
  );

  return {
    subjectProperty: subjectCompDetail,
    comps,
    compDetails,
    reportDate: new Date().toISOString().split("T")[0],
  };
}

// ─── Route handler ─────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const rl = rateLimit(`costar-parse:${userId}`, 10, 60_000);
    if (!rl.ok) {
      return Response.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
      );
    }

    const { summaryChunk, detailChunks, subjectName, expectedCount } =
      await req.json();

    // 1. Extract summary comps — one Claude call for the ranked table
    const summaryComps = await extractSummaryComps(summaryChunk, expectedCount);
    console.log(
      `[costar-parse] Summary: extracted ${summaryComps.length} comps` +
        (expectedCount ? ` (expected ${expectedCount})` : "")
    );

    // 2. Extract property details — one Claude call per batch of ~3 pages
    const allDetails: ClaudePropertyDetail[] = [];
    for (let i = 0; i < detailChunks.length; i++) {
      console.log(
        `[costar-parse] Detail chunk ${i + 1}/${detailChunks.length}...`
      );
      const details = await extractPropertyDetails(detailChunks[i]);
      allDetails.push(...details);
    }
    console.log(`[costar-parse] Details: extracted ${allDetails.length} sections`);

    // 3. Assemble into RentCompsData and return
    const result = assembleRentCompsData(summaryComps, allDetails, subjectName);
    return Response.json(result);
  } catch (err) {
    console.error("[costar-parse] error:", err);
    return Response.json({ error: "Parse failed" }, { status: 500 });
  }
}
