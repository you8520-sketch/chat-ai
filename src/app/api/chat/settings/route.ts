import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { normalizeTargetResponseChars } from "@/lib/responseLength";
import { validateUserNoteCombined } from "@/lib/userNoteStatusWindow";
import { sanitizeChatTitle } from "@/lib/chatTitle";
import { parseNarrativePov } from "@/lib/narrativePov";
import {
  displayModeFromEngineMode,
  engineModeForDisplay,
  hasCharacterStatusWidget,
  parseStatusWidgetDisplayMode,
  parseStatusWidgetJson,
  parseStatusWidgetMode,
  resolveStatusWidgetReservedBreakdown,
  resolveStatusWidgetTurn,
  validateStatusWidgetContextBudget,
  serializeStatusWidget,
} from "@/lib/statusWidget";

function loadChatWidgetContext(chatId: number, userId: number) {
  const db = getDb();
  return db
    .prepare(
      `SELECT ch.status_widget_mode, ch.user_status_widget_json, ch.status_widget_stack_order,
              ch.status_widget_display_mode,
              c.status_widget_json, c.status_widget_allow_user_override
       FROM chats ch
       JOIN characters c ON c.id = ch.character_id
       WHERE ch.id = ? AND ch.user_id = ?`
    )
    .get(chatId, userId) as
    | {
        status_widget_mode: string | null;
        user_status_widget_json: string | null;
        status_widget_stack_order: string | null;
        status_widget_display_mode: string | null;
        status_widget_json: string | null;
        status_widget_allow_user_override: number | null;
      }
    | undefined;
}

