import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/sessionCookie";
import { createSession } from "@/lib/auth";
import { confirmEmailSignup } from "@/lib/emailSignupVerification";
import { resolveVerifiedMailOrigin } from "@/lib/transactionalEmail";

function redirectTo(req: Request, path: string): NextResponse {
  const origin = resolveVerifiedMailOrigin(req) ?? new URL(req.url).origin;
  return NextResponse.redirect(new URL(path, `${origin}/`));
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const result = confirmEmailSignup(token);
  if (!result.ok) {
    return redirectTo(req, `/login?verify=failed`);
  }

  const tokenCookie = createSession(result.userId);
  const res = redirectTo(req, "/?verified=1");
  res.cookies.set(SESSION_COOKIE_NAME, tokenCookie, sessionCookieOptions());
  return res;
}
