import { getDb } from "@/lib/db";
import { parseStoredStatusWidgetValuesJson } from "./parseValues";
import { statusWidgetValuesHasContent } from "./displayPolicy";
import { stripStatusWidgetFromAssistantProse } from "./proseStrip";
import type { ParsedStatusWidgetTurnValues } from "./types";

/** 직전 assistant 턴에 저장된 위젯 values (V3 extract 시간 앵커) */
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

/** 직전 assistant 턴 RP 본문 (위젯 tail 제거) — V3 extract narrative 참고용 */
export function loadPreviousAssistantProse(
  chatId: number,
  excludeMessageId?: number
): string | null {
  const rows = getDb()
    .prepare(
      `SELECT id, content FROM messages
       WHERE chat_id=? AND role='assistant'
         AND content IS NOT NULL AND content != ''
       ORDER BY id DESC LIMIT 8`
    )
    .all(chatId) as { id: number; content: string }[];

  for (const row of rows) {
    if (excludeMessageId != null && row.id === excludeMessageId) continue;
    const prose = stripStatusWidgetFromAssistantProse(row.content);
    if (prose.trim()) return prose;
  }
  return null;
}
