import { getDb } from "@/lib/db";
import { parseStoredStatusWidgetValuesJson } from "./parseValues";
import { statusWidgetValuesHasContent } from "./displayPolicy";
import { stripStatusWidgetFromAssistantProse } from "./proseStrip";
import type { ParsedStatusWidgetTurnValues } from "./types";

/** Finalized turns only — never in-flight / failed / interrupted as clock anchors. */
const CANONICAL_STATUS_WIDGET_GENERATION_STATUSES = [
  "completed",
  "ok",
  "completed_with_postprocess_error",
] as const;

/**
 * Latest approved canonical widget values for V3 extract clock/state anchor.
 * Reads only finalized assistant rows with non-empty values — not generating,
 * failed, interrupted, or empty snapshots. Does not copy into the current message.
 */
export function loadPreviousStatusWidgetValues(
  chatId: number,
  excludeMessageId?: number
): ParsedStatusWidgetTurnValues | null {
  const placeholders = CANONICAL_STATUS_WIDGET_GENERATION_STATUSES.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT id, status_widget_values_json FROM messages
       WHERE chat_id=? AND role='assistant'
         AND generation_status IN (${placeholders})
         AND status_widget_values_json IS NOT NULL AND status_widget_values_json != ''
       ORDER BY id DESC LIMIT 8`
    )
    .all(chatId, ...CANONICAL_STATUS_WIDGET_GENERATION_STATUSES) as {
    id: number;
    status_widget_values_json: string;
  }[];

  for (const row of rows) {
    if (excludeMessageId != null && row.id === excludeMessageId) continue;
    const parsed = parseStoredStatusWidgetValuesJson(row.status_widget_values_json);
    if (statusWidgetValuesHasContent(parsed)) return parsed;
  }
  return null;
}

/** 직전 완료 assistant 턴 RP 본문 (위젯 tail 제거) — V3 extract narrative 참고용 */
export function loadPreviousAssistantProse(
  chatId: number,
  excludeMessageId?: number
): string | null {
  const placeholders = CANONICAL_STATUS_WIDGET_GENERATION_STATUSES.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT id, content FROM messages
       WHERE chat_id=? AND role='assistant'
         AND generation_status IN (${placeholders})
         AND content IS NOT NULL AND content != ''
       ORDER BY id DESC LIMIT 8`
    )
    .all(chatId, ...CANONICAL_STATUS_WIDGET_GENERATION_STATUSES) as {
    id: number;
    content: string;
  }[];

  for (const row of rows) {
    if (excludeMessageId != null && row.id === excludeMessageId) continue;
    const prose = stripStatusWidgetFromAssistantProse(row.content);
    if (prose.trim()) return prose;
  }
  return null;
}
