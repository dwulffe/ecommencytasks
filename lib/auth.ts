import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";

const COOKIE_NAME = "ecommency_session";

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return s;
}

/**
 * The session cookie value is an HMAC of a fixed marker keyed by AUTH_SECRET.
 * We never store the password itself. Rotating AUTH_SECRET invalidates all
 * existing sessions.
 */
export function makeSessionToken(): string {
  return createHmac("sha256", secret()).update("ecommency-authenticated").digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function checkPassword(input: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) throw new Error("APP_PASSWORD is not set");
  return safeEqual(input, expected);
}

/** Reads the session cookie (server components / route handlers). */
export function isAuthenticated(): boolean {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) return false;
  try {
    return safeEqual(token, makeSessionToken());
  } catch {
    return false;
  }
}

export const AUTH_COOKIE_NAME = COOKIE_NAME;
