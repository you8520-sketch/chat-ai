import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { notifyFollowReceived } from "@/lib/userNotifications";

// 캐릭터의 크리에이터를 팔로우/언팔로우
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const ch = db.prepare("SELECT creator_id, creator_name FROM characters WHERE id=?").get(id) as
    | { creator_id: number | null; creator_name: string }
    | undefined;
  if (!ch) return NextResponse.json({ error: "캐릭터가 없습니다." }, { status: 404 });
  const creatorKey = ch.creator_id ?? 0;
  const followed = db.prepare("SELECT 1 FROM follows WHERE user_id=? AND creator_id=?").get(user.id, creatorKey);
  if (followed) {
    db.prepare("DELETE FROM follows WHERE user_id=? AND creator_id=?").run(user.id, creatorKey);
    return NextResponse.json({ followed: false });
  }
  db.prepare("INSERT INTO follows (user_id, creator_id) VALUES (?,?)").run(user.id, creatorKey);
  if (creatorKey > 0) {
    notifyFollowReceived(db, creatorKey, user.id, user.nickname);
  }
  return NextResponse.json({ followed: true });
}
