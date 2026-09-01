import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import {
  buildUserChatPrefsPayload,
  parseUserChatPrefs,
  serializeUserChatPrefs,
} from "@/lib/userChatPrefs";
import { validateUserNoteCombined } from "@/lib/userNoteStatusWindow";
import {
  resolveStatusWidgetReservedChars,
  statusWidgetModeForDefinitions,
} from "@/lib/statusWidget";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const db = getDb();
  const row = db.prepare("SELECT chat_prefs FROM users WHERE id=?").get(user.id) as
    | { chat_prefs: string }
    | undefined;
  const prefs = parseUserChatPrefs(row?.chat_prefs);
  return Response.json({ prefs });
}

export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await req.json();
  const chatId = typeof body.chatId === "number" ? body.chatId : undefined;
  const db = getDb();

  const prefs = buildUserChatPrefsPayload({
    targetResponseChars: body.targetResponseChars,
    novelModeEnabled: body.novelModeEnabled,
    userNote: typeof body.userNote === "string" ? body.userNote : "",
    displayPrefs: body.displayPrefs,
  });

  if (typeof body.userNote === "string") {
    let widgetReserved = 0;
    if (chatId) {
      const row = db
        .prepare(
          `SELECT ch.status_widget_stack_order,
                  c.status_widget_json, c.status_widget_allow_user_override,
                  COALESCE((
                    SELECT p.widget_json
                    FROM user_personas up
                    JOIN user_status_widget_presets p
                      ON p.id = up.active_status_widget_preset_id
                     AND p.user_id = up.user_id
                    WHERE up.id = ch.selected_persona_id
                      AND up.user_id = ch.user_id
                    LIMIT 1
                  ), '') AS persona_status_widget_json
           FROM chats ch
           JOIN characters c ON c.id = ch.character_id
           WHERE ch.id = ? AND ch.user_id = ?`
        )
        .get(chatId, user.id) as
        | {
            status_widget_stack_order: string | null;
            status_widget_json: string | null;
            status_widget_allow_user_override: number | null;
            persona_status_widget_json: string;
          }
        | undefined;
      if (row) {
        const engineMode = statusWidgetModeForDefinitions({
          characterWidgetJson: row.status_widget_json,
          personaWidgetJson: row.persona_status_widget_json,
          characterAllowUserOverride: row.status_widget_allow_user_override !== 0,
        });
        widgetReserved = resolveStatusWidgetReservedChars({
          characterWidgetJson: row.status_widget_json,
          chatMode: engineMode,
          userWidgetJson: row.persona_status_widget_json,
          stackOrder: row.status_widget_stack_order,
          characterAllowUserOverride: row.status_widget_allow_user_override !== 0,
        });
      }
    }
    const noteCheck = validateUserNoteCombined(body.userNote, widgetReserved);
    if (!noteCheck.ok) {
      return Response.json({ error: noteCheck.error }, { status: 400 });
    }
  }

  db.prepare("UPDATE users SET chat_prefs=? WHERE id=?").run(
    serializeUserChatPrefs(prefs),
    user.id
  );

  if (chatId) {
    const chat = db
      .prepare("SELECT id, user_note FROM chats WHERE id=? AND user_id=?")
      .get(chatId, user.id) as { id: number; user_note: string } | undefined;
    if (chat) {
      const mergedNote = typeof body.userNote === "string" ? body.userNote.trim() : chat.user_note;
      db.prepare(
        `UPDATE chats SET target_response_chars=?, user_note=? WHERE id=?`
      ).run(prefs.targetResponseChars, mergedNote, chatId);
    }
  }

  return Response.json({ ok: true, prefs });
}
