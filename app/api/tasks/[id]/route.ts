import { NextRequest, NextResponse } from "next/server";
import { updateTask, deleteTask, getTask, getCurrentUser } from "@/lib/db";
import { PRIORITIES, Priority, Task } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const task = await getTask(params.id);
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

    const body = await req.json();
    const patch: Partial<Pick<Task, "title" | "priority" | "dueDate" | "done" | "assigneeId">> = {};

    if (me.role === "admin") {
      if (typeof body?.title === "string") patch.title = body.title;
      if (typeof body?.dueDate === "string") patch.dueDate = body.dueDate;
      if (typeof body?.assigneeId === "string") patch.assigneeId = body.assigneeId;
      if (PRIORITIES.includes(body?.priority)) patch.priority = body.priority as Priority;
      if (typeof body?.done === "boolean") patch.done = body.done;
    } else {
      // Employees can only act on tasks assigned to them, and only mark done.
      if (task.assigneeId !== me.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (typeof body?.done === "boolean") patch.done = body.done;
    }

    const updated = await updateTask(params.id, patch);
    return NextResponse.json({ task: updated });
  } catch (err) {
    return NextResponse.json({ error: message(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin") {
    return NextResponse.json({ error: "Only admins can delete tasks" }, { status: 403 });
  }
  try {
    await deleteTask(params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: message(err) }, { status: 500 });
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong";
}
