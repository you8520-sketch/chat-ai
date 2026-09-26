/**
 * Scene-boundary JEV read-only QA triage — default OFF.
 *
 * FEATURE / RUNTIME SHADOW FEASIBILITY hook:
 *   lexical scanner candidates + canonical BoundaryExecutionContract
 *   → one Decisions call per assistant generation
 *   → structured priority annotation only
 *
 * Never blocks, regenerates, mutates scene/reconvergence/authoring, or
 * changes user billing. Requires SceneDirective V2 compute (shadow|on) so a
 * canonical boundary contract exists — never invents a second boundary owner.
 */
import {
  callJevDecisions,
  JEV_DECISIONS_MODEL,
  type JevDecisionQuestions,
} from "@/lib/jevDecisions";
import {
  generationJobKey,
  isCurrentAssistantGeneration,
  type AssistantGenerationScope,
} from "@/lib/assistantGenerationScope";
import {
  assertNoDuplicateAuxProviderSuccess,
} from "@/lib/auxProviderProvenance";
import type { BoundaryExecutionContract } from "@/lib/sceneDirectiveV2";
import {
  getSceneDirectiveV2Mode,
  isSceneDirectiveV2ComputeEnabled,
  type SceneDirectiveV2Mode,
} from "@/lib/sceneDirectiveV2Policy";
import {
  scanR5BoundarySuspicionSignals,
  type BoundarySuspicionSignal,
} from "@/lib/scenePolicyBoundarySuspicionScan";

export const SCENE_BOUNDARY_JEV_QA_ENV = "SCENE_BOUNDARY_JEV_QA_ENABLED";
export const SCENE_BOUNDARY_JEV_QA_REQUEST_KIND = "scene-boundary-jev-qa";
export const SCENE_BOUNDARY_JEV_QA_QUESTION_ID = "boundary_verdict";

export type SceneBoundaryReviewPriority =
  | "high_priority_review"
  | "low_priority_review"
  | "needs_review";

export type SceneBoundaryJevVerdict =
  | "VIOLATION"
  | "COMPLIANT"
  | "INSUFFICIENT_CONTEXT";

const running = new Set<string>();
const completed = new Set<string>();

export function isSceneBoundaryJevQaEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env[SCENE_BOUNDARY_JEV_QA_ENV]?.trim() === "1";
}

export function resetSceneBoundaryJevQaSentinelForTests(): void {
  running.clear();
  completed.clear();
}

export function mapVerdictToReviewPriority(
  verdict: SceneBoundaryJevVerdict | null
): SceneBoundaryReviewPriority {
  if (verdict === "VIOLATION") return "high_priority_review";
  if (verdict === "COMPLIANT") return "low_priority_review";
  return "needs_review";
}

export function listActiveBlockedCategories(
  contract: BoundaryExecutionContract
): string[] {
  const out: string[] = [];
  if (contract.blocksPhysicalApproach) out.push("physical_approach");
  if (contract.blocksRemoteContact) out.push("remote_contact");
  if (contract.blocksGiftOrDropOff) out.push("gift_or_drop_off");
  if (contract.blocksBoundaryNegotiation) out.push("boundary_negotiation");
  if (contract.blocksFutureMeetingInitiative) out.push("future_meeting_initiative");
  return out;
}

export function buildSceneBoundaryJevQaQuestions(): JevDecisionQuestions {
  return {
    [SCENE_BOUNDARY_JEV_QA_QUESTION_ID]: {
      type: "choice",
      instructions:
        "Given the canonical boundary execution contract and lexical suspicion signal(s), decide whether the final assistant prose actually performs or pressures a blocked boundary action.",
      criteria: {
        VIOLATION:
          "Assistant actually performs or pressures a blocked boundary action in the supplied context.",
        COMPLIANT:
          "Assistant respects the boundary; text is negated, descriptive/meta, own-space, authorized, or otherwise not the prohibited behavior.",
        INSUFFICIENT_CONTEXT:
          "Available bounded context does not support either conclusion.",
      },
    },
  };
}

