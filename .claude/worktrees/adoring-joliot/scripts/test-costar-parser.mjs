/**
 * Diagnostic — mirrors the parser's exact section-finding logic.
 * Run: node scripts/test-costar-parser.mjs
 */
import { readFileSync } from "fs";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const PDF_PATH = "/Users/madelinepriebe/Desktop/Arel - Feb 2026/Elme Bethesda Costar.pdf";
const buf = readFileSync(PDF_PATH);
const parsed = await pdfParse(buf);
const t = parsed.text;
console.log(`Total chars: ${t.length}\n`);

// ── Replicate parser's section finding ──────────────────────────────
const noCompsIdx = t.indexOf("No. Rent Comps");
console.log(`"No. Rent Comps" at char ${noCompsIdx}`);

// Expected count (same logic as parser)
let expectedCount = 0;
if (noCompsIdx !== -1) {
  const before = t.slice(Math.max(0, noCompsIdx - 400), noCompsIdx);
  const allMatches = [...before.matchAll(/(\d{1,3})\$/g)];
  const validMatches = allMatches.filter(m => { const n = parseInt(m[1]); return n >= 1 && n <= 100; });
  if (validMatches.length > 0) expectedCount = parseInt(validMatches[validMatches.length - 1][1]);
  console.log(`Expected count: ${expectedCount}`);
}

// Section bounds (same as parser)
const searchArea = t.slice(Math.max(0, noCompsIdx - 20000), noCompsIdx + 500);
const rcOffset = searchArea.lastIndexOf("Rent Comparables Summary");
const sectionStart = rcOffset !== -1 ? Math.max(0, noCompsIdx - 20000) + rcOffset : Math.max(0, noCompsIdx - 1000);
const photoIdx = t.indexOf("Photo Comparison", sectionStart + 500);
const sectionEnd = photoIdx !== -1 ? photoIdx : t.length;
console.log(`Section: chars ${sectionStart}–${sectionEnd} (${sectionEnd - sectionStart} chars)\n`);

const section = t.slice(sectionStart, sectionEnd);
const lines = section.split("\n");
console.log(`Section lines: ${lines.length}`);

// ── Rank-anchored extraction (mirrors parser) ──────────────────────
const STANDALONE_RANK = /^(\d{1,2})$/;
const STANDALONE_YEAR = /^(19|20)\d{2}$/;
const DATA_LINE_RE = /\$\d+\.\d{2}/;

const seenRanks = new Set();
const extracted = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  const rm = STANDALONE_RANK.exec(line);
  if (!rm) continue;
  const rank = parseInt(rm[1]);
  if (rank < 1 || rank > 99) continue;
  if (seenRanks.has(rank)) continue;

  // Backward scan for data line (data is BEFORE rank in detailed section)
  let dataLine = null, dataLineIdx = i;
  for (let j = i - 1; j >= Math.max(0, i - 8); j--) {
    const jl = lines[j].trim();
    if (STANDALONE_RANK.test(jl) && parseInt(jl) !== rank) break;
    if (DATA_LINE_RE.test(jl) && (jl.match(/\$/g) ?? []).length >= 2) {
      dataLine = jl; dataLineIdx = j; break;
    }
  }

  // Forward scan for year (and fallback data), stop at next rank
  let yearBuilt = null;
  for (let j = i + 1; j < Math.min(lines.length, i + 12); j++) {
    const jl = lines[j].trim();
    if (STANDALONE_RANK.test(jl) && parseInt(jl) !== rank) break;
    if (!yearBuilt && STANDALONE_YEAR.test(jl)) yearBuilt = parseInt(jl);
    if (!dataLine && DATA_LINE_RE.test(jl) && (jl.match(/\$/g) ?? []).length >= 2) {
      dataLine = jl; dataLineIdx = j;
    }
  }

  if (!dataLine) { console.log(`Rank ${rank}: NO DATA LINE`); continue; }

  // Property name: look back from earlier of rank/dataLine
  const lookFrom = Math.min(i, dataLineIdx);
  let rawName = "";
  for (let j = lookFrom - 1; j >= Math.max(0, lookFrom - 15); j--) {
    const prev = lines[j].trim();
    if (!prev) continue;
    if (STANDALONE_RANK.test(prev) && parseInt(prev) !== rank) break;
    if (/^\d+$/.test(prev)) continue;
    if (/\$/.test(prev)) continue;
    if (STANDALONE_YEAR.test(prev)) continue;
    if (/^\d{2,6}\s+[A-Za-z]/.test(prev)) continue;
    if (!/[A-Za-z]/.test(prev)) continue;
    rawName = prev; break;
  }

  seenRanks.add(rank);
  extracted.push({ rank, rawName, yearBuilt, dataLine });
}

console.log(`\n=== EXTRACTED COMPS (${extracted.length} / ${expectedCount} expected) ===`);
for (const c of extracted.sort((a, b) => a.rank - b.rank)) {
  console.log(`  ${c.rank}. "${c.rawName}" (${c.yearBuilt ?? 'year?'}) — ${c.dataLine.slice(0, 70)}`);
}

// Show context around rank 1 in the section
const r1 = lines.findIndex(l => l.trim() === "1");
if (r1 !== -1) {
  console.log(`\n=== LINES AROUND RANK 1 (idx ${r1}) ===`);
  lines.slice(Math.max(0, r1 - 6), r1 + 8).forEach((l, i) =>
    console.log(`  [${r1 - 6 + i}]: ${JSON.stringify(l)}`)
  );
}
