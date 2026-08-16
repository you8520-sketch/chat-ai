import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import {
  USER_SELECTABLE_AI_OPTIONS,
  isValidSelectedAI,
  selectedAILabel,
  type SelectedAI,
} from "@/lib/chatModels";
import {
  consumeSelectedAiEntryNotice,
  getUserChatSelectedAI,
  setUserSelectedAI,
} from "@/lib/userSelectedAI";

const USER_SELECTABLE_IDS = new Set<string>(USER_SELECTABLE_AI_OPTIONS.map((o) => o.id));

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const db = getDb();
  const url = new URL(req.url);
  const consumeNotice = url.searchParams.get("consumeNotice") === "1";

  if (consumeNotice) {
    const chatCount = (
      db.prepare("SELECT COUNT(*) AS n FROM chats WHERE user_id=?").get(user.id) as { n: number }
    ).n;
    const { notice, kind, selectedAI } = consumeSelectedAiEntryNotice(db, user.id, {
      isFirstChatVisitEver: chatCount <= 1,
    });
    return Response.json({
      selectedAI,
      label: selectedAILabel(selectedAI),
      notice,
      noticeKind: kind,
    });
  }

  const selectedAI = getUserChatSelectedAI(db, user.id);
  return Response.json({
    selectedAI,
    label: selectedAILabel(selectedAI),
  });
}

export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await req.json();
  const requested = typeof body.selectedAI === "string" ? body.selectedAI.trim() : "";
  // Server allow-list: only currently user-selectable production models (not Kimi/Qwen/GLM/arbitrary).
  if (!requested || !isValidSelectedAI(requested) || !USER_SELECTABLE_IDS.has(requested)) {
    return Response.json({ error: "지원하지 않는 모델입니다." }, { status: 400 });
  }

  const db = getDb();
  const { selectedAI, changed } = setUserSelectedAI(db, user.id, requested as SelectedAI);

  return Response.json({
    ok: true,
    selectedAI,
    changed,
    label: selectedAILabel(selectedAI),
  });
}
