import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { parseAdultHandoffEnabled } from "@/lib/chatAdultHandoff";
import { normalizeTargetResponseChars } from "@/lib/responseLength";
import { validateUserNoteCombined } from "@/lib/userNoteStatusWindow";
import { sanitizeChatTitle } from "@/lib/chatTitle";
import { resolveNarrativePov } from "@/lib/narrativePov";
import { fieldPlaceholderKey } from "@/lib/statusWidget/fieldKeys";
import {
  statusWidgetHasCreatorSource,
  statusWidgetHasUserSource,
} from "@/lib/statusWidget/resolve";
import {
  displayModeFromEngineMode,
  parseStatusWidgetDisplayMode,
  parseStatusWidgetJson,
  parseStatusWidgetMode,
  resolveStatusWidgetReservedBreakdown,
  resolveStatusWidgetTurn,
  validateStatusWidgetContextBudget,
  serializeStatusWidget,
  type StatusWidget,
  type StatusWidgetSourceMode,
} from "@/lib/statusWidget";
import { resolveStatusWidgetSettingsWrite } from "@/lib/statusWidget/settingsWrite";
import {
  supersedeUnconsumedStatusTriggerEvents,
  supersedeUnconsumedStatusTriggerEventsForKeys,
} from "@/lib/statusWidgetTriggers";

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

function widgetFieldKeys(widget: StatusWidget | null | undefined): string[] {
  if (!widget) return [];
  const keys = new Set<string>();
  for (const field of widget.fields) {
    if (field.id?.trim()) keys.add(field.id.trim());
    const placeholder = fieldPlaceholderKey(field);
    if (placeholder) keys.add(placeholder);
  }
  return [...keys];
}

function supersedeDisabledStatusSources(opts: {
  chatId: number;
  prevMode: StatusWidgetSourceMode;
  nextMode: StatusWidgetSourceMode;
  characterWidget: StatusWidget | null;
  userWidget: StatusWidget | null;
}): void {
  const db = getDb();
  if (opts.nextMode === "off" && opts.prevMode !== "off") {
    supersedeUnconsumedStatusTriggerEvents(db, opts.chatId);
    return;
  }
  if (
    statusWidgetHasCreatorSource(opts.prevMode) &&
    !statusWidgetHasCreatorSource(opts.nextMode)
  ) {
    supersedeUnconsumedStatusTriggerEventsForKeys(
      db,
      opts.chatId,
      widgetFieldKeys(opts.characterWidget)
    );
  }
  if (
    statusWidgetHasUserSource(opts.prevMode) &&
    !statusWidgetHasUserSource(opts.nextMode)
  ) {
    supersedeUnconsumedStatusTriggerEventsForKeys(
      db,
      opts.chatId,
      widgetFieldKeys(opts.userWidget)
    );
  }
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
    adultHandoffEnabled: adultHandoffEnabledInput,
  } = body;
  if (!chatId) return Response.json({ error: "채팅방 ID가 필요합니다." }, { status: 400 });

  const nsfw = isAdultMode ?? isNsfwMode ?? nsfwMode;
  if (nsfw === true && !user.is_adult) {
    return Response.json({ error: "성인용 콘텐츠는 성인인증 후 이용할 수 있습니다.", needVerify: true }, { status: 403 });
  }
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

  const allowUser = widgetCtx?.status_widget_allow_user_override !== 0;
  const storedMode = parseStatusWidgetMode(widgetCtx?.status_widget_mode);
  const storedDisplay = parseStatusWidgetDisplayMode(widgetCtx?.status_widget_display_mode);
  const settingsWrite = resolveStatusWidgetSettingsWrite({
    storedMode,
    storedDisplay,
    incomingMode: statusWidgetMode,
    incomingDisplay: statusWidgetDisplayMode,
  });
  const nextMode = settingsWrite.nextMode;
  const nextDisplay = settingsWrite.nextDisplay;

  const resolved = resolveStatusWidgetTurn({
    characterWidgetJson: widgetCtx?.status_widget_json,
    chatMode: nextMode,
    userWidgetJson: nextUserWidgetJson,
    stackOrder: widgetCtx?.status_widget_stack_order,
    characterAllowUserOverride: allowUser,
    displayMode: nextDisplay,
  });

  const prevResolved = resolveStatusWidgetTurn({
    characterWidgetJson: widgetCtx?.status_widget_json,
    chatMode: storedMode,
    userWidgetJson: widgetCtx?.user_status_widget_json,
    stackOrder: widgetCtx?.status_widget_stack_order,
    characterAllowUserOverride: allowUser,
    displayMode: storedDisplay,
  });

  const widgetReservedBreakdown = resolveStatusWidgetReservedBreakdown({
    characterWidgetJson: widgetCtx?.status_widget_json,
    chatMode: nextMode,
    userWidgetJson: nextUserWidgetJson,
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
  const mode = typeof nsfw === "boolean" ? (nsfw ? "nsfw" : "safe") : undefined;
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
  if (settingsWrite.writeMode) {
    sets.push("status_widget_mode=?");
    vals.push(nextMode);
  }
  if (settingsWrite.writeDisplay) {
    sets.push("status_widget_display_mode=?");
    vals.push(nextDisplay);
  }
  if (userStatusWidgetJson !== undefined) {
    sets.push("user_status_widget_json=?");
    vals.push(nextUserWidgetJson);
  }
  if (adultHandoffEnabled !== undefined) {
    sets.push("adult_handoff_enabled=?");
    vals.push(adultHandoffEnabled ? 1 : 0);
  }

  if (sets.length === 0) {
    return Response.json({ error: "변경할 설정이 없습니다." }, { status: 400 });
  }

  vals.push(chatId);
  db.prepare(`UPDATE chats SET ${sets.join(", ")} WHERE id=?`).run(...vals);

  if (settingsWrite.writeMode) {
    supersedeDisabledStatusSources({
      chatId,
      prevMode: prevResolved.mode,
      nextMode: resolved.mode,
      characterWidget: resolved.characterWidget,
      userWidget: parseStatusWidgetJson(nextUserWidgetJson),
    });
  }

  return Response.json({
    ok: true,
    statusWidgetMode: nextMode,
    statusWidgetDisplayMode: nextDisplay ?? storedDisplay ?? displayModeFromEngineMode(nextMode),
    narrativePov: resolvedNarrativePov.mode,
    povCharacterName: resolvedNarrativePov.povCharacterName,
    ...(adultHandoffEnabled !== undefined ? { adultHandoffEnabled } : {}),
  });
}
