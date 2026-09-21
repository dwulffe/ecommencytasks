import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Who am I? Used by the UI to pick the admin vs employee view. */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ user: null }, { status: 401 });
    return NextResponse.json({
      user: { id: user.id, name: user.name, username: user.username, role: user.role },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Something went wrong";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
