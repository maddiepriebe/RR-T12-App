import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { buildRentCompsWorkbook, workbookToBuffer } from "@/lib/excel-builder";
import { rateLimit } from "@/lib/rate-limit";
import type { RentCompsData } from "@/lib/schemas";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rl = rateLimit(`rentcomps-download:${userId}`, 20, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
      );
    }

    const data = (await req.json()) as RentCompsData;

    if (!data || (!data.comps?.length && !data.subjectProperty)) {
      return NextResponse.json({ error: "No comp data provided" }, { status: 400 });
    }

    const wb = buildRentCompsWorkbook(data);
    const buf = workbookToBuffer(wb);

    const subjectName =
      data.subjectProperty?.propertyName ||
      data.comps.find((c) => c.isSubject)?.name ||
      "RentComps";
    const filename = `${subjectName.replace(/[^a-z0-9]/gi, "_")}_Comps.xlsx`;

    return new NextResponse(buf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buf.length),
      },
    });
  } catch (err) {
    console.error("Rent comps download error:", err);
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
}
