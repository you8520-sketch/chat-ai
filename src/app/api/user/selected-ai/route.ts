import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import type { User } from "@/lib/auth-types";
import { isAdminUser } from "@/lib/isAdminUser";
import {
  isUserSelectableAI,
  isValidSelectedAI,
  selectedAILabel,
  type SelectedAI,
} from "@/lib/chatModels";
import {
  consumeSelectedAiEntryNotice,
  getUserChatSelectedAI,
  setUserSelectedAI,
} from "@/lib/userSelectedAI";

function sessionIsAdmin(user: User): boolean {
  const db = getDb();
  const row = db
    .prepare("SELECT is_admin FROM users WHERE id = ?")
    .get(user.id) as { is_admin: number } | undefined;
  return isAdminUser({ email: user.email, is_admin: row?.is_admin ?? 0 });
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const db = getDb();
  const isAdmin = sessionIsAdmin(user);
  const url = new URL(req.url);
  const consumeNotice = url.searchParams.get("consumeNotice") === "1";

  if (consumeNotice) {
    const chatCount = (
      db.prepare("SELECT COUNT(*) AS n FROM chats WHERE user_id=?").get(user.id) as { n: number }
    ).n;
    const { notice, kind, selectedAI } = consumeSelectedAiEntryNotice(db, user.id, {
      isFirstChatVisitEver: chatCount <= 1,
      isAdmin,
    });
    return Response.json({
      selectedAI,
      label: selectedAILabel(selectedAI),
      notice,
      noticeKind: kind,
    });
  }

  const selectedAI = getUserChatSelectedAI(db, user.id, { isAdmin });
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
  const isAdmin = sessionIsAdmin(user);
  // Server allow-list: user-selectable production models (+ admin-only Opus 5 when disabled globally).
  if (!requested || !isValidSelectedAI(requested) || !isUserSelectableAI(requested, isAdmin)) {
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
