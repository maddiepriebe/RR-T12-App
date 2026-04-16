/**
 * Verifies parseCoStarPages() against the Elme Bethesda CoStar PDF, comparing
 * the extracted data to the target Excel workbook.
 *
 * Run:  npx tsx scripts/verify-costar-parser.ts
 */

import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
// @ts-expect-error legacy build has no types
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.js";
import { parseCoStarPages } from "../lib/costar-parser";

const PDF_PATH = "/Users/madelinepriebe/Desktop/Arel - Feb 2026/Elme Bethesda Costar.pdf";
const XLSX_PATH = "/Users/madelinepriebe/Desktop/Arel - Feb 2026/Elme Bethesda - Rent Comps 202603.xlsx";
const SUBJECT_NAME = "Elme Bethesda";

// ── 1. Extract PDF pages with PDF.js (mirrors extract-pdf-client y-grouping) ──
async function extractPages(pdfPath: string): Promise<string[]> {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const loadingTask = pdfjs.getDocument({ data, disableWorker: true, useSystemFonts: true });
  const doc = await loadingTask.promise;
  const pages: string[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    // Group items by y-coordinate (rounded) to reconstruct lines.
    const byY = new Map<number, { x: number; str: string }[]>();
    for (const item of content.items as Array<{ str: string; transform: number[] }>) {
      const y = Math.round(item.transform[5]);
      const x = item.transform[4];
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y)!.push({ x, str: item.str });
    }
    const ys = [...byY.keys()].sort((a, b) => b - a); // top → bottom
    const lines = ys.map((y) => {
      const row = byY.get(y)!.sort((a, b) => a.x - b.x);
      return row.map((r) => r.str).join(" ").replace(/\s+/g, " ").trim();
    }).filter(Boolean);
    pages.push(lines.join("\n"));
  }
  return pages;
}

// ── 2. Read the target Excel to harvest expected values ───────────────────────
interface ExcelComp {
  rank: number;
  name: string;
  yearBuilt: number | null;
  totalUnits: number | null;
  askingRentPerUnit: number | null;
  effectiveRentPerUnit: number | null;
  totalVacancyPct: number | null;
  concessionsPct: number | null;
}

