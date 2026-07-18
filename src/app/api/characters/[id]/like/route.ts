import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { notifyCharacterLiked } from "@/lib/userNotifications";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const { id } = await params;
  const characterId = Number(id);
  if (!characterId) return NextResponse.json({ error: "캐릭터가 없습니다." }, { status: 404 });

  const db = getDb();
  const ch = db
    .prepare("SELECT id, name, creator_id, likes FROM characters WHERE id=?")
    .get(characterId) as
    | { id: number; name: string; creator_id: number | null; likes: number }
    | undefined;
  if (!ch) return NextResponse.json({ error: "캐릭터가 없습니다." }, { status: 404 });

  const liked = db
    .prepare("SELECT 1 FROM likes WHERE user_id=? AND character_id=?")
    .get(user.id, characterId);
  if (liked) {
    db.prepare("DELETE FROM likes WHERE user_id=? AND character_id=?").run(user.id, characterId);
    db.prepare(
      "UPDATE characters SET likes = CASE WHEN likes > 0 THEN likes - 1 ELSE 0 END WHERE id=?"
    ).run(characterId);
    return NextResponse.json({ liked: false });
  }

  db.prepare("INSERT INTO likes (user_id, character_id) VALUES (?,?)").run(user.id, characterId);
  db.prepare("UPDATE characters SET likes = likes + 1 WHERE id=?").run(characterId);
  notifyCharacterLiked(db, {
    creatorId: ch.creator_id,
    actorId: user.id,
    actorNickname: user.nickname,
    characterId: ch.id,
    characterName: ch.name,
  });
  return NextResponse.json({ liked: true });
}
