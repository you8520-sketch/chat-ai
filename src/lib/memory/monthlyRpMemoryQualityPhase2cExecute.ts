/**
 * #1486 Phase 2C — one approved GPT-6 Luna 5-turn summary via the live owner.
 * Recording wrapper only. No second client, retry loop, or billing owner.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  callBackgroundMemory,
  resolveBackgroundPrimaryModelId,
  type TokenUsage,
} from "@/lib/ai";
import { CHEAPER_INFERENCE_GPT_6_LUNA_MODEL } from "@/lib/chatModels";
import {
  CHEAPER_INFERENCE_BASE_URL,
  buildCheaperInferenceHeaders,
} from "@/lib/cheaperInferenceConfig";
import {
  canClaimCurrentLiveProvider,
  type MemoryEvidenceProvenance,
} from "@/lib/memory/memoryEvidenceProvenance";
import { ROLLING_SUMMARY_MAX_CHARS, ROLLING_SUMMARY_MIN_CHARS } from "@/lib/memory/memory-constants";
import {
  __formatBatchDialogueForTests,
  __setSummarizeTurnBatchCallerForTests,
  buildRollingSummarySystemPrompt,
  ROLLING_SUMMARY_EPISTEMIC_POLICY,
  summarizeTurnBatch,
} from "@/lib/memory/memory-rolling-summary";
import { clampMemoryRecordSummary } from "@/lib/memory/memory-summary-clamp";
import {
  isRollingSummaryGroundedInDialogue,
  validateSummaryNarrative,
} from "@/lib/memory/memory-summary-integrity";
import {
  PHASE2B_FIXTURE_IDENTITY,
  PHASE2B_FIXTURE_PERSONA,
  PHASE2B_TURNS,
  missingPhase2bMustKeepIds,
} from "@/lib/memory/monthlyRpMemoryQualityPhase2bFixture";
import { resolveOpenRouterModelRates } from "@/lib/openRouterModelPricing";
import { RP_QUALITY_PRECALL_TARGET_SELECTOR } from "@/lib/rpQualityPrecall";

export const PHASE2C_CASE_ID = "phase2c_like18_ren_5turn_v1" as const;
export const PHASE2C_MAX_ATTEMPTS = 3;
export const PHASE2C_MAX_CASES = 1;
export const PHASE2C_EXPERIMENT_MAIN_SHA =
  "3a5238542dd594d72b55e46ba64cb498946b9082" as const;
export const PHASE2C_RAILWAY_SUCCESS_SHA =
  "3a5238542dd594d72b55e46ba64cb498946b9082" as const;
export const PHASE2C_LOCK_DIR = "/opt/cursor/artifacts/monthly-rp-memory-quality-phase2c";
export const PHASE2C_LOCK_FILE = path.join(PHASE2C_LOCK_DIR, "execute.lock.json");

export const MONTHLY_RP_MEMORY_QUALITY_PHASE2C_PLAN = {
  caseId: PHASE2C_CASE_ID,
  characterId: 18,
  characterName: "라이크",
  personaName: "렌",
  paidEvaluationApproved: true,
  maxAttemptsPerCase: PHASE2C_MAX_ATTEMPTS,
  maxCases: PHASE2C_MAX_CASES,
  expectedModel: CHEAPER_INFERENCE_GPT_6_LUNA_MODEL,
  identitySource: "FIXTURE_NOT_PRODUCTION_SHEET",
} as const;

export type Phase2cStopReason =
  | "MODEL_NOT_LUNA"
  | "NO_CHEAPER_INFERENCE_KEY"
  | "AUTH_PROBE_FAILED"
  | "ALREADY_EXECUTED"
  | "IN_FLIGHT"
  | "EXECUTE_FAILED";

export type Phase2cAttemptRecord = {
  attempt: number;
  requestKind: string;
  startedAt: string;
  finishedAt: string;
  rawText: string;
  clampedText: string;
  clampChanged: boolean;
  narrativeOk: boolean;
  narrativeReason: string | null;
  grounded: boolean;
  usage: TokenUsage | null;
  error: string | null;
};

export type Phase2cEvidence = {
  caseId: typeof PHASE2C_CASE_ID;
  executedAt: string;
  originMainSha: string;
  railwaySuccessSha: string;
  resolvedModel: string;
  backgroundMemoryModelEnv: string | null;
  provider: "cheaperinference";
  requestKinds: string[];
  providerPosts: number;
  identitySource: typeof MONTHLY_RP_MEMORY_QUALITY_PHASE2C_PLAN.identitySource;
  characterSheetRead: false;
  systemPrompt: string;
  userPrompt: string;
  sourceTurns: typeof PHASE2B_TURNS;
  attempts: Phase2cAttemptRecord[];
  selectedSummary: string;
  selectedFromAttempt: number | null;
  missingMustKeepIds: string[];
  provenance: MemoryEvidenceProvenance;
  canClaimCurrentLiveProvider: boolean;
  estimatedUsd: number | null;
  billedUsd: number | null;
  experimentDelta: string;
};

type LockState = {
  caseId: typeof PHASE2C_CASE_ID;
  status: "started" | "completed" | "failed";
  startedAt: string;
  finishedAt?: string;
};

export function resolvePhase2cModel(
  env: NodeJS.ProcessEnv = process.env
): string {
  return resolveBackgroundPrimaryModelId(env.BACKGROUND_MEMORY_MODEL);
}

export function phase2cHasCheaperInferenceKey(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return Boolean(env.CHEAPER_INFERENCE_API_KEY?.trim());
}

export function readPhase2cLock(lockFile = PHASE2C_LOCK_FILE): LockState | null {
  if (!existsSync(lockFile)) return null;
  const parsed = JSON.parse(readFileSync(lockFile, "utf8")) as LockState;
  if (!parsed || parsed.caseId !== PHASE2C_CASE_ID) return null;
  return parsed;
}

export function writePhase2cLock(state: LockState, lockFile = PHASE2C_LOCK_FILE): void {
  mkdirSync(path.dirname(lockFile), { recursive: true });
  const tmp = `${lockFile}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(tmp, lockFile);
}

export function assertPhase2cPreconditions(opts?: {
  env?: NodeJS.ProcessEnv;
  lockFile?: string;
}): { ok: true; model: string } | { ok: false; reason: Phase2cStopReason } {
  const env = opts?.env ?? process.env;
  const model = resolvePhase2cModel(env);
  if (model !== CHEAPER_INFERENCE_GPT_6_LUNA_MODEL) {
    return { ok: false, reason: "MODEL_NOT_LUNA" };
  }
  if (!phase2cHasCheaperInferenceKey(env)) {
    return { ok: false, reason: "NO_CHEAPER_INFERENCE_KEY" };
  }
  const lock = readPhase2cLock(opts?.lockFile ?? PHASE2C_LOCK_FILE);
  if (lock?.status === "completed") return { ok: false, reason: "ALREADY_EXECUTED" };
  if (lock?.status === "started") return { ok: false, reason: "IN_FLIGHT" };
  return { ok: true, model };
}

export function claimPhase2cLiveProvenance(opts: {
  providerPosts: number;
  resolvedModel: string;
  providerText: string;
  railwaySuccessSha: string;
  responseModelId?: string | null;
}): MemoryEvidenceProvenance {
  const modelLooksLuna =
    !opts.responseModelId ||
    opts.responseModelId.toLowerCase().includes("luna") ||
    opts.responseModelId === CHEAPER_INFERENCE_GPT_6_LUNA_MODEL;
  if (
    opts.providerPosts >= 1 &&
    opts.resolvedModel === CHEAPER_INFERENCE_GPT_6_LUNA_MODEL &&
    opts.providerText.trim().length > 0 &&
    opts.railwaySuccessSha === PHASE2C_RAILWAY_SUCCESS_SHA &&
    modelLooksLuna
  ) {
    return "CURRENT_LIVE_PROVIDER";
  }
  return "CURRENT_CODE_DETERMINISTIC";
}

export async function probeCheaperInferenceAuth(
  env: NodeJS.ProcessEnv = process.env
): Promise<{ ok: true; modelsIncludeLuna: boolean } | { ok: false; reason: Phase2cStopReason }> {
  if (!phase2cHasCheaperInferenceKey(env)) {
    return { ok: false, reason: "NO_CHEAPER_INFERENCE_KEY" };
  }
  try {
    const response = await fetch(`${CHEAPER_INFERENCE_BASE_URL}/models`, {
      method: "GET",
      headers: buildCheaperInferenceHeaders(env.CHEAPER_INFERENCE_API_KEY),
    });
    if (!response.ok) {
      return { ok: false, reason: "AUTH_PROBE_FAILED" };
    }
    const body = (await response.json()) as { data?: Array<{ id?: string }> };
    const ids = (body.data ?? []).map((row) => (row.id ?? "").toLowerCase());
    return {
      ok: true,
      modelsIncludeLuna: ids.some((id) => id === CHEAPER_INFERENCE_GPT_6_LUNA_MODEL || id.includes("gpt-6-luna")),
    };
  } catch {
    return { ok: false, reason: "AUTH_PROBE_FAILED" };
  }
}

function sanitizeUsage(usage: TokenUsage | undefined): TokenUsage | null {
  if (!usage) return null;
  const { debugRawUsage: _dropped, ...safe } = usage;
  return safe;
}

function usdFromUsage(usage: TokenUsage | null): number | null {
  if (!usage) return null;
  if (typeof usage.cheaperInferenceBilledCostUsd === "number") {
    return usage.cheaperInferenceBilledCostUsd;
  }
  if (typeof usage.upstreamCostUsd === "number") return usage.upstreamCostUsd;
  const rates = resolveOpenRouterModelRates(CHEAPER_INFERENCE_GPT_6_LUNA_MODEL);
  return (
    (Math.max(0, usage.inputTokens) / 1_000_000) * rates.inputUsdPerM +
    (Math.max(0, usage.outputTokens) / 1_000_000) * rates.outputUsdPerM
  );
}

export async function executePhase2cLunaSummary(opts?: {
  lockFile?: string;
  env?: NodeJS.ProcessEnv;
  skipAuthProbe?: boolean;
}): Promise<
  | { ok: true; evidence: Phase2cEvidence }
  | { ok: false; reason: Phase2cStopReason; evidence?: Phase2cEvidence }
> {
  const lockFile = opts?.lockFile ?? PHASE2C_LOCK_FILE;
  const env = opts?.env ?? process.env;
  const pre = assertPhase2cPreconditions({ env, lockFile });
  if (!pre.ok) return { ok: false, reason: pre.reason };

  if (!opts?.skipAuthProbe) {
    const probe = await probeCheaperInferenceAuth(env);
    if (!probe.ok) return { ok: false, reason: probe.reason };
  }

  const startedAt = new Date().toISOString();
  writePhase2cLock(
    { caseId: PHASE2C_CASE_ID, status: "started", startedAt },
    lockFile
  );

  const dialogue = __formatBatchDialogueForTests([...PHASE2B_TURNS], RP_QUALITY_PRECALL_TARGET_SELECTOR.characterName);
  const attempts: Phase2cAttemptRecord[] = [];
  let capturedSystem = "";
  let capturedUser = "";

  __setSummarizeTurnBatchCallerForTests(async (system, history, turnTrace, requestKind) => {
    const attemptStarted = new Date().toISOString();
    capturedSystem = system;
    capturedUser = history[0]?.content ?? "";
    try {
      const result = await callBackgroundMemory(system, history, turnTrace, requestKind);
      const rawText = result.text ?? "";
      const clampedText = clampMemoryRecordSummary(
        rawText.replace(/\s+/g, " ").trim(),
        ROLLING_SUMMARY_MAX_CHARS,
        ROLLING_SUMMARY_MIN_CHARS
      );
      const narrative = validateSummaryNarrative(clampedText, "main_canon");
      const grounded = narrative.ok
        ? isRollingSummaryGroundedInDialogue(narrative.text, dialogue, PHASE2B_FIXTURE_PERSONA)
        : false;
      attempts.push({
        attempt: attempts.length + 1,
        requestKind,
        startedAt: attemptStarted,
        finishedAt: new Date().toISOString(),
        rawText,
        clampedText,
        clampChanged: rawText.replace(/\s+/g, " ").trim() !== clampedText,
        narrativeOk: narrative.ok,
        narrativeReason: narrative.ok ? null : narrative.reason,
        grounded,
        usage: sanitizeUsage(result.usage),
        error: null,
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);
      attempts.push({
        attempt: attempts.length + 1,
        requestKind,
        startedAt: attemptStarted,
        finishedAt: new Date().toISOString(),
        rawText: "",
        clampedText: "",
        clampChanged: false,
        narrativeOk: false,
        narrativeReason: "SUMMARY_EMPTY",
        grounded: false,
        usage: null,
        error: message,
      });
      throw error;
    }
  });

  try {
    const selectedSummary = await summarizeTurnBatch({
      dialogue,
      charName: RP_QUALITY_PRECALL_TARGET_SELECTOR.characterName,
      characterIdentity: PHASE2B_FIXTURE_IDENTITY,
      userPersona: PHASE2B_FIXTURE_PERSONA,
      startTurn: 1,
      endTurn: 5,
      sourceTurnIndexes: [1, 2, 3, 4, 5],
    });
    const accepted = attempts.find(
      (attempt) => attempt.narrativeOk && attempt.grounded && attempt.clampedText === selectedSummary
    );
    const anyProviderText = attempts.map((attempt) => attempt.rawText).find((text) => text.trim()) ?? selectedSummary;
    const responseModelId = attempts.find((attempt) => attempt.usage?.responseModelId)?.usage?.responseModelId;
    const provenance = claimPhase2cLiveProvenance({
      providerPosts: attempts.length,
      resolvedModel: pre.model,
      providerText: anyProviderText,
      railwaySuccessSha: PHASE2C_RAILWAY_SUCCESS_SHA,
      responseModelId,
    });
    const billedParts = attempts
      .map((attempt) => usdFromUsage(attempt.usage))
      .filter((value): value is number => value != null);
    const billedUsd = billedParts.length > 0 ? billedParts.reduce((sum, value) => sum + value, 0) : null;
    const evidence: Phase2cEvidence = {
      caseId: PHASE2C_CASE_ID,
      executedAt: startedAt,
      originMainSha: PHASE2C_EXPERIMENT_MAIN_SHA,
      railwaySuccessSha: PHASE2C_RAILWAY_SUCCESS_SHA,
      resolvedModel: pre.model,
      backgroundMemoryModelEnv: env.BACKGROUND_MEMORY_MODEL?.trim() || null,
      provider: "cheaperinference",
      requestKinds: attempts.map((attempt) => attempt.requestKind),
      providerPosts: attempts.length,
      identitySource: MONTHLY_RP_MEMORY_QUALITY_PHASE2C_PLAN.identitySource,
      characterSheetRead: false,
      systemPrompt: capturedSystem || `${buildRollingSummarySystemPrompt(5)}\n\n${ROLLING_SUMMARY_EPISTEMIC_POLICY}`,
      userPrompt: capturedUser,
      sourceTurns: PHASE2B_TURNS,
      attempts,
      selectedSummary,
      selectedFromAttempt: accepted?.attempt ?? (selectedSummary ? attempts.at(-1)?.attempt ?? null : null),
      missingMustKeepIds: selectedSummary
        ? missingPhase2bMustKeepIds(selectedSummary)
        : [
            "time_order",
            "actor_gift",
            "user_choice",
            "emotion_change",
            "role_direction",
            "claim_vs_fact",
            "promise",
            "item_owner",
          ],
      provenance,
      canClaimCurrentLiveProvider: canClaimCurrentLiveProvider(provenance),
      estimatedUsd: billedUsd,
      billedUsd,
      experimentDelta:
        "Wrapper records callBackgroundMemory args/results only. system, history, turnTrace, requestKind, model, max_tokens, and retry owner stay summarizeTurnBatch.",
    };
    writePhase2cLock(
      {
        caseId: PHASE2C_CASE_ID,
        status: "completed",
        startedAt,
        finishedAt: new Date().toISOString(),
      },
      lockFile
    );
    return { ok: true, evidence };
  } catch {
    writePhase2cLock(
      {
        caseId: PHASE2C_CASE_ID,
        status: "completed",
        startedAt,
        finishedAt: new Date().toISOString(),
      },
      lockFile
    );
    return { ok: false, reason: "EXECUTE_FAILED" };
  } finally {
    __setSummarizeTurnBatchCallerForTests(null);
  }
}
