import { NextRequest, NextResponse } from "next/server";
import { updateTask, deleteTask } from "@/lib/sheets";
import { isAuthenticated } from "@/lib/auth";
import { PRIORITIES, Priority, Task } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function guard() {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = guard();
  if (denied) return denied;
  try {
    const body = await req.json();
    const patch: Partial<Pick<Task, "title" | "priority" | "dueDate" | "done">> = {};

    if (typeof body?.title === "string") patch.title = body.title;
    if (typeof body?.dueDate === "string") patch.dueDate = body.dueDate;
    if (typeof body?.done === "boolean") patch.done = body.done;
    if (PRIORITIES.includes(body?.priority)) patch.priority = body.priority as Priority;

    const task = await updateTask(params.id, patch);
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    return NextResponse.json({ task });
  } catch (err) {
    return NextResponse.json({ error: message(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = guard();
  if (denied) return denied;
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
