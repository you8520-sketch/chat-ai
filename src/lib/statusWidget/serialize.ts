import { statusValueKeyFromLabel } from "./fieldKeys";
import { DEFAULT_STATUS_WIDGET } from "./defaultTemplate";
import type {
  StatusWidget,
  StatusWidgetDisplayMode,
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
          return {
            id,
            label,
            instruction,
            ...(initialValue ? { initialValue } : {}),
          };
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
    fields: widget.fields.map(({ id, label, instruction, initialValue }) => ({
      id,
      label,
      instruction,
      ...(initialValue?.trim() ? { initialValue: initialValue.trim().slice(0, 80) } : {}),
    })),
  });
}

export function parseStatusWidgetMode(raw: string | null | undefined): StatusWidgetSourceMode {
  switch (raw) {
    case "off":
    case "character_only":
    case "user_only":
    case "both":
      return raw;
    default:
      return "character_only";
  }
}

export function parseStatusWidgetDisplayMode(
  raw: string | null | undefined
): StatusWidgetDisplayMode | null {
  switch (raw) {
    case "creator":
    case "user":
    case "both":
    case "hidden":
      return raw;
    default:
      return null;
  }
}

/** Derive display preference from legacy engine mode when display column is unset. */
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
 * Engine mode for persistence: creator widget always stays on when present.
 * Display preference never turns creator generation off.
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
  // Creator always on for engine
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
