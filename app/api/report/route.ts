import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, reportByUser } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const params = new URL(req.url).searchParams;
    const start = params.get("start") || "";
    const end = params.get("end") || "";
    if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
      return NextResponse.json({ error: "start and end must be YYYY-MM-DD" }, { status: 400 });
    }
    const rows = await reportByUser(start, end);
    return NextResponse.json({ rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Something went wrong";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
