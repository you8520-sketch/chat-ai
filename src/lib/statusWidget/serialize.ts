import { statusValueKeyFromLabel } from "./fieldKeys";
import { DEFAULT_STATUS_WIDGET } from "./defaultTemplate";
import { normalizeNumericStateDefinition } from "./numericStateDefinition";
import type {
  StatusWidget,
  StatusWidgetDisplayMode,
  StatusWidgetField,
  StatusWidgetSourceMode,
  StatusWidgetStackOrder,
} from "./types";

export function parseStatusWidgetJson(raw: string | null | undefined): StatusWidget | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as StatusWidget;
    if (parsed?.version !== 1 || !parsed.htmlTemplate?.trim() || !Array.isArray(parsed.fields)) {
      return null;
    }
    if (parsed.fields.length === 0) return null;
    return {
      version: 1,
      name: String(parsed.name || "상태창").slice(0, 80),
      htmlTemplate: parsed.htmlTemplate,
      fields: parsed.fields
        .map((f) => {
          const label = String(f.label || "").trim().slice(0, 40);
          const instruction = String(f.instruction || "").trim().slice(0, 500);
          const storedId = String(f.id || "").trim().slice(0, 64);
          const id = storedId || statusValueKeyFromLabel(label);
          const initialValue = String(
            (f as { initialValue?: unknown }).initialValue || ""
          )
            .trim()
            .slice(0, 80);
          // Explicit opt-in only — invalid numericState is stripped (null).
          // Do NOT blindly pass through unknown field properties.
          const numericState = normalizeNumericStateDefinition(
            (f as { numericState?: unknown }).numericState
          );
          const field: StatusWidgetField = {
            id,
            label,
            instruction,
            ...(initialValue ? { initialValue } : {}),
            ...(numericState ? { numericState } : {}),
          };
          return field;
        })
        .filter((f) => f.id && f.label),
      placement: parsed.placement === "top" ? "top" : "bottom",
    };
  } catch {
    return null;
  }
}

export function serializeStatusWidget(widget: StatusWidget): string {
  return JSON.stringify({
    ...widget,
    fields: widget.fields.map(({ id, label, instruction, initialValue, numericState }) => {
      const normalized = numericState
        ? normalizeNumericStateDefinition(numericState)
        : null;
      return {
        id,
        label,
        instruction,
        ...(initialValue?.trim() ? { initialValue: initialValue.trim().slice(0, 80) } : {}),
        ...(normalized ? { numericState: normalized } : {}),
      };
    }),
  });
}

const STATUS_WIDGET_SOURCE_MODES = new Set<StatusWidgetSourceMode>([
  "off",
  "character_only",
  "user_only",
  "both",
]);

const STATUS_WIDGET_DISPLAY_MODES = new Set<StatusWidgetDisplayMode>([
  "creator",
  "user",
  "both",
  "hidden",
]);

/** Forgiving parser for stored DB / legacy rows only. */
export function parseStatusWidgetMode(raw: string | null | undefined): StatusWidgetSourceMode {
  if (raw && STATUS_WIDGET_SOURCE_MODES.has(raw as StatusWidgetSourceMode)) {
    return raw as StatusWidgetSourceMode;
  }
  return "character_only";
}

/** Strict parser for incoming PATCH/API writes. Invalid → null (HTTP 400). */
export function parseIncomingStatusWidgetMode(raw: unknown): StatusWidgetSourceMode | null {
  if (typeof raw !== "string") return null;
  return STATUS_WIDGET_SOURCE_MODES.has(raw as StatusWidgetSourceMode)
    ? (raw as StatusWidgetSourceMode)
    : null;
}

export function parseStatusWidgetDisplayMode(
  raw: string | null | undefined
): StatusWidgetDisplayMode | null {
  if (raw && STATUS_WIDGET_DISPLAY_MODES.has(raw as StatusWidgetDisplayMode)) {
    return raw as StatusWidgetDisplayMode;
  }
  return null;
}

/** Strict parser for incoming PATCH/API writes. Invalid → null (HTTP 400). */
export function parseIncomingStatusWidgetDisplayMode(
  raw: unknown
): StatusWidgetDisplayMode | null {
  if (typeof raw !== "string") return null;
  return STATUS_WIDGET_DISPLAY_MODES.has(raw as StatusWidgetDisplayMode)
    ? (raw as StatusWidgetDisplayMode)
    : null;
}

/**
 * COMPATIBILITY_ONLY_OWNER — one-way legacy display init when
 * status_widget_display_mode is null/empty. Must not write engine mode.
 */
export function displayModeFromEngineMode(mode: StatusWidgetSourceMode): StatusWidgetDisplayMode {
  switch (mode) {
    case "both":
      return "both";
    case "user_only":
      return "user";
    case "off":
      return "hidden";
    case "character_only":
    default:
      return "creator";
  }
}

/**
 * @deprecated COMPATIBILITY_ONLY_OWNER — do not call from runtime engine or
 * settings writes. Display must never determine engine mode.
 */
export function engineModeForDisplay(
  display: StatusWidgetDisplayMode,
  hasCharacterWidget: boolean,
  hasUserWidget: boolean
): StatusWidgetSourceMode {
  if (!hasCharacterWidget) {
    if (!hasUserWidget) return "off";
    return display === "hidden" ? "off" : "user_only";
  }
  if (hasUserWidget && (display === "user" || display === "both")) return "both";
  return "character_only";
}

export function parseStatusWidgetStackOrder(raw: string | null | undefined): StatusWidgetStackOrder {
  return raw === "user_first" ? "user_first" : "character_first";
}

export function hasCharacterStatusWidget(raw: string | null | undefined): boolean {
  return parseStatusWidgetJson(raw) !== null;
}

export function characterStatusWidgetOrDefault(raw: string | null | undefined): StatusWidget {
  return parseStatusWidgetJson(raw) ?? DEFAULT_STATUS_WIDGET;
}
