import { Buffer } from "buffer";

export interface ParsedPDF {
  text: string;
  pages: string[];
  numPages: number;
}

export async function parsePDF(buffer: Buffer): Promise<ParsedPDF> {
  // Dynamic import to avoid issues with Next.js server components
  const pdfParse = (await import("pdf-parse")).default;
  const data = await pdfParse(buffer);

  // Split into pages using form feed character
  const pages = data.text.split("\f").map((p: string) => p.trim());

  return {
    text: data.text,
    pages,
    numPages: data.numpages,
  };
}

export function findPagesByKeyword(
  pages: string[],
  keyword: string
): number[] {
  return pages.reduce<number[]>((acc, page, idx) => {
    if (page.toLowerCase().includes(keyword.toLowerCase())) {
      acc.push(idx);
    }
    return acc;
  }, []);
}

export function extractPageRange(pages: string[], start: number, end: number): string {
  return pages.slice(start, end + 1).join("\n\n---PAGE BREAK---\n\n");
}

/**
 * For CoStar PDFs: identify which pages contain the summary table,
 * vacancy table, and individual comp detail pages.
 */
export function identifyCoStarSections(pages: string[]): {
  summaryPages: number[];
  vacancyPages: number[];
  compDetailPages: Array<{ name: string; pageIdx: number }>;
  subjectPages: number[];
} {
  const summaryPages: number[] = [];
  const vacancyPages: number[] = [];
  const compDetailPages: Array<{ name: string; pageIdx: number }> = [];
  const subjectPages: number[] = [];

  pages.forEach((page, idx) => {
    const lower = page.toLowerCase();

    // Summary / rent comp overview pages
    if (
      lower.includes("rent comparables") &&
      (lower.includes("asking rent") || lower.includes("year built"))
    ) {
      summaryPages.push(idx);
    }

    // Vacancy/availability table
    if (lower.includes("vacancy") && lower.includes("availability") && lower.includes("concession")) {
      vacancyPages.push(idx);
    }

    // Individual comp detail pages — look for unit mix breakdown headers
    if (
      lower.includes("unit mix") ||
      (lower.includes("all 1 bed") && lower.includes("all 2 bed"))
    ) {
      // Try to extract property name from first non-empty line
      const lines = page.split("\n").filter((l) => l.trim().length > 0);
      const name = lines[0]?.trim() || `Comp Page ${idx + 1}`;
      compDetailPages.push({ name, pageIdx: idx });
    }

    // Subject property pages (typically early in report)
    if (
      (lower.includes("subject") || lower.includes("subject property")) &&
      lower.includes("unit mix") &&
      idx < 10
    ) {
      subjectPages.push(idx);
    }
  });

  return { summaryPages, vacancyPages, compDetailPages, subjectPages };
}
