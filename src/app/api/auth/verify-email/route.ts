import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  EMAIL_VERIFY_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  emailVerifyCookieOptions,
  sessionCookieOptions,
} from "@/lib/sessionCookie";
import { createSession } from "@/lib/auth";
import { confirmEmailSignup, inspectEmailSignupToken } from "@/lib/emailSignupVerification";
import { resolveSafeAppRedirect } from "@/lib/transactionalEmail";

function redirectTo(req: Request, path: string): NextResponse {
  return new NextResponse(null, {
    status: 303,
    headers: { Location: resolveSafeAppRedirect(req, path) },
  });
}

function clearVerifyCookie(res: NextResponse): void {
  res.cookies.set(EMAIL_VERIFY_COOKIE_NAME, "", emailVerifyCookieOptions(0));
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const inspected = inspectEmailSignupToken(token);
  if (!inspected.ok) {
    const res = redirectTo(req, "/login?verify=failed");
    clearVerifyCookie(res);
    return res;
  }

  const res = redirectTo(req, "/signup/verify");
  res.cookies.set(EMAIL_VERIFY_COOKIE_NAME, token.trim(), emailVerifyCookieOptions(inspected.remainingSeconds));
  return res;
}

export async function POST(req: Request) {
  const store = await cookies();
  const token = store.get(EMAIL_VERIFY_COOKIE_NAME)?.value ?? "";
  const result = confirmEmailSignup(token);
  if (!result.ok) {
    const res = redirectTo(req, "/login?verify=failed");
    clearVerifyCookie(res);
    return res;
  }

  const res = redirectTo(req, "/?verified=1");
  clearVerifyCookie(res);
  res.cookies.set(SESSION_COOKIE_NAME, createSession(result.userId), sessionCookieOptions());
  return res;
}
