/**
 * Scene Momentum Activation Predicate (P2) — COMMON, model-agnostic ON/OFF gate.
 *
 * P2: momentumEligible = isThinSceneHistory(history)
 *                       AND NOT structurallyMatureByAlternatingExchange(history)
 *     where altExchanges(history) > MOMENTUM_BOOTSTRAP_MAX_EXCHANGES
 *     -> structurally mature -> Momentum OFF.
 *
 * This patch changes ONLY the activation predicate. Candidate A momentum
 * content/extractor (header / 5 fields / source extraction / wording / budget /
 * insertion) is FROZEN. `isThinSceneHistory` (in ./extractor) is reused
 * BYTE-IDENTICAL — its internals/threshold/serialization are NOT modified. The
 * structural maturity guard is combined ONLY at this Momentum activation layer;
 * LENGTH / SHORT HISTORY semantics are NOT globally changed.
 *
 * Model policy (DeepSeek D2 canary / kill switch) is applied at the CALL SITE
 * (contextBuilder), not here — this module is provider-agnostic and has no
 * DeepSeek-specific schema.
 */
import { isThinSceneHistory } from "./extractor";

/**
 * Momentum bootstrap structural boundary — the maximum number of genuine
 * user<->assistant alternating exchanges below which a scene is still
 * bootstrapping (cold / thin) and Momentum MAY fire. Above this, the scene is
 * structurally mature and Momentum turns OFF regardless of per-turn length.
 *
 * This is a MOMENTUM-BOOTSTRAP-ONLY constant. It MUST NOT be reused as a generic
 * production turn-count rule elsewhere (LENGTH / SHORT HISTORY / canon / archive).
 */
export const MOMENTUM_BOOTSTRAP_MAX_EXCHANGES = 3;

/** Roles that count as real RP turns (excludes system / tool / meta / synthetic helper). */
const RP_ROLES = new Set(["user", "assistant"]);

/**
 * Count VALID user<->assistant alternating exchanges in a non-empty RP conversation.
 *
 * Contract:
 *  - Only `user` / `assistant` roles count. system / tool / meta / synthetic
 *    helper metadata are excluded entirely (dropped before counting).
 *  - Empty (whitespace-only) messages are excluded entirely.
 *  - An exchange = one adjacent (user -> assistant) pair in the NORMALIZED
 *    sequence (after dropping excluded roles/empties). Consecutive same-role
 *    messages are NOT forced as an exchange; only genuine user->assistant
 *    transitions count.
 *  - assistant -> user transitions do not count (an exchange completes on the
 *    assistant reply).
 *  - Pure cold-start (no assistant turn) -> 0 exchanges.
 */
export function countAlternatingExchanges(
  history: { role: string; content: string }[]
): number {
  const norm: { role: string; content: string }[] = [];
  for (const m of history) {
    if (!m || !RP_ROLES.has(m.role)) continue;
    if (!m.content || !m.content.trim()) continue;
    norm.push(m);
  }
  let count = 0;
  for (let i = 1; i < norm.length; i++) {
    if (norm[i - 1]!.role === "user" && norm[i]!.role === "assistant") count++;
  }
  return count;
}

/** Structural maturity guard: more bootstrap-max exchanges -> structurally mature. */
export function structurallyMatureByAlternatingExchange(
  history: { role: string; content: string }[]
): boolean {
  return countAlternatingExchanges(history) > MOMENTUM_BOOTSTRAP_MAX_EXCHANGES;
}

/**
 * P2 activation predicate (model-agnostic). Momentum is eligible iff the scene
 * is thin/cold (existing length predicate) AND NOT structurally mature by
 * alternating-exchange count.
 */
export function momentumEligible(
  history: { role: string; content: string }[]
): boolean {
  return (
    isThinSceneHistory(history) &&
    !structurallyMatureByAlternatingExchange(history)
  );
}

/** Predicate-level activation reason (model policy is layered at the call site). */
export type MomentumActivationReason =
  | "THIN_LENGTH_AND_LOW_EXCHANGES"
  | "MATURE_EXCHANGE_GUARD"
  | "NOT_THIN"
  | "MODEL_POLICY_OFF";

/** Predicate-level activation observability (no model policy, no raw text). */
export type MomentumActivation = {
  /** P0: existing thin/cold length predicate (isThinSceneHistory), unchanged. */
  existingThinHistory: boolean;
  /** Count of genuine user<->assistant alternating exchanges. */
  alternatingExchanges: number;
  /** altExchanges > MOMENTUM_BOOTSTRAP_MAX_EXCHANGES. */
  structuralMature: boolean;
  /** P2 predicate: existingThinHistory AND NOT structuralMature. */
  momentumEligible: boolean;
  /** Why the predicate resolved the way it did (predicate-level, before model policy). */
  activationReason: Exclude<MomentumActivationReason, "MODEL_POLICY_OFF">;
};

/**
 * Final Momentum activation observability surfaced on the built context
 * (predicate + model policy). `momentumActive` is the actual ON/OFF after the
 * DeepSeek D2 canary / kill switch / opt-in model policy is applied. NO raw
 * conversation text is logged.
 */
export type MomentumActivationObservability = {
  existingThinHistory: boolean;
  alternatingExchanges: number;
  structuralMature: boolean;
  /** Actual Momentum ON/OFF for this turn (predicate AND model policy). */
  momentumActive: boolean;
  activationReason: MomentumActivationReason;
};

/**
 * Resolve the Momentum activation predicate + observability (model-agnostic).
 * The CALL SITE combines this with model policy (DeepSeek D2 canary / kill
 * switch) to produce the final `momentumActive` (MODEL_POLICY_OFF when the
 * model policy blocks injection).
 */
export function resolveMomentumActivation(
  history: { role: string; content: string }[]
): MomentumActivation {
  const existingThinHistory = isThinSceneHistory(history);
  const alternatingExchanges = countAlternatingExchanges(history);
  const structuralMature =
    alternatingExchanges > MOMENTUM_BOOTSTRAP_MAX_EXCHANGES;
  const eligible = existingThinHistory && !structuralMature;
  let activationReason: MomentumActivationReason;
  if (!existingThinHistory) activationReason = "NOT_THIN";
  else if (structuralMature) activationReason = "MATURE_EXCHANGE_GUARD";
  else activationReason = "THIN_LENGTH_AND_LOW_EXCHANGES";
  return {
    existingThinHistory,
    alternatingExchanges,
    structuralMature,
    momentumEligible: eligible,
    activationReason,
  };
}
