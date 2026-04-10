/**
 * Client-side PDF text extraction using PDF.js loaded from CDN.
 *
 * Text items are grouped by y-coordinate so the output preserves
 * the original line structure of each page. This is critical for
 * the regex-based CoStar parser which expects clean line-by-line text.
 *
 * Loading from CDN avoids all webpack bundling issues with pdfjs-dist's
 * optional `canvas` peer dependency. The CDN script is only fetched
 * when the user actually processes a file.
 */

const PDFJS_VERSION = "3.11.174";
const PDFJS_CDN = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;

let _loaded = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadPdfJs(): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (_loaded) return (window as any).pdfjsLib;

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${PDFJS_CDN}/pdf.min.js`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load PDF.js from CDN"));
    document.head.appendChild(script);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lib = (window as any).pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.min.js`;
  _loaded = true;
  return lib;
}

export async function extractPDFPages(file: File): Promise<string[]> {
  const pdfjsLib = await loadPdfJs();

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise as {
    numPages: number;
    getPage: (n: number) => Promise<{
      getTextContent: () => Promise<{
        // width is in the same PDF user-space units as transform[4] (x)
        items: Array<{ str: string; transform: number[]; width?: number }>;
      }>;
    }>;
  };

  const pages: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    // Group text items by y-coordinate to reconstruct visual lines.
    // PDF coordinate space: y increases upward, so we sort y descending
    // (largest y = top of page) for natural reading order.
    // Round to nearest 2 units to merge items on the same visual line
    // that may have slightly different baselines due to font metrics.
    const lineMap = new Map<number, Array<{ x: number; str: string; width: number }>>();

    for (const item of textContent.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const y = Math.round(item.transform[5] / 2) * 2;
      const x = item.transform[4];
      // width comes from PDF.js in the same user-space units as x.
      // Fall back to a character-count estimate (5 pts/char) if absent.
      const width = item.width ?? item.str.length * 5;
      if (!lineMap.has(y)) lineMap.set(y, []);
      lineMap.get(y)!.push({ x, str: item.str, width });
    }

    // Sort lines top-to-bottom; sort items within each line left-to-right.
    // Use the gap between the end of one item and the start of the next to
    // determine how many spaces to insert.  A gap of ≤2 pts = tight/touching
    // (0 extra spaces inserted beyond the mandatory 1).  Larger gaps scale
    // proportionally, so CoStar column separators (≥8–10 pts) always produce
    // 2+ spaces — which is what extractRentComps splits on.
    const lines = [...lineMap.entries()]
      .sort(([ya], [yb]) => yb - ya)
      .map(([, items]) => {
        const sorted = items.sort((a, b) => a.x - b.x);
        if (sorted.length === 0) return "";

        let line = sorted[0].str;
        let prevEnd = sorted[0].x + sorted[0].width;

        for (let i = 1; i < sorted.length; i++) {
          const gap = sorted[i].x - prevEnd;
          // ceil(gap / 3) spaces: gap of 0–3 pts → 1 sp, 3–6 pts → 2 sp,
          // 6–9 pts → 3 sp, etc.  Minimum 1 so words never run together.
          const spaces = gap <= 0 ? 1 : Math.max(1, Math.ceil(gap / 3));
          line += " ".repeat(spaces) + sorted[i].str;
          prevEnd = sorted[i].x + sorted[i].width;
        }

        return line.trim();
      })
      .filter((line) => line.length > 0);

    pages.push(lines.join("\n"));
  }

  return pages;
}
