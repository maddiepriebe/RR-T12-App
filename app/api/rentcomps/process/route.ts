import { NextRequest, NextResponse } from "next/server";
import { parseCoStarPages } from "@/lib/costar-parser";

// PDF text is extracted client-side; this route receives { pages: string[], subjectName: string }.
// Pure regex parsing — zero AI calls, sub-2-second response time.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { pages?: string[]; subjectName?: string };
    const pages = body.pages;
    const subjectName = body.subjectName?.trim() ?? "";

    if (!pages?.length) {
      return NextResponse.json({ error: "No PDF text provided" }, { status: 400 });
    }

    const data = parseCoStarPages(pages, subjectName);

    if (!data.comps.length && !data.subjectProperty) {
      return NextResponse.json(
        { error: "Could not parse any comp data from this PDF. Please verify it is a CoStar Underwriting Report." },
        { status: 422 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error("Rent comps processing error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Processing failed" },
      { status: 500 }
    );
  }
}
