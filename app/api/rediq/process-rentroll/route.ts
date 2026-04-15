import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { callClaude, parseClaudeJSON } from "@/lib/anthropic";
import { parsePDF } from "@/lib/pdf-parser";
import { isYardiFormat, parseYardiRentRoll } from "@/lib/yardi-parser";
import { validateUpload } from "@/lib/upload-guard";
import { rateLimit } from "@/lib/rate-limit";
import type { RentRollData } from "@/lib/schemas";

// ─── Claude fallback for non-Yardi formats ─────────────────────────
const RENT_ROLL_SYSTEM_PROMPT = `You are a multifamily real estate analyst assistant. You will receive raw data extracted from a Rent Roll document in an unknown format.

Your job is to:
1. Identify what each row/column represents
2. Map it to the standardized schema provided
3. Return ONLY a valid JSON object — no markdown, no commentary, no code fences
4. If a field cannot be found, use null
5. Normalize all dollar amounts to numbers (no $ signs or commas)
6. Normalize all dates to YYYY-MM-DD format
7. For Status, map to exactly: "Occupied", "Vacant", or "Notice"

SCHEMA:
{
  "propertyName": string | null,
  "date": string | null,
  "units": [
    {
      "unit": string | null,
      "unitType": string | null,
      "bed": number | null,
      "bath": number | null,
      "sqFt": number | null,
      "tenantName": string | null,
      "leaseStart": string | null,
      "leaseEnd": string | null,
      "marketRent": number | null,
      "actualRent": number | null,
      "lossToLease": number | null,
      "status": "Occupied" | "Vacant" | "Notice" | null,
      "moveInDate": string | null,
      "notes": string | null
    }
  ]
}

For lossToLease: calculate as (marketRent - actualRent) if not explicitly provided.
For status: "Vacant" if no tenant / zero rent, "Notice" if notice given, "Occupied" otherwise.
Include every unit row — do not skip vacant units.`;

async function extractTextFromExcel(buffer: Buffer): Promise<string> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "buffer" });
  const results: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(ws);
    results.push(`Sheet: ${sheetName}\n${csv}`);
  }
  return results.join("\n\n");
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rl = rateLimit(`rentroll:${userId}`, 10, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const v = validateUpload(file);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status ?? 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = file.name.split(".").pop()?.toLowerCase();

    // ── Yardi format: deterministic parse, no AI needed ──────────
    if ((ext === "xlsx" || ext === "xls") && (await isYardiFormat(buffer))) {
      const parsed = await parseYardiRentRoll(buffer);
      return NextResponse.json({ success: true, data: parsed, format: "yardi" });
    }

    // ── Generic format: extract text and use Claude ───────────────
    let rawText = "";

    if (ext === "pdf") {
      const pdf = await parsePDF(buffer);
      rawText = pdf.text;
    } else if (ext === "csv" || ext === "txt") {
      rawText = buffer.toString("utf-8");
    } else {
      rawText = await extractTextFromExcel(buffer);
    }

    if (!rawText.trim()) {
      return NextResponse.json({ error: "Could not extract text from file" }, { status: 400 });
    }

    const response = await callClaude(
      RENT_ROLL_SYSTEM_PROMPT,
      `Raw Rent Roll data to map:\n\n${rawText.slice(0, 80000)}`,
      16000
    );

    const rrData = parseClaudeJSON<RentRollData>(response);
    return NextResponse.json({ success: true, data: rrData, format: "generic" });
  } catch (err) {
    console.error("Rent roll processing error:", err);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
