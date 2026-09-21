import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  applyGuestNoticeReadCookies,
  readGuestNoticeReadState,
} from "@/lib/noticeGuestReadCookies";
import {
  getLatestNoticeId,
  markAllGuestNoticeReads,
  markNoticesRead,
  markSingleNoticeRead,
} from "@/lib/notices";

type ReadBody = {
  noticeId?: number;
};

/** 공지 확인 — 단건 또는 전체(레거시 공지 게시판) */
export async function POST(req: Request) {
  const user = await getSessionUser();
  const db = getDb();
  const cookieStore = await cookies();
  let guestState = readGuestNoticeReadState({
    watermarkRaw: cookieStore.get("notice_read_id")?.value,
    sparseRaw: cookieStore.get("notice_read_ids")?.value,
  });

  let body: ReadBody = {};
  try {
    body = (await req.json()) as ReadBody;
  } catch {
    body = {};
  }

  const noticeId = Number(body.noticeId);
  if (Number.isFinite(noticeId) && noticeId > 0) {
    guestState = markSingleNoticeRead(db, user?.id ?? null, noticeId, guestState);
    const res = NextResponse.json({ ok: true, noticeId, guestState });
    applyGuestNoticeReadCookies(res, guestState);
    return res;
  }

  const latestId = getLatestNoticeId(db);
  markNoticesRead(db, user?.id ?? null, latestId);
  guestState = markAllGuestNoticeReads(latestId);

  const res = NextResponse.json({ ok: true, latestId, guestState });
  applyGuestNoticeReadCookies(res, guestState);
  return res;
}
