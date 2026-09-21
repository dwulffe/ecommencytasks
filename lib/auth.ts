import { cookies } from "next/headers";
import { createHmac, timingSafeEqual, scryptSync, randomBytes } from "crypto";

const COOKIE_NAME = "ecommency_session";

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return s;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// ── Password hashing (scrypt, no external deps) ──────────────

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, derived] = stored.split(":");
  if (!salt || !derived) return false;
  const calc = scryptSync(password, salt, 64).toString("hex");
  return safeEqual(calc, derived);
}

// ── Sessions: a cookie carrying the signed user id ───────────

/** Build the session cookie value: "<userId>.<hmac(userId)>". */
export function signSession(userId: string): string {
  const sig = createHmac("sha256", secret()).update(userId).digest("hex");
  return `${userId}.${sig}`;
}

/** Verify a cookie value and return the user id it carries, or null. */
export function verifySessionToken(token: string | undefined): string | null {
  if (!token) return null;
  const i = token.lastIndexOf(".");
  if (i <= 0) return null;
  const id = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expected = createHmac("sha256", secret()).update(id).digest("hex");
  try {
    return safeEqual(sig, expected) ? id : null;
  } catch {
    return null;
  }
}

/** The current user's id from the session cookie (server components / routes). */
export function sessionUserId(): string | null {
  return verifySessionToken(cookies().get(COOKIE_NAME)?.value);
}

export const AUTH_COOKIE_NAME = COOKIE_NAME;
