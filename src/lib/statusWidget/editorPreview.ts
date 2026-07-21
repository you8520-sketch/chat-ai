import { fieldPlaceholderKey } from "./fieldKeys";
import { expandStatusWidgetProfilePlaceholders } from "./placeholders";
import type { StatusWidget, StatusWidgetField, StatusWidgetValues } from "./types";
import type { StatusWidgetProfileNames } from "./placeholders";

/** 제작 페이지 미리보기 — 지시사항을 괄호로 감싼 레이아웃 placeholder */
export function formatStatusWidgetEditorPreviewValue(
  field: StatusWidgetField,
  names?: StatusWidgetProfileNames | null
): string {
  const instruction = expandStatusWidgetProfilePlaceholders(
    field.instruction.trim(),
    names
  );
  if (instruction) return `(${instruction})`;
  const label = expandStatusWidgetProfilePlaceholders(field.label.trim(), names);
  if (label) return `(${label} — 지시사항 없음)`;
  return "(지시사항을 입력하세요)";
}

export function buildStatusWidgetEditorPreviewValues(
  widget: StatusWidget,
  names?: StatusWidgetProfileNames | null
): StatusWidgetValues {
  const values: StatusWidgetValues = {};
  for (const field of widget.fields) {
    const preview = formatStatusWidgetEditorPreviewValue(field, names);
    const key = fieldPlaceholderKey(field);
    if (key) values[key] = preview;
    if (field.id?.trim() && field.id !== key) {
      values[field.id] = preview;
    }
  }
  return values;
}
