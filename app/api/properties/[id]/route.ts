import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db, properties } from "@/lib/db";
import { eq, and } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
