/**
 * extractRentComps.ts
 *
 * Pure string/regex parser for CoStar Rent Comparables PDFs (Underwriting Report format).
 * Input: text from `pdftotext -layout` (layout-preserving plain text).
 * No AI/LLM dependencies.
 *
 * Document structure (per comparable property):
 *   {rank}  {address} - {property name}          ← block header
 *   ...property details (Year Built, etc.)...
 *   UNIT BREAKDOWN
 *   [column header: Bed  Bath  Avg SF  Units  Mix%  [Avail  Avail%]  Per Unit  Per SF  Per Unit  Per SF  Concessions]
 *   [data rows — indented, dollar amounts, percent concessions]
 *   Totals / All Studios / All 1 Beds ...         ← aggregate rows, skipped
 */

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/** One floor-plan row extracted from a CoStar UNIT BREAKDOWN block. */
export interface RentCompRow {
  propertyName: string;
  /** "Studio", "1", "2", "3", etc. */
  bed: string;
  bath: number;
  avgSF: number;
  units: number;
  /** Decimal fraction, e.g. 0.061 for 6.1% */
  mixPct: number;
  askPerUnit: number;
  askPerSF: number;
  effPerUnit: number;
  effPerSF: number;
  /** Decimal fraction, e.g. 0.01 for 1.0% */
  concessions: number;
  /** Year built string, e.g. "1967" or "1986 (2006)" */
  vintage: string;
  /** CoStar star rating; 0 when not available in this report section */
  stars: number;
}

/** All rows for one comparable property. */
export interface RentCompSection {
  /** Property name used as the section label */
  bedroomType: string;
  rows: RentCompRow[];
}

/** Full extraction result for one CoStar underwriting report. */
export interface ExtractionResult {
  /** Name of the subject property. */
  subjectProperty: string;
  /** One section per property (subject first when present). */
  sections: RentCompSection[];
  /** All rows flattened across all sections. */
  allRows: RentCompRow[];
}

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

/**
 * Property block header: rank number + 2+ spaces + address + " - " + property name.
 * e.g. "13    8200 Wisconsin Ave - Eighty Two Hundred"
 */
const PROP_HEADER_RE = /^(\d+)\s{2,}(.+?)\s+-\s+(.+)$/;

/**
 * Year Built line in property details.
 * Handles "Year Built: 1967", "Year Built: Oct 2024", "Year Built: 1986 Renov Apr 2006".
 */
const YEAR_BUILT_RE = /Year\s+Built:\s+(?:[A-Za-z]+\s+)?(\d{4})(?:\s+Renov(?:\.?)?\s+(?:[A-Za-z]+\s+)?(\d{4}))?/i;

/** Marks the start of the unit breakdown table. */
const UNIT_BREAKDOWN_RE = /^\s*UNIT\s+BREAKDOWN\s*$/i;

/** Column header line — has "Bed" and "Bath" and "Avg SF" together. */
const COLUMN_HEADER_RE = /\bBed\b.*\bBath\b.*Avg\s+SF|\bAvg\s+SF\b.*\bBed\b/i;

/** Sub-header lines between the two column header rows. */
const SUB_HEADER_RE = /unit\s+mix|availability|avg\s+(asking|effective)\s+rent/i;

/** Aggregate / totals rows to skip. */
const TOTALS_RE = /^\s*(Totals|All\s+(Studios?|\d+\s+Beds?))\b/i;

/** Non-data section keywords that signal the end of a UNIT BREAKDOWN block. */
const SECTION_END_RE = /^\s*(SITE\s+AMENITIES|UNIT\s+AMENITIES|RECURRING\s+EXPENSES|ONE\s+TIME\s+EXPENSES|PET\s+POLICY|PARKING|©|Page\s+\d)/i;

/**
 * Data row pattern.
 * Groups:
 *   1  bed (Studio | digit)
 *   2  bath
 *   3  avgSF (may contain commas)
 *   4  units
 *   5  mixPct%
 *   6  availUnits  (optional, digit or "-")
 *   7  availPct%   (optional, "N.N%" or "-")
 *   8  askPerUnit  ($N,NNN)
 *   9  askPerSF    ($N.NN)
 *   10 effPerUnit  ($N,NNN)
 *   11 effPerSF    ($N.NN)
 *   12 concessions%
 */
const UNIT_ROW_RE =
  /^\s+(Studio|\d+)\s+(\d+(?:\.\d+)?)\s+([\d,]+)\s+(\d+)\s+([\d.]+%)\s+(?:(\d+|-)\s+([\d.]+%|-)?\s+)?\$([\d,]+)\s+\$([\d.]+)\s+\$([\d,]+)\s+\$([\d.]+)\s+([\d.]+%)/i;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cleanMoney(s: string): number {
  return parseFloat(s.replace(/[$,]/g, ""));
}

