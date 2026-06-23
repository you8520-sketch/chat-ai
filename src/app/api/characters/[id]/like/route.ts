import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const liked = db.prepare("SELECT 1 FROM likes WHERE user_id=? AND character_id=?").get(user.id, id);
  if (liked) {
    db.prepare("DELETE FROM likes WHERE user_id=? AND character_id=?").run(user.id, id);
    db.prepare("UPDATE characters SET likes = likes - 1 WHERE id=?").run(id);
    return NextResponse.json({ liked: false });
  }
  db.prepare("INSERT INTO likes (user_id, character_id) VALUES (?,?)").run(user.id, id);
  db.prepare("UPDATE characters SET likes = likes + 1 WHERE id=?").run(id);
  return NextResponse.json({ liked: true });
}
