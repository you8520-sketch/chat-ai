import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getLatestNoticeId, markNoticesRead, markSingleNoticeRead } from "@/lib/notices";

type ReadBody = {
  noticeId?: number;
};

/** 공지 확인 — 단건 또는 전체(레거시 공지 게시판) */
export async function POST(req: Request) {
  const user = await getSessionUser();
  const db = getDb();
  const cookieStore = await cookies();
  const cookieReadId = Number(cookieStore.get("notice_read_id")?.value ?? 0);

  let body: ReadBody = {};
  try {
    body = (await req.json()) as ReadBody;
  } catch {
    body = {};
  }

  const noticeId = Number(body.noticeId);
  if (Number.isFinite(noticeId) && noticeId > 0) {
    markSingleNoticeRead(db, user?.id ?? null, noticeId);
    const nextCookieReadId = Math.max(cookieReadId, noticeId);
    const res = NextResponse.json({ ok: true, noticeId, latestId: nextCookieReadId });
    res.cookies.set("notice_read_id", String(nextCookieReadId), {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
    return res;
  }

  const latestId = getLatestNoticeId(db);
  markNoticesRead(db, user?.id ?? null, latestId);

  const res = NextResponse.json({ ok: true, latestId });
  res.cookies.set("notice_read_id", String(latestId), {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  return res;
}
