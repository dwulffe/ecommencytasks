import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "ecommency_session";

/** Web Crypto HMAC-SHA256 → hex. Works in the Edge runtime. */
async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// The cookie is "<userId>.<hmac(userId)>" — verify the signature (not the
// user's existence; the API routes resolve and re-check that per request).
async function isValidSession(token: string | undefined): Promise<boolean> {
  const secret = process.env.AUTH_SECRET;
  if (!token || !secret) return false;
  const i = token.lastIndexOf(".");
  if (i <= 0) return false;
  const id = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expected = await hmacHex(secret, id);
  return sig === expected;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public paths that never require auth.
  const isPublic =
    pathname === "/login" ||
    pathname.startsWith("/api/auth/login") ||
    pathname.startsWith("/api/cron/") ||
    pathname.startsWith("/api/inbound"); // token-gated inside the route

  if (isPublic) return NextResponse.next();

  const valid = await isValidSession(req.cookies.get(COOKIE_NAME)?.value);
  if (valid) return NextResponse.next();

  // API calls get a clean 401; page loads get redirected to /login.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logo.svg).*)"],
};
