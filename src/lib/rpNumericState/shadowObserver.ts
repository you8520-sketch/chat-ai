/**
 * Phase B1-B — Numeric shadow observer (diagnostic only).
 *
 * - No rp_numeric_state_* reads/writes
 * - No bootstrap/commit
 * - Reuses B1-A strict parser + pure reducer
 * - Fail-open for production path (caller wraps try/catch)
 */
import {
  parseStrictNumericProposal,
  reduceNumericStateProposal,
} from "./reducer";
import type { NumericReducerAdjustment } from "./types";
import {
  listShadowEligibleNumericFields,
  resolveNumericShadowEligibility,
} from "./shadowPolicy";
import type { StatusWidget, StatusWidgetValues } from "@/lib/statusWidget/types";

export type NumericShadowBaselineSource =
  | "previous_status"
  | "definition_initial"
  | "invalid_previous";

export type NumericShadowOutcome =
  | "APPLIED"
  | "NO_CHANGE"
  | "INVALID_HOLD"
  | "BASELINE_INVALID_SKIP";

export type NumericShadowProposalFormat =
  | "number"
  | "plain_numeric"
  | "percent"
  | "fraction"
  | "invalid_text"
  | "missing";

export type NumericShadowObservation = {
  chatId: number;
  characterId: number | null;
  stateKey: string;
  baselineSource: NumericShadowBaselineSource;
  beforeValue: number | null;
  proposalFormat: NumericShadowProposalFormat;
  parsedProposal: number | null;
  proposedDelta: number | null;
  appliedDelta: number | null;
  hypotheticalAfter: number | null;
  outcome: NumericShadowOutcome;
  adjustments: NumericReducerAdjustment[];
  regeneration: boolean;
};

const PLAIN_NUMBER_RE = /^-?\d+(\.\d+)?$/;
const GROUPED_NUMBER_RE = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/;
const PERCENT_RE = /^(\d+(\.\d+)?)%$/;
const FRACTION_RE = /^(\d+(\.\d+)?)\/(\d+(\.\d+)?)$/;

export function classifyNumericProposalFormat(
  proposal: string | number | null | undefined
): NumericShadowProposalFormat {
  if (proposal == null) return "missing";
  if (typeof proposal === "number") {
    return Number.isFinite(proposal) ? "number" : "invalid_text";
  }
  if (typeof proposal !== "string") return "invalid_text";
  const raw = proposal.trim();
  if (!raw) return "missing";
  if (PLAIN_NUMBER_RE.test(raw) || GROUPED_NUMBER_RE.test(raw)) {
    return "plain_numeric";
  }
  if (PERCENT_RE.test(raw)) return "percent";
  if (FRACTION_RE.test(raw)) return "fraction";
  return "invalid_text";
}

function lookupValue(
  values: StatusWidgetValues | null | undefined,
  valueKey: string,
  stateKey: string
): string | null {
  if (!values) return null;
  const direct = values[valueKey];
  if (direct != null && String(direct).trim() !== "") return String(direct);
  const byState = values[stateKey];
  if (byState != null && String(byState).trim() !== "") return String(byState);
  return null;
}

export function observeNumericShadow(input: {
  chatId: number;
  characterId?: number | null;
  characterWidget: StatusWidget | null | undefined;
  previousCharacterValues?: StatusWidgetValues | null;
  currentCharacterValues?: StatusWidgetValues | null;
  regeneration?: boolean;
}): NumericShadowObservation[] {
  const fields = listShadowEligibleNumericFields(input.characterWidget);
  if (fields.length === 0) return [];

  const observations: NumericShadowObservation[] = [];
  const regeneration = input.regeneration === true;
  const characterId = input.characterId ?? null;

  for (const field of fields) {
    const proposalRaw = lookupValue(
      input.currentCharacterValues,
      field.valueKey,
      field.stateKey
    );
    const proposalFormat = classifyNumericProposalFormat(proposalRaw);
    const previousRaw = lookupValue(
      input.previousCharacterValues,
      field.valueKey,
      field.stateKey
    );

    let baselineSource: NumericShadowBaselineSource;
    let beforeValue: number | null;

    if (previousRaw == null) {
      beforeValue = field.definition.initial;
      baselineSource = "definition_initial";
    } else {
      const parsedPrev = parseStrictNumericProposal(
        previousRaw,
        field.definition
      );
      if (parsedPrev == null) {
        observations.push({
          chatId: input.chatId,
          characterId,
          stateKey: field.stateKey,
          baselineSource: "invalid_previous",
          beforeValue: null,
          proposalFormat,
          parsedProposal: parseStrictNumericProposal(
            proposalRaw,
            field.definition
          ),
          proposedDelta: null,
          appliedDelta: null,
          hypotheticalAfter: null,
          outcome: "BASELINE_INVALID_SKIP",
          adjustments: [],
          regeneration,
        });
        continue;
      }
      beforeValue = parsedPrev;
      baselineSource = "previous_status";
    }

    const reduced = reduceNumericStateProposal({
      definition: field.definition,
      beforeValue,
      proposal: proposalRaw,
      sourceKind: "extractor",
    });

    observations.push({
      chatId: input.chatId,
      characterId,
      stateKey: field.stateKey,
      baselineSource,
      beforeValue: reduced.beforeValue,
      proposalFormat,
      parsedProposal: reduced.proposedValue,
      proposedDelta: reduced.proposedDelta,
      appliedDelta: reduced.appliedDelta,
      hypotheticalAfter: reduced.afterValue,
      outcome: reduced.outcome,
      adjustments: reduced.adjustments,
      regeneration,
    });
  }

  return observations;
}

