import { getDb } from "@/lib/db";
import { parseStatusWidgetJson, serializeStatusWidget, characterStatusWidgetOrDefault } from "@/lib/statusWidget";
import {
  estimateStatusWidgetContextCharsFromJson,
  validateStatusWidgetContextBudget,
} from "@/lib/statusWidget/contextBudget";
import {
  sanitizeStatusWidgetPresetTitle,
  STATUS_WIDGET_PRESET_TITLE_MAX,
  type StatusWidgetPresetItem,
} from "@/lib/statusWidgetPresetTypes";

export {
  STATUS_WIDGET_PRESET_TITLE_MAX,
  sanitizeStatusWidgetPresetTitle,
  type StatusWidgetPresetItem,
} from "@/lib/statusWidgetPresetTypes";

export function listStatusWidgetPresets(userId: number): StatusWidgetPresetItem[] {
  return getDb()
    .prepare(
      "SELECT id, user_id, title, widget_json, created_at FROM user_status_widget_presets WHERE user_id=? ORDER BY created_at ASC"
    )
    .all(userId) as StatusWidgetPresetItem[];
}

export function getStatusWidgetPresetById(
  userId: number,
  presetId: number
): StatusWidgetPresetItem | null {
  const row = getDb()
    .prepare(
      "SELECT id, user_id, title, widget_json, created_at FROM user_status_widget_presets WHERE id=? AND user_id=?"
    )
    .get(presetId, userId) as StatusWidgetPresetItem | undefined;
  return row ?? null;
}

export function validateStatusWidgetPresetInput(
  title: string,
  widgetJson: string
): { ok: true } | { ok: false; error: string } {
  const trimmedTitle = sanitizeStatusWidgetPresetTitle(title);
  if (!trimmedTitle) {
    return { ok: false, error: "상태창 제목을 입력하세요." };
  }
  const parsed = parseStatusWidgetJson(widgetJson);
  if (!parsed?.htmlTemplate?.trim() || parsed.fields.length === 0) {
    return { ok: false, error: "상태창 HTML과 필드가 필요합니다." };
  }
  const reserved = estimateStatusWidgetContextCharsFromJson(widgetJson);
  return validateStatusWidgetContextBudget(reserved);
}

function normalizeWidgetJson(widgetJson: string): string {
  const parsed =
    parseStatusWidgetJson(widgetJson) ?? characterStatusWidgetOrDefault(null);
  return serializeStatusWidget(parsed);
}

export function createStatusWidgetPreset(
  userId: number,
  title: string,
  widgetJson: string
): StatusWidgetPresetItem | null {
  const check = validateStatusWidgetPresetInput(title, widgetJson);
  if (!check.ok) return null;
  const db = getDb();
  const info = db
    .prepare("INSERT INTO user_status_widget_presets (user_id, title, widget_json) VALUES (?,?,?)")
    .run(userId, sanitizeStatusWidgetPresetTitle(title), normalizeWidgetJson(widgetJson));
  return getStatusWidgetPresetById(userId, Number(info.lastInsertRowid));
}

export function updateStatusWidgetPreset(
  userId: number,
  presetId: number,
  patch: { title?: string; widget_json?: string }
): StatusWidgetPresetItem | null {
  const prev = getStatusWidgetPresetById(userId, presetId);
  if (!prev) return null;
  const nextTitle = patch.title != null ? sanitizeStatusWidgetPresetTitle(patch.title) : prev.title;
  const nextJson = patch.widget_json != null ? normalizeWidgetJson(patch.widget_json) : prev.widget_json;
  const check = validateStatusWidgetPresetInput(nextTitle, nextJson);
  if (!check.ok) return null;
  getDb()
    .prepare("UPDATE user_status_widget_presets SET title=?, widget_json=? WHERE id=? AND user_id=?")
    .run(nextTitle, nextJson, presetId, userId);
  return getStatusWidgetPresetById(userId, presetId);
}

export function deleteStatusWidgetPreset(userId: number, presetId: number): boolean {
  const info = getDb()
    .prepare("DELETE FROM user_status_widget_presets WHERE id=? AND user_id=?")
    .run(presetId, userId);
  return info.changes > 0;
}
