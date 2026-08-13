import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/adminAuth";
import { getDb } from "@/lib/db";
import { getHomePopupNotice, saveHomePopupNotice } from "@/lib/homePopupNotice";
import { queueBroadcastWebPush } from "@/lib/webPush";

export async function GET() {
  const admin = await requireAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  return NextResponse.json({ notice: getHomePopupNotice(getDb()) });
}

export async function POST(req: Request) {
  const admin = await requireAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    enabled?: boolean;
    title?: string;
    content?: string;
    backgroundColor?: string;
    imageUrl?: string;
    startsAt?: string | null;
    endsAt?: string | null;
  };

  const db = getDb();
  const previous = getHomePopupNotice(db);
  const notice = saveHomePopupNotice(db, body, admin.id);
  const changed =
    !previous ||
    previous.enabled !== notice.enabled ||
    previous.title !== notice.title ||
    previous.content !== notice.content ||
    previous.starts_at !== notice.starts_at ||
    previous.ends_at !== notice.ends_at;
  if (notice.enabled === 1 && changed) {
    queueBroadcastWebPush(db, `event:${notice.updated_at}`, {
      title: notice.title || "새 이벤트·소식",
      body: notice.content.replace(/\s+/g, " ").trim().slice(0, 160),
      url: "/",
      tag: `event:${notice.updated_at}`,
      kind: "event",
    });
  }
  return NextResponse.json({ ok: true, notice });
}
