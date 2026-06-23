import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

// 정보 공유 게시판 답글
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { postId, content } = await req.json();
  if (!content?.trim()) return NextResponse.json({ error: "내용을 입력하세요." }, { status: 400 });

  const db = getDb();
  const post = db.prepare("SELECT board FROM posts WHERE id=?").get(postId) as { board: string } | undefined;
  if (!post) return NextResponse.json({ error: "게시글이 없습니다." }, { status: 404 });
  if (post.board !== "info") {
    return NextResponse.json({ error: "이 게시판에는 답글을 달 수 없습니다." }, { status: 403 });
  }

  db.prepare("INSERT INTO comments (post_id, author_id, author_name, content) VALUES (?,?,?,?)").run(
    postId, user.id, user.nickname, content.trim().slice(0, 2000)
  );
  return NextResponse.json({ ok: true });
}
