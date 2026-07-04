import { NextResponse } from "next/server";
import { requireAdminRequest, requireAdminUser } from "@/lib/adminAuth";
import { isAdminManagedBoard } from "@/lib/boardConfig";
import { createAdminBoardPost, deleteAdminBoardPost, listPostsByBoard } from "@/lib/boardPosts";
import { getDb } from "@/lib/db";

export async function GET(req: Request) {
  if (!(await requireAdminRequest(req))) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const board = new URL(req.url).searchParams.get("board") ?? "notice";
  if (!isAdminManagedBoard(board)) {
    return NextResponse.json({ error: "board는 notice 또는 faq만 가능합니다." }, { status: 400 });
  }

  const posts = listPostsByBoard(getDb(), board);
  return NextResponse.json({ posts });
}

export async function POST(req: Request) {
  const admin = await requireAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const body = await req.json();
  const board = typeof body.board === "string" ? body.board : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const content = typeof body.content === "string" ? body.content.trim() : "";

  if (!isAdminManagedBoard(board)) {
    return NextResponse.json({ error: "board는 notice 또는 faq만 가능합니다." }, { status: 400 });
  }
  if (!title || !content) {
    return NextResponse.json({ error: "제목과 내용을 입력하세요." }, { status: 400 });
  }
  if (title.length > 200) {
    return NextResponse.json({ error: "제목은 200자 이내로 입력하세요." }, { status: 400 });
  }
  if (content.length > 10000) {
    return NextResponse.json({ error: "내용은 10,000자 이내로 입력하세요." }, { status: 400 });
  }

  const id = createAdminBoardPost(getDb(), board, title, content, admin.id);
  return NextResponse.json({ ok: true, id });
}

export async function DELETE(req: Request) {
  const admin = await requireAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "유효하지 않은 id입니다." }, { status: 400 });
  }

  const ok = deleteAdminBoardPost(getDb(), id);
  if (!ok) {
    return NextResponse.json({ error: "삭제할 수 없는 게시글입니다." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
