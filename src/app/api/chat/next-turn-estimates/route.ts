import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { NEXT_TURN_ESTIMATE_VERSION } from "@/lib/mainRpNextTurnEstimate";
import { resolveMainRpNextTurnPickerEstimates } from "@/services/mainRpNextTurnEstimate";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const chatId = Number(body.chatId);
  if (!Number.isInteger(chatId) || chatId <= 0) {
    return NextResponse.json({ error: "chatId가 필요합니다." }, { status: 400 });
  }

  const result = await resolveMainRpNextTurnPickerEstimates({
    chatId,
    user,
    refresh: body.refresh === true,
  });
  if (!result) {
    return NextResponse.json({ error: "채팅방을 찾을 수 없습니다." }, { status: 404 });
  }

  return NextResponse.json({
    chatId: result.chatId,
    estimates: result.displayPoints,
    models: result.estimates,
    lastVisibleAssistantChars: result.lastVisibleAssistantChars,
    source: result.source,
    version: NEXT_TURN_ESTIMATE_VERSION,
  });
}
