import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getDb, reports, properties } from "@/lib/db";
import { eq, and } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; reportId: string } }
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

    const [report] = await db
      .select()
      .from(reports)
      .where(and(eq(reports.id, params.reportId), eq(reports.propertyId, params.id)));

    if (!report) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json(report);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
