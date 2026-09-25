import { NextRequest, NextResponse } from "next/server";
import { getTask, getCurrentUser, listNotes, addNote } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Can this user see/add notes on this task? Admin, or the assigned employee. */
async function access(taskId: string) {
  const me = await getCurrentUser();
  if (!me) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const task = await getTask(taskId);
  if (!task) return { error: NextResponse.json({ error: "Task not found" }, { status: 404 }) };
  if (me.role !== "admin" && task.assigneeId !== me.id) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { me };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const a = await access(params.id);
  if ("error" in a) return a.error;
  try {
    const notes = await listNotes(params.id);
    return NextResponse.json({ notes });
  } catch (err) {
    return NextResponse.json({ error: message(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const a = await access(params.id);
  if ("error" in a) return a.error;
  try {
    const body = await req.json();
    const text = typeof body?.body === "string" ? body.body.trim() : "";
    if (!text) return NextResponse.json({ error: "Note can't be empty" }, { status: 400 });
    const note = await addNote({
      taskId: params.id,
      authorId: a.me.id,
      authorName: a.me.name || a.me.username,
      body: text,
    });
    return NextResponse.json({ note }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: message(err) }, { status: 500 });
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong";
}
