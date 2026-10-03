import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/sessionCookie";
import { createSession } from "@/lib/auth";
import { authenticatePasswordLogin } from "@/lib/passwordLogin";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const result = authenticatePasswordLogin(body.email, body.password);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const token = createSession(result.userId);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions());
  return res;
}