function cleanPct(s: string): number {
  return parseFloat(s.replace("%", "")) / 100;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extracts all unit-level rent comp rows from a CoStar underwriting report PDF.
 *
 * @param pdfText  Full text from `pdftotext -layout`.
 * @param options.subjectProperty  Optional name of the subject property.
 *   Used as a fallback when the subject's UNIT BREAKDOWN block has no rank-based header.
 */
export function extractRentComps(
  pdfText: string,
  options?: { subjectProperty?: string }
): ExtractionResult {
  const lines = pdfText.split(/\r?\n/);
  const allRows: RentCompRow[] = [];
  // Preserve insertion order; skip duplicate blocks for the same property
  const seen = new Set<string>();

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (!UNIT_BREAKDOWN_RE.test(line)) {
      i++;
      continue;
    }

    // ── Found "UNIT BREAKDOWN" ─────────────────────────────────────────────
    // Scan backwards for property header and year built
    let propName = "";
    let vintage = "";

    for (let j = i - 1; j >= Math.max(0, i - 50); j--) {
      const back = lines[j];

      // Capture Year Built the first time we see it
      if (!vintage) {
        const ym = YEAR_BUILT_RE.exec(back);
        if (ym) {
          vintage = ym[2] ? `${ym[1]} (${ym[2]})` : ym[1];
        }
      }

      // Stop at a ranked property header
      if (!propName) {
        const hm = PROP_HEADER_RE.exec(back);
        if (hm) {
          propName = hm[3].trim();
          break;
        }
      }

      // Subject property has no rank — detect via "Subject Property" label
      if (!propName && /subject\s+property/i.test(back)) {
        propName = options?.subjectProperty?.trim() || "Subject Property";
        break;
      }
    }

    // Fallback: use the provided subject name if nothing else matched
    if (!propName) {
      propName = options?.subjectProperty?.trim() || "";
    }

    if (!propName || seen.has(propName)) {
      i++;
      continue;
    }

    // ── Skip column header lines ───────────────────────────────────────────
    i++; // move past "UNIT BREAKDOWN"
    while (
      i < lines.length &&
      (COLUMN_HEADER_RE.test(lines[i]) ||
        SUB_HEADER_RE.test(lines[i]) ||
        lines[i].trim() === "")
    ) {
      i++;
    }

    // ── Parse data rows ────────────────────────────────────────────────────
    const blockRows: RentCompRow[] = [];
    while (i < lines.length) {
      const dl = lines[i];

      // End of block: next property header or section keyword
      if (PROP_HEADER_RE.test(dl)) break;
      if (UNIT_BREAKDOWN_RE.test(dl)) break;
      if (SECTION_END_RE.test(dl)) break;

      // Skip aggregate rows
      if (TOTALS_RE.test(dl)) {
        i++;
        continue;
      }

      const m = UNIT_ROW_RE.exec(dl);
      if (m) {
        const bedRaw = m[1];
        blockRows.push({
          propertyName: propName,
          bed: /studio/i.test(bedRaw) ? "Studio" : bedRaw,
          bath: parseFloat(m[2]),
          avgSF: parseInt(m[3].replace(/,/g, ""), 10),
          units: parseInt(m[4], 10),
          mixPct: cleanPct(m[5]),
          askPerUnit: cleanMoney(m[8]),
          askPerSF: cleanMoney(m[9]),
          effPerUnit: cleanMoney(m[10]),
          effPerSF: cleanMoney(m[11]),
          concessions: cleanPct(m[12]),
          vintage,
          stars: 0,
        });
      }

      i++;
    }

    if (blockRows.length > 0) {
      seen.add(propName);
      allRows.push(...blockRows);
    }
  }

  // ── Build sections (one per property) ──────────────────────────────────
  const propOrder: string[] = [];
  const rowsByProp = new Map<string, RentCompRow[]>();
  for (const row of allRows) {
    if (!rowsByProp.has(row.propertyName)) {
      propOrder.push(row.propertyName);
      rowsByProp.set(row.propertyName, []);
    }
    rowsByProp.get(row.propertyName)!.push(row);
  }

  const sections: RentCompSection[] = propOrder.map((name) => ({
    bedroomType: name,
    rows: rowsByProp.get(name)!,
  }));

  // ── Subject property detection ──────────────────────────────────────────
  let subjectProperty = options?.subjectProperty?.trim() ?? "";
  if (!subjectProperty && propOrder.length > 0) {
    subjectProperty = propOrder[0];
  }

  return { subjectProperty, sections, allRows };
}
