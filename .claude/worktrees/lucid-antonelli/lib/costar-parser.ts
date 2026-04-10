/**
 * Claude AI-powered CoStar Underwriting Report parser.
 *
 * Replaces regex heuristics with structured Claude API extraction.
 * Text is chunked here (client-safe, pure string ops) and sent to
 * /api/costar-parse, where the server calls Claude and returns RentCompsData.
 *
 * Public interface: parseCoStarPages(pages, subjectName) → Promise<RentCompsData>
 * (was synchronous; now async to support the server round-trip)
 */

import type { RentCompsData } from "./schemas";

/**
 * Sanity-check: extract the expected comp count from the overview text.
 * CoStar prints something like "17$2,938 … No. Rent Comps" near the top.
 * Used after assembly to warn if Claude returned fewer comps than expected.
 */
export function extractCompCount(fullText: string): number {
  const noCompsIdx = fullText.indexOf("No. Rent Comps");
  if (noCompsIdx === -1) return 0;

  // Count appears just before the label, often concatenated with a $ amount: "17$2,938..."
  const before = fullText.slice(Math.max(0, noCompsIdx - 400), noCompsIdx);
  const matches = [...before.matchAll(/(\d{1,3})\$/g)];
  const valid = matches.filter((m) => {
    const n = parseInt(m[1], 10);
    return n >= 1 && n <= 100;
  });
  if (valid.length > 0) return parseInt(valid[valid.length - 1][1], 10);

  // Fallback: number right after the label
  const after = fullText.slice(noCompsIdx, noCompsIdx + 200);
  const m2 = after.match(/No\.\s*Rent\s*Comps[\s\S]{0,60}?(\d{1,3})/);
  if (m2) {
    const n = parseInt(m2[1], 10);
    if (n >= 1 && n <= 100) return n;
  }
  return 0;
}

/**
 * Split the pages array into a summary chunk and batched detail chunks.
 *
 * - Summary chunk  : pages from "Rent Comparables Summary" through "Photo Comparison"
 *                    (or through the last page before the first "Unit Breakdown" page
 *                    if the photo page has too little text to match)
 * - Detail chunks  : remaining pages, 3 per batch
 */
function splitIntoChunks(pages: string[]): {
  summaryChunk: string;
  detailChunks: string[];
} {
  // First page that contains the summary table
  const summaryStart = pages.findIndex((p) =>
    /Rent\s+Comparables?\s+Summary/i.test(p)
  );
  const startIdx = Math.max(0, summaryStart);

  // Primary anchor: page that contains the photo grid
  const photoIdx = pages.findIndex(
    (p, i) => i > startIdx && /Photo\s+Comparison/i.test(p)
  );

  // Secondary anchor: first page after the summary that has a unit breakdown
  // table header — this is always the first comp detail page.
  const unitBreakdownIdx = pages.findIndex(
    (p, i) => i > startIdx + 1 && /Unit\s+Breakdown/i.test(p)
  );

  // Prefer photo anchor (+1 to skip the photo page itself); fall back to the
  // unit-breakdown page (it IS a detail page so no +1); last resort: +5.
  const detailStartIdx =
    photoIdx !== -1
      ? photoIdx + 1
      : unitBreakdownIdx !== -1
        ? unitBreakdownIdx
        : startIdx + 5;

  const summaryChunk = pages.slice(startIdx, detailStartIdx).join("\n");

  // Batch detail pages 3 at a time
  const BATCH = 3;
  const detailPages = pages.slice(detailStartIdx);
  const detailChunks: string[] = [];
  for (let i = 0; i < detailPages.length; i += BATCH) {
    detailChunks.push(
      detailPages.slice(i, i + BATCH).join("\n\n---PAGE BREAK---\n\n")
    );
  }

  console.log(
    `[splitIntoChunks] total pages: ${pages.length} | ` +
    `summaryStart: ${summaryStart} | photoIdx: ${photoIdx} | ` +
    `unitBreakdownIdx: ${unitBreakdownIdx} | detailStartIdx: ${detailStartIdx} | ` +
    `detail pages: ${detailPages.length} | chunks (×3): ${detailChunks.length}`
  );

  return { summaryChunk, detailChunks };
}

/**
 * Main entry point.
 *
 * Splits pages into chunks (pure string ops, safe to run in the browser),
 * then POSTs them to /api/costar-parse where Claude does the extraction.
 * Throws on network or API errors so the caller's catch block can surface
 * an error toast to the user.
 */
export async function parseCoStarPages(
  pages: string[],
  subjectName: string
): Promise<RentCompsData> {
  const fullText = pages.join("\n");
  const expectedCount = extractCompCount(fullText);

  const { summaryChunk, detailChunks } = splitIntoChunks(pages);

  const response = await fetch("/api/costar-parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ summaryChunk, detailChunks, subjectName, expectedCount }),
  });

  if (!response.ok) {
    const msg = await response.text().catch(() => response.statusText);
    throw new Error(`CoStar parse API error ${response.status}: ${msg}`);
  }

  return response.json() as Promise<RentCompsData>;
}
