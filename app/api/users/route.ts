import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, listUsers, createUser } from "@/lib/db";
import { Role } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const users = await listUsers();
    return NextResponse.json({ users });
  } catch (err) {
    return NextResponse.json({ error: message(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body = await req.json();
    const username = typeof body?.username === "string" ? body.username : "";
    const name = typeof body?.name === "string" ? body.name : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const role: Role = body?.role === "admin" ? "admin" : "employee";

    if (!username.trim()) return NextResponse.json({ error: "Username is required" }, { status: 400 });
    if (!password) return NextResponse.json({ error: "Password is required" }, { status: 400 });

    const user = await createUser({ username, name, password, role });
    return NextResponse.json({ user }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: message(err) }, { status: 400 });
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong";
}