function readExcelTargets(): { comps: ExcelComp[]; unitMixRowCounts: Record<string, number> } {
  const wb = XLSX.readFile(XLSX_PATH);
  // Dump sheet names so we can align.
  console.log("Workbook sheets:", wb.SheetNames);

  // Try to find a summary sheet. We'll guess by name.
  const summarySheet =
    wb.Sheets[wb.SheetNames.find((n) => /summary|comps/i.test(n)) ?? wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(summarySheet, { defval: null });
  const comps: ExcelComp[] = [];
  for (const r of rows) {
    // Heuristic: row has a rank 1..30 in some numeric col AND a string name col.
    const vals = Object.values(r);
    const strs = vals.filter((v): v is string => typeof v === "string");
    const nums = vals.filter((v): v is number => typeof v === "number");
    if (!strs.length || !nums.length) continue;
    const possibleRank = nums.find((n) => Number.isInteger(n) && n >= 1 && n <= 30);
    if (possibleRank === undefined) continue;
    const name = strs.find((s) => /[A-Za-z]{3,}/.test(s)) ?? "";
    if (!name) continue;
    comps.push({
      rank: possibleRank,
      name,
      yearBuilt: nums.find((n) => n >= 1900 && n <= 2030) ?? null,
      totalUnits: null,
      askingRentPerUnit: null,
      effectiveRentPerUnit: null,
      totalVacancyPct: null,
      concessionsPct: null,
    });
  }

  // Unit mix: count rows per sheet whose name suggests a comp property.
  const unitMixRowCounts: Record<string, number> = {};
  for (const sn of wb.SheetNames) {
    const sheet = wb.Sheets[sn];
    const rng = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
    unitMixRowCounts[sn] = rng.e.r - rng.s.r + 1;
  }
  return { comps, unitMixRowCounts };
}

// ── 3. Run parser + compare ───────────────────────────────────────────────────
async function main() {
  console.log("Extracting PDF…", PDF_PATH);
  const pages = await extractPages(PDF_PATH);
  console.log(`PDF: ${pages.length} pages, ${pages.reduce((s, p) => s + p.length, 0)} chars`);

  const fullText = pages.join("\n");
  const anchor = "Rent Comparables\n5114 Dudley Ln - Elme Bethesda\n";
  const parts0 = fullText.split(anchor)[0];
  const ubMatches = [...parts0.matchAll(/UNIT\s+BREAKDOWN/gi)];
  console.log(`parts[0] has ${ubMatches.length} UNIT BREAKDOWN occurrences, length=${parts0.length}`);

  const data = parseCoStarPages(pages, SUBJECT_NAME);

  console.log("\n=== Parser output ===");
  console.log(`Subject: ${data.subjectProperty?.propertyName ?? "(none)"}`);
  const comps = data.comps.filter((c) => !c.isSubject);
  console.log(`Comps: ${comps.length}`);
  console.log(`CompDetails: ${data.compDetails.length}`);

  console.log("\n=== Per-comp fields ===");
  console.log(
    "rank".padEnd(5) +
      "name".padEnd(35) +
      "yrBuilt  units  askRent  effRent  vac%   conc%"
  );
  for (const c of comps) {
    console.log(
      String(c.rank).padEnd(5) +
        (c.name ?? "").slice(0, 33).padEnd(35) +
        String(c.yearBuilt ?? "—").padEnd(9) +
        String(c.totalUnits ?? "—").padEnd(7) +
        String(c.askingRentPerUnit ?? "—").padEnd(9) +
        String(c.effectiveRentPerUnit ?? "—").padEnd(9) +
        String(c.totalVacancyPct ?? "—").padEnd(7) +
        String(c.concessionsPct ?? "—")
    );
  }

  // ── Diagnostics ──
  const missing = {
    yearBuilt: comps.filter((c) => c.yearBuilt == null).map((c) => c.rank),
    askingRentPerUnit: comps.filter((c) => c.askingRentPerUnit == null).map((c) => c.rank),
    effectiveRentPerUnit: comps.filter((c) => c.effectiveRentPerUnit == null).map((c) => c.rank),
    totalVacancyPct: comps.filter((c) => c.totalVacancyPct == null).map((c) => c.rank),
    concessionsPct: comps.filter((c) => c.concessionsPct == null).map((c) => c.rank),
  };
  console.log("\n=== Missing fields (comp ranks) ===");
  for (const [k, v] of Object.entries(missing)) {
    console.log(`${k.padEnd(22)} missing in ${v.length}/${comps.length}: [${v.join(",")}]`);
  }

  console.log("\n=== Unit-mix rows per comp detail ===");
  for (const d of data.compDetails) {
    const individual = d.unitTypes.filter((u) => u.label && !u.label.startsWith("All") && u.label !== "Totals");
    const summary = d.unitTypes.filter((u) => u.label?.startsWith("All"));
    const totals = d.unitTypes.filter((u) => u.label === "Totals");
    console.log(
      `  ${d.propertyName.padEnd(35)} ` +
        `individual=${individual.length}  summary=${summary.length}  totals=${totals.length}`
    );
  }

  // ── Read Excel and cross-reference ──
  console.log("\n=== Excel workbook ===");
  let excel: ReturnType<typeof readExcelTargets> | null = null;
  try {
    excel = readExcelTargets();
    console.log(`Excel comps parsed: ${excel.comps.length}`);
    // Try matching by rank
    const excelByRank = new Map(excel.comps.map((c) => [c.rank, c]));
    let mismatches = 0;
    for (const c of comps) {
      const ex = excelByRank.get(c.rank);
      if (!ex) continue;
      const nameMatch = ex.name.toLowerCase().includes(c.name.toLowerCase().split(" ")[0]) ||
        c.name.toLowerCase().includes(ex.name.toLowerCase().split(" ")[0]);
      if (!nameMatch) {
        mismatches++;
        console.log(`  Rank ${c.rank}: parser="${c.name}"  excel="${ex.name}"`);
      }
    }
    console.log(`Name mismatches: ${mismatches}/${comps.length}`);
  } catch (err) {
    console.log("Could not read Excel:", (err as Error).message);
  }

  console.log("\nsubjectProperty:", data.subjectProperty?.propertyName, "unitTypes:", data.subjectProperty?.unitTypes.length);
  console.log("comps[0] (rank1):", JSON.stringify(comps[0], null, 2));

  // Dump to JSON for manual review.
  const outPath = path.join(__dirname, "verify-output.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify({ subjectProperty: data.subjectProperty, comps, compDetails: data.compDetails, excel: excel?.comps ?? [] }, null, 2)
  );
  console.log(`\nFull output written to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
