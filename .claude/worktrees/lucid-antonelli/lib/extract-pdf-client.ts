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
        items: Array<{ str: string; transform: number[] }>;
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
    const lineMap = new Map<number, Array<{ x: number; str: string }>>();

    for (const item of textContent.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const y = Math.round(item.transform[5] / 2) * 2;
      const x = item.transform[4];
      if (!lineMap.has(y)) lineMap.set(y, []);
      lineMap.get(y)!.push({ x, str: item.str });
    }

    // Sort lines top-to-bottom; sort items within each line left-to-right.
    const lines = [...lineMap.entries()]
      .sort(([ya], [yb]) => yb - ya)
      .map(([, items]) =>
        items
          .sort((a, b) => a.x - b.x)
          .map((i) => i.str)
          .join(" ")
          .trim()
      )
      .filter((line) => line.length > 0);

    pages.push(lines.join("\n"));
  }

  return pages;
}
