import { execSync } from "child_process";
import { writeFileSync, readFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { NextRequest, NextResponse } from "next/server";
import { parseCoStarPDF as parseWithAI } from "@/lib/costar-parser";
import { extractRentComps } from "@/lib/extractRentComps";
import type { RentCompRow, ExtractionResult } from "@/lib/extractRentComps";
import type { CompSummary, CompDetail, UnitTypeDetail, RentCompsData } from "@/lib/schemas";

// Allow up to 60s — two parallel Claude calls on a large PDF.
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// pdftotext extraction (regex path only)
// ---------------------------------------------------------------------------

function pdfToText(pdfBuffer: Buffer): string {
  const tmp = join(tmpdir(), `costar-${Date.now()}.pdf`);
  const out = tmp.replace(".pdf", ".txt");
  try {
    writeFileSync(tmp, pdfBuffer);
    execSync(`pdftotext -layout "${tmp}" "${out}"`);
    return readFileSync(out, "utf-8");
  } finally {
    try { unlinkSync(tmp); } catch {}
    try { unlinkSync(out); } catch {}
  }
}

const USE_REGEX_PARSER = process.env.USE_REGEX_PARSER === "true";

// ---------------------------------------------------------------------------
// Transform ExtractionResult → RentCompsData so the client stays unchanged
// ---------------------------------------------------------------------------

function parseBed(bed: string): number {
  if (/studio/i.test(bed)) return 0;
  const n = parseInt(bed, 10);
  return isNaN(n) ? 0 : n;
}

function parseVintage(vintage: string): number | null {
  const m = /(\d{4})/.exec(vintage);
  return m ? parseInt(m[1], 10) : null;
}

/** Weighted average of a numeric field, weighted by unit count. */
function weightedAvg(rows: RentCompRow[], getValue: (r: RentCompRow) => number): number | null {
  const totalUnits = rows.reduce((s, r) => s + r.units, 0);
  if (totalUnits === 0) return null;
  return rows.reduce((s, r) => s + getValue(r) * r.units, 0) / totalUnits;
}

function toRentCompsData(result: ExtractionResult): RentCompsData {
  const { subjectProperty, allRows } = result;

  // Unique property names in order of first appearance across all rows
  const propertyOrder: string[] = [];
  const seen = new Set<string>();
  for (const row of allRows) {
    if (!seen.has(row.propertyName)) {
      propertyOrder.push(row.propertyName);
      seen.add(row.propertyName);
    }
  }

  // Rows keyed by property name
  const rowsByProp = new Map<string, RentCompRow[]>();
  for (const row of allRows) {
    const arr = rowsByProp.get(row.propertyName) ?? [];
    arr.push(row);
    rowsByProp.set(row.propertyName, arr);
  }

  // Build CompDetail[] — one per property, unitTypes = one entry per floor-plan row
  const compDetails: CompDetail[] = propertyOrder.map((name) => {
    const rows = rowsByProp.get(name) ?? [];
    const yearBuilt = rows.length > 0 ? parseVintage(rows[0].vintage) : null;

    const unitTypes: UnitTypeDetail[] = rows.map((row) => ({
      bed: parseBed(row.bed),
      bath: row.bath,
      avgSF: row.avgSF,
      units: row.units,
      mixPct: row.mixPct,
      availableUnits: null,
      availabilityPct: null,
      askingRentPerUnit: row.askPerUnit,
      askingRentPerSF: row.askPerSF,
      effectiveRentPerUnit: row.effPerUnit,
      effectiveRentPerSF: row.effPerSF,
      concessionsPct: row.concessions,
      label: row.bed,           // e.g. "Studio", "1", "2"
    }));

    return {
      propertyName: name,
      isSubject: name === subjectProperty,
      unitTypes,
      yearBuilt,
      address: "",
    };
  });

  // Build CompSummary[] — one per property with aggregated rent metrics
  let nonSubjectRank = 1;
  const comps: CompSummary[] = propertyOrder.map((name) => {
    const rows = rowsByProp.get(name) ?? [];
    const isSubject = name === subjectProperty;

    const byBed = (bed: number) => rows.filter((r) => parseBed(r.bed) === bed);

    const totalUnits = rows.reduce((s, r) => s + r.units, 0);
    const yearBuilt = rows.length > 0 ? parseVintage(rows[0].vintage) : null;
    // CoStar rating is constant per property — take from first row
    const stars = rows.length > 0 ? rows[0].stars : null;

    return {
      rank: isSubject ? 0 : nonSubjectRank++,
      isSubject,
      name,
      address: "",
      city: "",
      state: "",
      yearBuilt,
      totalUnits: totalUnits || null,
      stories: null,
      avgUnitSF: weightedAvg(rows, (r) => r.avgSF),
      distanceToSubjectMiles: null,
      coStarRating: stars,
      studioAskingRent: weightedAvg(byBed(0), (r) => r.askPerUnit),
      oneBedAskingRent: weightedAvg(byBed(1), (r) => r.askPerUnit),
      twoBedAskingRent: weightedAvg(byBed(2), (r) => r.askPerUnit),
      threeBedAskingRent: weightedAvg(byBed(3), (r) => r.askPerUnit),
      rentPerSF: weightedAvg(rows, (r) => r.askPerSF),
      totalVacancyPct: null,
      totalAvailabilityPct: null,
      askingRentPerUnit: weightedAvg(rows, (r) => r.askPerUnit),
      askingRentPerSF: weightedAvg(rows, (r) => r.askPerSF),
      effectiveRentPerUnit: weightedAvg(rows, (r) => r.effPerUnit),
      effectiveRentPerSF: weightedAvg(rows, (r) => r.effPerSF),
      concessionsPct: weightedAvg(rows, (r) => r.concessions),
    };
  });

  const subjectDetail = compDetails.find((d) => d.isSubject) ?? null;

  return { subjectProperty: subjectDetail, comps, compDetails };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      pages?: string[];
      pdfBase64?: string;
      subjectName?: string;
    };

    if (!Array.isArray(body.pages) || body.pages.length === 0) {
      return NextResponse.json({ error: "pages array required" }, { status: 400 });
    }

    const pages = body.pages;
    const subjectName = body.subjectName ?? "";

    console.log(`[rentcomps/process] parser=${USE_REGEX_PARSER ? "regex" : "ai"} pages=${pages.length}`);

    let data: RentCompsData;

    if (USE_REGEX_PARSER) {
      if (!body.pdfBase64) {
        return NextResponse.json({ error: "pdfBase64 required for regex parser" }, { status: 400 });
      }
      const pdfBuffer = Buffer.from(body.pdfBase64, "base64");
      const pdfText = pdfToText(pdfBuffer);
      const extracted = extractRentComps(pdfText, { subjectProperty: subjectName });
      console.log(`[rentcomps/process] regex extracted ${extracted.allRows.length} rows across ${extracted.sections.length} properties, subject="${extracted.subjectProperty}"`);
      data = toRentCompsData(extracted);
    } else {
      data = await parseWithAI(pages);
    }

    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Processing failed";
    console.error("[rentcomps/process] error:", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
