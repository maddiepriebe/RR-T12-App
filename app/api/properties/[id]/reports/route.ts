import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db, reports, properties } from "@/lib/db";
import { eq, desc } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Verify property ownership
    const [prop] = await db
      .select({ id: properties.id })
      .from(properties)
      .where(eq(properties.id, params.id));

    if (!prop) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const rows = await db
      .select()
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
    const { type, label, excelUrl, metadata } = body;

    const [report] = await db
      .insert(reports)
      .values({ propertyId: params.id, type, label, excelUrl, metadata })
      .returning();

    return NextResponse.json(report, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
