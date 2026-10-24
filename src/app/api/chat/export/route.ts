import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { adultOffReadGuardAppliesForChat } from "@/lib/adultOffVisibleOutput";
import {
  buildAttachmentDisposition,
  buildTranscriptFilename,
  generateTranscriptChunks,
  type TranscriptHeader,
  type TranscriptStatusContext,
} from "@/lib/chatTranscriptExport";
import { getPublicPersonaById } from "@/lib/userPersonas";

export const dynamic = "force-dynamic";

type ChatExportRow = {
  id: number;
  title: string | null;
  adult_handoff_enabled: number | null;
  selected_persona_id: number | null;
  user_note: string | null;
  status_widget_stack_order: string | null;
  status_widget_display_mode: string | null;
  character_name: string | null;
  character_widget_json: string | null;
  character_allow_user_override: number | null;
};

/**
 * 전체 대화 TXT. 읽기 전용(DB 쓰기 없음), 파일은 서버에 저장하지 않고 응답으로만 내려보낸다.
 * `/api/chat/messages`의 고아 메시지 purge는 의도적으로 복제하지 않는다.
 */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const chatId = Number(new URL(req.url).searchParams.get("chatId"));
  if (!Number.isInteger(chatId) || chatId <= 0) {
    return NextResponse.json({ error: "chatId가 필요합니다." }, { status: 400 });
  }

  const db = getDb();
  const chat = db
    .prepare(
      `SELECT c.id, c.title, c.adult_handoff_enabled, c.selected_persona_id, c.user_note,
              c.status_widget_stack_order, c.status_widget_display_mode,
              ch.name AS character_name, ch.status_widget_json AS character_widget_json,
              ch.status_widget_allow_user_override AS character_allow_user_override
       FROM chats c LEFT JOIN characters ch ON ch.id = c.character_id
       WHERE c.id=? AND c.user_id=?`
    )
    .get(chatId, user.id) as ChatExportRow | undefined;
  if (!chat) return NextResponse.json({ error: "채팅방을 찾을 수 없습니다." }, { status: 404 });

  const persona = chat.selected_persona_id
    ? getPublicPersonaById(user.id, chat.selected_persona_id)
    : null;

  const header: TranscriptHeader = {
    characterName: chat.character_name?.trim() || "캐릭터",
    chatTitle: chat.title ?? "",
    personaName: persona?.name?.trim() || user.nickname || "",
  };
  const statusContext: TranscriptStatusContext = {
    userNote: chat.user_note ?? "",
    personaDescription: persona?.description ?? "",
    characterWidgetJson: chat.character_widget_json ?? "",
    personaWidgetJson: persona?.active_status_widget_json ?? "",
    characterAllowUserOverride: chat.character_allow_user_override !== 0,
    statusWidgetStackOrder: chat.status_widget_stack_order,
    statusWidgetDisplayMode: chat.status_widget_display_mode,
    profileNames: {
      characterName: chat.character_name,
      personaName: persona?.name,
      fallbackNickname: user.nickname,
    },
  };
  const applyAdultOffReadGuard = adultOffReadGuardAppliesForChat({
    user,
    adultHandoffEnabled: chat.adult_handoff_enabled,
  });

  const chunks = generateTranscriptChunks({
    db,
    chatId: chat.id,
    header,
    applyAdultOffReadGuard,
    statusContext,
  });
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      try {
        const next = chunks.next();
        if (next.done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(next.value));
      } catch (error) {
        controller.error(error);
      }
    },
    cancel() {
      chunks.return(undefined);
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": buildAttachmentDisposition(buildTranscriptFilename(header)),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
