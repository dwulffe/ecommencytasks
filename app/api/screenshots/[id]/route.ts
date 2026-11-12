import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { getScreenshot, getCurrentUser, deleteScreenshot } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Delete a screenshot: allowed for whoever uploaded it, or any admin.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const shot = await getScreenshot(params.id);
  if (!shot) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (me.role !== "admin" && shot.uploadedById !== me.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    // Remove the blob too (best-effort), then the record.
    try {
      if (shot.url) await del(shot.url);
    } catch {
      // ignore blob deletion errors — still remove the DB record
    }
    await deleteScreenshot(params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Something went wrong";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
