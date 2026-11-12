import { NextRequest, NextResponse } from "next/server";
import { getTask, getCurrentUser, listScreenshots, addScreenshot } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    const screenshots = await listScreenshots(params.id);
    return NextResponse.json({ screenshots });
  } catch (err) {
    return NextResponse.json({ error: message(err) }, { status: 500 });
  }
}

/** Record a screenshot after the browser uploaded it to Blob. Body: { url, pathname }. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const a = await access(params.id);
  if ("error" in a) return a.error;
  try {
    const body = await req.json();
    const url = typeof body?.url === "string" ? body.url : "";
    const pathname = typeof body?.pathname === "string" ? body.pathname : "";
    if (!url) return NextResponse.json({ error: "url is required" }, { status: 400 });
    const screenshot = await addScreenshot({
      taskId: params.id,
      url,
      pathname,
      uploadedById: a.me.id,
      uploadedByName: a.me.name || a.me.username,
    });
    return NextResponse.json({ screenshot }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: message(err) }, { status: 500 });
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong";
}
