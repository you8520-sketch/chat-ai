import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSession } from "@/lib/auth";
import {
  BetaInviteRejectedError,
  resolvePostGoogleDest,
  sanitizeOAuthReturnTo,
  upsertGoogleUser,
} from "@/lib/googleAuth";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const store = await cookies();
  const savedState = store.get("oauth_state")?.value;
  const returnTo = sanitizeOAuthReturnTo(store.get("oauth_return_to")?.value);
  const redirectAfter = sanitizeOAuthReturnTo(store.get("oauth_redirect_after")?.value, "/");
  const inviteCode = store.get("oauth_invite_code")?.value ?? null;

  if (!code || !state || state !== savedState) {
    return NextResponse.redirect(`${origin}${returnTo}?error=google_failed`);
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${origin}/api/auth/google/callback`,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) return NextResponse.redirect(`${origin}${returnTo}?error=google_failed`);
  const { access_token } = (await tokenRes.json()) as { access_token?: string };
  if (!access_token) return NextResponse.redirect(`${origin}${returnTo}?error=google_failed`);

  const infoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!infoRes.ok) return NextResponse.redirect(`${origin}${returnTo}?error=google_failed`);
  const info = (await infoRes.json()) as { sub: string; email: string; name?: string };
  if (!info.sub || !info.email) {
    return NextResponse.redirect(`${origin}${returnTo}?error=google_failed`);
  }

  try {
    const { userId, isNew, pref } = upsertGoogleUser(info, inviteCode);
    const token = createSession(userId);
    const dest = resolvePostGoogleDest({ isNew, pref, redirectAfter });
    const res = NextResponse.redirect(`${origin}${dest}`);
    res.cookies.set("session", token, { httpOnly: true, sameSite: "lax", maxAge: 30 * 24 * 3600, path: "/" });
    res.cookies.delete("oauth_state");
    res.cookies.delete("oauth_return_to");
    res.cookies.delete("oauth_redirect_after");
    res.cookies.delete("oauth_invite_code");
    return res;
  } catch (e) {
    if (e instanceof BetaInviteRejectedError) {
      const res = NextResponse.redirect(`${origin}${returnTo}?error=${e.code}`);
      res.cookies.delete("oauth_state");
      res.cookies.delete("oauth_return_to");
      res.cookies.delete("oauth_redirect_after");
      res.cookies.delete("oauth_invite_code");
      return res;
    }
    throw e;
  }
}
