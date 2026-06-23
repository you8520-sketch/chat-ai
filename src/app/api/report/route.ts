import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

// 메시지/응답 이상 신고
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { chatId, messageId, content, reason } = await req.json();
  getDb()
    .prepare("INSERT INTO reports (user_id, chat_id, message_id, content, reason) VALUES (?,?,?,?,?)")
    .run(user.id, chatId ?? null, messageId ?? null, String(content || "").slice(0, 2000), String(reason || "").slice(0, 500));
  return NextResponse.json({ ok: true });
}
