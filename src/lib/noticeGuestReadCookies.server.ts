import "server-only";

import { cookies } from "next/headers";
import { readGuestNoticeReadState, type GuestNoticeReadState } from "./noticeGuestReadCookies";

export async function getGuestNoticeReadStateFromCookies(): Promise<GuestNoticeReadState> {
  const cookieStore = await cookies();
  return readGuestNoticeReadState({
    watermarkRaw: cookieStore.get("notice_read_id")?.value,
    sparseRaw: cookieStore.get("notice_read_ids")?.value,
  });
}