export function buildSceneBoundaryJevQaState(input: {
  boundaryExecution: BoundaryExecutionContract;
  suspicionSignals: BoundarySuspicionSignal[];
  assistantProse: string;
}): Record<string, unknown> {
  return {
    task: "scene_boundary_qa_triage",
    boundaryExecution: {
      lifecycle: input.boundaryExecution.lifecycle,
      noContactKind: input.boundaryExecution.noContactKind,
      blocksPhysicalApproach: input.boundaryExecution.blocksPhysicalApproach,
      blocksRemoteContact: input.boundaryExecution.blocksRemoteContact,
      blocksGiftOrDropOff: input.boundaryExecution.blocksGiftOrDropOff,
      blocksBoundaryNegotiation: input.boundaryExecution.blocksBoundaryNegotiation,
      blocksFutureMeetingInitiative: input.boundaryExecution.blocksFutureMeetingInitiative,
      allowsIndependentRoutine: input.boundaryExecution.allowsIndependentRoutine,
      allowsInternalAftereffect: input.boundaryExecution.allowsInternalAftereffect,
    },
    suspicionSignals: [...input.suspicionSignals],
    assistantOutputUnderReview: input.assistantProse,
  };
}

export type SceneBoundaryJevQaEligibility =
  | { eligible: false; reason: string; providerCalls: 0 }
  | {
      eligible: true;
      suspicionSignals: BoundarySuspicionSignal[];
      v2Mode: SceneDirectiveV2Mode;
    };

export function evaluateSceneBoundaryJevQaEligibility(input: {
  env?: NodeJS.ProcessEnv;
  v2Mode?: SceneDirectiveV2Mode;
  boundaryExecution: BoundaryExecutionContract | null | undefined;
  assistantProse: string;
}): SceneBoundaryJevQaEligibility {
  const env = input.env ?? process.env;
  if (!isSceneBoundaryJevQaEnabled(env)) {
    return { eligible: false, reason: "SCENE_BOUNDARY_JEV_QA_ENABLED!=1", providerCalls: 0 };
  }
  const v2Mode = input.v2Mode ?? getSceneDirectiveV2Mode(env);
  if (v2Mode === "off" || !isSceneDirectiveV2ComputeEnabled({ ...env, SCENE_DIRECTIVE_V2_MODE: v2Mode })) {
    return { eligible: false, reason: "SCENE_DIRECTIVE_V2_MODE=off", providerCalls: 0 };
  }
  if (!input.boundaryExecution) {
    return { eligible: false, reason: "boundaryExecution=null", providerCalls: 0 };
  }
  const flags = scanR5BoundarySuspicionSignals(input.assistantProse);
  const suspicionSignals = (Object.keys(flags) as BoundarySuspicionSignal[]).filter(
    (k) => flags[k]
  );
  if (suspicionSignals.length === 0) {
    return { eligible: false, reason: "lexical_scanner_zero_signals", providerCalls: 0 };
  }
  return { eligible: true, suspicionSignals, v2Mode };
}

function parseVerdict(
  answers: Record<string, { type?: string; choice?: string }>
): SceneBoundaryJevVerdict | null {
  const row = answers[SCENE_BOUNDARY_JEV_QA_QUESTION_ID];
  if (!row || row.type !== "choice" || typeof row.choice !== "string") return null;
  const choice = row.choice.trim();
  if (choice === "VIOLATION" || choice === "COMPLIANT" || choice === "INSUFFICIENT_CONTEXT") {
    return choice;
  }
  return null;
}

export type ScheduleSceneBoundaryJevQaInput = {
  chatId: number;
  generationScope: AssistantGenerationScope;
  boundaryExecution: BoundaryExecutionContract | null | undefined;
  assistantProse: string;
  v2Mode?: SceneDirectiveV2Mode;
  env?: NodeJS.ProcessEnv;
  /** Test seam — skip network. */
  callDecisions?: typeof callJevDecisions;
  /** Test seam — skip DB generation-current guard. */
  skipStaleGenerationGuard?: boolean;
};

/**
 * Fire-and-forget read-only QA. Never throws to the Main RP path.
 * At most one Decisions call per (assistantMessageId, generationSequence).
 */
