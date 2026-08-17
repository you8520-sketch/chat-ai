import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getPushSocialPrefs, setPushSocialPrefs } from "@/lib/userNotifications";
import {
  getWebPushPublicConfig,
  hasWebPushSubscription,
  removeWebPushSubscription,
  saveWebPushSubscription,
} from "@/lib/webPush";

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  return !origin || origin === new URL(req.url).origin;
}

function validEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function validKey(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 512;
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const endpoint = new URL(req.url).searchParams.get("endpoint") ?? undefined;
  const config = getWebPushPublicConfig();
  const prefs = getPushSocialPrefs(getDb(), user.id);
  return NextResponse.json({
    enabled: config.enabled,
    publicKey: config.enabled ? config.publicKey : "",
    subscribed: hasWebPushSubscription(getDb(), user.id, endpoint),
    pushNotifyLikes: prefs.pushNotifyLikes,
    pushNotifyComments: prefs.pushNotifyComments,
  });
}

export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 403 });
  const body = (await req.json().catch(() => null)) as
    | { pushNotifyLikes?: unknown; pushNotifyComments?: unknown }
    | null;
  if (!body) return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  const likes = typeof body.pushNotifyLikes === "boolean" ? body.pushNotifyLikes : undefined;
  const comments = typeof body.pushNotifyComments === "boolean" ? body.pushNotifyComments : undefined;
  if (likes === undefined && comments === undefined) {
    return NextResponse.json({ error: "변경할 알림 설정이 없습니다." }, { status: 400 });
  }
  const prefs = setPushSocialPrefs(getDb(), user.id, {
    pushNotifyLikes: likes,
    pushNotifyComments: comments,
  });
  return NextResponse.json({ ok: true, ...prefs });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 403 });
  if (!getWebPushPublicConfig().enabled) {
    return NextResponse.json({ error: "푸시 알림 서버 설정이 완료되지 않았습니다." }, { status: 503 });
  }

  const body = (await req.json().catch(() => null)) as
    | { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }
    | null;
  if (!body || !validEndpoint(body.endpoint) || !validKey(body.keys?.p256dh) || !validKey(body.keys?.auth)) {
    return NextResponse.json({ error: "유효하지 않은 푸시 구독입니다." }, { status: 400 });
  }

  saveWebPushSubscription(getDb(), user.id, {
    endpoint: body.endpoint,
    p256dh: body.keys.p256dh,
    auth: body.keys.auth,
  });
  return NextResponse.json({ ok: true, subscribed: true });
}

export async function DELETE(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { endpoint?: unknown } | null;
  if (!body || !validEndpoint(body.endpoint)) {
    return NextResponse.json({ error: "유효하지 않은 푸시 구독입니다." }, { status: 400 });
  }
  removeWebPushSubscription(getDb(), user.id, body.endpoint);
  return NextResponse.json({ ok: true, subscribed: false });
}
