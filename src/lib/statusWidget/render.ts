import { fieldPlaceholderKey, statusWidgetFieldLookupKeys } from "./fieldKeys";
import {
  expandStatusWidgetProfilePlaceholders,
  type StatusWidgetProfileNames,
} from "./placeholders";
import { sanitizeChatVisualCardHtml } from "@/lib/chatHtmlSanitize";
import type { RenderedStatusWidget, StatusWidget, StatusWidgetValues } from "./types";

export type { StatusWidgetProfileNames };

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
  for (const lookup of statusWidgetFieldLookupKeys(field)) {
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
  values: StatusWidgetValues,
  names?: StatusWidgetProfileNames | null
): string {
  let html = widget.htmlTemplate;
  for (const field of widget.fields) {
    const key = fieldPlaceholderKey(field);
    const raw = expandStatusWidgetProfilePlaceholders(
      resolveWidgetFieldValue(field, values),
      names
    );
    const safe = escapeHtmlText(raw);
    if (key) html = html.replaceAll(`{{${key}}}`, safe);
    if (field.id && field.id !== key) html = html.replaceAll(`{{${field.id}}}`, safe);
  }
  // 필드 키 치환 후 — HTML·라벨에 남은 {{char}}/{{user}}를 실명으로
  html = expandStatusWidgetProfilePlaceholders(html, names);
  return sanitizeChatVisualCardHtml(html);
}

export function renderStatusWidgetsForTurn(
  items: Array<{
    source: "character" | "user";
    widget: StatusWidget;
    values: StatusWidgetValues;
  }>,
  names?: StatusWidgetProfileNames | null
): RenderedStatusWidget[] {
  return items
    .map(({ source, widget, values }) => {
      const html = renderStatusWidgetHtml(widget, values, names);
      if (!html.trim()) return null;
      return { source, html, widget, values };
    })
    .filter((x): x is RenderedStatusWidget => x != null);
}
