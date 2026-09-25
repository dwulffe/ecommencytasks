import { NextRequest, NextResponse } from "next/server";
import { getNote, getCurrentUser, updateNote, deleteNote } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Edit/delete a note: allowed for its author, or any admin.
async function access(noteId: string) {
  const me = await getCurrentUser();
  if (!me) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const note = await getNote(noteId);
  if (!note) return { error: NextResponse.json({ error: "Note not found" }, { status: 404 }) };
  if (me.role !== "admin" && note.authorId !== me.id) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { me, note };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const a = await access(params.id);
  if ("error" in a) return a.error;
  try {
    const body = await req.json();
    const text = typeof body?.body === "string" ? body.body.trim() : "";
    if (!text) return NextResponse.json({ error: "Note can't be empty" }, { status: 400 });
    const note = await updateNote(params.id, text);
    return NextResponse.json({ note });
  } catch (err) {
    return NextResponse.json({ error: message(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const a = await access(params.id);
  if ("error" in a) return a.error;
  try {
    await deleteNote(params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: message(err) }, { status: 500 });
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong";
}
