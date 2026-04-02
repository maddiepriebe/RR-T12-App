import { NextRequest, NextResponse } from "next/server";
import { buildT12Workbook, workbookToBuffer } from "@/lib/excel-builder";
import { buildRedIQWorkbook } from "@/lib/rediq-builder";
import * as XLSX from "xlsx";
import type { T12Data, RentRollData } from "@/lib/schemas";
import type { ParsedRentRoll } from "@/lib/yardi-parser";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { t12, rentRoll, rentRollFormat } = body as {
      t12?: T12Data;
      rentRoll?: RentRollData | ParsedRentRoll;
      rentRollFormat?: "yardi" | "generic";
    };

    if (!t12 && !rentRoll) {
      return NextResponse.json({ error: "No data provided" }, { status: 400 });
    }

    let buf: Buffer;
    let filename: string;

    if (rentRoll && rentRollFormat === "yardi") {
      // Build the redIQ-format workbook (Source Data / Rent Roll / Floor Plan sheets)
      const parsed = rentRoll as ParsedRentRoll;
      const wb = buildRedIQWorkbook(parsed);

      if (t12) {
        // Also add the T12 sheet
        const t12Sheet = buildT12Workbook(t12 as T12Data);
        const t12ws = t12Sheet.Sheets["T12 Summary"];
        XLSX.utils.book_append_sheet(wb, t12ws, "T12 Summary");
      }

      buf = workbookToBuffer(wb);
      filename = `${(parsed.propertyName || "RentRoll").replace(/[^a-z0-9]/gi, "_")}_redIQ.xlsx`;
    } else {
      // Generic format — use the simple T12/RR builder
      const wb = buildT12Workbook(
        t12 as T12Data,
        rentRoll as RentRollData | undefined
      );
      buf = workbookToBuffer(wb);
      const propertyName = t12?.propertyName || (rentRoll as RentRollData)?.propertyName || "Underwriting";
      filename = `${propertyName.replace(/[^a-z0-9]/gi, "_")}_T12.xlsx`;
    }

    return new NextResponse(buf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buf.length),
      },
    });
  } catch (err) {
    console.error("Download error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Download failed" },
      { status: 500 }
    );
  }
}
