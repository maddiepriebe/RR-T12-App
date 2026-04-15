import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getDb, reports, properties } from "@/lib/db";
import { and, eq, desc } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const db = getDb();

    // Verify property ownership
    const [prop] = await db
      .select({ id: properties.id })
      .from(properties)
      .where(and(eq(properties.id, params.id), eq(properties.clerkUserId, userId)));

    if (!prop) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Exclude processedData from the list — it can be large; fetch per-report when needed
    const rows = await db
      .select({
        id: reports.id,
        propertyId: reports.propertyId,
        type: reports.type,
        label: reports.label,
        excelUrl: reports.excelUrl,
        metadata: reports.metadata,
        createdAt: reports.createdAt,
      })
      .from(reports)
      .where(eq(reports.propertyId, params.id))
      .orderBy(desc(reports.createdAt));

    return NextResponse.json(rows);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { type, label, excelUrl, metadata, processedData } = body;

    const db = getDb();

    // Verify property ownership before inserting a report against it
    const [prop] = await db
      .select({ id: properties.id })
      .from(properties)
      .where(and(eq(properties.id, params.id), eq(properties.clerkUserId, userId)));

    if (!prop) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [report] = await db
      .insert(reports)
      .values({ propertyId: params.id, type, label, excelUrl, metadata, processedData })
      .returning();

    return NextResponse.json(report, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
