import type {
  CandidateDecisionCode,
  CandidateLifecycleState,
  ResearchCandidate,
  ResearchObservation,
} from "@/lib/memoryResearch/types";

export const WATCH_COOLDOWN_DAYS = 90;

const ALLOWED_TRANSITIONS: Readonly<Record<CandidateLifecycleState, readonly CandidateLifecycleState[]>> = {
  RESEARCHED: ["SCREENED"],
  SCREENED: ["EXPERIMENT_ELIGIBLE", "WATCH", "REJECTED"],
  EXPERIMENT_ELIGIBLE: ["BENCHMARKED", "WATCH"],
  BENCHMARKED: ["ACCEPTED", "REJECTED", "WATCH"],
  ACCEPTED: [],
  REJECTED: [],
  WATCH: [],
};

export function canTransition(from: CandidateLifecycleState, to: CandidateLifecycleState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Validates a full per-cycle trail: starts at RESEARCHED, ends terminal, every hop allowed. */
export function assertValidTrail(trail: readonly CandidateLifecycleState[]): void {
  if (trail[0] !== "RESEARCHED") throw new Error(`trail must start at RESEARCHED: ${trail.join(">")}`);
  for (let i = 1; i < trail.length; i++) {
    if (!canTransition(trail[i - 1]!, trail[i]!)) {
      throw new Error(`illegal lifecycle transition ${trail[i - 1]} -> ${trail[i]}`);
    }
  }
  const last = trail[trail.length - 1]!;
  if (!isTerminalState(last)) throw new Error(`trail must end terminal: ${trail.join(">")}`);
}

export function isTerminalState(state: CandidateLifecycleState): boolean {
  return state === "ACCEPTED" || state === "REJECTED" || state === "WATCH";
}

export function decisionState(code: CandidateDecisionCode): "ACCEPTED" | "REJECTED" | "WATCH" {
  switch (code) {
    case "ACCEPTED_QUALITY_GAIN":
      return "ACCEPTED";
    case "REJECTED_NO_QUALITY_GAIN":
    case "REJECTED_PRECISION_REGRESSION":
    case "REJECTED_FALSE_MEMORY_REGRESSION":
    case "REJECTED_STALE_STATE_REGRESSION":
    case "REJECTED_QUALITY_REGRESSION":
    case "REJECTED_COST_REGRESSION":
    case "REJECTED_LATENCY_REGRESSION":
    case "REJECTED_OWNER_CONFLICT":
    case "REJECTED_INFRA_COMPLEXITY":
    case "REJECTED_DESTRUCTIVE_MIGRATION":
    case "REJECTED_PRIVACY_EXPOSURE":
    case "REJECTED_BOUNDARY_CHANGE":
    case "REJECTED_BILLING_CHANGE":
    case "REJECTED_UNMAINTAINED":
      return "REJECTED";
    case "WATCH_INSUFFICIENT_EVIDENCE":
    case "WATCH_NO_EXPERIMENT_ADAPTER":
    case "WATCH_NO_BENCHMARK_HOOK":
    case "WATCH_BENCHMARK_FAILED":
    case "WATCH_LIVE_EXPERIMENT_PENDING":
    case "WATCH_IMPLEMENTATION_PR_PENDING":
      return "WATCH";
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}

/** What unlocks the next evaluation of a candidate after `code`. */
export function reevaluationConditionFor(code: CandidateDecisionCode): string {
  const state = decisionState(code);
  switch (state) {
    case "ACCEPTED":
      return "Draft PR review outcome; a new release re-runs the benchmark";
    case "REJECTED":
      return code === "REJECTED_INFRA_COMPLEXITY"
        ? "new release, or a TypeScript-native experiment adapter that removes the infra requirement"
        : "new release/version, new experiment adapter evidence, or a change to the benchmarked memory owners";
    case "WATCH":
      if (code === "WATCH_LIVE_EXPERIMENT_PENDING") {
        return "monthly live experiment, manual live experiment, new release/version, or live recipe change";
      }
      if (code === "WATCH_IMPLEMENTATION_PR_PENDING") {
        return "implementation Draft PR generation/review, new release/version, or live recipe change";
      }
      return `new release/version, new experiment adapter, or ${WATCH_COOLDOWN_DAYS}-day cooldown`;
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

export type ReevaluationTrigger =
  | "new_candidate"
  | "new_version"
  | "new_evidence"
  | "architecture_changed"
  | "cooldown_elapsed"
  | "deep_review"
  | "draft_pr_retry";

export type SkipReason =
  | "duplicate_same_version"
  | "rejected_same_version"
  | "watch_cooldown"
  | "accepted_pending_review"
  | "implementation_pending";

export type ReevaluationDecision =
  | { evaluate: true; trigger: ReevaluationTrigger }
  | { evaluate: false; skip: SkipReason };

export type ReevaluationContext = {
  now: Date;
  adapterFingerprint: string | null;
  architectureFingerprint: string;
  deepReview: boolean;
};

/**
 * Dedupe + rejection memory. Same candidate + same version is never
 * re-evaluated unless new evidence (adapter), an architecture change of the
 * benchmarked owners (only for benchmark-decided candidates), an elapsed WATCH
 * cooldown, a deep review of a WATCH benchmarked candidate, or an ACCEPTED
 * candidate whose Draft PR was never created applies.
 */
export function decideReevaluation(
  existing: ResearchCandidate | undefined,
  observation: ResearchObservation,
  ctx: ReevaluationContext
): ReevaluationDecision {
  if (!existing) return { evaluate: true, trigger: "new_candidate" };
  if (observation.version !== null && observation.version !== existing.version) {
    return { evaluate: true, trigger: "new_version" };
  }
  const last = existing.evaluations[existing.evaluations.length - 1];
  if ((last?.adapterFingerprint ?? null) !== ctx.adapterFingerprint) {
    return { evaluate: true, trigger: "new_evidence" };
  }
  const benchmarkDecided = last?.stateTrail.includes("BENCHMARKED") ?? false;
  if (benchmarkDecided && last!.architectureFingerprint !== ctx.architectureFingerprint) {
    return { evaluate: true, trigger: "architecture_changed" };
  }
  if (existing.state === "WATCH") {
    if (existing.lastDecision === "WATCH_IMPLEMENTATION_PR_PENDING") {
      return { evaluate: false, skip: "implementation_pending" };
    }
    if (benchmarkDecided && ctx.deepReview) return { evaluate: true, trigger: "deep_review" };
    if (existing.cooldownUntil && Date.parse(existing.cooldownUntil) <= ctx.now.getTime()) {
      return { evaluate: true, trigger: "cooldown_elapsed" };
    }
    return { evaluate: false, skip: "watch_cooldown" };
  }
  if (existing.state === "REJECTED") return { evaluate: false, skip: "rejected_same_version" };
  if (existing.state === "ACCEPTED") {
    return existing.draftPrUrl === null
      ? { evaluate: true, trigger: "draft_pr_retry" }
      : { evaluate: false, skip: "accepted_pending_review" };
  }
  return { evaluate: false, skip: "duplicate_same_version" };
}

export function cooldownUntilFor(code: CandidateDecisionCode, now: Date): string | null {
  if (decisionState(code) !== "WATCH") return null;
  if (code === "WATCH_LIVE_EXPERIMENT_PENDING" || code === "WATCH_IMPLEMENTATION_PR_PENDING") return null;
  return new Date(now.getTime() + WATCH_COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();
}
