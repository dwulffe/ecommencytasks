import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, reportByUser, reportTasks } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const params = new URL(req.url).searchParams;
    const start = params.get("start") || "";
    const end = params.get("end") || "";
    if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
      return NextResponse.json({ error: "start and end must be YYYY-MM-DD" }, { status: 400 });
    }
    // Admins see everyone; employees are always scoped to their own time — they
    // can never query another person's data.
    const scope = me.role === "admin" ? undefined : me.id;
    const [rows, tasks] = await Promise.all([
      reportByUser(start, end, scope),
      reportTasks(start, end, scope),
    ]);
    return NextResponse.json({ rows, tasks });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Something went wrong";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
