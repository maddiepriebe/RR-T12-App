import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db, properties } from "@/lib/db";
import { eq, desc } from "drizzle-orm";

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rows = await db
      .select()
      .from(properties)
      .where(eq(properties.clerkUserId, userId))
      .orderBy(desc(properties.createdAt));

    return NextResponse.json(rows);
  } catch (err) {
    console.error("GET /api/properties error:", err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { name, address, city, state, zip, units } = body;

    if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });

    const [prop] = await db
      .insert(properties)
      .values({ name, address, city, state, zip, units, clerkUserId: userId })
      .returning();

    return NextResponse.json(prop, { status: 201 });
  } catch (err) {
    console.error("POST /api/properties error:", err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
