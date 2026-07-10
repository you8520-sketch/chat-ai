import { sanitizeChatVisualCardHtml } from "@/lib/chatHtmlSanitize";
import { fieldPlaceholderKey } from "./fieldKeys";
import { sanitizeStatusWidgetFieldValue } from "./parseValues";
import type { StatusWidget, StatusWidgetField, StatusWidgetValues } from "./types";

export const STATUS_WIDGET_EDIT_VALUE_MAX = 320;

export function readEditableStatusWidgetValue(
  values: StatusWidgetValues,
  field: StatusWidgetField
): string {
  const key = fieldPlaceholderKey(field);
  for (const lookup of [field.id, key]) {
    const value = values[lookup];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

export function writeEditableStatusWidgetValue(
  values: StatusWidgetValues,
  field: StatusWidgetField,
  next: string
): StatusWidgetValues {
  const key = fieldPlaceholderKey(field) || field.id;
  const out: StatusWidgetValues = { ...values };
  if (field.id) delete out[field.id];
  if (key) delete out[key];

  const trimmed = next.slice(0, STATUS_WIDGET_EDIT_VALUE_MAX).trim();
  if (key && trimmed && trimmed !== "—") out[key] = trimmed;
  return out;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function editableValueMarker(
  source: "character" | "user",
  field: StatusWidgetField,
  value: string
): string {
  const key = fieldPlaceholderKey(field) || field.id;
  const shown = value.trim() || "—";
  return `<span contenteditable="plaintext-only" role="textbox" spellcheck="false" aria-label="${escapeHtml(field.label || key)} 값" data-status-widget-edit-source="${source}" data-status-widget-edit-key="${escapeHtml(key)}" data-status-widget-edit-empty="${value.trim() ? "false" : "true"}" style="display:inline-block;min-width:2.5em;max-width:100%;white-space:pre-wrap;overflow-wrap:anywhere;outline:none;border-bottom:1px dashed rgba(251,146,60,.6);cursor:text">${escapeHtml(shown)}</span>`;
}

/** Sanitized original card template with editable spans only at value placeholders. */
export function renderEditableStatusWidgetHtml(
  source: "character" | "user",
  widget: StatusWidget,
  values: StatusWidgetValues
): string {
  const sanitizedTemplate = sanitizeChatVisualCardHtml(widget.htmlTemplate);
  if (!sanitizedTemplate) return "";

  const markers = new Map<string, string>();
  for (const field of widget.fields) {
    const value = readEditableStatusWidgetValue(values, field);
    const marker = editableValueMarker(source, field, value);
    const key = fieldPlaceholderKey(field);
    if (key) markers.set(key, marker);
    if (field.id) markers.set(field.id, marker);
  }

  return sanitizedTemplate
    .split(/(<[^>]+>)/g)
    .map((chunk) => {
      if (chunk.startsWith("<")) return chunk;
      return chunk.replace(/\{\{([^{}]+)\}\}/g, (placeholder, key: string) => {
        return markers.get(key.trim()) ?? placeholder;
      });
    })
    .join("");
}

/** Apply only configured field values; labels, instructions, HTML, and unknown keys stay immutable. */
export function applyEditableStatusWidgetValuePatch(
  existing: StatusWidgetValues | null | undefined,
  incoming: StatusWidgetValues | null | undefined,
  widget: StatusWidget | null | undefined
): StatusWidgetValues | null {
  if (!widget) return existing && Object.keys(existing).length > 0 ? { ...existing } : null;

  const out: StatusWidgetValues = { ...(existing ?? {}) };
  const patch = incoming ?? {};
  for (const field of widget.fields) {
    const key = fieldPlaceholderKey(field) || field.id;
    const candidate = patch[key] ?? patch[field.id];
    if (field.id) delete out[field.id];
    if (key) delete out[key];
    if (typeof candidate !== "string" || !key) continue;
    const clean = sanitizeStatusWidgetFieldValue(
      candidate.slice(0, STATUS_WIDGET_EDIT_VALUE_MAX)
    );
    if (clean) out[key] = clean;
  }
  return Object.keys(out).length > 0 ? out : null;
}
