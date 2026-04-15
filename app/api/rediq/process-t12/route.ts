import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { callClaude, parseClaudeJSON } from "@/lib/anthropic";
import { parsePDF } from "@/lib/pdf-parser";
import { validateUpload } from "@/lib/upload-guard";
import { rateLimit } from "@/lib/rate-limit";
import type { T12Data } from "@/lib/schemas";

const T12_SYSTEM_PROMPT = `You are a multifamily real estate analyst assistant. You will receive raw data extracted from a T12 (Trailing 12-Month Income Statement) document in an unknown format.

Your job is to:
1. Identify what each row/column represents
2. Map it to the standardized schema provided
3. Return ONLY a valid JSON object matching the schema — no markdown, no commentary, no code fences
4. If a field cannot be found, use null
5. Normalize all dollar amounts to numbers (no $ signs or commas)
6. Normalize all dates to YYYY-MM-DD format

SCHEMA:
{
  "propertyName": string | null,
  "period": string | null,
  "unitCount": number | null,
  "lineItems": [
    {
      "category": "income" | "expense" | "noi",
      "label": string,
      "actual": number | null,
      "perUnit": number | null,
      "pctEGI": number | null,
      "isSubtotal": boolean,
      "isTotal": boolean,
      "indent": number
    }
  ]
}

INCOME line items to identify and map (use these exact labels):
- Gross Potential Rent (GPR)
- Loss to Lease
- Vacancy Loss
- Concessions
- Bad Debt / Credit Loss
- Pet Fees
- Parking Income
- Laundry Income
- Storage Income
- Other Income
- Effective Gross Income (EGI)  [isSubtotal: true]

EXPENSE line items:
- Payroll & Benefits
- Repairs & Maintenance
- Electric
- Gas
- Water / Sewer
- Insurance
- Real Estate Taxes
- Management Fee
- Administrative
- Marketing / Advertising
- Contract Services
- Capital Expenditures / Replacements
- Total Operating Expenses  [isTotal: true]

NOI:
- Net Operating Income  [isTotal: true, category: "noi"]

For subcategories, use indent: 1. For totals/subtotals set the flag and indent: 0.
If a line item from the source doesn't match any standard item, include it as "Other Income" or create an appropriately labeled item.`;

async function extractTextFromFile(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = file.name.split(".").pop()?.toLowerCase();

  if (ext === "pdf") {
    const parsed = await parsePDF(buffer);
    return parsed.text;
  }

  if (ext === "csv" || ext === "txt") {
    return buffer.toString("utf-8");
  }

  // For xlsx/xls, convert to CSV-like text using XLSX
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

    const rl = rateLimit(`t12:${userId}`, 10, 60_000);
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

    const rawText = await extractTextFromFile(file);

    if (!rawText.trim()) {
      return NextResponse.json({ error: "Could not extract text from file" }, { status: 400 });
    }

    const response = await callClaude(
      T12_SYSTEM_PROMPT,
      `Raw T12 data to map:\n\n${rawText.slice(0, 50000)}`,
      8192
    );

    const t12Data = parseClaudeJSON<T12Data>(response);

    return NextResponse.json({ success: true, data: t12Data });
  } catch (err) {
    console.error("T12 processing error:", err);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
