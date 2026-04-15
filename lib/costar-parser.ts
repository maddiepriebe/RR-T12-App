/**
 * Pure regex parser for CoStar Underwriting Report PDFs.
 *
 * Actual PDF format (discovered via diagnostic on Elme Bethesda Costar.pdf):
 *
 *   SUMMARY TABLE — each comp occupies several lines (NOT one line):
 *     Sophia Bethesda            ← property name (standalone line)
 *     276 909 $2,432 $3,030 $4,560 $8,440 $4.50   ← data (PDF.js space-joined)
 *       OR  276909$2,432$3,030$4,560$8,440$4.50    ← concatenated (pdf-parse)
 *     4924 Saint Elmo            ← street address
 *     1                          ← rank number (standalone line!)
 *     2024                       ← year (standalone)
 *     -                          ← rating (standalone)
 *
 *   UNIT MIX — with PDF.js y-grouping items are space-joined on one line:
 *     Studio 1 484 2 0.7% 0 0.0% $2,290 $4.73 $2,249 $4.65 1.8%
 *     All Studios 516 23 8.3% 1 4.4% $2,432 $4.72 $2,389 $4.63 1.8%
 *     Totals 909 276 100% 59 21.4% $4,089 $4.50 $4,016 $4.42 1.8%
 *   Fallback (concatenated, from pdf-parse):
 *     Studio148420.7%00.0%$2,290$4.73$2,249$4.651.8%
 *
 * Key parsing strategy for the summary table:
 *   - Anchor section via "No. Rent Comps" (unique in document)
 *   - Detect comps by finding STANDALONE RANK NUMBERS (lines that are just "1", "2", etc.)
 *   - For each rank, scan nearby lines for the data line (contains ≥2 $ amounts + $X.XX)
 *   - Property name = last looksLikeName() line before the data/rank block
 *
 * Input: pages[] from extract-pdf-client.ts
 * Output: RentCompsData
 */

import type { CompSummary, CompDetail, UnitTypeDetail, RentCompsData } from "./schemas";

// ─── Primitive parsers ─────────────────────────────────────────────
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

/** Returns true if a line looks like a street address (starts with a house number). */
function isStreetAddress(line: string): boolean {
  return /^\d{2,6}\s+[A-Za-z]/.test(line);
}

/** Returns true if a line looks like a property name. */
function looksLikeName(line: string): boolean {
  if (!line || line.length < 3) return false;
  if (isStreetAddress(line)) return false;
  if (/^\d+$/.test(line.trim())) return false; // pure number = rank/page
  if (/\$/.test(line)) return false; // rent values
  if (/^\d{4}$/.test(line.trim())) return false; // year
  if (/^[-★⭐]+$/.test(line.trim())) return false; // rating dash
  if (/^(PROPERTY|UNIT|Bed|Bath|CoStar|Page|No\.|Rating|Yr Built|Property Size|Year Built|Avg\.|Type:|Rent Type:|Parking:|Distance|Vacancy|OWNER|MANAGER|Construction|Subject|Photo|Comparables Summary|Rent Comps|Score)/i.test(line.trim())) return false;
  // Must have at least one alphabetic character
  if (!/[A-Za-z]/.test(line)) return false;
  return true;
}

/**
 * Split a concatenated "units+avgSF" prefix string like "276909" or "2201,156".
 * CoStar omits space between the two numbers in pdf-parse output.
 */
function splitUnitsAvgSF(s: string): { units: number | null; avgSF: number | null } {
  const raw = s.trim();

  // Has comma: "2201,156" → avgSF has 4 digits with comma separator
  // The comma position: raw = "{units}{1-digit-thousands-of-avgSF},{3-digit-hundreds-of-avgSF}"
  if (raw.includes(",")) {
    const commaIdx = raw.indexOf(",");
    const beforeComma = raw.slice(0, commaIdx); // e.g. "2201"
    const afterComma = raw.slice(commaIdx + 1); // e.g. "156"
    const avgSFThousands = beforeComma.slice(-1); // "1"
    const unitsStr = beforeComma.slice(0, -1); // "220"
    const u = parseInt(unitsStr, 10);
    const sf = parseInt(avgSFThousands + afterComma, 10); // 1156
    if (!isNaN(u) && !isNaN(sf) && u >= 5 && sf >= 200) {
      return { units: u, avgSF: sf };
    }
  }

  const clean = raw.replace(/,/g, "");
  if (!/^\d+$/.test(clean)) return { units: null, avgSF: null };

  // Try last 3 digits as avgSF (400–999 typical unit SF)
  if (clean.length >= 4) {
    const last3 = parseInt(clean.slice(-3), 10);
    const u3 = parseInt(clean.slice(0, -3), 10);
    if (last3 >= 400 && last3 <= 999 && u3 >= 5 && u3 <= 10000) {
      return { units: u3, avgSF: last3 };
    }
  }

  // Try last 4 digits as avgSF (1000–2500 larger units)
  if (clean.length >= 5) {
    const last4 = parseInt(clean.slice(-4), 10);
    const u4 = parseInt(clean.slice(0, -4), 10);
    if (last4 >= 1000 && last4 <= 2500 && u4 >= 5 && u4 <= 10000) {
      return { units: u4, avgSF: last4 };
    }
  }

  return { units: null, avgSF: null };
}

