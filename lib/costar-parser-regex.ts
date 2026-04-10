/**
 * Pure regex parser for CoStar Underwriting Report PDFs.
 *
 * Drop-in alternative to the AI parser. Takes the same inputs and returns
 * the same RentCompsData type. No Claude / network calls — fully offline.
 *
 * PDF format (Elme Bethesda Costar.pdf):
 *
 *   SUMMARY TABLE  (pages "Rent Comparables Summary" × 2)
 *   ─────────────────────────────────────────────────────
 *   Page A — bedroom rents, one row per comp:
 *     Sophia Bethesda                              ← property name (standalone line)
 *     1 - 2024 276 909 $2,432 $3,030 $4,560 $8,440 $4.50
 *       │   │    │   │   studio  1br   2br   3br  rent/SF
 *       rank yr  units avgSF
 *     4924 Saint Elmo                              ← address
 *
 *   Page B — vacancy / asking / effective, one row per comp:
 *     Sophia Bethesda
 *     1 276 61 22.1% 59 21.4% $4,089 $4.50 $4,016 $4.42 1.8%
 *     4924 Saint Elmo
 *
 *   DETAIL SECTIONS  (one per comp, after "Photo Comparison")
 *   ───────────────────────────────────────────────────────────
 *   Rent Comparables
 *   5114 Dudley Ln - Elme Bethesda            ← repeated subject header on every detail page
 *   4924 Saint Elmo - Sophia Bethesda         ← {address} - {property name}
 *   1                                          ← rank
 *   Bethesda, Maryland - Woodmont Triangle…   ← city, state
 *   PROPERTY ...
 *   Property Size: 276 Units, 22 Floors
 *   Avg. Unit Size: 909 SF
 *   Year Built: Oct 2024
 *   Distance to Subject: 1.86 Miles
 *   ...
 *   UNIT BREAKDOWN
 *   Studio 1 484 2 0.7% 0 0.0% $2,290 $4.73 $2,249 $4.65 1.8%
 *   ...
 *   All Studios 516 23 8.3% 1 4.4% $2,432 $4.72 $2,389 $4.63 1.8%
 *   Totals 909 276 100% 59 21.4% $4,089 $4.50 $4,016 $4.42 1.8%
 *
 * Input: pages[] — raw text strings from extract-pdf-client.ts (one entry per PDF page)
 * Output: RentCompsData
 */

import type { CompSummary, CompDetail, UnitTypeDetail, RentCompsData } from "./schemas";

// ─── Primitive parsers ────────────────────────────────────────────────────────

