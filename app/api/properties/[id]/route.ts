import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getDb, properties, reports } from "@/lib/db";
import { eq, and } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const db = getDb();
    const [prop] = await db
      .select()
      .from(properties)
      .where(and(eq(properties.id, params.id), eq(properties.clerkUserId, userId)));

    if (!prop) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json(prop);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const db = getDb();

    // Verify ownership before deleting
    const [prop] = await db
      .select({ id: properties.id })
      .from(properties)
      .where(and(eq(properties.id, params.id), eq(properties.clerkUserId, userId)));

    if (!prop) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Delete all associated reports first (FK constraint)
    await db.delete(reports).where(eq(reports.propertyId, params.id));

    // Delete the property
    await db.delete(properties).where(eq(properties.id, params.id));

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
