/**
 * POST /api/rentcomps/process
 *
 * Parses CoStar PDF page text into structured RentCompsData.
 * Set USE_REGEX_PARSER=true in .env.local to use the regex parser;
 * omit or set to false to use the AI parser.
 *
 * Body:    { pages: string[], subjectName: string }
 * Response: RentCompsData
 *
 * NOTE: lib/costar-parser.ts exports `parseCoStarPages`, not `parseCoStarPDF`.
 * To use the exact import alias below, add this one line to lib/costar-parser.ts:
 *   export { parseCoStarPages as parseCoStarPDF }
 * Until then the alias is applied here.
 */

import { auth } from "@clerk/nextjs/server";
import { parseCoStarPages } from "@/lib/costar-parser";
import { parseCoStarPDF as parseWithRegex } from "@/lib/costar-parser-regex";
import { rateLimit } from "@/lib/rate-limit";
import type { RentCompsData } from "@/lib/schemas";

const USE_REGEX_PARSER = process.env.USE_REGEX_PARSER === "true";

// Alias so both parsers share the same call signature.
// Replace with: import { parseCoStarPDF as parseWithAI } from "@/lib/costar-parser";
// once that file exports parseCoStarPDF.
const parseWithAI = (pages: string[], subjectName: string): RentCompsData =>
  parseCoStarPages(pages, subjectName);

const parseCoStarPDF = USE_REGEX_PARSER ? parseWithRegex : parseWithAI;

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const rl = rateLimit(`rentcomps-process:${userId}`, 10, 60_000);
    if (!rl.ok) {
      return Response.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
      );
    }

    const body = await req.json();
    const pages: string[] = body.pages ?? [];
    const subjectName: string = body.subjectName ?? "";

    if (!Array.isArray(pages) || pages.length === 0) {
      return Response.json({ error: "pages must be a non-empty array of strings" }, { status: 400 });
    }

    console.log(
      `[rentcomps/process] parser=${USE_REGEX_PARSER ? "regex" : "ai"} ` +
        `pages=${pages.length} subject="${subjectName}"`
    );

    const result = parseCoStarPDF(pages, subjectName);
    return Response.json(result);
  } catch (err) {
    console.error("[rentcomps/process] error:", err);
    return Response.json({ error: "Unexpected error" }, { status: 500 });
  }
}
