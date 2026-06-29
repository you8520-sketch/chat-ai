import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/adminAuth";
import { getDb } from "@/lib/db";
import {
  bulkInsertCommentBannedWords,
  insertCommentBannedWord,
  listCommentBannedWords,
} from "@/lib/commentBannedWords";
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

export async function GET(req: Request) {
  if (!(await requireAdminRequest(req))) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }
  const url = new URL(req.url);
  const category = parseCategory(url.searchParams.get("category") ?? undefined);
  const words = listCommentBannedWords(getDb(), { category: category ?? undefined });
  return NextResponse.json({ words });
}

export async function POST(req: Request) {
  if (!(await requireAdminRequest(req))) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const body = await req.json();
  const db = getDb();

  if (body.csv && typeof body.csv === "string") {
    const category = parseCategory(body.category) ?? "other";
    const lines = body.csv
      .split(/\r?\n/)
      .map((line: string) => line.trim())
      .filter(Boolean);
    const rows = lines.map((word: string) => ({
      word: word.split(",")[0]?.trim() ?? word,
      category: (word.split(",")[1]?.trim() as CommentBannedWordCategory) || category,
      match_type: "substring" as const,
      ai_check: body.ai_check !== false,
    }));
    const count = bulkInsertCommentBannedWords(db, rows);
    return NextResponse.json({ ok: true, inserted: count });
  }

  const word = typeof body.word === "string" ? body.word.trim() : "";
  const category = parseCategory(body.category) ?? "other";
  if (!word) return NextResponse.json({ error: "금지어를 입력하세요." }, { status: 400 });

  const match_type = body.match_type === "regex" ? "regex" : "substring";
  const id = insertCommentBannedWord(db, {
    word,
    category,
    match_type,
    ai_check: body.ai_check !== false,
  });
  return NextResponse.json({ ok: true, id });
}
