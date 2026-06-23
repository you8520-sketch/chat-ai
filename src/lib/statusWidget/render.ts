import { fieldPlaceholderKey } from "./fieldKeys";
import { sanitizeChatVisualCardHtml } from "@/lib/chatHtmlSanitize";
import type { RenderedStatusWidget, StatusWidget, StatusWidgetValues } from "./types";

function isWidgetPlaceholderValue(value: string): boolean {
  const t = value.trim();
  return (
    !t ||
    t === "…" ||
    t === "..." ||
    t === "<scene value>" ||
    /^[.·…\s]+$/.test(t)
  );
}

function resolveWidgetFieldValue(
  field: StatusWidget["fields"][number],
  values: StatusWidgetValues
): string {
  const key = fieldPlaceholderKey(field);
  for (const lookup of [field.id, key]) {
    const candidate = values[lookup]?.trim();
    if (candidate && !isWidgetPlaceholderValue(candidate)) return candidate;
  }
  return "—";
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderStatusWidgetHtml(
  widget: StatusWidget,
  values: StatusWidgetValues
): string {
  let html = widget.htmlTemplate;
  for (const field of widget.fields) {
    const key = fieldPlaceholderKey(field);
    const raw = resolveWidgetFieldValue(field, values);
    const safe = escapeHtmlText(raw);
    if (key) html = html.replaceAll(`{{${key}}}`, safe);
    if (field.id && field.id !== key) html = html.replaceAll(`{{${field.id}}}`, safe);
  }
  return sanitizeChatVisualCardHtml(html);
}

export function renderStatusWidgetsForTurn(
  items: Array<{
    source: "character" | "user";
    widget: StatusWidget;
    values: StatusWidgetValues;
  }>
): RenderedStatusWidget[] {
  return items
    .map(({ source, widget, values }) => {
      const html = renderStatusWidgetHtml(widget, values);
      if (!html.trim()) return null;
      return { source, html, widget, values };
    })
    .filter((x): x is RenderedStatusWidget => x != null);
}
