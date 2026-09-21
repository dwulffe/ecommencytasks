import { NextRequest, NextResponse } from "next/server";
import { acceptSuggestion, dismissSuggestion, getCurrentUser } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guard() {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

/** Accept a suggestion → creates a real task. Body: { action: "accept" }. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await guard();
  if (denied) return denied;
  try {
    const task = await acceptSuggestion(params.id);
    if (!task) return NextResponse.json({ error: "Suggestion not found" }, { status: 404 });
    return NextResponse.json({ task });
  } catch (err) {
    return NextResponse.json({ error: message(err) }, { status: 500 });
  }
}

/** Dismiss a suggestion without creating a task. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await guard();
  if (denied) return denied;
  try {
    await dismissSuggestion(params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: message(err) }, { status: 500 });
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong";
}
