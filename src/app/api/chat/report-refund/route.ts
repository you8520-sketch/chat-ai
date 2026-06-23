import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { processReportRefund } from "@/lib/refund";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await req.json();
  const messageId = Number(body.messageId ?? body.message_id);
  const chatId = Number(body.chatId ?? body.chat_id);

  if (!messageId || !chatId) {
    return NextResponse.json({ error: "messageId와 chatId가 필요합니다." }, { status: 400 });
  }

  const result = processReportRefund(user.id, messageId, chatId);

  if (result.status === "rejected") {
    return NextResponse.json({ error: result.message, status: result.status }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    status: "pending",
    message: result.message,
  });
}
