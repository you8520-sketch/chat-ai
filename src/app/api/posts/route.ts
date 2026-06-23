import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

const WRITABLE = ["inquiry"];

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const { board, title, content } = await req.json();
  if (!WRITABLE.includes(board)) return NextResponse.json({ error: "쓰기 권한이 없는 게시판입니다." }, { status: 403 });
  if (!title?.trim() || !content?.trim()) return NextResponse.json({ error: "제목과 내용을 입력하세요." }, { status: 400 });
  getDb()
    .prepare("INSERT INTO posts (board, title, content, author_name, author_id) VALUES (?,?,?,?,?)")
    .run(board, title.trim(), content.trim(), user.nickname, user.id);
  return NextResponse.json({ ok: true });
}