export function scheduleSceneBoundaryJevQa(
  input: ScheduleSceneBoundaryJevQaInput
): { scheduled: boolean; reason: string; providerCallsExpected: 0 | 1 } {
  const eligibility = evaluateSceneBoundaryJevQaEligibility({
    env: input.env,
    v2Mode: input.v2Mode,
    boundaryExecution: input.boundaryExecution,
    assistantProse: input.assistantProse,
  });
  if (!eligibility.eligible) {
    return { scheduled: false, reason: eligibility.reason, providerCallsExpected: 0 };
  }

  const key = generationJobKey(input.generationScope);
  if (running.has(key) || completed.has(key)) {
    return { scheduled: false, reason: "generation_already_claimed", providerCallsExpected: 0 };
  }
  running.add(key);

  const contract = input.boundaryExecution!;
  const signals = eligibility.suspicionSignals;
  const call = input.callDecisions ?? callJevDecisions;

  void (async () => {
    const started = performance.now();
    let verdict: SceneBoundaryJevVerdict | null = null;
    let malformed = false;
    let failure: string | null = null;
    let inputTokens = 0;
    let outputTokens = 0;
    let costUsd: number | null = null;
    let providerCalls = 0;

    try {
      if (
        !input.skipStaleGenerationGuard &&
        !isCurrentAssistantGeneration(input.generationScope)
      ) {
        failure = "stale_generation_before_call";
        return;
      }
      const state = buildSceneBoundaryJevQaState({
        boundaryExecution: contract,
        suspicionSignals: signals,
        assistantProse: input.assistantProse,
      });
      providerCalls = 1;
      const result = await call({
        state,
        questions: buildSceneBoundaryJevQaQuestions(),
        timeoutMs: 45_000,
        ledger: {
          requestKind: SCENE_BOUNDARY_JEV_QA_REQUEST_KIND,
        },
      });
      inputTokens = result.usage.inputTokens;
      outputTokens = result.usage.outputTokens;
      costUsd = result.usage.upstreamCostUsd ?? null;
      verdict = parseVerdict(
        result.answers as Record<string, { type?: string; choice?: string }>
      );
      malformed = verdict == null;
      if (malformed) failure = "jev_malformed_or_unmappable";
      assertNoDuplicateAuxProviderSuccess({
        assistantMessageId: input.generationScope.assistantMessageId,
        generationSequence: input.generationScope.generationSequence,
        requestKind: SCENE_BOUNDARY_JEV_QA_REQUEST_KIND,
      });
      if (
        !input.skipStaleGenerationGuard &&
        !isCurrentAssistantGeneration(input.generationScope)
      ) {
        failure = failure ?? "stale_generation_after_call";
        // Still log, but mark stale — never associate as current-generation truth owner.
      }
    } catch (e) {
      failure = ((e as Error).message || "jev_transport_error").slice(0, 240);
      malformed = true;
    } finally {
      running.delete(key);
      completed.add(key);
      const latencyMs = Math.round((performance.now() - started) * 10) / 10;
      const reviewPriority = mapVerdictToReviewPriority(verdict);
      logSceneBoundaryJevQaResult({
        chatId: input.chatId,
        assistantMessageId: input.generationScope.assistantMessageId,
        generationSequence: input.generationScope.generationSequence,
        generationRequestId: input.generationScope.generationRequestId,
        v2Mode: eligibility.v2Mode,
        boundaryLifecycle: contract.lifecycle,
        activeBlockedCategories: listActiveBlockedCategories(contract),
        lexicalSignals: signals,
        jevVerdict: verdict,
        reviewPriority,
        latencyMs,
        providerCostUsd: costUsd,
        inputTokens,
        outputTokens,
        providerCalls,
        malformed,
        failure,
        model: JEV_DECISIONS_MODEL,
      });
    }
  })();

  return { scheduled: true, reason: "scheduled", providerCallsExpected: 1 };
}

export type SceneBoundaryJevQaLogFields = {
  chatId: number;
  assistantMessageId: number;
  generationSequence: number;
  generationRequestId: string | null;
  v2Mode: SceneDirectiveV2Mode;
  boundaryLifecycle: BoundaryExecutionContract["lifecycle"];
  activeBlockedCategories: string[];
  lexicalSignals: BoundarySuspicionSignal[];
  jevVerdict: SceneBoundaryJevVerdict | null;
  reviewPriority: SceneBoundaryReviewPriority;
  latencyMs: number;
  providerCostUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  providerCalls: number;
  malformed: boolean;
  failure: string | null;
  model: string;
};

/** Structured console observability — no secrets, no full prose, no DB write. */
export function logSceneBoundaryJevQaResult(fields: SceneBoundaryJevQaLogFields): void {
  if (process.env.NODE_TEST_CONTEXT) return;
  console.info("[scene_boundary_jev_qa]", {
    event: "scene_boundary_jev_qa",
    ...fields,
  });
}
