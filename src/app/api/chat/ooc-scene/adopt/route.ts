import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { adoptOocSceneRenderCore } from "@/lib/oocSceneRender";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = (await req.json()) as {
    chatId?: unknown;
    assistantMessageId?: unknown;
    canonAdopted?: unknown;
  };
  if (body.canonAdopted != null) {
    return NextResponse.json(
      { error: "클라이언트에서 본편 채택 여부를 지정할 수 없습니다." },
      { status: 400 }
    );
  }

  const chatId = Number(body.chatId);
  const assistantMessageId = Number(body.assistantMessageId);
  if (!Number.isSafeInteger(chatId) || chatId <= 0) {
    return NextResponse.json({ error: "chatId가 필요합니다." }, { status: 400 });
  }
  if (!Number.isSafeInteger(assistantMessageId) || assistantMessageId <= 0) {
    return NextResponse.json({ error: "assistantMessageId가 필요합니다." }, { status: 400 });
  }

  const result = adoptOocSceneRenderCore(getDb(), {
    chatId,
    assistantMessageId,
    ownerUserId: user.id,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, code: result.code },
      { status: result.status }
    );
  }

  return NextResponse.json({
    ok: true,
    alreadyAdopted: result.alreadyAdopted,
    canonAdopted: true,
    canonAdoptedAt: result.canonAdoptedAt,
    assistantMessageId: result.assistantMessageId,
  });
}
