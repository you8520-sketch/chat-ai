import { getDb } from "@/lib/db";
import { parseStoredStatusWidgetValuesJson } from "./parseValues";
import { statusWidgetValuesHasContent } from "./displayPolicy";
import type { ParsedStatusWidgetTurnValues } from "./types";

/** 직전 assistant 턴에 저장된 위젯 values (DeepSeek Flash 백필 anchor) */
export function loadPreviousStatusWidgetValues(
  chatId: number,
  excludeMessageId?: number
): ParsedStatusWidgetTurnValues | null {
  const rows = getDb()
    .prepare(
      `SELECT id, status_widget_values_json FROM messages
       WHERE chat_id=? AND role='assistant'
         AND status_widget_values_json IS NOT NULL AND status_widget_values_json != ''
       ORDER BY id DESC LIMIT 8`
    )
    .all(chatId) as { id: number; status_widget_values_json: string }[];

  for (const row of rows) {
    if (excludeMessageId != null && row.id === excludeMessageId) continue;
    const parsed = parseStoredStatusWidgetValuesJson(row.status_widget_values_json);
    if (statusWidgetValuesHasContent(parsed)) return parsed;
  }
  return null;
}