/**
 * Parse a comp data line from the summary table.
 * Handles both space-separated (PDF.js) and concatenated (pdf-parse) formats.
 *
 * Space-sep:   "276 909 $2,432 $3,030 $4,560 $8,440 $4.50"
 * Concat:      "276909$2,432$3,030$4,560$8,440$4.50"
 * With dash:   "167774$2,117$2,484$3,731-$3.99"
 *              "167 774 $2,117 $2,484 $3,731 - $3.99"
 */
function parseCompDataLine(line: string): {
  units: number | null;
  avgSF: number | null;
  rents: Array<number | null>;
  rentPerSF: number | null;
} | null {
  const firstDollar = line.indexOf("$");
  if (firstDollar === -1) return null;

  // A leading bedroom rent of "-" (no studios / no 1BR etc.) gets stuck on the
  // end of the prefix because it sits between avgSF and the first $amount with
  // no whitespace (e.g. "237980-$2,349..." → studio=null, units=237, avgSF=980).
  // Strip trailing dashes, remember how many, and prepend that many nulls to
  // rentTokens so the remaining $amounts land in the correct bedroom slots.
  let rawPrefix = line.slice(0, firstDollar).trim();
  let leadingNulls = 0;
  while (rawPrefix.endsWith("-")) {
    leadingNulls++;
    rawPrefix = rawPrefix.slice(0, -1).trim();
  }
  const prefix = rawPrefix;

  // Collect tokens: $X,XXX  $X.XX  or bare dash (missing bedroom)
  // Match $amounts and also standalone - between amounts
  const afterPrefix = line.slice(firstDollar);
  const tokens: Array<{ value: number | null; isPerSF: boolean }> = [];

  const tokenRe = /\$[\d,]+(?:\.\d+)?|-(?=\s*\$)/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(afterPrefix)) !== null) {
    const tok = m[0];
    if (tok.startsWith("$")) {
      const v = parseFloat(tok.replace(/[$,]/g, ""));
      const isPerSF = /^\$\d{1,2}\.\d{2}$/.test(tok) && v < 50;
      tokens.push({ value: v, isPerSF });
    } else {
      // dash = null bedroom rent
      tokens.push({ value: null, isPerSF: false });
    }
  }

  if (tokens.length < 2) return null;

  // Last isPerSF token = rentPerSF; the others = bedroom rents
  let rentPerSF: number | null = null;
  const rentTokens: Array<number | null> = [];

  // Find the last isPerSF token
  let lastPerSFIdx = -1;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (tokens[i].isPerSF) { lastPerSFIdx = i; break; }
  }

  for (let i = 0; i < tokens.length; i++) {
    if (i === lastPerSFIdx) {
      rentPerSF = tokens[i].value;
    } else {
      rentTokens.push(tokens[i].value);
    }
  }

  // Prepend placeholders for leading-dash bedrooms stripped from the prefix.
  for (let i = 0; i < leadingNulls; i++) rentTokens.unshift(null);

  // Parse prefix for units + avgSF
  let units: number | null = null;
  let avgSF: number | null = null;

  const spaceParts = prefix.split(/\s+/).filter(Boolean);
  if (spaceParts.length >= 2) {
    // Space-separated: "276 909"
    const u = parseInt(spaceParts[0].replace(/,/g, ""), 10);
    const sf = parseInt(spaceParts[1].replace(/,/g, ""), 10);
    if (!isNaN(u) && !isNaN(sf) && u >= 5 && u <= 10000 && sf >= 200 && sf <= 5000) {
      units = u;
      avgSF = sf;
    }
  }

  if (units === null && prefix && /^[\d,]+$/.test(prefix)) {
    // Concatenated: "276909" or "2201,156"
    const split = splitUnitsAvgSF(prefix);
    units = split.units;
    avgSF = split.avgSF;
  }

  return { units, avgSF, rents: rentTokens, rentPerSF };
}

