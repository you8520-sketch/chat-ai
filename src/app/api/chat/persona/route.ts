import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import {
  ensureDefaultPersona,
  validatePersonaSelection,
} from "@/lib/userPersonas";

export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { chatId, selectedPersonaId } = await req.json();
  if (!chatId) return Response.json({ error: "채팅방 ID가 필요합니다." }, { status: 400 });
  if (!selectedPersonaId) {
    return Response.json({ error: "페르소나 ID가 필요합니다." }, { status: 400 });
  }

  const db = getDb();
  const chat = db
    .prepare("SELECT id FROM chats WHERE id=? AND user_id=?")
    .get(chatId, user.id) as { id: number } | undefined;
  if (!chat) return Response.json({ error: "채팅방을 찾을 수 없습니다." }, { status: 404 });

  const personas = ensureDefaultPersona(user.id, user.nickname);
  const selection = validatePersonaSelection(personas, Number(selectedPersonaId));

  if (!selection.ok) {
    const fallback = selection.fallbackPersona;
    if (!fallback) {
      return Response.json({ error: "사용 가능한 페르소나가 없습니다." }, { status: 400 });
    }
    db.prepare("UPDATE chats SET selected_persona_id=? WHERE id=?").run(fallback.id, chatId);
    return Response.json(
      {
        ok: true,
        selectedPersonaId: fallback.id,
        fallbackApplied: true,
        error: "페르소나를 찾을 수 없습니다. 첫 번째 페르소나로 변경되었습니다.",
      },
      { status: 403 }
    );
  }

  db.prepare("UPDATE chats SET selected_persona_id=? WHERE id=?").run(selection.persona.id, chatId);

  return Response.json({
    ok: true,
    selectedPersonaId: selection.persona.id,
    persona: selection.persona,
  });
}
