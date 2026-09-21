import { NextRequest, NextResponse } from "next/server";
import { listTasks, addTask, getCurrentUser } from "@/lib/db";
import { PRIORITIES, Priority } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    // Employees only see tasks assigned to them; admins see everything.
    const tasks = me.role === "admin" ? await listTasks() : await listTasks({ assigneeId: me.id });
    return NextResponse.json({ tasks });
  } catch (err) {
    return NextResponse.json({ error: message(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin") {
    return NextResponse.json({ error: "Only admins can add tasks" }, { status: 403 });
  }
  try {
    const body = await req.json();
    const clientId = typeof body?.clientId === "string" ? body.clientId : "";
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const priority: Priority = PRIORITIES.includes(body?.priority) ? body.priority : "Medium";
    const dueDate = typeof body?.dueDate === "string" ? body.dueDate : "";
    const assigneeId = typeof body?.assigneeId === "string" ? body.assigneeId : "";

    if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });
    if (!title) return NextResponse.json({ error: "Task title is required" }, { status: 400 });

    const task = await addTask({ clientId, title, priority, dueDate, assigneeId });
    return NextResponse.json({ task }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: message(err) }, { status: 500 });
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong";
}
