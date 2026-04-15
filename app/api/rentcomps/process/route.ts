/**
 * POST /api/rentcomps/process
 *
 * Parses CoStar PDF page text into structured RentCompsData using the regex parser.
 * If the regex parser finds no comps, responds with { status: "no_comps", data: null }
 * so the client can prompt the user to retry via the AI path (/api/costar-parse).
 *
 * Body:    { pages: string[], subjectName: string }
 * Response: { status: "ok", data: RentCompsData } | { status: "no_comps", data: null }
 */

import { auth } from "@clerk/nextjs/server";
import { parseCoStarPages } from "@/lib/costar-parser";
import { rateLimit } from "@/lib/rate-limit";

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

    console.log(`[rentcomps/process] pages=${pages.length} subject="${subjectName}"`);

    const result = parseCoStarPages(pages, subjectName);

    if (result.comps.length === 0) {
      console.log("[rentcomps/process] regex parser found no comps — signalling no_comps");
      return Response.json({ status: "no_comps", data: null });
    }

    return Response.json({ status: "ok", data: result });
  } catch (err) {
    console.error("[rentcomps/process] error:", err);
    return Response.json({ error: "Unexpected error" }, { status: 500 });
  }
}
