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

/**
 * 위젯 카드에 실제로 채워지는 값만 줄글로 옮긴다.
 * HTML 템플릿, JSX, 필드 지시문, 수치 정의, extracted_facts 는 포함하지 않는다.
 */
export function formatRenderedStatusWidgetText(
  widget: StatusWidget,
  values: StatusWidgetValues,
  names?: StatusWidgetProfileNames | null
): string {
  const lines: string[] = [];
  for (const field of widget.fields) {
    const value = expandStatusWidgetProfilePlaceholders(
      resolveWidgetFieldValue(field, values),
      names
    ).trim();
    if (!value || value === "—" || value === "-" || isWidgetPlaceholderValue(value)) continue;
    const label = expandStatusWidgetProfilePlaceholders(field.label, names).trim();
    lines.push(label ? `${label}: ${value}` : value);
  }
  if (lines.length === 0) return "";
  const title = expandStatusWidgetProfilePlaceholders(widget.name, names).trim();
  return title ? `${title}\n${lines.join("\n")}` : lines.join("\n");
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
      const html = widget.htmlTemplate.trim()
        ? renderStatusWidgetHtml(widget, values, names)
        : "";
      const jsxCompiled = widget.jsxCompiled?.trim() || undefined;
      if (!html.trim() && !jsxCompiled) return null;
      return { source, html, widget, values, ...(jsxCompiled ? { jsxCompiled } : {}) };
    })
    .filter((x): x is RenderedStatusWidget => x != null);
}