function num(s: string): number | null {
  if (!s || /^-+$/.test(s.trim())) return null;
  const n = parseFloat(s.replace(/[$,%]/g, "").replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

function money(s: string): number | null {
  if (!s || /^-+$/.test(s.trim())) return null;
  const n = parseFloat(s.replace(/[$,]/g, ""));
  return isNaN(n) ? null : n;
}

function pct(s: string): number | null {
  if (!s || /^-+$/.test(s.trim())) return null;
  const n = parseFloat(s.replace(/%/g, ""));
  return isNaN(n) ? null : n;
}

function yr(s: string): number | null {
  const m = s.match(/\b(\d{4})\b/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  return y >= 1900 && y <= 2050 ? y : null;
}

// ─── Line classification helpers ──────────────────────────────────────────────

function isStreetAddress(line: string): boolean {
  return /^\d{2,6}\s+[A-Za-z]/.test(line.trim());
}

function looksLikeName(line: string): boolean {
  const t = line.trim();
  if (!t || t.length < 3) return false;
  if (isStreetAddress(t)) return false;
  if (/^\d+$/.test(t)) return false;
  if (/\$/.test(t)) return false;
  if (/^\d{4}$/.test(t)) return false;
  if (/^[-★⭐]+$/.test(t)) return false;
  if (!/[A-Za-z]/.test(t)) return false;
  if (
    /^(PROPERTY|UNIT|Bed|Bath|CoStar|Page|No\.|Rating|Yr Built|Property Size|Year Built|Avg\.|Type:|Rent Type:|Parking:|Distance|Vacancy|OWNER|MANAGER|Construction|Subject|Photo|Comparables Summary|Rent Comps|Score)/i.test(
      t
    )
  )
    return false;
  return true;
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface SummaryRow {
  rank: number;
  rawName: string;
  rawAddress: string;
  yearBuilt: number | null;
  totalUnits: number | null;
  avgUnitSF: number | null;
  studioRent: number | null;
  oneBedRent: number | null;
  twoBedRent: number | null;
  threeBedRent: number | null;
  rentPerSF: number | null;
}

interface VacancyRow {
  rank: number;
  totalUnits: number | null;
  vacancyUnits: number | null;
  vacancyPct: number | null;
  availabilityUnits: number | null;
  availabilityPct: number | null;
  askingRentPerUnit: number | null;
  askingRentPerSF: number | null;
  effectiveRentPerUnit: number | null;
  effectiveRentPerSF: number | null;
  concessionsPct: number | null;
}

interface PropertySection {
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
  summaryRows: UnitTypeDetail[];
  totalsRow: UnitTypeDetail | null;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Parse pages of CoStar PDF text (as produced by extract-pdf-client.ts) into
 * structured RentCompsData. Pure regex — no network calls.
 *
 * @param pages   Array of page text strings, one per PDF page.
 * @param subjectName  Display name of the subject property (used to identify it).
 */
export function parseCoStarPDF(pages: string[], subjectName: string): RentCompsData {
  const fullText = pages.join("\n");

  const summaryRows = parseSummaryTable(fullText);
  const vacancyRows = parseVacancyTable(fullText);
  const sections = parseDetailSections(fullText);

  return assembleData(summaryRows, vacancyRows, sections, subjectName);
}

// ─── 1. Rent Comparables Summary — bedroom-rent table ────────────────────────
//
// Format:  "1 - 2024 276 909 $2,432 $3,030 $4,560 $8,440 $4.50"
//   (or multi-line with rank on its own line and data line before/after)
//
// Strategy: scan for lines matching the inline "rank - year units avgSF ..." pattern
// first; then fall back to standalone-rank detection for PDFs with split lines.
function parseSummaryTable(fullText: string): SummaryRow[] {
  // Anchor: find "Rent Comparables Summary" sections that contain bedroom-rent data.
  // The first such section has bedroom rents (Studio/$X, $Y/SF columns).
  const SECTION_START_RE = /Rent Comparables Summary/g;

  // Find the section that has bedroom rent data (contains $X.XX rent/SF column
  // and at least one "- 2024" or "- 20XX" comp row).
  let sectionStart = -1;
  let m: RegExpExecArray | null;
  while ((m = SECTION_START_RE.exec(fullText)) !== null) {
    const slice = fullText.slice(m.index, m.index + 5000);
    // Bedroom-rent summary has inline "rank - year" rows with ≥3 $ amounts
    if (/\d{1,2}\s+-\s+(?:19|20)\d{2}\s+\d{2,4}\s+[\d,]+\s+\$/.test(slice)) {
      sectionStart = m.index;
      break;
    }
    // Fallback: any section with standalone rank lines AND dollar rent/SF
    if (/^\d{1,2}$/m.test(slice) && /\$\d+\.\d{2}/.test(slice)) {
      sectionStart = m.index;
      break;
    }
  }

  if (sectionStart === -1) {
    console.warn("[costar-parser-regex] Could not find summary table.");
    return [];
  }

  // Section ends before "Photo Comparison" or the next major header
  const sectionEnd = findSectionEnd(fullText, sectionStart + 500, [
    "Photo Comparison",
    "Rent Comparables Details",
    "Unit Mix Summary",
  ]);
  const section = fullText.slice(sectionStart, sectionEnd);
  const lines = section.split("\n");

  const rows: SummaryRow[] = [];
  const seenRanks = new Set<number>();

  // Pattern A: inline "rank - year units avgSF $studio $1br $2br $3br $rent/SF"
  const INLINE_RE =
    /^(\d{1,2})\s+-\s+((?:19|20)\d{2})\s+([\d,]+)\s+([\d,]+)\s+((?:\$[\d,]+|-)\s+)*((?:\$[\d,]+|-)\s+)*\$(\d{1,2}\.\d{2})$/;

  // Simpler inline detector: starts with rank, has "- year", contains $X.XX at end
  const INLINE_DETECT = /^(\d{1,2})\s+-\s+((?:19|20)\d{2})\s+/;
  const HAS_RENT_SF = /\$\d{1,2}\.\d{2}$/;
  const HAS_DOLLAR = /\$/;

  // Pattern B: standalone rank line (line is just "3")
  const STANDALONE_RANK = /^(\d{1,2})$/;
  const STANDALONE_YEAR = /^((?:19|20)\d{2})$/;
  const DATA_LINE = /\$\d+\.\d{2}/; // has $X.XX = rentPerSF marker

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // ── Pattern A: inline rank+year+data on one line ──────────────────
    const inlineM = INLINE_DETECT.exec(line);
    if (inlineM && HAS_DOLLAR.test(line)) {
      const rank = parseInt(inlineM[1], 10);
      if (rank >= 1 && rank <= 99 && !seenRanks.has(rank)) {
        const yearBuilt = parseInt(inlineM[2], 10);
        // Strip "rank - year " prefix to get the data portion
        const dataPart = line.replace(/^\d{1,2}\s+-\s+\d{4}\s+/, "").trim();
        const parsed = parseRentDataSegment(dataPart);
        if (parsed) {
          const rawName = i > 0 ? lines[i - 1].trim() : "";
          const rawAddress = i + 1 < lines.length ? lines[i + 1].trim() : "";
          seenRanks.add(rank);
          rows.push({
            rank, rawName, rawAddress, yearBuilt,
            totalUnits: parsed.units,
            avgUnitSF: parsed.avgSF,
            studioRent: parsed.rents[0] ?? null,
            oneBedRent: parsed.rents[1] ?? null,
            twoBedRent: parsed.rents[2] ?? null,
            threeBedRent: parsed.rents[3] ?? null,
            rentPerSF: parsed.rentPerSF,
          });
          continue;
        }
      }
    }

    // ── Pattern B: standalone rank line ──────────────────────────────
    const standaloneM = STANDALONE_RANK.exec(line);
    if (!standaloneM) continue;
    const rank = parseInt(standaloneM[1], 10);
    if (rank < 1 || rank > 99 || seenRanks.has(rank)) continue;

    // Find data line: scan backward then forward for a line with $X.XX
    let dataLine: string | null = null;
    let dataLineIdx = i;
    let yearBuilt: number | null = null;

    for (let j = i - 1; j >= Math.max(0, i - 8); j--) {
      const jl = lines[j].trim();
      if (STANDALONE_RANK.test(jl) && parseInt(jl, 10) !== rank) break;
      if (DATA_LINE.test(jl) && (jl.match(/\$/g) ?? []).length >= 2) {
        dataLine = jl;
        dataLineIdx = j;
        break;
      }
    }

    for (let j = i + 1; j < Math.min(lines.length, i + 12); j++) {
      const jl = lines[j].trim();
      if (STANDALONE_RANK.test(jl) && parseInt(jl, 10) !== rank) break;
      if (!yearBuilt && STANDALONE_YEAR.test(jl)) yearBuilt = parseInt(jl, 10);
      if (!dataLine && DATA_LINE.test(jl) && (jl.match(/\$/g) ?? []).length >= 2) {
        dataLine = jl;
        dataLineIdx = j;
      }
    }

    if (!dataLine) continue;

    const parsed = parseRentDataSegment(dataLine);
    if (!parsed) continue;
    if (parsed.units !== null && parsed.units < 5) continue;

    const rawName = i > 0 ? lines[i - 1].trim() : "";
    const rawAddress = dataLineIdx + 1 < lines.length ? lines[dataLineIdx + 1].trim() : "";

    seenRanks.add(rank);
    rows.push({
      rank, rawName, rawAddress, yearBuilt,
      totalUnits: parsed.units,
      avgUnitSF: parsed.avgSF,
      studioRent: parsed.rents[0] ?? null,
      oneBedRent: parsed.rents[1] ?? null,
      twoBedRent: parsed.rents[2] ?? null,
      threeBedRent: parsed.rents[3] ?? null,
      rentPerSF: parsed.rentPerSF,
    });
  }

  rows.sort((a, b) => a.rank - b.rank);
  return rows;
}

/**
 * Parse the data segment of a summary row (after stripping "rank - year ").
 * Handles both space-separated and concatenated formats.
 *
 * Input examples:
 *   "276 909 $2,432 $3,030 $4,560 $8,440 $4.50"   (space-sep)
 *   "276909$2,432$3,030$4,560$8,440$4.50"           (concatenated)
 *   "167 774 $2,117 $2,484 $3,731 - $3.99"          (with null bedroom)
 */
function parseRentDataSegment(seg: string): {
  units: number | null;
  avgSF: number | null;
  rents: Array<number | null>;
  rentPerSF: number | null;
} | null {
  const firstDollar = seg.indexOf("$");
  if (firstDollar === -1) return null;

  const prefix = seg.slice(0, firstDollar).trim();
  const afterPrefix = seg.slice(firstDollar);

  // Collect rent tokens: $X,XXX amounts and dashes (missing bedroom)
  const tokenRe = /\$[\d,]+(?:\.\d+)?|-(?=\s*\$)/g;
  const tokens: Array<{ value: number | null; isPerSF: boolean }> = [];
  let tm: RegExpExecArray | null;
  while ((tm = tokenRe.exec(afterPrefix)) !== null) {
    const tok = tm[0];
    if (tok.startsWith("$")) {
      const v = parseFloat(tok.replace(/[$,]/g, ""));
      const isPerSF = /^\$\d{1,2}\.\d{2}$/.test(tok) && v < 50;
      tokens.push({ value: v, isPerSF });
    } else {
      tokens.push({ value: null, isPerSF: false });
    }
  }
  if (tokens.length < 2) return null;

  // Last isPerSF token = rentPerSF; the rest = bedroom rents
  let rentPerSF: number | null = null;
  const rentTokens: Array<number | null> = [];
  let lastPerSFIdx = -1;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (tokens[i].isPerSF) { lastPerSFIdx = i; break; }
  }
  for (let i = 0; i < tokens.length; i++) {
    if (i === lastPerSFIdx) rentPerSF = tokens[i].value;
    else rentTokens.push(tokens[i].value);
  }

  // Parse prefix for units + avgSF
  let units: number | null = null;
  let avgSF: number | null = null;

  const spaceParts = prefix.split(/\s+/).filter(Boolean);
  if (spaceParts.length >= 2) {
    const u = parseInt(spaceParts[0].replace(/,/g, ""), 10);
    const sf = parseInt(spaceParts[1].replace(/,/g, ""), 10);
    if (!isNaN(u) && !isNaN(sf) && u >= 5 && u <= 10000 && sf >= 200 && sf <= 5000) {
      units = u; avgSF = sf;
    }
  }

  if (units === null && prefix && /^[\d,]+$/.test(prefix)) {
    const split = splitUnitsAvgSF(prefix);
    units = split.units; avgSF = split.avgSF;
  }

  return { units, avgSF, rents: rentTokens, rentPerSF };
}

/** Split concatenated "units+avgSF" like "276909" or "2201,156". */
function splitUnitsAvgSF(s: string): { units: number | null; avgSF: number | null } {
  const raw = s.trim();
  if (raw.includes(",")) {
    const commaIdx = raw.indexOf(",");
    const beforeComma = raw.slice(0, commaIdx);
    const afterComma = raw.slice(commaIdx + 1);
    const avgSFThousands = beforeComma.slice(-1);
    const unitsStr = beforeComma.slice(0, -1);
    const u = parseInt(unitsStr, 10);
    const sf = parseInt(avgSFThousands + afterComma, 10);
    if (!isNaN(u) && !isNaN(sf) && u >= 5 && sf >= 200) return { units: u, avgSF: sf };
  }
  const clean = raw.replace(/,/g, "");
  if (!/^\d+$/.test(clean)) return { units: null, avgSF: null };
  if (clean.length >= 4) {
    const last3 = parseInt(clean.slice(-3), 10);
    const u3 = parseInt(clean.slice(0, -3), 10);
    if (last3 >= 400 && last3 <= 999 && u3 >= 5 && u3 <= 10000) return { units: u3, avgSF: last3 };
  }
  if (clean.length >= 5) {
    const last4 = parseInt(clean.slice(-4), 10);
    const u4 = parseInt(clean.slice(0, -4), 10);
    if (last4 >= 1000 && last4 <= 2500 && u4 >= 5 && u4 <= 10000) return { units: u4, avgSF: last4 };
  }
  return { units: null, avgSF: null };
}

// ─── 2. Rent Comparables Summary — vacancy/asking-rent table ─────────────────
//
// Format per row:  "rank units vacUnits vac% availUnits avail% $asking $ask/SF $eff $eff/SF conc%"
// Example:  "1 276 61 22.1% 59 21.4% $4,089 $4.50 $4,016 $4.42 1.8%"
//
// This table appears on the SECOND "Rent Comparables Summary" page.
function parseVacancyTable(fullText: string): VacancyRow[] {
  // Find sections that look like vacancy rows (have NN% $X,XXX $X.XX patterns)
  const VAC_LINE =
    /^(\d{1,2})\s+(\d{1,4})\s+(\d{1,4})\s+([\d.]+)%\s+(\d{1,4})\s+([\d.]+)%\s+\$([\d,]+)\s+\$([\d.]+)\s+\$([\d,]+)\s+\$([\d.]+)\s+([\d.]+)%$/;

  const rows: VacancyRow[] = [];
  const seenRanks = new Set<number>();
  const lines = fullText.split("\n");

  // Only parse within "Rent Comparables Summary" sections
  const SECTION_RE = /Rent Comparables Summary/g;
  const sectionStarts: number[] = [];
  let sm: RegExpExecArray | null;
  while ((sm = SECTION_RE.exec(fullText)) !== null) sectionStarts.push(sm.index);

  for (const start of sectionStarts) {
    const end = findSectionEnd(fullText, start + 500, [
      "Photo Comparison",
      "Rent Comparables Details",
    ]);
    const sectionText = fullText.slice(start, end);
    const sectionLines = sectionText.split("\n");

    for (const line of sectionLines) {
      const t = line.trim();
      const m = VAC_LINE.exec(t);
      if (!m) continue;
      const rank = parseInt(m[1], 10);
      if (rank < 1 || rank > 99 || seenRanks.has(rank)) continue;
      seenRanks.add(rank);
      rows.push({
        rank,
        totalUnits: num(m[2]),
        vacancyUnits: num(m[3]),
        vacancyPct: pct(m[4]),
        availabilityUnits: num(m[5]),
        availabilityPct: pct(m[6]),
        askingRentPerUnit: money(m[7]),
        askingRentPerSF: num(m[8]),
        effectiveRentPerUnit: money(m[9]),
        effectiveRentPerSF: num(m[10]),
        concessionsPct: pct(m[11]),
      });
    }
  }

  rows.sort((a, b) => a.rank - b.rank);
  return rows;
}

// ─── 3. Detail sections ───────────────────────────────────────────────────────
//
// Each comp detail page opens with the repeated "Rent Comparables\n{subject header}\n"
// anchor pattern. We detect this anchor dynamically and split on it.
function parseDetailSections(fullText: string): PropertySection[] {
  const anchor = detectAnchor(fullText);
  if (!anchor) return parseDetailSectionsFallback(fullText);

  const parts = fullText.split(anchor);
  console.log("[costar-parser-regex] anchor split →", parts.length, "parts");

  const sections: PropertySection[] = [];

  // parts[0] contains everything before first comp detail (includes subject section)
  sections.push(...parseDetailSectionsFallback(parts[0]));

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    const lines = part.split("\n");

    // Line 0: rank number
    if (!/^\d{1,2}$/.test((lines[0] ?? "").trim())) continue;

    // Line 1: "{address} - {property name}"
    const addrNameLine = (lines[1] ?? "").trim();
    const addrNameM = addrNameLine.match(/^(.+?)\s+-\s+(.+)$/);
    const address = addrNameM ? addrNameM[1].trim() : (addrNameLine || null);
    const propertyName = addrNameM ? addrNameM[2].trim() : "";

    // Line 2: "{city}, {State}"
    const cityStateLine = (lines[2] ?? "").trim();
    const cityStateM = cityStateLine.match(/^([A-Za-z][A-Za-z ]*),\s*([A-Za-z]+)/);
    const city = cityStateM ? cityStateM[1].trim() : null;
    const state = cityStateM ? cityStateM[2].trim() : null;

    const ubMatch = part.match(/UNIT\s+BREAKDOWN/i);
    const ubIdx = ubMatch ? part.indexOf(ubMatch[0]) : -1;
    const headerText = ubIdx !== -1 ? part.slice(0, ubIdx) : part;
    const bodyText = ubIdx !== -1 ? part.slice(ubIdx + ubMatch![0].length) : "";

    const sizeM = headerText.match(/Property Size:\s*([\d,]+)\s*Units?,\s*(\d+)\s*Floors?/i);
    const totalUnits = sizeM ? num(sizeM[1]) : null;
    const stories = sizeM ? num(sizeM[2]) : null;

    const yrM = headerText.match(/Year Built:\s*([A-Za-z]+ \d{4}|\d{4})/i);
    const yearBuilt = yrM ? yr(yrM[1]) : null;

    const sfM = headerText.match(/Avg\.\s*Unit Size:\s*([\d,]+)\s*SF/i);
    const avgUnitSF = sfM ? num(sfM[1]) : null;

    const distM = headerText.match(/Distance to Subject:?\s*([\d.]+)\s*Miles?/i);
    const distanceMiles = distM ? num(distM[1]) : null;

    const coStarRating = extractRating(headerText);

    const hasRows =
      /\$[\d,]+\s+\$\d+\.\d{2}/.test(bodyText) ||
      /\$[\d,]+\$\d+\.\d{2}/.test(bodyText) ||
      /All\s+(?:Studios?|1\s*Beds?|2\s*Beds?|3\s*Beds?)/i.test(bodyText);
    if (!hasRows && !totalUnits) continue;

    const { unitTypes, summaryRows, totalsRow } = parseUnitMixLines(bodyText.split("\n"));

    sections.push({
      propertyName: propertyName || `Comp ${lines[0].trim()}`,
      address, city, state,
      yearBuilt, totalUnits, stories, avgUnitSF, distanceMiles, coStarRating,
      unitTypes, summaryRows, totalsRow,
    });
  }

  return sections;
}

/** Find the most-repeated "Rent Comparables\n{header}\n" anchor (≥2 hits). */
function detectAnchor(fullText: string): string | null {
  const RE = /Rent Comparables\n([^\n]+)\n/g;
  const counts = new Map<string, number>();
  let m: RegExpExecArray | null;
  while ((m = RE.exec(fullText)) !== null) {
    const c = `Rent Comparables\n${m[1]}\n`;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let best = "";
  let bestCount = 0;
  for (const [a, n] of counts) {
    if (n > bestCount) { best = a; bestCount = n; }
  }
  return bestCount >= 2 ? best : null;
}

/** Fallback: split on UNIT BREAKDOWN headers when no anchor is found. */
function parseDetailSectionsFallback(text: string): PropertySection[] {
  const normalised = text.replace(/UNIT\s+BREAKDOWN/gi, "§UB§");
  const parts = normalised.split("§UB§");
  const sections: PropertySection[] = [];
  for (let i = 0; i < parts.length - 1; i++) {
    const headerText = parts[i];
    const bodyText = parts[i + 1];
    const hasRows =
      /\$[\d,]+\s+\$\d+\.\d{2}/.test(bodyText) ||
      /\$[\d,]+\$\d+\.\d{2}/.test(bodyText) ||
      /All\s+(?:Studios?|1\s*Beds?|2\s*Beds?|3\s*Beds?)/i.test(bodyText);
    if (!hasRows) continue;
    const sec = parseOneSection(headerText, bodyText);
    if (sec) sections.push(sec);
  }
  return sections;
}

function parseOneSection(headerText: string, bodyText: string): PropertySection | null {
  const headerLines = headerText.split("\n").slice(-120);
  const h = headerLines.join("\n");

  const sizeM = h.match(/Property Size:\s*([\d,]+)\s*Units?,\s*(\d+)\s*Floors?/i);
  const totalUnits = sizeM ? num(sizeM[1]) : null;
  const stories = sizeM ? num(sizeM[2]) : null;

  const yrM = h.match(/Year Built:\s*([A-Za-z]+ \d{4}|\d{4})/i);
  const yearBuilt = yrM ? yr(yrM[1]) : null;

  const sfM = h.match(/Avg\.\s*Unit Size:\s*([\d,]+)\s*SF/i);
  const avgUnitSF = sfM ? num(sfM[1]) : null;

  const distM = h.match(/Distance to Subject:?\s*([\d.]+)\s*Miles?/i);
  const distanceMiles = distM ? num(distM[1]) : null;

  const coStarRating = extractRating(h);

  let propertyName = "";
  let address: string | null = null;
  let city: string | null = null;
  let state: string | null = null;

  const addrNameM = h.match(/(\d+[^-\n]+?)\s+-\s+([A-Za-z][^\n-]{3,60}?)(?:\n|$)/);
  if (addrNameM) {
    address = addrNameM[1].trim();
    propertyName = addrNameM[2].trim();
  }

  if (!propertyName) {
    const detailLine = headerLines.findIndex((l) =>
      /Property Size:|Year Built:|Avg\. Unit Size:/i.test(l)
    );
    const nameSearchLines =
      detailLine > 0
        ? headerLines.slice(Math.max(0, detailLine - 25), detailLine)
        : headerLines.slice(-25);

    for (let i = nameSearchLines.length - 1; i >= 0; i--) {
      const line = nameSearchLines[i].trim();
      if (!line) continue;
      if (!city && /^[A-Za-z ]+,\s*[A-Z]{2}\b/.test(line)) {
        const csm = line.match(/^([A-Za-z ]+),\s*([A-Z]{2})/);
        if (csm) { city = csm[1].trim(); state = csm[2]; continue; }
      }
      if (!address && isStreetAddress(line)) { address = line; continue; }
      if (!propertyName && looksLikeName(line)) {
        const embedded = line.match(/^\d+\S*\s+.*?\s+-\s+(.+)$/);
        if (embedded) {
          propertyName = embedded[1].trim();
          if (!address) address = line.split(" - ")[0].trim();
        } else {
          propertyName = line;
        }
        break;
      }
    }
  }

  if (!propertyName) {
    if (totalUnits) propertyName = `Unknown (${totalUnits} units)`;
    else return null;
  }

  const { unitTypes, summaryRows, totalsRow } = parseUnitMixLines(bodyText.split("\n"));
  return {
    propertyName, address, city, state,
    yearBuilt, totalUnits, stories, avgUnitSF, distanceMiles, coStarRating,
    unitTypes, summaryRows, totalsRow,
  };
}

function extractRating(text: string): number | null {
  const m =
    text.match(/\b([\d.]+)\s*Stars?\b/i) ||
    text.match(/Rating:\s*([\d.]+)/i) ||
    text.match(/(★+)/);
  if (!m) return null;
  if (/\d/.test(m[1])) return num(m[1]);
  return (m[1].match(/★/g) ?? []).length || null;
}

// ─── 4. Unit mix lines ────────────────────────────────────────────────────────
//
// Space-separated (PDF.js — primary):
//   Individual: "Studio 1 484 2 0.7% 0 0.0% $2,290 $4.73 $2,249 $4.65 1.8%"
//   Summary:    "All Studios 516 23 8.3% 1 4.4% $2,432 $4.72 $2,389 $4.63 1.8%"
//   Totals:     "Totals 909 276 100% 59 21.4% $4,089 $4.50 $4,016 $4.42 1.8%"
//
// Concatenated (pdf-parse — fallback):
//   Individual: "Studio148420.7%00.0%$2,290$4.73$2,249$4.651.8%"
function parseUnitMixLines(lines: string[]): {
  unitTypes: UnitTypeDetail[];
  summaryRows: UnitTypeDetail[];
  totalsRow: UnitTypeDetail | null;
} {
  const unitTypes: UnitTypeDetail[] = [];
  const summaryRows: UnitTypeDetail[] = [];
  let totalsRow: UnitTypeDetail | null = null;

  // Space-separated regexes
  const UNIT_ROW =
    /^(Studio|\d)\s+(\d)\s+([\d,]+)\s+(\d+)\s+([\d.]+)%\s+(\d+)\s+([\d.]+|100)%\s+\$([\d,]+)\s+\$([\d.]+)\s+\$([\d,]+)\s+\$([\d.]+)\s+([\d.]+)%/;

  const SUMMARY_ROW =
    /^(All\s+Studios?|All\s+1\s*Beds?|All\s+2\s*Beds?|All\s+3\s*Beds?|All\s+One\s*Beds?|All\s+Two\s*Beds?|All\s+Three\s*Beds?)\s+([\d,]+)\s+(\d+)\s+([\d.]+|100)%\s+(\d+)\s+([\d.]+|100)%\s+\$([\d,]+)\s+\$([\d.]+)\s+\$([\d,]+)\s+\$([\d.]+)\s+([\d.]+)%/i;

  const TOTALS_ROW =
    /^Totals?\s+([\d,]+)\s+(\d+)\s+([\d.]+|100)%\s+(\d+)\s+([\d.]+|100)%\s+\$([\d,]+)\s+\$([\d.]+)\s+\$([\d,]+)\s+\$([\d.]+)\s+([\d.]+)%/i;

  // Concatenated regexes (fallback)
  const SF = String.raw`(\d{3,4}|\d,\d{3})`;
  const UNIT_CONCAT = new RegExp(
    `^(Studio|\\d)(\\d)${SF}(\\d+)([\\d.]+)%(\\d+)([\\d.]+|100)%\\$([\\d,]+)\\$([\\d.]+)\\$([\\d,]+)\\$([\\d.]+)([\\d.]+)%$`
  );
  const SUMMARY_CONCAT = new RegExp(
    `^(All\\s+(?:Studios?|1\\s*Beds?|2\\s*Beds?|3\\s*Beds?|One\\s*Beds?|Two\\s*Beds?|Three\\s*Beds?))${SF}(\\d+)([\\d.]+|100)%(\\d+)([\\d.]+|100)%\\$([\\d,]+)\\$([\\d.]+)\\$([\\d,]+)\\$([\\d.]+)([\\d.]+)%$`,
    "i"
  );
  const TOTALS_CONCAT = new RegExp(
    `^Totals?${SF}(\\d+)([\\d.]+|100)%(\\d+)([\\d.]+|100)%\\$([\\d,]+)\\$([\\d.]+)\\$([\\d,]+)\\$([\\d.]+)([\\d.]+)%$`,
    "i"
  );

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;

    // Totals (space-sep)
    const tm = TOTALS_ROW.exec(t);
    if (tm) {
      totalsRow = {
        bed: -1, bath: null,
        avgSF: num(tm[1]), units: num(tm[2]), mixPct: pct(tm[3]),
        availableUnits: num(tm[4]), availabilityPct: pct(tm[5]),
        askingRentPerUnit: money(tm[6]), askingRentPerSF: num(tm[7]),
        effectiveRentPerUnit: money(tm[8]), effectiveRentPerSF: num(tm[9]),
        concessionsPct: pct(tm[10]), label: "Totals",
      };
      continue;
    }

    // Summary rows (space-sep)
    const sm = SUMMARY_ROW.exec(t);
    if (sm) {
      const label = normaliseLabel(sm[1]);
      summaryRows.push({
        bed: bedFromLabel(label), bath: null,
        avgSF: num(sm[2]), units: num(sm[3]), mixPct: pct(sm[4]),
        availableUnits: num(sm[5]), availabilityPct: pct(sm[6]),
        askingRentPerUnit: money(sm[7]), askingRentPerSF: num(sm[8]),
        effectiveRentPerUnit: money(sm[9]), effectiveRentPerSF: num(sm[10]),
        concessionsPct: pct(sm[11]), label,
      });
      continue;
    }

    // Individual rows (space-sep)
    const um = UNIT_ROW.exec(t);
    if (um) {
      const bed = um[1] === "Studio" ? 0 : parseInt(um[1], 10);
      const bath = parseInt(um[2], 10);
      unitTypes.push({
        bed, bath,
        avgSF: num(um[3]), units: num(um[4]), mixPct: pct(um[5]),
        availableUnits: num(um[6]), availabilityPct: pct(um[7]),
        askingRentPerUnit: money(um[8]), askingRentPerSF: num(um[9]),
        effectiveRentPerUnit: money(um[10]), effectiveRentPerSF: num(um[11]),
        concessionsPct: pct(um[12]),
        label: bed === 0 ? `Studio/${bath}` : `${bed}/${bath}`,
      });
      continue;
    }

    // Totals (concatenated)
    const tc = TOTALS_CONCAT.exec(t);
    if (tc) {
      totalsRow = {
        bed: -1, bath: null,
        avgSF: num(tc[1]), units: num(tc[2]), mixPct: pct(tc[3]),
        availableUnits: num(tc[4]), availabilityPct: pct(tc[5]),
        askingRentPerUnit: money(tc[6]), askingRentPerSF: num(tc[7]),
        effectiveRentPerUnit: money(tc[8]), effectiveRentPerSF: num(tc[9]),
        concessionsPct: pct(tc[10]), label: "Totals",
      };
      continue;
    }

    // Summary rows (concatenated)
    const sc = SUMMARY_CONCAT.exec(t);
    if (sc) {
      const label = normaliseLabel(sc[1]);
      summaryRows.push({
        bed: bedFromLabel(label), bath: null,
        avgSF: num(sc[2]), units: num(sc[3]), mixPct: pct(sc[4]),
        availableUnits: num(sc[5]), availabilityPct: pct(sc[6]),
        askingRentPerUnit: money(sc[7]), askingRentPerSF: num(sc[8]),
        effectiveRentPerUnit: money(sc[9]), effectiveRentPerSF: num(sc[10]),
        concessionsPct: pct(sc[11]), label,
      });
      continue;
    }

    // Individual rows (concatenated)
    const uc = UNIT_CONCAT.exec(t);
    if (uc) {
      const bed = uc[1] === "Studio" ? 0 : parseInt(uc[1], 10);
      const bath = parseInt(uc[2], 10);
      unitTypes.push({
        bed, bath,
        avgSF: num(uc[3]), units: num(uc[4]), mixPct: pct(uc[5]),
        availableUnits: num(uc[6]), availabilityPct: pct(uc[7]),
        askingRentPerUnit: money(uc[8]), askingRentPerSF: num(uc[9]),
        effectiveRentPerUnit: money(uc[10]), effectiveRentPerSF: num(uc[11]),
        concessionsPct: pct(uc[12]),
        label: bed === 0 ? `Studio/${bath}` : `${bed}/${bath}`,
      });
    }
  }

  return { unitTypes, summaryRows, totalsRow };
}

function normaliseLabel(raw: string): string {
  const r = raw.trim();
  if (/studio/i.test(r)) return "All Studios";
  if (/1\s*bed|one\s*bed/i.test(r)) return "All 1 Beds";
  if (/2\s*bed|two\s*bed/i.test(r)) return "All 2 Beds";
  if (/3\s*bed|three\s*bed/i.test(r)) return "All 3 Beds";
  return r;
}

function bedFromLabel(label: string): number {
  if (/studio/i.test(label)) return 0;
  if (/1\s*bed|one\s*bed/i.test(label)) return 1;
  if (/2\s*bed|two\s*bed/i.test(label)) return 2;
  if (/3\s*bed|three\s*bed/i.test(label)) return 3;
  return -1;
}

// ─── 5. Assemble RentCompsData ────────────────────────────────────────────────

function assembleData(
  summaryRows: SummaryRow[],
  vacancyRows: VacancyRow[],
  sections: PropertySection[],
  subjectName: string
): RentCompsData {
  const nameLower = subjectName.toLowerCase().trim();

  // Build vacancy lookup by rank for fast access
  const vacByRank = new Map<number, VacancyRow>(vacancyRows.map((v) => [v.rank, v]));

  // Identify subject section
  let subjectSection: PropertySection | null = null;
  if (nameLower) {
    subjectSection =
      sections.find(
        (s) =>
          s.propertyName.toLowerCase().includes(nameLower) ||
          nameLower.includes(s.propertyName.toLowerCase().trim())
      ) ?? null;
  }
  if (!subjectSection) subjectSection = sections.find((s) => s.distanceMiles === null) ?? null;
  if (!subjectSection && sections.length > 0) subjectSection = sections[0];

  const nonSubjectSections = sections.filter((s) => s !== subjectSection);

  // Match each summary row to a detail section
  function scoreMatch(row: SummaryRow, sec: PropertySection): number {
    let score = 0;
    const rn = row.rawName.toLowerCase().trim();
    const sn = sec.propertyName.toLowerCase().trim();
    if (rn === sn) score += 100;
    else if (rn.includes(sn) || sn.includes(rn)) score += 60;
    else {
      const rw = new Set(rn.split(/\s+/).filter((w) => w.length > 2));
      score += sn.split(/\s+/).filter((w) => w.length > 2 && rw.has(w)).length * 20;
    }
    if (row.totalUnits !== null && row.totalUnits === sec.totalUnits) score += 25;
    if (row.yearBuilt !== null && row.yearBuilt === sec.yearBuilt) score += 15;
    return score;
  }

  const usedSections = new Set<PropertySection>();
  const matchedSections: (PropertySection | null)[] = summaryRows.map((row) => {
    let best: PropertySection | null = null;
    let bestScore = 0;
    for (const sec of nonSubjectSections) {
      if (usedSections.has(sec)) continue;
      const s = scoreMatch(row, sec);
      if (s > bestScore) { bestScore = s; best = sec; }
    }
    if (best) usedSections.add(best);
    return best;
  });

  // Build CompSummary[]
  const comps: CompSummary[] = [];

  if (subjectSection) {
    const tot = subjectSection.totalsRow;
    const allStudio = subjectSection.summaryRows.find((r) => r.label === "All Studios");
    const all1 = subjectSection.summaryRows.find((r) => r.label === "All 1 Beds");
    const all2 = subjectSection.summaryRows.find((r) => r.label === "All 2 Beds");
    const all3 = subjectSection.summaryRows.find((r) => r.label === "All 3 Beds");
    comps.push({
      rank: 0, isSubject: true,
      name: subjectSection.propertyName,
      address: subjectSection.address ?? "",
      city: subjectSection.city ?? "",
      state: subjectSection.state ?? "",
      yearBuilt: subjectSection.yearBuilt,
      totalUnits: subjectSection.totalUnits ?? tot?.units ?? null,
      stories: subjectSection.stories,
      avgUnitSF: subjectSection.avgUnitSF ?? tot?.avgSF ?? null,
      distanceToSubjectMiles: null,
      coStarRating: subjectSection.coStarRating,
      studioAskingRent: allStudio?.askingRentPerUnit ?? null,
      oneBedAskingRent: all1?.askingRentPerUnit ?? null,
      twoBedAskingRent: all2?.askingRentPerUnit ?? null,
      threeBedAskingRent: all3?.askingRentPerUnit ?? null,
      rentPerSF: tot?.askingRentPerSF ?? null,
      totalVacancyPct: tot?.availabilityPct ?? null,
      totalAvailabilityPct: tot?.availabilityPct ?? null,
      askingRentPerUnit: tot?.askingRentPerUnit ?? null,
      askingRentPerSF: tot?.askingRentPerSF ?? null,
      effectiveRentPerUnit: tot?.effectiveRentPerUnit ?? null,
      effectiveRentPerSF: tot?.effectiveRentPerSF ?? null,
      concessionsPct: tot?.concessionsPct ?? null,
      owner: null, propertyManager: null,
    });
  }

  for (let i = 0; i < summaryRows.length; i++) {
    const row = summaryRows[i];
    const sec = matchedSections[i];
    const tot = sec?.totalsRow ?? null;
    const vac = vacByRank.get(row.rank) ?? null;

    comps.push({
      rank: row.rank, isSubject: false,
      name: row.rawName || sec?.propertyName || `Comp ${row.rank}`,
      address: row.rawAddress || (sec?.address ?? ""),
      city: sec?.city ?? "",
      state: sec?.state ?? "",
      yearBuilt: row.yearBuilt ?? sec?.yearBuilt ?? null,
      totalUnits: row.totalUnits ?? vac?.totalUnits ?? sec?.totalUnits ?? null,
      stories: sec?.stories ?? null,
      avgUnitSF: row.avgUnitSF ?? sec?.avgUnitSF ?? null,
      distanceToSubjectMiles: sec?.distanceMiles ?? null,
      coStarRating: sec?.coStarRating ?? null,
      studioAskingRent: row.studioRent,
      oneBedAskingRent: row.oneBedRent,
      twoBedAskingRent: row.twoBedRent,
      threeBedAskingRent: row.threeBedRent,
      rentPerSF: row.rentPerSF,
      // Prefer vacancy table data (more precise) over totals row
      totalVacancyPct: vac?.vacancyPct ?? tot?.availabilityPct ?? null,
      totalAvailabilityPct: vac?.availabilityPct ?? tot?.availabilityPct ?? null,
      askingRentPerUnit: vac?.askingRentPerUnit ?? tot?.askingRentPerUnit ?? null,
      askingRentPerSF: vac?.askingRentPerSF ?? tot?.askingRentPerSF ?? null,
      effectiveRentPerUnit: vac?.effectiveRentPerUnit ?? tot?.effectiveRentPerUnit ?? null,
      effectiveRentPerSF: vac?.effectiveRentPerSF ?? tot?.effectiveRentPerSF ?? null,
      concessionsPct: vac?.concessionsPct ?? tot?.concessionsPct ?? null,
      owner: null, propertyManager: null,
    });
  }

  // Build CompDetail[]
  function buildDetail(sec: PropertySection, isSubject: boolean): CompDetail {
    return {
      propertyName: sec.propertyName,
      isSubject,
      address: sec.address ?? undefined,
      yearBuilt: sec.yearBuilt,
      unitTypes: [
        ...sec.unitTypes,
        ...sec.summaryRows,
        ...(sec.totalsRow ? [sec.totalsRow] : []),
      ],
      amenities: {},
      parking: null,
      petPolicy: null,
    };
  }

  const subjectDetail = subjectSection ? buildDetail(subjectSection, true) : null;
  const compDetails: CompDetail[] = matchedSections
    .map((sec) => (sec ? buildDetail(sec, false) : null))
    .filter((d): d is CompDetail => d !== null);

  console.log(
    `[costar-parser-regex] Assembled: ${summaryRows.length} summary rows, ` +
      `${sections.length} detail sections → ${comps.filter((c) => !c.isSubject).length} ranked comps`
  );

  return {
    subjectProperty: subjectDetail,
    comps,
    compDetails,
    reportDate: new Date().toISOString().split("T")[0],
  };
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function findSectionEnd(
  fullText: string,
  searchFrom: number,
  terminators: string[]
): number {
  let end = fullText.length;
  for (const t of terminators) {
    const idx = fullText.indexOf(t, searchFrom);
    if (idx !== -1 && idx < end) end = idx;
  }
  return end;
}
