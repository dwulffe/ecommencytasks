import { NextRequest, NextResponse } from "next/server";
import { listTasks, addTask } from "@/lib/db";
import { isAuthenticated } from "@/lib/auth";
import { PRIORITIES, Priority } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function guard() {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET() {
  const denied = guard();
  if (denied) return denied;
  try {
    const tasks = await listTasks();
    return NextResponse.json({ tasks });
  } catch (err) {
    return NextResponse.json({ error: message(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const denied = guard();
  if (denied) return denied;
  try {
    const body = await req.json();
    const clientId = typeof body?.clientId === "string" ? body.clientId : "";
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const priority: Priority = PRIORITIES.includes(body?.priority) ? body.priority : "Medium";
    const dueDate = typeof body?.dueDate === "string" ? body.dueDate : "";

    if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });
    if (!title) return NextResponse.json({ error: "Task title is required" }, { status: 400 });

    const task = await addTask({ clientId, title, priority, dueDate });
    return NextResponse.json({ task }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: message(err) }, { status: 500 });
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong";
}
