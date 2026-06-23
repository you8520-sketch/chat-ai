import type { ParsedStatusWidgetTurnValues, StatusWidgetValues } from "./types";
import { statusWidgetValuesAreCorrupt } from "./parseValues";

function isWidgetPlaceholderValue(value: string): boolean {
  const t = value.trim();
  return (
    !t ||
    t === "—" ||
    t === "…" ||
    t === "..." ||
    t === "<scene value>" ||
    /^[.·…\s-]+$/.test(t)
  );
}

export function statusWidgetValuesHasContent(
  values: ParsedStatusWidgetTurnValues | null | undefined
): boolean {
  if (statusWidgetValuesAreCorrupt(values)) return false;
  const check = (v?: StatusWidgetValues | null) =>
    Boolean(v && Object.values(v).some((x) => x?.trim() && !isWidgetPlaceholderValue(x)));
  return check(values?.character) || check(values?.user);
}

/** Per-message widget card — not global chat widget toggle */
export function shouldShowStatusWidgetOnMessage(opts: {
  model?: string;
  /** Saved at generation time (messages.status_widget_turn_active) */
  statusWidgetTurnActive?: boolean;
  statusWidgetValues?: ParsedStatusWidgetTurnValues | null;
  isStreaming?: boolean;
}): boolean {
  if (opts.model === "greeting" || opts.isStreaming) return false;
  if (opts.statusWidgetTurnActive === true) {
    return statusWidgetValuesHasContent(opts.statusWidgetValues);
  }
  // Legacy rows before per-turn flag: only show when values were persisted
  return statusWidgetValuesHasContent(opts.statusWidgetValues);
}
