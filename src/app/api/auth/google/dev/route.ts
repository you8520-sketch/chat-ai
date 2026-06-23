import { NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { isDemoEnv } from "@/lib/demo";
import { resolvePostGoogleDest, sanitizeOAuthReturnTo, upsertGoogleUser } from "@/lib/googleAuth";

const DEV_GOOGLE_SUB = "dev-google-oauth-sub";
const DEV_GOOGLE_EMAIL = "dev-google@playai.local";
const DEV_GOOGLE_NAME = "구글데모";

/** GOOGLE_CLIENT_ID 미설정 시 로컬 개발용 구글 가입/로그인 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const returnTo = sanitizeOAuthReturnTo(url.searchParams.get("returnTo"));
  const redirectAfter = sanitizeOAuthReturnTo(url.searchParams.get("redirect"), "/");

  if (!isDemoEnv()) {
    return NextResponse.redirect(`${origin}${returnTo}?error=google_not_configured`);
  }

  const { userId, isNew, pref } = upsertGoogleUser({
    sub: DEV_GOOGLE_SUB,
    email: DEV_GOOGLE_EMAIL,
    name: DEV_GOOGLE_NAME,
  });
  const token = createSession(userId);
  const dest = resolvePostGoogleDest({ isNew, pref, redirectAfter });
  const res = NextResponse.redirect(`${origin}${dest}`);
  res.cookies.set("session", token, { httpOnly: true, sameSite: "lax", maxAge: 30 * 24 * 3600, path: "/" });
  return res;
}
