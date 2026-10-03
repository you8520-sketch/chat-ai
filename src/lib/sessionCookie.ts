import type { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies";

export const SESSION_COOKIE_NAME = "session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const EMAIL_VERIFY_COOKIE_NAME = "email_verify";

export function sessionCookieOptions(): Partial<ResponseCookie> {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  };
}

export function emailVerifyCookieOptions(maxAgeSeconds: number): Partial<ResponseCookie> {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: Math.max(0, Math.floor(maxAgeSeconds)),
    path: "/",
  };
}
