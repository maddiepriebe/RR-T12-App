import { NextRequest, NextResponse } from "next/server";
import { parseCoStarPages } from "@/lib/costar-parser";

// PDF text is extracted client-side; this route receives { pages: string[], subjectName: string }.
// Pure regex parsing — zero AI calls, sub-2-second response time.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  try {
    const body = await req.json() as { pages?: string[]; subjectName?: string };
    const pages = body.pages;
    const subjectName = body.subjectName?.trim() ?? "";

    if (!pages?.length) {
      return NextResponse.json({ error: "No PDF text provided" }, { status: 400 });
    }

    const totalChars = pages.reduce((s: number, p: string) => s + p.length, 0);
    console.log(
      `[rentcomps/process] Received ${pages.length} pages, ${totalChars} chars. ` +
      `Parsing started at +${Date.now() - t0}ms`
    );

    const data = parseCoStarPages(pages, subjectName);

    console.log(
      `[rentcomps/process] Parsing done — ${data.comps.length} comps (incl. subject), ` +
      `${data.compDetails.length} detail sections. Total time: ${Date.now() - t0}ms`
    );

    if (!data.comps.length && !data.subjectProperty) {
      return NextResponse.json(
        { error: "Could not parse any comp data from this PDF. Please verify it is a CoStar Underwriting Report." },
        { status: 422 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error(`[rentcomps/process] Error after ${Date.now() - t0}ms:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Processing failed" },
      { status: 500 }
    );
  }
}
