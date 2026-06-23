import type { StatusWidget, StatusWidgetField } from "./types";

/** 케이브덕식 — 상태값 이름 → HTML {{…}} 키 (공백→_, 특수문자 제거) */
export function statusValueKeyFromLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return "";
  return trimmed
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_]/gu, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64);
}

export function fieldPlaceholderKey(field: StatusWidgetField): string {
  return statusValueKeyFromLabel(field.label) || field.id.trim();
}

export function uniqueStatusValueKey(label: string, existingKeys: string[]): string {
  const base = statusValueKeyFromLabel(label) || "상태값";
  if (!existingKeys.includes(base)) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base}_${n}`.slice(0, 64);
    if (!existingKeys.includes(candidate)) return candidate;
  }
  return `${base.slice(0, 58)}_${Date.now() % 1000}`.slice(0, 64);
}

export function replacePlaceholderInHtml(html: string, oldKey: string, newKey: string): string {
  if (!oldKey || !newKey || oldKey === newKey) return html;
  return html.split(`{{${oldKey}}}`).join(`{{${newKey}}}`);
}

/** 라벨 변경 시 id·HTML placeholder 동기화 */
export function applyFieldLabelChange(
  widget: StatusWidget,
  fieldIndex: number,
  label: string
): StatusWidget {
  const fields = widget.fields.map((f) => ({ ...f }));
  const field = fields[fieldIndex];
  if (!field) return widget;

  const oldKey = fieldPlaceholderKey(field);
  field.label = label.slice(0, 40);
  const otherKeys = fields.filter((_, i) => i !== fieldIndex).map(fieldPlaceholderKey).filter(Boolean);
  field.id = uniqueStatusValueKey(field.label, otherKeys);

  const htmlTemplate = replacePlaceholderInHtml(widget.htmlTemplate, oldKey, field.id);

  return { ...widget, fields, htmlTemplate };
}

export function normalizeWidgetFieldKeys(widget: StatusWidget): StatusWidget {
  const used = new Set<string>();
  const fields = widget.fields.map((f) => {
    const label = f.label.trim();
    let id = fieldPlaceholderKey({ ...f, label: label || f.label });
    if (!id) id = f.id.trim() || "상태값";
    const stem = id;
    let n = 2;
    while (used.has(id)) {
      id = `${stem}_${n}`.slice(0, 64);
      n++;
    }
    used.add(id);
    return { ...f, label: label || f.label, id };
  });
  return { ...widget, fields };
}