// ─── Internal data types ───────────────────────────────────────────
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

// ─── Main export ───────────────────────────────────────────────────
export function parseCoStarPages(pages: string[], subjectName: string): RentCompsData {
  const fullText = pages.join("\n");

  const { rows: summaryRows, expectedCount } = parseSummaryTable(fullText);
  const sections = parsePropertySections(fullText);

  if (expectedCount > 0 && summaryRows.length !== expectedCount) {
    console.warn(
      `[CoStar parser] Expected ${expectedCount} comps from "No. Rent Comps" but extracted ` +
        `${summaryRows.length} rows from the summary table.`
    );
  }

  return assembleData(summaryRows, sections, subjectName);
}

// ─── 1. Parse the Rent Comparables Summary table ───────────────────
//
// In the actual PDF, each comp spans several lines:
//   Line A: property name (standalone)
//   Line B: "units avgSF $studio $1br $2br $3br $rentPerSF" (same y-coord → space-joined by PDF.js)
//   Line C: street address
//   Line D: rank number (standalone, different y-coord)
//   Line E: year (standalone)
//   Line F: rating "-" (standalone)
//
// Strategy: anchor on standalone rank numbers (lines that are exactly "1"–"99"),
// then scan nearby lines for the data line and property name.
function parseSummaryTable(fullText: string): { rows: SummaryRow[]; expectedCount: number } {
  // ── Locate expected count ──────────────────────────────────────────
  // Format: "17$2,938$3.2012.3%\nNo. Rent Comps..." — count is BEFORE the label.
  // The number 17 appears as "17$" (directly before the avg rent $X,XXX).
  // Filter to 1–100 to avoid matching 3-digit tails of dollar amounts like "938" from "$2,938$".
  let expectedCount = 0;
  const noCompsIdx = fullText.indexOf("No. Rent Comps");
  if (noCompsIdx !== -1) {
    const before = fullText.slice(Math.max(0, noCompsIdx - 400), noCompsIdx);
    const allMatches = [...before.matchAll(/(\d{1,3})\$/g)];
    const validMatches = allMatches.filter((m) => {
      const n = parseInt(m[1], 10);
      return n >= 1 && n <= 100; // realistic comp count; filters out "938" from "$2,938$"
    });
    if (validMatches.length > 0) {
      // Take the last valid match (closest to "No. Rent Comps")
      expectedCount = parseInt(validMatches[validMatches.length - 1][1], 10);
    }
    // Fallback: count may appear right after the label
    if (expectedCount === 0) {
      const after = fullText.slice(noCompsIdx, noCompsIdx + 200);
      const m2 = after.match(/No\.\s*Rent\s*Comps[\s\S]{0,60}?(\d{1,3})/);
      if (m2) {
        const n = parseInt(m2[1], 10);
        if (n >= 1 && n <= 100) expectedCount = n;
      }
    }
  }

  // ── Find section bounds ────────────────────────────────────────────
  let sectionStart = 0;
  if (noCompsIdx !== -1) {
    // Walk backward up to 20 000 chars to find "Rent Comparables Summary"
    const searchArea = fullText.slice(Math.max(0, noCompsIdx - 20000), noCompsIdx + 500);
    const rcIdx = searchArea.lastIndexOf("Rent Comparables Summary");
    sectionStart =
      rcIdx !== -1
        ? Math.max(0, noCompsIdx - 20000) + rcIdx
        : Math.max(0, noCompsIdx - 1000);
  } else {
    const lastRc = fullText.lastIndexOf("Rent Comparables Summary");
    if (lastRc === -1) {
      console.warn("[CoStar parser] Could not find 'Rent Comparables Summary' in document.");
      return { rows: [], expectedCount };
    }
    sectionStart = lastRc;
  }

  // Section ends at "Photo Comparison" header
  const photoIdx = fullText.indexOf("Photo Comparison", sectionStart + 500);
  const sectionEnd = photoIdx !== -1 ? photoIdx : fullText.length;

  const section = fullText.slice(sectionStart, sectionEnd);
  const lines = section.split("\n");

  // ── Rank-anchored extraction ───────────────────────────────────────
  const STANDALONE_RANK = /^(\d{1,2})$/;
  const STANDALONE_YEAR = /^(19\d{2}|20\d{2})$/;
  const DATA_LINE_RE = /\$\d+\.\d{2}/; // has $X.XX = rentPerSF
  // Matches inline format: "3 - 2024 220 1,156 $2,192 $2,760 $5,300 $8,056 $3.98"
  const INLINE_RANK_RE = /^(\d{1,2})\s+-\s+(19\d{2}|20\d{2})\s+/;

  const rows: SummaryRow[] = [];
  const seenRanks = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Detect rank: standalone line ("3") or inline rank+data ("3 - 2024 220 1,156 $...")
    const standaloneM = STANDALONE_RANK.exec(line);
    const inlineCandidate = !standaloneM ? INLINE_RANK_RE.exec(line) : null;
    const inlineM = inlineCandidate && DATA_LINE_RE.test(line) ? inlineCandidate : null;
    if (!standaloneM && !inlineM) continue;

    const rank = parseInt((standaloneM ?? inlineM)![1], 10);
    if (rank < 1 || rank > 99) continue;
    if (seenRanks.has(rank)) continue;

    let dataLine: string | null = null;
    let dataLineIdx = i;
    let yearBuilt: number | null = null;

    if (inlineM) {
      // Inline format: rank, rating dash, year, and data are all on one line.
      yearBuilt = parseInt(inlineM[2], 10);
      // Strip the "rank - year " prefix to isolate the data portion.
      dataLine = line.replace(/^\d{1,2}\s+-\s+\d{4}\s+/, "").trim();
      dataLineIdx = i;
    } else {
      // Standalone rank: scan backward for data line, forward for year.
      for (let j = i - 1; j >= Math.max(0, i - 8); j--) {
        const jl = lines[j].trim();
        if (STANDALONE_RANK.test(jl) && parseInt(jl, 10) !== rank) break;
        if (DATA_LINE_RE.test(jl) && (jl.match(/\$/g) ?? []).length >= 2) {
          dataLine = jl;
          dataLineIdx = j;
          break;
        }
      }

      for (let j = i + 1; j < Math.min(lines.length, i + 12); j++) {
        const jl = lines[j].trim();
        if (STANDALONE_RANK.test(jl) && parseInt(jl, 10) !== rank) break;
        if (!yearBuilt && STANDALONE_YEAR.test(jl)) {
          yearBuilt = parseInt(jl, 10);
        }
        if (!dataLine && DATA_LINE_RE.test(jl) && (jl.match(/\$/g) ?? []).length >= 2) {
          dataLine = jl;
          dataLineIdx = j;
        }
      }
    }

    if (!dataLine) continue;

    const parsed = parseCompDataLine(dataLine);
    if (!parsed) continue;
    if (parsed.units !== null && parsed.units < 5) continue; // not a property

    // The name always appears on the line immediately before the rank line.
    const rawName = i > 0 ? lines[i - 1].trim() : "";
    // The address always appears on the line immediately after the data line.
    const rawAddress = dataLineIdx + 1 < lines.length ? lines[dataLineIdx + 1].trim() : "";

    seenRanks.add(rank);
    rows.push({
      rank,
      rawName,
      rawAddress,
      yearBuilt,
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
  return { rows, expectedCount };
}

// ─── 2a. Detect the repeating comp-detail-page anchor ──────────────
// Every comp detail page opens with "Rent Comparables\n{subject header}\n".
// We discover the anchor dynamically by finding the most-repeated instance
// of that two-line pattern, so no subject name/address is hard-coded.
function detectDetailAnchor(fullText: string): string | null {
  const RE = /Rent Comparables\n([^\n]+)\n/g;
  const counts = new Map<string, number>();
  let m: RegExpExecArray | null;
  while ((m = RE.exec(fullText)) !== null) {
    const candidate = `Rent Comparables\n${m[1]}\n`;
    counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
  }
  let best = "";
  let bestCount = 0;
  for (const [anchor, count] of counts) {
    if (count > bestCount) { best = anchor; bestCount = count; }
  }
  console.log("[anchor] best:", JSON.stringify(best));
  // Require at least 2 occurrences — a single hit could be a false positive
  return bestCount >= 2 ? best : null;
}

// ─── 2b. UNIT BREAKDOWN fallback (used for subject section + fallback) ──
function parsePropertySectionsFallback(text: string): PropertySection[] {
  const normalised = text.replace(/UNIT\s+BREAKDOWN/gi, "§§UNIT_BREAKDOWN§§");
  const parts = normalised.split("§§UNIT_BREAKDOWN§§");
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

// ─── 2. Split full text into per-property sections ─────────────────
// Detects the repeating "Rent Comparables\n{subject header}\n" anchor that
// appears at the top of every comp detail page.  Splits on it; reads rank,
// address, name, city, state directly from the 3 lines that follow.
// Unit mix data is still extracted via UNIT BREAKDOWN within each part.
// Falls back to UNIT BREAKDOWN splitting if no anchor is detected.
function parsePropertySections(fullText: string): PropertySection[] {
  const anchor = detectDetailAnchor(fullText);
  if (!anchor) return parsePropertySectionsFallback(fullText);

  const parts = fullText.split(anchor);
  console.log("[anchor] split produced", parts.length, "parts");
  const sections: PropertySection[] = [];

  // parts[0] — content before the first comp detail page (includes subject section)
  sections.push(...parsePropertySectionsFallback(parts[0]));

  // parts[1..n] — one comp detail page each
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    const lines = part.split("\n");

    // Line 0: rank number. Parts that don't open with a rank are either noise
    // (e.g. the Photo Comparison page) or continuation pages — the same comp's
    // UNIT BREAKDOWN spilled onto a second physical page, which reproduces the
    // anchor but starts with the unit-mix column headers ("UnitsBedBath…")
    // instead of a rank. Merge continuation unit-mix data into the previous
    // section so Totals / All Studios / All 1 Beds etc. aren't lost.
    if (!/^\d{1,2}$/.test((lines[0] ?? "").trim())) {
      if (sections.length === 0) continue;
      const hasContinuationRows =
        /\$[\d,]+\s+\$\d+\.\d{2}/.test(part) ||
        /\$[\d,]+\$\d+\.\d{2}/.test(part) ||
        /All\s+(?:Studios?|1\s*Beds?|2\s*Beds?|3\s*Beds?)/i.test(part) ||
        /^Totals?\b/im.test(part);
      if (!hasContinuationRows) continue;
      const prev = sections[sections.length - 1];
      const cont = parseUnitMixLines(part.split("\n"));
      prev.unitTypes.push(...cont.unitTypes);
      prev.summaryRows.push(...cont.summaryRows);
      if (cont.totalsRow && !prev.totalsRow) prev.totalsRow = cont.totalsRow;
      continue;
    }

    // Line 1: "{address} - {comp name}"
    const addrNameLine = (lines[1] ?? "").trim();
    const addrNameM = addrNameLine.match(/^(.+?)\s+-\s+(.+)$/);
    const address = addrNameM ? addrNameM[1].trim() : (addrNameLine || null);
    const propertyName = addrNameM ? addrNameM[2].trim() : "";

    // Line 2: "{city}, {State}" (may continue with " - {neighborhood}")
    const cityStateLine = (lines[2] ?? "").trim();
    const cityStateM = cityStateLine.match(/^([A-Za-z][A-Za-z ]*),\s*([A-Za-z]+)/);
    const city = cityStateM ? cityStateM[1].trim() : null;
    const state = cityStateM ? cityStateM[2].trim() : null;

    // Locate UNIT BREAKDOWN within this part
    const ubMatch = part.match(/UNIT\s+BREAKDOWN/i);
    const ubIdx = ubMatch ? part.indexOf(ubMatch[0]) : -1;
    const headerText = ubIdx !== -1 ? part.slice(0, ubIdx) : part;
    const bodyText = ubIdx !== -1 ? part.slice(ubIdx + ubMatch![0].length) : "";

    // Structured fields from the header
    const sizeM = headerText.match(/Property Size:\s*([\d,]+)\s*Units?,\s*(\d+)\s*Floors?/i);
    const totalUnits = sizeM ? num(sizeM[1]) : null;
    const stories = sizeM ? num(sizeM[2]) : null;

    if (i === 1) {
      console.log("[DEBUG comp1] headerText:", JSON.stringify(headerText.slice(0, 500)));
      console.log("[DEBUG comp1] bodyText[:200]:", JSON.stringify(bodyText.slice(0, 200)));
    }

    // CoStar detail sections always contain a line of the form "Year Built: Oct 2024"
    // (colon may or may not have a trailing space in PDF.js output). Match the full
    // line, then take the 4-digit year group. Search the whole part — the line can
    // land on either side of "UNIT BREAKDOWN" depending on PDF.js line grouping.
    const yrM = part.match(/Year Built:\s*[A-Za-z]{3,9}\s+(\d{4})/);
    const yearBuilt = yrM ? parseInt(yrM[1], 10) : null;

    const sfM = headerText.match(/Avg\.\s*Unit Size:\s*([\d,]+)\s*SF/i);
    const avgUnitSF = sfM ? num(sfM[1]) : null;

    const distM = headerText.match(/Distance to Subject:?\s*([\d.]+)\s*Miles?/i);
    const distanceMiles = distM ? num(distM[1]) : null;

    const ratingM =
      headerText.match(/\b([\d.]+)\s*Stars?\b/i) ||
      headerText.match(/Rating:\s*([\d.]+)/i) ||
      headerText.match(/(★+)/);
    let coStarRating: number | null = null;
    if (ratingM) {
      if (typeof ratingM[1] === "string" && /\d/.test(ratingM[1])) {
        coStarRating = num(ratingM[1]);
      } else if (ratingM[1]) {
        coStarRating = (ratingM[1].match(/★/g) ?? []).length || null;
      }
    }

    const hasRows =
      /\$[\d,]+\s+\$\d+\.\d{2}/.test(bodyText) ||
      /\$[\d,]+\$\d+\.\d{2}/.test(bodyText) ||
      /All\s+(?:Studios?|1\s*Beds?|2\s*Beds?|3\s*Beds?)/i.test(bodyText);
    if (!hasRows && !totalUnits) continue;

    const { unitTypes, summaryRows, totalsRow } = parseUnitMixLines(bodyText.split("\n"));

    sections.push({
      propertyName: propertyName || `Comp ${lines[0].trim()}`,
      address: address ?? null,
      city,
      state,
      yearBuilt,
      totalUnits,
      stories,
      avgUnitSF,
      distanceMiles,
      coStarRating,
      unitTypes,
      summaryRows,
      totalsRow,
    });
  }

  return sections;
}

// ─── 3. Parse one property section ─────────────────────────────────
function parseOneSection(headerText: string, bodyText: string): PropertySection | null {
  const headerLines = headerText.split("\n").slice(-120);
  const h = headerLines.join("\n");

  // ── Structured fields ──────────────────────────────────────────────
  const sizeM = h.match(/Property Size:\s*([\d,]+)\s*Units?,\s*(\d+)\s*Floors?/i);
  const totalUnits = sizeM ? num(sizeM[1]) : null;
  const stories = sizeM ? num(sizeM[2]) : null;

  const yrM = h.match(/Year Built:\s*([A-Za-z]+ \d{4}|\d{4})/i);
  const yearBuilt = yrM ? yr(yrM[1]) : null;

  const sfM = h.match(/Avg\.\s*Unit Size:\s*([\d,]+)\s*SF/i);
  const avgUnitSF = sfM ? num(sfM[1]) : null;

  const distM = h.match(/Distance to Subject:?\s*([\d.]+)\s*Miles?/i);
  const distanceMiles = distM ? num(distM[1]) : null;

  const ratingM =
    h.match(/\b([\d.]+)\s*Stars?\b/i) ||
    h.match(/Rating:\s*([\d.]+)/i) ||
    h.match(/(★+)/);
  let coStarRating: number | null = null;
  if (ratingM) {
    if (typeof ratingM[1] === "string" && /\d/.test(ratingM[1])) {
      coStarRating = num(ratingM[1]);
    } else if (ratingM[1]) {
      coStarRating = (ratingM[1].match(/★/g) ?? []).length || null;
    }
  }

  // ── Property name & address ────────────────────────────────────────
  let propertyName = "";
  let address: string | null = null;
  let city: string | null = null;
  let state: string | null = null;

  // Strategy 1: "address - property name" header line
  const addrNameM = h.match(/(\d+[^-\n]+?)\s+-\s+([A-Za-z][^\n-]{3,60}?)(?:\n|$)/);
  if (addrNameM) {
    address = addrNameM[1].trim();
    propertyName = addrNameM[2].trim();
  }

  // Strategy 2: scan backward through header lines
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

      if (!address && isStreetAddress(line)) {
        address = line; continue;
      }

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

  // ── Unit breakdown ─────────────────────────────────────────────────
  const { unitTypes, summaryRows, totalsRow } = parseUnitMixLines(bodyText.split("\n"));

  return {
    propertyName,
    address,
    city,
    state,
    yearBuilt,
    totalUnits,
    stories,
    avgUnitSF,
    distanceMiles,
    coStarRating,
    unitTypes,
    summaryRows,
    totalsRow,
  };
}

// ─── 4. Parse unit mix lines ───────────────────────────────────────
// Handles both space-separated (PDF.js y-grouped) and concatenated (pdf-parse) formats.
//
// Space-separated (primary — what PDF.js produces):
//   Individual:  "Studio 1 484 2 0.7% 0 0.0% $2,290 $4.73 $2,249 $4.65 1.8%"
//   Summary:     "All Studios 516 23 8.3% 1 4.4% $2,432 $4.72 $2,389 $4.63 1.8%"
//   Totals:      "Totals 909 276 100% 59 21.4% $4,089 $4.50 $4,016 $4.42 1.8%"
//
// Concatenated (fallback for pdf-parse output):
//   Individual:  "Studio148420.7%00.0%$2,290$4.73$2,249$4.651.8%"
//   Summary:     "All Studios516238.3%14.4%$2,432$4.72$2,389$4.631.8%"
//   Totals:      "Totals909276100%5921.4%$4,089$4.50$4,016$4.421.8%"
function parseUnitMixLines(lines: string[]): {
  unitTypes: UnitTypeDetail[];
  summaryRows: UnitTypeDetail[];
  totalsRow: UnitTypeDetail | null;
} {
  const unitTypes: UnitTypeDetail[] = [];
  const summaryRows: UnitTypeDetail[] = [];
  let totalsRow: UnitTypeDetail | null = null;

  // ── Space-separated regexes (primary) ─────────────────────────────
  const UNIT_ROW =
    /^(Studio|\d)\s+(\d)\s+([\d,]+)\s+(\d+)\s+([\d.]+)%\s+(\d+)\s+([\d.]+|100)%\s+\$([\d,]+)\s+\$([\d.]+)\s+\$([\d,]+)\s+\$([\d.]+)\s+([\d.]+)%/;

  const SUMMARY_ROW =
    /^(All\s+Studios?|All\s+1\s*Beds?|All\s+2\s*Beds?|All\s+3\s*Beds?|All\s+One\s*Beds?|All\s+Two\s*Beds?|All\s+Three\s*Beds?)\s+([\d,]+)\s+(\d+)\s+([\d.]+|100)%\s+(\d+)\s+([\d.]+|100)%\s+\$([\d,]+)\s+\$([\d.]+)\s+\$([\d,]+)\s+\$([\d.]+)\s+([\d.]+)%/i;

  const TOTALS_ROW =
    /^Totals?\s+([\d,]+)\s+(\d+)\s+([\d.]+|100)%\s+(\d+)\s+([\d.]+|100)%\s+\$([\d,]+)\s+\$([\d.]+)\s+\$([\d,]+)\s+\$([\d.]+)\s+([\d.]+)%/i;

  // ── Concatenated regexes (fallback) ───────────────────────────────
  // avgSF is 3 digits (400-999) or 4 digits (1000-2500, may have comma)
  const SF_PAT = String.raw`(\d{3,4}|\d,\d{3})`;

  // Individual: (bed)(bath)(avgSF)(units)(mix%)(avail)(avail%)(askRent)(askSF)(effRent)(effSF)(conc%)
  const UNIT_CONCAT = new RegExp(
    `^(Studio|\\d)(\\d)${SF_PAT}(\\d+)([\\d.]+)%(\\d+)([\\d.]+|100)%\\$([\\d,]+)\\$([\\d.]+)\\$([\\d,]+)\\$([\\d.]+)([\\d.]+)%$`
  );

  // Summary: (label)(avgSF)(units)(mix%)(avail)(avail%)(askRent)(askSF)(effRent)(effSF)(conc%)
  const SUMMARY_CONCAT = new RegExp(
    `^(All\\s+(?:Studios?|1\\s*Beds?|2\\s*Beds?|3\\s*Beds?|One\\s*Beds?|Two\\s*Beds?|Three\\s*Beds?))${SF_PAT}(\\d+)([\\d.]+|100)%(\\d+)([\\d.]+|100)%\\$([\\d,]+)\\$([\\d.]+)\\$([\\d,]+)\\$([\\d.]+)([\\d.]+)%$`,
    "i"
  );

  // Totals: (avgSF)(units)(mix%)(avail)(avail%)(askRent)(askSF)(effRent)(effSF)(conc%)
  const TOTALS_CONCAT = new RegExp(
    `^Totals?${SF_PAT}(\\d+)([\\d.]+|100)%(\\d+)([\\d.]+|100)%\\$([\\d,]+)\\$([\\d.]+)\\$([\\d,]+)\\$([\\d.]+)([\\d.]+)%$`,
    "i"
  );

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;

    // ── Totals (space-sep) ──────────────────────────────────────────
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

    // ── Summary rows (space-sep) ────────────────────────────────────
    const sm = SUMMARY_ROW.exec(t);
    if (sm) {
      const label = normaliseLabel(sm[1]);
      const bed = bedFromLabel(label);
      summaryRows.push({
        bed, bath: null,
        avgSF: num(sm[2]), units: num(sm[3]), mixPct: pct(sm[4]),
        availableUnits: num(sm[5]), availabilityPct: pct(sm[6]),
        askingRentPerUnit: money(sm[7]), askingRentPerSF: num(sm[8]),
        effectiveRentPerUnit: money(sm[9]), effectiveRentPerSF: num(sm[10]),
        concessionsPct: pct(sm[11]), label,
      });
      continue;
    }

    // ── Individual rows (space-sep) ─────────────────────────────────
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

    // ── Totals (concatenated) ───────────────────────────────────────
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

    // ── Summary rows (concatenated) ─────────────────────────────────
    const sc = SUMMARY_CONCAT.exec(t);
    if (sc) {
      const label = normaliseLabel(sc[1]);
      const bed = bedFromLabel(label);
      summaryRows.push({
        bed, bath: null,
        avgSF: num(sc[2]), units: num(sc[3]), mixPct: pct(sc[4]),
        availableUnits: num(sc[5]), availabilityPct: pct(sc[6]),
        askingRentPerUnit: money(sc[7]), askingRentPerSF: num(sc[8]),
        effectiveRentPerUnit: money(sc[9]), effectiveRentPerSF: num(sc[10]),
        concessionsPct: pct(sc[11]), label,
      });
      continue;
    }

    // ── Individual rows (concatenated) ──────────────────────────────
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
      continue;
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

// ─── 5. Assemble final RentCompsData ──────────────────────────────
function assembleData(
  summaryRows: SummaryRow[],
  sections: PropertySection[],
  subjectName: string
): RentCompsData {
  const nameLower = subjectName.toLowerCase().trim();

  // ── Identify subject section ──────────────────────────────────────
  let subjectSection: PropertySection | null = null;

  if (nameLower) {
    subjectSection =
      sections.find(
        (s) =>
          s.propertyName.toLowerCase().includes(nameLower) ||
          nameLower.includes(s.propertyName.toLowerCase().trim())
      ) ?? null;
  }

  if (!subjectSection) {
    subjectSection = sections.find((s) => s.distanceMiles === null) ?? null;
  }

  if (!subjectSection && sections.length > 0) {
    subjectSection = sections[0]; // CoStar puts subject first
  }

  // ── Match summary rows to detail sections ─────────────────────────
  const nonSubjectSections = sections.filter((s) => s !== subjectSection);

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

  // ── Build CompSummary[] ───────────────────────────────────────────
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

    comps.push({
      rank: row.rank, isSubject: false,
      name: row.rawName || sec?.propertyName || `Comp ${row.rank}`,
      address: row.rawAddress || (sec?.address ?? ""),
      city: sec?.city ?? "",
      state: sec?.state ?? "",
      yearBuilt: row.yearBuilt ?? sec?.yearBuilt ?? null,
      totalUnits: row.totalUnits ?? sec?.totalUnits ?? null,
      stories: sec?.stories ?? null,
      avgUnitSF: row.avgUnitSF ?? sec?.avgUnitSF ?? null,
      distanceToSubjectMiles: sec?.distanceMiles ?? null,
      coStarRating: sec?.coStarRating ?? null,
      studioAskingRent: row.studioRent,
      oneBedAskingRent: row.oneBedRent,
      twoBedAskingRent: row.twoBedRent,
      threeBedAskingRent: row.threeBedRent,
      rentPerSF: row.rentPerSF,
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

  // ── Build CompDetail[] ────────────────────────────────────────────
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

  return {
    subjectProperty: subjectDetail,
    comps,
    compDetails,
    reportDate: new Date().toISOString().split("T")[0],
  };
}
