/**
 * Pulls per-property target values from the Excel workbook and diffs them
 * against the parser's output.
 */
import fs from "fs";
import * as XLSX from "xlsx";
// @ts-expect-error legacy build has no types
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.js";
import { parseCoStarPages } from "../lib/costar-parser";

const PDF = "/Users/madelinepriebe/Desktop/Arel - Feb 2026/Elme Bethesda Costar.pdf";
const XLS = "/Users/madelinepriebe/Desktop/Arel - Feb 2026/Elme Bethesda - Rent Comps 202603.xlsx";

async function extractPages(): Promise<string[]> {
  const data = new Uint8Array(fs.readFileSync(PDF));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const byY = new Map<number, { x: number; str: string }[]>();
    for (const item of content.items as Array<{ str: string; transform: number[] }>) {
      const y = Math.round(item.transform[5]);
      const x = item.transform[4];
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y)!.push({ x, str: item.str });
    }
    const ys = [...byY.keys()].sort((a, b) => b - a);
    pages.push(
      ys
        .map((y) =>
          byY.get(y)!.sort((a, b) => a.x - b.x).map((r) => r.str).join(" ").replace(/\s+/g, " ").trim()
        )
        .filter(Boolean)
        .join("\n")
    );
  }
  return pages;
}

interface ExcelTarget {
  name: string;
  yearBuilt: string | number | null;
  unitRowCount: number;
}

function loadExcelTargets(): Map<string, ExcelTarget> {
  const wb = XLSX.readFile(XLS);
  const sh = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json<(string | number | null)[]>(sh, {
    header: 1,
    defval: null,
  });
  const targets = new Map<string, ExcelTarget>();
  for (const row of aoa) {
    if (!row || !row.length) continue;
    const name = row[0];
    const bed = row[1];
    if (typeof name !== "string" || !name.trim()) continue;
    if (name === "Property Name") continue; // header
    if (!bed) continue; // totals/blank row
    const yr = row[11]; // Vintage
    const t = targets.get(name) ?? { name, yearBuilt: null, unitRowCount: 0 };
    if (t.yearBuilt == null && yr != null) t.yearBuilt = yr;
    t.unitRowCount++;
    targets.set(name, t);
  }
  return targets;
}

async function main() {
  const pages = await extractPages();
  const data = parseCoStarPages(pages, "Elme Bethesda");
  const parsedComps = data.comps.filter((c) => !c.isSubject);
  const targets = loadExcelTargets();

  console.log("Excel target properties:");
  for (const t of targets.values()) {
    console.log(`  ${t.name.padEnd(30)}  yr=${t.yearBuilt ?? "—"}  unitRows=${t.unitRowCount}`);
  }

  console.log("\n── Per-rank comparison ──");
  console.log(
    "rank".padEnd(5) +
      "parser name".padEnd(35) +
      "excel name".padEnd(25) +
      "parser.yr".padEnd(12) +
      "excel.yr".padEnd(14) +
      "parser.ut  excel.ut"
  );

  const excelList = [...targets.values()];

  for (const c of parsedComps) {
    // Try to match Excel target by first-word fuzzy match.
    const firstWord = c.name.toLowerCase().split(/\s+/)[0];
    const match =
      excelList.find((t) => t.name.toLowerCase().startsWith(firstWord)) ??
      excelList.find((t) => c.name.toLowerCase().includes(t.name.toLowerCase().slice(0, 10))) ??
      null;
    const det = data.compDetails.find((d) => d.propertyName === c.name);
    const indivRows = det?.unitTypes.filter((u) => u.label && !u.label.startsWith("All") && u.label !== "Totals").length ?? 0;
    console.log(
      String(c.rank).padEnd(5) +
        c.name.slice(0, 33).padEnd(35) +
        (match?.name ?? "(no match)").slice(0, 23).padEnd(25) +
        String(c.yearBuilt ?? "—").padEnd(12) +
        String(match?.yearBuilt ?? "—").padEnd(14) +
        String(indivRows).padEnd(11) +
        String(match?.unitRowCount ?? "—")
    );
  }

  // Also compare subject.
  const subj = data.subjectProperty;
  const subjTarget = excelList.find((t) => t.name.toLowerCase().includes("elme"));
  console.log("\n── Subject ──");
  console.log(`parser: ${subj?.propertyName}  yr=${subj?.yearBuilt}  unitTypes=${subj?.unitTypes.length}`);
  console.log(`excel : ${subjTarget?.name}  yr=${subjTarget?.yearBuilt}  unitRows=${subjTarget?.unitRowCount}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
