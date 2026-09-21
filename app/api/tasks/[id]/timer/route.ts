import { NextRequest, NextResponse } from "next/server";
import { getTask, getCurrentUser, startTimer, pauseTimer } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Start or pause a task's timer. Body: { action: "start" | "pause" }. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const task = await getTask(params.id);
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

    // Admins can run any timer; employees only on their own tasks.
    if (me.role !== "admin" && task.assigneeId !== me.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const action = body?.action;
    const updated =
      action === "start"
        ? await startTimer(params.id)
        : action === "pause"
        ? await pauseTimer(params.id)
        : null;

    if (!updated) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    return NextResponse.json({ task: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Something went wrong";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
