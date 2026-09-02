import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { parseAdultHandoffEnabled } from "@/lib/chatAdultHandoff";
import { normalizeTargetResponseChars } from "@/lib/responseLength";
import { validateUserNoteCombined } from "@/lib/userNoteStatusWindow";
import { sanitizeChatTitle } from "@/lib/chatTitle";
import { resolveNarrativePov } from "@/lib/narrativePov";
import {
  displayModeFromEngineMode,
  parseIncomingStatusWidgetDisplayMode,
  parseStatusWidgetDisplayMode,
  resolveStatusWidgetReservedBreakdown,
  statusWidgetModeForDefinitions,
  validateStatusWidgetContextBudget,
} from "@/lib/statusWidget";

function loadChatWidgetContext(chatId: number, userId: number) {
  const db = getDb();
  return db
    .prepare(
      `SELECT ch.status_widget_stack_order, ch.status_widget_display_mode,
              c.status_widget_json, c.status_widget_allow_user_override,
              COALESCE((
                SELECT preset.widget_json
                FROM user_personas persona
                JOIN user_status_widget_presets preset
                  ON preset.id=persona.active_status_widget_preset_id
                 AND preset.user_id=persona.user_id
                WHERE persona.id=ch.selected_persona_id
                  AND persona.user_id=ch.user_id
              ), '') AS persona_status_widget_json
       FROM chats ch
       JOIN characters c ON c.id = ch.character_id
       WHERE ch.id = ? AND ch.user_id = ?`
    )
    .get(chatId, userId) as
    | {
        status_widget_stack_order: string | null;
        status_widget_display_mode: string | null;
        status_widget_json: string | null;
        status_widget_allow_user_override: number | null;
        persona_status_widget_json: string;
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
    targetResponseChars,
    chatTitle,
    statusWidgetDisplayMode,
    narrativePov,
    povCharacterName,
    adultHandoffEnabled: adultHandoffEnabledInput,
  } = body;
  if (!chatId) return Response.json({ error: "채팅방 ID가 필요합니다." }, { status: 400 });

  const adultHandoffEnabled = parseAdultHandoffEnabled(
    adultHandoffEnabledInput ?? body.adult_handoff_enabled
  );
  if (adultHandoffEnabled === true && !user.is_adult) {
    return Response.json(
      { error: "성인모드는 성인인증 후 이용할 수 있습니다.", needVerify: true },
      { status: 403 }
    );
  }

  const db = getDb();
  const chat = db.prepare(
    `SELECT ch.id, ch.narrative_pov, ch.pov_character_name,
            c.name, COALESCE(c.content_kind, 'character') AS content_kind
     FROM chats ch JOIN characters c ON c.id = ch.character_id
     WHERE ch.id=? AND ch.user_id=?`
  ).get(chatId, user.id) as {
    id: number;
    narrative_pov: string | null;
    pov_character_name: string | null;
    name: string;
    content_kind: string;
  } | undefined;
  if (!chat) return Response.json({ error: "채팅방을 찾을 수 없습니다." }, { status: 404 });

  const widgetCtx = loadChatWidgetContext(chatId, user.id);
  const allowUser = widgetCtx?.status_widget_allow_user_override !== 0;
  const engineMode = statusWidgetModeForDefinitions({
    characterWidgetJson: widgetCtx?.status_widget_json,
    personaWidgetJson: widgetCtx?.persona_status_widget_json,
    characterAllowUserOverride: allowUser,
  });
  const storedDisplay = parseStatusWidgetDisplayMode(widgetCtx?.status_widget_display_mode);
  const writeDisplay = statusWidgetDisplayMode !== undefined;
  const incomingDisplay = writeDisplay
    ? parseIncomingStatusWidgetDisplayMode(statusWidgetDisplayMode)
    : null;
  if (writeDisplay && !incomingDisplay) {
    return Response.json(
      { error: "statusWidgetDisplayMode must be creator, user, both, or hidden." },
      { status: 400 }
    );
  }
  const nextDisplay = incomingDisplay ?? storedDisplay ?? displayModeFromEngineMode(engineMode);

  const widgetReservedBreakdown = resolveStatusWidgetReservedBreakdown({
    characterWidgetJson: widgetCtx?.status_widget_json,
    chatMode: engineMode,
    userWidgetJson: widgetCtx?.persona_status_widget_json,
    stackOrder: widgetCtx?.status_widget_stack_order,
    characterAllowUserOverride: allowUser,
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
  const mode =
    adultHandoffEnabled !== undefined
      ? adultHandoffEnabled && user.is_adult
        ? "nsfw"
        : "safe"
      : undefined;
  const targetChars =
    targetResponseChars != null ? normalizeTargetResponseChars(targetResponseChars) : undefined;
  const title = chatTitle !== undefined ? sanitizeChatTitle(chatTitle) : undefined;
  const resolvedNarrativePov = resolveNarrativePov({
    mode: narrativePov !== undefined ? narrativePov : chat.narrative_pov,
    contentKind: chat.content_kind === "simulation" ? "simulation" : "character",
    mainCharacterName: chat.name,
    povCharacterName:
      povCharacterName !== undefined ? povCharacterName : chat.pov_character_name,
  });
  const shouldPersistNarrativePov =
    narrativePov !== undefined ||
    povCharacterName !== undefined ||
    (chat.content_kind === "simulation" &&
      (chat.narrative_pov !== resolvedNarrativePov.mode ||
        (chat.pov_character_name ?? "") !== resolvedNarrativePov.povCharacterName));

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
  if (shouldPersistNarrativePov) {
    sets.push("narrative_pov=?");
    vals.push(resolvedNarrativePov.mode);
    sets.push("pov_character_name=?");
    vals.push(resolvedNarrativePov.povCharacterName || null);
  }
  if (writeDisplay) {
    sets.push("status_widget_display_mode=?");
    vals.push(nextDisplay);
  }
  if (adultHandoffEnabled !== undefined) {
    sets.push("adult_handoff_enabled=?");
    vals.push(adultHandoffEnabled ? 1 : 0);
  }

  if (sets.length === 0) {
    return Response.json({ error: "변경할 설정이 없습니다." }, { status: 400 });
  }

  try {
    db.prepare(`UPDATE chats SET ${sets.join(", ")} WHERE id=? AND user_id=?`).run(
      ...vals,
      chatId,
      user.id
    );
  } catch (e) {
    console.error("[StatusWidgetSettings] atomic persist failed:", (e as Error).message);
    return Response.json({ error: "상태창 설정 저장에 실패했습니다." }, { status: 500 });
  }

  return Response.json({
    ok: true,
    statusWidgetDisplayMode: nextDisplay,
    narrativePov: resolvedNarrativePov.mode,
    povCharacterName: resolvedNarrativePov.povCharacterName,
    ...(adultHandoffEnabled !== undefined ? { adultHandoffEnabled } : {}),
  });
}
