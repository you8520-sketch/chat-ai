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

export function normalizeStatusWidgetLookupKey(value: string): string {
  return statusValueKeyFromLabel(value).replace(/_/g, "").toLowerCase();
}

function semanticMachineAliases(field: StatusWidgetField): string[] {
  const norm = normalizeStatusWidgetLookupKey(`${field.id} ${field.label}`);
  const aliases: string[] = [];
  if (/시간|time/.test(norm)) aliases.push("time", "scene_time");
  if (/장소|위치|place|location/.test(norm)) aliases.push("place", "location", "scene_place");
  if (/속마음|내면|inner|thought/.test(norm)) {
    aliases.push("inner_thought", "thought", "mood", "emotion");
  }
  if (/현재상황|상황|current|situation/.test(norm)) {
    aliases.push("current_situation", "situation", "status");
  }
  if (/몸상태|신체|body|physical/.test(norm)) {
    aliases.push("body_state", "physical_state", "body_status");
  }
  return aliases;
}

export function statusWidgetFieldLookupKeys(
  field: StatusWidgetField,
  htmlTemplate?: string
): string[] {
  const keys = new Set<string>();
  const add = (value: string | null | undefined) => {
    const trimmed = value?.trim();
    if (!trimmed) return;
    keys.add(trimmed);
    const labelKey = statusValueKeyFromLabel(trimmed);
    if (labelKey) keys.add(labelKey);
    const compact = labelKey.replace(/_/g, "");
    if (compact) keys.add(compact);
  };

  add(field.id);
  add(field.label);
  add(fieldPlaceholderKey(field));
  for (const alias of semanticMachineAliases(field)) add(alias);

  if (htmlTemplate) {
    for (const match of htmlTemplate.matchAll(/\{\{([^}]+)\}\}/g)) {
      const raw = match[1]?.trim();
      if (!raw) continue;
      const normRaw = normalizeStatusWidgetLookupKey(raw);
      const fieldKeys = [field.id, field.label, fieldPlaceholderKey(field)].map(
        normalizeStatusWidgetLookupKey
      );
      if (fieldKeys.includes(normRaw)) add(raw);
    }
  }

  return [...keys];
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
