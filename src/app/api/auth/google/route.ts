import { NextResponse } from "next/server";
import crypto from "crypto";
import { isDemoEnv } from "@/lib/demo";
import { isGoogleAuthConfigured, sanitizeOAuthReturnTo } from "@/lib/googleAuth";

// 구글 로그인/회원가입 시작: 구글 동의 화면으로 리다이렉트
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const returnTo = sanitizeOAuthReturnTo(url.searchParams.get("returnTo"));
  const redirectAfter = sanitizeOAuthReturnTo(url.searchParams.get("redirect"), "/");
  const inviteCode = url.searchParams.get("inviteCode")?.trim() ?? "";

  if (!isGoogleAuthConfigured()) {
    if (isDemoEnv()) {
      const devUrl = new URL(`${origin}/api/auth/google/dev`);
      devUrl.searchParams.set("returnTo", returnTo);
      devUrl.searchParams.set("redirect", redirectAfter);
      return NextResponse.redirect(devUrl.toString());
    }
    return NextResponse.redirect(`${origin}${returnTo}?error=google_not_configured`);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID!.trim();
  const state = crypto.randomBytes(16).toString("hex");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${origin}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  const res = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  res.cookies.set("oauth_state", state, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });
  res.cookies.set("oauth_return_to", returnTo, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });
  res.cookies.set("oauth_redirect_after", redirectAfter, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  if (inviteCode) {
    res.cookies.set("oauth_invite_code", inviteCode, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });
  }
  return res;
}
