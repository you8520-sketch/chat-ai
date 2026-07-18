import type { ParsedStatusWidgetTurnValues, StatusWidgetValues } from "./types";
import { statusWidgetValuesAreCorrupt } from "./parseValues";

/** Placeholder / unknown status values — not real scene state for triggers or memory. */
export function isStatusWidgetPlaceholderValue(value: string): boolean {
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

function isWidgetPlaceholderValue(value: string): boolean {
  return isStatusWidgetPlaceholderValue(value);
}

export function statusWidgetSourceValuesHaveContent(
  values: StatusWidgetValues | null | undefined
): boolean {
  return Boolean(
    values && Object.values(values).some((x) => x?.trim() && !isWidgetPlaceholderValue(x))
  );
}

export function statusWidgetValuesHasContent(
  values: ParsedStatusWidgetTurnValues | null | undefined
): boolean {
  if (statusWidgetValuesAreCorrupt(values)) return false;
  return (
    statusWidgetSourceValuesHaveContent(values?.character) ||
    statusWidgetSourceValuesHaveContent(values?.user)
  );
}

/** Per-message widget card — not global chat widget toggle */
export function shouldShowStatusWidgetOnMessage(opts: {
  model?: string;
  /** Saved at generation time (messages.status_widget_turn_active) */
  statusWidgetTurnActive?: boolean;
  statusWidgetValues?: ParsedStatusWidgetTurnValues | null;
  isStreaming?: boolean;
  /** Visual-only: hide all status widget cards in the chat UI */
  displayHidden?: boolean;
}): boolean {
  if (opts.displayHidden) return false;
  if (opts.model === "greeting" || opts.isStreaming) return false;
  // Do not render a valid-looking all-placeholder card when extraction produced no usable values.
  // Legacy rows before per-turn flag follow the same rule: only show when values were persisted.
  return statusWidgetValuesHasContent(opts.statusWidgetValues);
}
