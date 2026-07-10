import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { assertMessageAccess } from "@/lib/chatAccess";
import { CHAT_MESSAGE_MAX, ASSISTANT_MESSAGE_MAX } from "@/lib/chatModels";
import { editedMessageVariant } from "@/lib/messageAlternates";
import { formatAiProseForEditTextarea } from "@/lib/novelParagraphs";

export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { messageId, content } = await req.json();
  const id = Number(messageId);
  let text = typeof content === "string" ? content.trim() : "";
  if (!id) return NextResponse.json({ error: "messageId가 필요합니다." }, { status: 400 });
  if (!text) return NextResponse.json({ error: "내용을 입력하세요." }, { status: 400 });

  const msg = assertMessageAccess(user.id, id);
  if (!msg) return NextResponse.json({ error: "메시지를 찾을 수 없습니다." }, { status: 404 });
  if (msg.model === "greeting") {
    return NextResponse.json({ error: "인사말은 수정할 수 없습니다." }, { status: 400 });
  }

  if (msg.role === "assistant") {
    text = formatAiProseForEditTextarea(text).trim();
    if (!text) return NextResponse.json({ error: "내용을 입력하세요." }, { status: 400 });
  }

  const maxLen = msg.role === "assistant" ? ASSISTANT_MESSAGE_MAX : CHAT_MESSAGE_MAX;
  if (text.length > maxLen) {
    return NextResponse.json(
      { error: `메시지는 ${maxLen.toLocaleString()}자까지 입력할 수 있습니다.` },
      { status: 400 }
    );
  }

  const db = getDb();
  if (msg.role === "assistant") {
    const variant = editedMessageVariant({
      content: text,
      model: msg.model,
      usage: msg.usage ? JSON.parse(msg.usage) : null,
    });
    db.prepare("UPDATE messages SET content=?, alternates=?, active_variant=? WHERE id=?").run(
      text,
      JSON.stringify([variant]),
      0,
      id
    );
    return NextResponse.json({
      ok: true,
      content: text,
      variants: [variant],
      activeVariant: 0,
      variantCount: 1,
    });
  }

  db.prepare("UPDATE messages SET content=? WHERE id=?").run(text, id);
  return NextResponse.json({ ok: true, content: text });
}
