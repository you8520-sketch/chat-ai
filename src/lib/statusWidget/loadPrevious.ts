import { getDb } from "@/lib/db";
import { parseStoredStatusWidgetValuesJson } from "./parseValues";
import { statusWidgetValuesHasContent } from "./displayPolicy";
import { stripStatusWidgetFromAssistantProse } from "./proseStrip";
import { stripUnknownLikeTemporalFromParsed } from "./temporalUnknown";
import type { ParsedStatusWidgetTurnValues, StatusWidget } from "./types";

/** Finalized turns only — never in-flight / failed / interrupted as clock anchors. */
const CANONICAL_STATUS_WIDGET_GENERATION_STATUSES = [
  "completed",
  "ok",
  "completed_with_postprocess_error",
] as const;

export type LoadPreviousStatusWidgetOptions = {
  /** Regeneration target — never used as canonical clock anchor. */
  excludeMessageId?: number;
  characterWidget?: StatusWidget | null;
  userWidget?: StatusWidget | null;
};

export type LoadPreviousStatusWidgetResult = {
  values: ParsedStatusWidgetTurnValues | null;
  /** Single finalized message id used as the canonical anchor row. */
  anchorMessageId: number | null;
  skippedTemporalKeys: string[];
  diagCodes: string[];
};

/**
 * Latest eligible finalized assistant row as a single canonical temporal anchor.
 *
 * - Picks the nearest finalized row with usable widget values (excluding regenerate id).
 * - Strips unknown-like temporal fields from that row only.
 * - Does NOT synthesize date/clock/season/weather from older rows.
 * Missing temporal fields are left for initialValue / V3 first-fill invent.
 */
export function loadPreviousStatusWidgetValuesDetailed(
  chatId: number,
  opts: LoadPreviousStatusWidgetOptions = {}
): LoadPreviousStatusWidgetResult {
  const excludeMessageId = opts.excludeMessageId;
  const widgets = {
    characterWidget: opts.characterWidget,
    userWidget: opts.userWidget,
  };
  const placeholders = CANONICAL_STATUS_WIDGET_GENERATION_STATUSES.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT id, status_widget_values_json, generation_status FROM messages
       WHERE chat_id=? AND role='assistant'
         AND generation_status IN (${placeholders})
         AND status_widget_values_json IS NOT NULL AND status_widget_values_json != ''
       ORDER BY id DESC LIMIT 8`
    )
    .all(chatId, ...CANONICAL_STATUS_WIDGET_GENERATION_STATUSES) as {
    id: number;
    status_widget_values_json: string;
    generation_status: string;
  }[];

  for (const row of rows) {
    if (excludeMessageId != null && row.id === excludeMessageId) continue;
    const parsed = parseStoredStatusWidgetValuesJson(row.status_widget_values_json);
    if (!statusWidgetValuesHasContent(parsed)) continue;

    const stripped = stripUnknownLikeTemporalFromParsed(parsed, widgets);
    if (!statusWidgetValuesHasContent(stripped.values)) {
      // Entire row was only unknown temporal / empty after strip — try next eligible row
      // as a whole (never field-mix with this row).
      continue;
    }

    return {
      values: stripped.values,
      anchorMessageId: row.id,
      skippedTemporalKeys: stripped.skippedKeys,
      diagCodes: stripped.codes,
    };
  }

  return {
    values: null,
    anchorMessageId: null,
    skippedTemporalKeys: [],
    diagCodes: [],
  };
}

/**
 * Latest approved canonical widget values for V3 extract clock/state anchor.
 * Compatible wrapper — single-row anchor, no cross-row temporal synthesis.
 */
export function loadPreviousStatusWidgetValues(
  chatId: number,
  excludeMessageId?: number,
  widgets?: { characterWidget?: StatusWidget | null; userWidget?: StatusWidget | null }
): ParsedStatusWidgetTurnValues | null {
  return loadPreviousStatusWidgetValuesDetailed(chatId, {
    excludeMessageId,
    characterWidget: widgets?.characterWidget,
    userWidget: widgets?.userWidget,
  }).values;
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
