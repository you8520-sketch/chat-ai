import { statusWidgetValuesHasContent } from "./displayPolicy";
import type { ParsedStatusWidgetTurnValues } from "./types";

/** Creator canonical values only — never user widget fields for machine triggers. */
export function creatorTriggerValuesFromPayload(
  payload: ParsedStatusWidgetTurnValues | null | undefined
): ParsedStatusWidgetTurnValues | null {
  if (!payload) return null;
  return {
    character: payload.character ?? null,
    user: null,
  };
}

/**
 * Single owner: creator machine-trigger evaluation eligibility for a finalized turn.
 * Used by runtime invocation and status_trigger_evaluated telemetry alike.
 */
export function shouldEvaluateCreatorStatusTriggers(opts: {
  derivedStateAllowed: boolean;
  needsCharacterValues: boolean;
  statusValues: ParsedStatusWidgetTurnValues | null | undefined;
}): boolean {
  if (!opts.derivedStateAllowed || !opts.needsCharacterValues) return false;
  return statusWidgetValuesHasContent(creatorTriggerValuesFromPayload(opts.statusValues));
}