export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await req.json();
  const {
    chatId,
    userNote,
    isNsfwMode,
    nsfwMode,
    isAdultMode,
    targetResponseChars,
    chatTitle,
    statusWidgetMode,
    statusWidgetDisplayMode,
    userStatusWidgetJson,
    narrativePov,
    povCharacterName,
  } = body;
  if (!chatId) return Response.json({ error: "채팅방 ID가 필요합니다." }, { status: 400 });

  const nsfw = isAdultMode ?? isNsfwMode ?? nsfwMode;
  if (nsfw === true && !user.is_adult) {
    return Response.json({ error: "19+ 모드는 성인인증 후 이용할 수 있습니다.", needVerify: true }, { status: 403 });
  }

  const db = getDb();
  const chat = db.prepare(
    `SELECT ch.id, c.name, COALESCE(c.content_kind, 'character') AS content_kind
     FROM chats ch JOIN characters c ON c.id = ch.character_id
     WHERE ch.id=? AND ch.user_id=?`
  ).get(chatId, user.id) as { id: number; name: string; content_kind: string } | undefined;
  if (!chat) return Response.json({ error: "채팅방을 찾을 수 없습니다." }, { status: 404 });

  const widgetCtx = loadChatWidgetContext(chatId, user.id);
  const hasCreator = hasCharacterStatusWidget(widgetCtx?.status_widget_json);
  let nextUserWidgetJson = widgetCtx?.user_status_widget_json ?? null;
  if (userStatusWidgetJson !== undefined) {
    const parsed =
      typeof userStatusWidgetJson === "string"
        ? parseStatusWidgetJson(userStatusWidgetJson)
        : parseStatusWidgetJson(JSON.stringify(userStatusWidgetJson));
    if (!parsed) {
      return Response.json({ error: "유효하지 않은 상태창 위젯 JSON입니다." }, { status: 400 });
    }
    nextUserWidgetJson = serializeStatusWidget(parsed);
  }

  const hasUser = Boolean(parseStatusWidgetJson(nextUserWidgetJson));

  let nextDisplay =
    statusWidgetDisplayMode !== undefined
      ? parseStatusWidgetDisplayMode(String(statusWidgetDisplayMode))
      : parseStatusWidgetDisplayMode(widgetCtx?.status_widget_display_mode);

  // Legacy: if only engine mode sent, derive display
  if (nextDisplay == null && statusWidgetMode !== undefined) {
    nextDisplay = displayModeFromEngineMode(parseStatusWidgetMode(String(statusWidgetMode)));
  }
  if (nextDisplay == null) {
    nextDisplay =
      parseStatusWidgetDisplayMode(widgetCtx?.status_widget_display_mode) ??
      displayModeFromEngineMode(parseStatusWidgetMode(widgetCtx?.status_widget_mode));
  }

  // Engine mode always keeps creator on when present
  let nextMode = engineModeForDisplay(nextDisplay, hasCreator, hasUser);
  nextMode = resolveStatusWidgetTurn({
    characterWidgetJson: widgetCtx?.status_widget_json,
    chatMode: nextMode,
    userWidgetJson: nextUserWidgetJson,
    stackOrder: widgetCtx?.status_widget_stack_order,
    characterAllowUserOverride: widgetCtx?.status_widget_allow_user_override !== 0,
    displayMode: nextDisplay,
  }).mode;

  const widgetReservedBreakdown = resolveStatusWidgetReservedBreakdown({
    characterWidgetJson: widgetCtx?.status_widget_json,
    chatMode: nextMode,
    userWidgetJson: nextUserWidgetJson,
    stackOrder: widgetCtx?.status_widget_stack_order,
    characterAllowUserOverride: widgetCtx?.status_widget_allow_user_override !== 0,
    displayMode: nextDisplay,
  });
  const widgetBudgetCheck = validateStatusWidgetContextBudget(widgetReservedBreakdown);
  if (!widgetBudgetCheck.ok) {
    return Response.json({ error: widgetBudgetCheck.error }, { status: 400 });
  }

  const note = typeof userNote === "string" ? userNote.trim() : undefined;
  if (note !== undefined) {
    const noteCheck = validateUserNoteCombined(note, widgetReservedBreakdown.totalReservedChars);
    if (!noteCheck.ok) {
      return Response.json({ error: noteCheck.error }, { status: 400 });
    }
  }
  const mode = typeof nsfw === "boolean" ? (nsfw ? "nsfw" : "safe") : undefined;
  const targetChars =
    targetResponseChars != null ? normalizeTargetResponseChars(targetResponseChars) : undefined;
  const title = chatTitle !== undefined ? sanitizeChatTitle(chatTitle) : undefined;
  const nextNarrativePov = narrativePov !== undefined ? parseNarrativePov(narrativePov) : undefined;
  let nextPovCharacterName = povCharacterName !== undefined
    ? String(povCharacterName).trim().slice(0, 80)
    : undefined;
  if (nextNarrativePov === "first_person") {
    if (chat.content_kind === "simulation" && !nextPovCharacterName) {
      return Response.json({ error: "1인칭 시점 캐릭터를 선택하거나 입력해 주세요." }, { status: 400 });
    }
    if (chat.content_kind !== "simulation") nextPovCharacterName = chat.name;
  }

  const sets: string[] = [];
  const vals: unknown[] = [];
  if (note !== undefined) {
    sets.push("user_note=?");
    vals.push(note);
  }
  if (mode !== undefined) {
    sets.push("mode=?");
    vals.push(mode);
  }
  if (targetChars !== undefined) {
    sets.push("target_response_chars=?");
    vals.push(targetChars);
  }
  if (title !== undefined) {
    sets.push("title=?");
    vals.push(title);
  }
  if (nextNarrativePov !== undefined) {
    sets.push("narrative_pov=?");
    vals.push(nextNarrativePov);
  }
  if (nextPovCharacterName !== undefined) {
    sets.push("pov_character_name=?");
    vals.push(nextPovCharacterName);
  }
  if (statusWidgetMode !== undefined || statusWidgetDisplayMode !== undefined) {
    sets.push("status_widget_mode=?");
    vals.push(nextMode);
    sets.push("status_widget_display_mode=?");
    vals.push(nextDisplay);
  }
  if (userStatusWidgetJson !== undefined) {
    sets.push("user_status_widget_json=?");
    vals.push(nextUserWidgetJson);
  }

  if (sets.length === 0) {
    return Response.json({ error: "변경할 설정이 없습니다." }, { status: 400 });
  }

  vals.push(chatId);
  db.prepare(`UPDATE chats SET ${sets.join(", ")} WHERE id=?`).run(...vals);

  return Response.json({ ok: true, statusWidgetMode: nextMode, statusWidgetDisplayMode: nextDisplay });
}
