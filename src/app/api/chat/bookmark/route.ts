import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { assertMessageAccess } from "@/lib/chatAccess";
import { PREFERENCE_EVENT } from "@/lib/feedback/events";
import { recordPreferenceEvent } from "@/lib/feedback/feedback-db";
import { enqueueScoreRecompute } from "@/lib/feedback/queue";
import { defaultBookmarkTitle, sanitizeBookmarkTitle } from "@/lib/bookmarks";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await req.json();
  const id = Number(body.messageId);
  if (!id) return NextResponse.json({ error: "messageId가 필요합니다." }, { status: 400 });

  const msg = assertMessageAccess(user.id, id);
  if (!msg) return NextResponse.json({ error: "메시지를 찾을 수 없습니다." }, { status: 404 });
  if (msg.model === "greeting") {
    return NextResponse.json({ error: "인사말은 북마크할 수 없습니다." }, { status: 400 });
  }

  const db = getDb();
  const existing = db
    .prepare("SELECT title FROM bookmarks WHERE user_id=? AND message_id=?")
    .get(user.id, id) as { title: string } | undefined;

  if (existing) {
    db.prepare("DELETE FROM bookmarks WHERE user_id=? AND message_id=?").run(user.id, id);
    recordPreferenceEvent({
      userId: user.id,
      chatId: msg.chat_id,
      messageId: id,
      eventType: PREFERENCE_EVENT.BOOKMARK_REMOVE,
    });
    enqueueScoreRecompute(id);
    return NextResponse.json({ ok: true, bookmarked: false });
  }

  const titleInput = typeof body.title === "string" ? sanitizeBookmarkTitle(body.title) : "";
  const title = titleInput || defaultBookmarkTitle(msg.content);

  db.prepare("INSERT INTO bookmarks (user_id, message_id, title) VALUES (?,?,?)").run(
    user.id,
    id,
    title
  );
  recordPreferenceEvent({
    userId: user.id,
    chatId: msg.chat_id,
    messageId: id,
    eventType: PREFERENCE_EVENT.BOOKMARK_ADD,
  });
  enqueueScoreRecompute(id);
  return NextResponse.json({ ok: true, bookmarked: true, title });
}