export function logNumericShadowObservation(
  observation: NumericShadowObservation
): void {
  console.info(
    "[RpNumericShadow]",
    JSON.stringify({
      chat_id: observation.chatId,
      character_id: observation.characterId,
      state_key: observation.stateKey,
      baseline_source: observation.baselineSource,
      before: observation.beforeValue,
      proposal_format: observation.proposalFormat,
      parsed: observation.parsedProposal,
      proposed_delta: observation.proposedDelta,
      applied_delta: observation.appliedDelta,
      hypothetical_after: observation.hypotheticalAfter,
      outcome: observation.outcome,
      adjustments: observation.adjustments,
      regeneration: observation.regeneration,
    })
  );
}

/**
 * Best-effort shadow entrypoint. Production path must ignore failures.
 * When eligibility is OFF: no field/definition work and no logs.
 */
export function tryObserveNumericShadowForTurn(input: {
  userId?: number | null;
  characterId?: number | null;
  chatId: number;
  characterWidget: StatusWidget | null | undefined;
  previousCharacterValues?: StatusWidgetValues | null;
  currentCharacterValues?: StatusWidgetValues | null;
  regeneration?: boolean;
  env?: NodeJS.ProcessEnv;
}): NumericShadowObservation[] {
  const gate = resolveNumericShadowEligibility({
    userId: input.userId,
    characterId: input.characterId,
    env: input.env,
  });
  if (!gate.eligible) return [];

  try {
    const observations = observeNumericShadow({
      chatId: input.chatId,
      characterId: input.characterId ?? null,
      characterWidget: input.characterWidget,
      previousCharacterValues: input.previousCharacterValues,
      currentCharacterValues: input.currentCharacterValues,
      regeneration: input.regeneration,
    });
    for (const observation of observations) {
      logNumericShadowObservation(observation);
    }
    return observations;
  } catch (error) {
    console.warn(
      "[RpNumericShadow] observer failed",
      error instanceof Error ? error.message : String(error)
    );
    return [];
  }
}

/** Aggregate counters for offline metrics / tests (no PII). */
export function aggregateNumericShadowObservations(
  observations: NumericShadowObservation[]
): {
  total: number;
  byOutcome: Record<string, number>;
  byBaseline: Record<string, number>;
  byFormat: Record<string, number>;
  byAdjustment: Record<string, number>;
  absProposedDeltas: number[];
} {
  const byOutcome: Record<string, number> = {};
  const byBaseline: Record<string, number> = {};
  const byFormat: Record<string, number> = {};
  const byAdjustment: Record<string, number> = {};
  const absProposedDeltas: number[] = [];
  for (const o of observations) {
    byOutcome[o.outcome] = (byOutcome[o.outcome] ?? 0) + 1;
    byBaseline[o.baselineSource] = (byBaseline[o.baselineSource] ?? 0) + 1;
    byFormat[o.proposalFormat] = (byFormat[o.proposalFormat] ?? 0) + 1;
    for (const adj of o.adjustments) {
      byAdjustment[adj] = (byAdjustment[adj] ?? 0) + 1;
    }
    if (o.proposedDelta != null) {
      absProposedDeltas.push(Math.abs(o.proposedDelta));
    }
  }
  return {
    total: observations.length,
    byOutcome,
    byBaseline,
    byFormat,
    byAdjustment,
    absProposedDeltas,
  };
}
