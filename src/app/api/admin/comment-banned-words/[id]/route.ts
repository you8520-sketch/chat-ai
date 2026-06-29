import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/adminAuth";
import { getDb } from "@/lib/db";
import { deleteCommentBannedWord, updateCommentBannedWord } from "@/lib/commentBannedWords";
import {
  COMMENT_BANNED_WORD_CATEGORIES,
  type CommentBannedWordCategory,
} from "@/lib/commentModerationPolicy";

function parseCategory(raw: unknown): CommentBannedWordCategory | null {
  if (typeof raw !== "string") return null;
  return COMMENT_BANNED_WORD_CATEGORIES.includes(raw as CommentBannedWordCategory)
    ? (raw as CommentBannedWordCategory)
    : null;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdminRequest(req))) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }
  const id = Number((await params).id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "잘못된 ID" }, { status: 400 });

  const body = await req.json();
  const ok = updateCommentBannedWord(getDb(), id, {
    word: typeof body.word === "string" ? body.word : undefined,
    category: parseCategory(body.category) ?? undefined,
    match_type: body.match_type === "regex" ? "regex" : body.match_type === "substring" ? "substring" : undefined,
    ai_check: typeof body.ai_check === "boolean" ? body.ai_check : undefined,
    enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
  });
  if (!ok) return NextResponse.json({ error: "항목을 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdminRequest(req))) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }
  const id = Number((await params).id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "잘못된 ID" }, { status: 400 });
  const ok = deleteCommentBannedWord(getDb(), id);
  if (!ok) return NextResponse.json({ error: "항목을 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
