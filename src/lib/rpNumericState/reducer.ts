/**
 * Phase B1-A — pure numeric state reducer + strict proposal parser.
 *
 * Deterministic: no DB, env, Date.now, or random.
 */
import type { ServerMeterNumericStateDefinitionV1 } from "@/lib/statusWidget/types";
import { normalizeNumericStateDefinition } from "@/lib/statusWidget/numericStateDefinition";
import {
  NumericStateInvalidCurrentError,
  NumericStateValidationError,
  type NumericReducerAdjustment,
  type NumericReducerInput,
  type NumericReducerResult,
} from "./types";

const PLAIN_NUMBER_RE = /^-?\d+(\.\d+)?$/;
const GROUPED_NUMBER_RE = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/;
const PERCENT_RE = /^(\d+(\.\d+)?)%$/;
const FRACTION_RE = /^(\d+(\.\d+)?)\/(\d+(\.\d+)?)$/;

/**
 * Strict proposal parser for server SoT.
 * Does NOT extract the first number from free text.
 */
export function parseStrictNumericProposal(
  proposal: string | number | null | undefined,
  definition: ServerMeterNumericStateDefinitionV1
): number | null {
  if (proposal == null) return null;
  if (typeof proposal === "number") {
    return Number.isFinite(proposal) ? proposal : null;
  }
  if (typeof proposal !== "string") return null;

  const raw = proposal.trim();
  if (!raw) return null;

  if (PLAIN_NUMBER_RE.test(raw) || GROUPED_NUMBER_RE.test(raw)) {
    const n = Number(raw.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  const percent = raw.match(PERCENT_RE);
  if (percent) {
    // Ambiguous unless the meter is exactly 0..100.
    if (definition.min !== 0 || definition.max !== 100) return null;
    const n = Number(percent[1]);
    return Number.isFinite(n) ? n : null;
  }

  const fraction = raw.match(FRACTION_RE);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[3]);
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
    if (definition.min !== 0) return null;
    if (denominator !== definition.max) return null;
    return numerator;
  }

  return null;
}

function assertValidDefinition(
  definition: ServerMeterNumericStateDefinitionV1
): ServerMeterNumericStateDefinitionV1 {
  const normalized = normalizeNumericStateDefinition(definition);
  if (!normalized) {
    throw new NumericStateValidationError("invalid numeric state definition");
  }
  return normalized;
}

function assertValidCurrentValue(
  beforeValue: number,
  definition: ServerMeterNumericStateDefinitionV1
): void {
  if (!Number.isFinite(beforeValue)) {
    throw new NumericStateInvalidCurrentError(
      "current numeric value is not finite"
    );
  }
  if (beforeValue < definition.min || beforeValue > definition.max) {
    throw new NumericStateInvalidCurrentError(
      "current numeric value is outside definition range"
    );
  }
  if (definition.integer && !Number.isSafeInteger(beforeValue)) {
    throw new NumericStateInvalidCurrentError(
      "current numeric value is not an integer for integer definition"
    );
  }
}

/**
 * Pure reducer. Policy order (extractor):
 * 1 validate definition
 * 2 validate beforeValue
 * 3 parse proposal
 * 4 integer coercion (Math.round)
 * 5 clamp min/max
 * 6 maxIncrease/maxDecrease per turn (extractor only)
 * 7 final bounds
 * 8 outcome/adjustments
 *
 * manual_override: still clamps + integer-coerces; bypasses per-turn delta limits.
 */
export function reduceNumericStateProposal(
  input: NumericReducerInput
): NumericReducerResult {
  const definition = assertValidDefinition(input.definition);
  assertValidCurrentValue(input.beforeValue, definition);

  const beforeValue = input.beforeValue;
  const parsed = parseStrictNumericProposal(input.proposal, definition);
  if (parsed == null) {
    return {
      beforeValue,
      proposedValue: null,
      proposedDelta: null,
      appliedDelta: 0,
      afterValue: beforeValue,
      outcome: "INVALID_HOLD",
      adjustments: [],
    };
  }

  const adjustments: NumericReducerAdjustment[] = [];
  let working = parsed;
  const proposedValue = parsed;
  const proposedDelta = proposedValue - beforeValue;

  if (definition.integer) {
    const rounded = Math.round(working);
    if (rounded !== working) {
      adjustments.push("INTEGER_COERCED");
    }
    working = rounded;
  }

  if (working > definition.max) {
    working = definition.max;
    adjustments.push("CLAMPED_MAX");
  } else if (working < definition.min) {
    working = definition.min;
    adjustments.push("CLAMPED_MIN");
  }

  if (input.sourceKind === "extractor") {
    const maxUp = definition.maxIncreasePerTurn;
    const maxDown = definition.maxDecreasePerTurn;
    const delta = working - beforeValue;
    if (maxUp != null && delta > maxUp) {
      working = beforeValue + maxUp;
      adjustments.push("DELTA_LIMITED_UP");
    } else if (maxDown != null && delta < -maxDown) {
      working = beforeValue - maxDown;
      adjustments.push("DELTA_LIMITED_DOWN");
    }
  }

  // Final bounds verification (should already hold).
  if (working > definition.max) working = definition.max;
  if (working < definition.min) working = definition.min;

  const afterValue = working;
  const appliedDelta = afterValue - beforeValue;
  const outcome =
    afterValue === beforeValue ? ("NO_CHANGE" as const) : ("APPLIED" as const);

  return {
    beforeValue,
    proposedValue,
    proposedDelta,
    appliedDelta,
    afterValue,
    outcome,
    adjustments,
  };
}
