/**
 * Scene policy MINIMAL provider pilot — benchmark-only live execution.
 * Uses production assemblePrimaryRpRequest + CheaperInference fetch.
 * No billing, DB, retry, fallback, or auxiliary calls.
 */
import { createHash } from "node:crypto";

import type { ChatMsg } from "@/lib/ai";
import {
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  buildCheaperInferenceHeaders,
} from "@/lib/cheaperInferenceConfig";
import { parseOpenRouterUsage } from "@/lib/openRouterUsage";
import { openRouterUsdCostFromRates } from "@/lib/openRouterModelPricing";
import type { ReconvergenceState } from "@/lib/reconvergenceState";

import {
  getBenchmarkFixtureById,
  getBenchmarkPilotModelDescriptor,
  listPilotTrajectories,
  type ScenePolicyBenchmarkFixture,
} from "@/lib/scenePolicyBenchmarkDataset";
import {
  advanceV2ReconvergenceForBenchmark,
  BLIND_EVALUATION_RUBRIC_ITEMS,
  buildBenchmarkArmPayload,
  buildLiveTrajectoryTurnFixture,
  buildScenePolicyInputFromFixture,
  computeExecutionMatrix,
  countSceneOwnerMarkers,
  proveSceneOnlyDelta,
  runBenchmarkCase,
  type BenchmarkArmPayload,
  type LiveTrajectoryPriorTurn,
  type ScenePolicyArm,
} from "@/lib/scenePolicyBenchmarkHarness";

export type PilotLogicalSample = {
  logicalId: string;
  kind: "single_turn" | "trajectory";
  fixtureId: string;
  trajectoryId?: string;
  turnIndex?: number;
  arm: ScenePolicyArm;
};

export type PilotCallAccounting = {
  plannedLogicalSamples: number;
  attemptedPhysicalCalls: number;
  successfulProviderCalls: number;
  failedProviderCalls: number;
  fallbackCalls: number;
  retryCalls: number;
  auxiliaryCalls: number;
};

export type PilotCaptureRecord = {
  logical_id: string;
  benchmark_case_id: string;
  fixture_id: string;
  trajectory_id: string | null;
  trajectory_turn_index: number | null;
  arm_id: ScenePolicyArm;
  pilot_baseline_sha: string;
  model_id: string;
  provider: string;
  provider_wire_model: string;
  generation_parameters: Record<string, unknown>;
  actual_final_payload_hash: string;
  normalized_non_scene_hash: string | null;
  scene_policy_metadata: BenchmarkArmPayload["sceneMetadata"];
  scene_policy_representation: ReturnType<typeof countSceneOwnerMarkers>;
  estimated_input_tokens: number;
  actual_input_tokens: number | null;
  actual_output_tokens: number | null;
  latency_ms: number | null;
  raw_output: string | null;
  finish_reason: string | null;
  provider_error: string | null;
  provider_request_id: string | null;
  reconvergence_state_before: unknown;
  reconvergence_state_after: unknown;
  arm_history_provenance: string[];
  upstream_usd_estimate: number | null;
  http_status: number | null;
};

export type PilotRunResult = {
  status:
    | "PILOT_COMPLETE_READY_FOR_BLIND_EVALUATION"
    | "PILOT_PARTIAL_PROVIDER_FAILURE"
    | "PILOT_INVALID_PAYLOAD_DRIFT"
    | "PILOT_INVALID_HISTORY_CONTAMINATION"
    | "PILOT_COST_ABORTED"
    | "PROVIDER_EXECUTION_UNSAFE";
  pilotBaselineSha: string;
  mainSyncSha: string;
  accounting: PilotCallAccounting;
  captures: PilotCaptureRecord[];
  failureReason?: string;
  totalUpstreamUsdEstimate: number;
  planningUpstreamUsdEstimate: number;
};

export class PilotAbortError extends Error {
  constructor(
    message: string,
    readonly status: PilotRunResult["status"]
  ) {
    super(message);
    this.name = "PilotAbortError";
  }
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function generationParamsFromBody(body: Record<string, unknown>): Record<string, unknown> {
  const keys = [
    "model",
    "temperature",
    "max_tokens",
    "stream",
    "top_p",
    "reasoning",
    "thinking",
    "reasoning_effort",
    "response_format",
    "provider",
  ] as const;
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
}

/** Derive MINIMAL logical samples from manifest (authoritative). */
export function deriveMinimalPilotSamples(): PilotLogicalSample[] {
  const matrix = computeExecutionMatrix();
  const minimal = matrix.plans.find((p) => p.name === "MINIMAL");
  if (!minimal) throw new Error("MINIMAL plan missing from execution matrix");

  const samples: PilotLogicalSample[] = [];
  for (const fixtureId of minimal.singleTurnFixtureIds) {
    for (const arm of ["v1", "v2", "living"] as const) {
      samples.push({
        logicalId: `${fixtureId}_${arm}`,
        kind: "single_turn",
        fixtureId,
        arm,
      });
    }
  }
  const trajectories = listPilotTrajectories();
  for (const traj of trajectories) {
    for (const arm of minimal.armSet) {
      for (const turn of traj.turns) {
        samples.push({
          logicalId: `${traj.id}_T${turn.turnIndex}_${arm}`,
          kind: "trajectory",
          fixtureId: `${traj.id}_T${turn.turnIndex}_${arm}`,
          trajectoryId: traj.id,
          turnIndex: turn.turnIndex,
          arm,
        });
      }
    }
  }
  if (samples.length !== minimal.totalCalls) {
    throw new Error(
      `derived samples ${samples.length} != MINIMAL totalCalls ${minimal.totalCalls}`
    );
  }
  return samples;
}

export function assertMinimalPlanExpected(): {
  singleTurnFixtureIds: string[];
  trajectoryIds: string[];
  totalCalls: number;
  formula: string;
} {
  const minimal = computeExecutionMatrix().plans.find((p) => p.name === "MINIMAL")!;
  return {
    singleTurnFixtureIds: minimal.singleTurnFixtureIds,
    trajectoryIds: minimal.trajectoryIds,
    totalCalls: minimal.totalCalls,
    formula: minimal.callFormula,
  };
}

function assertPilotModelPayload(payload: BenchmarkArmPayload, pilotModelId: string): void {
  if (payload.requestBody.model !== pilotModelId) {
    throw new PilotAbortError(
      `unexpected model in payload: ${String(payload.requestBody.model)}`,
      "PROVIDER_EXECUTION_UNSAFE"
    );
  }
}

/** Single CheaperInference HTTP call — no retry, no fallback. */
export async function invokeBenchmarkProviderCall(input: {
  requestBody: Record<string, unknown>;
  pilotModelId: string;
}): Promise<{
  httpStatus: number;
  latencyMs: number;
  rawOutput: string;
  finishReason: string | null;
  providerWireModel: string | null;
  providerRequestId: string | null;
  providerError: string | null;
  usage: ReturnType<typeof parseOpenRouterUsage>;
}> {
  const bodyModel = String(input.requestBody.model ?? "");
  if (bodyModel !== input.pilotModelId) {
    throw new PilotAbortError(
      `refusing provider call: body.model=${bodyModel} expected ${input.pilotModelId}`,
      "PROVIDER_EXECUTION_UNSAFE"
    );
  }

  const started = Date.now();
  const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: buildCheaperInferenceHeaders(),
    body: JSON.stringify(input.requestBody),
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  const latencyMs = Date.now() - started;
  const httpStatus = res.status;

  let json: Record<string, unknown>;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new PilotAbortError(
      `provider response JSON parse failed (HTTP ${httpStatus})`,
      "PILOT_PARTIAL_PROVIDER_FAILURE"
    );
  }

  if (!res.ok) {
    const errMsg =
      typeof json.error === "object" && json.error && "message" in (json.error as object)
        ? String((json.error as { message?: unknown }).message)
        : JSON.stringify(json.error ?? json);
    return {
      httpStatus,
      latencyMs,
      rawOutput: "",
      finishReason: null,
      providerWireModel: typeof json.model === "string" ? json.model : null,
      providerRequestId: typeof json.id === "string" ? json.id : null,
      providerError: errMsg,
      usage: parseOpenRouterUsage(null),
    };
  }

  const resolvedModel = typeof json.model === "string" ? json.model : null;
  if (resolvedModel && !resolvedModel.toLowerCase().includes("gemini")) {
    throw new PilotAbortError(
      `unexpected provider model response: ${resolvedModel}`,
      "PILOT_PARTIAL_PROVIDER_FAILURE"
    );
  }

  const choice = Array.isArray(json.choices)
    ? (json.choices[0] as Record<string, unknown>)
    : undefined;
  const message = (choice?.message ?? {}) as Record<string, unknown>;
  const rawOutput = typeof message.content === "string" ? message.content : "";
  const finishReason =
    typeof choice?.finish_reason === "string" ? choice.finish_reason : null;
  const usage = parseOpenRouterUsage(json.usage, res.headers);

  return {
    httpStatus,
    latencyMs,
    rawOutput,
    finishReason,
    providerWireModel: resolvedModel,
    providerRequestId: typeof json.id === "string" ? json.id : null,
    providerError: null,
    usage,
  };
}

function buildCaptureFromPayload(input: {
  sample: PilotLogicalSample;
  payload: BenchmarkArmPayload;
  pilotBaselineSha: string;
  pilotModel: ReturnType<typeof getBenchmarkPilotModelDescriptor>;
  providerResult: Awaited<ReturnType<typeof invokeBenchmarkProviderCall>>;
  reconvergenceBefore: unknown;
  reconvergenceAfter: unknown;
  armHistoryProvenance: string[];
  normalizedNonSceneHash: string | null;
}): PilotCaptureRecord {
  const usage = input.providerResult.usage;
  const upstreamUsd =
    usage.promptTokens > 0 || usage.completionTokens > 0
      ? openRouterUsdCostFromRates({
          modelId: input.pilotModel.modelId,
          promptTokens: usage.promptTokens,
          outputTokens: usage.completionTokens,
        }).usdCost
      : null;

  return {
    logical_id: input.sample.logicalId,
    benchmark_case_id: input.sample.fixtureId,
    fixture_id: input.sample.fixtureId,
    trajectory_id: input.sample.trajectoryId ?? null,
    trajectory_turn_index: input.sample.turnIndex ?? null,
    arm_id: input.sample.arm,
    pilot_baseline_sha: input.pilotBaselineSha,
    model_id: input.pilotModel.modelId,
    provider: input.pilotModel.transportProvider,
    provider_wire_model:
      input.providerResult.providerWireModel ?? input.pilotModel.providerWireModelId,
    generation_parameters: generationParamsFromBody(input.payload.requestBody),
    actual_final_payload_hash: input.payload.normalizedFinalPayload.rawMessagesHash,
    normalized_non_scene_hash: input.normalizedNonSceneHash,
    scene_policy_metadata: input.payload.sceneMetadata,
    scene_policy_representation: countSceneOwnerMarkers(
      input.payload.systemPrompt
    ),
    estimated_input_tokens: input.payload.inputTokenEstimate,
    actual_input_tokens: usage.promptTokens > 0 ? usage.promptTokens : null,
    actual_output_tokens: usage.completionTokens > 0 ? usage.completionTokens : null,
    latency_ms: input.providerResult.latencyMs,
    raw_output: input.providerResult.rawOutput,
    finish_reason: input.providerResult.finishReason,
    provider_error: input.providerResult.providerError,
    provider_request_id: input.providerResult.providerRequestId,
    reconvergence_state_before: input.reconvergenceBefore,
    reconvergence_state_after: input.reconvergenceAfter,
    arm_history_provenance: input.armHistoryProvenance,
    upstream_usd_estimate: upstreamUsd,
    http_status: input.providerResult.httpStatus,
  };
}

export async function runMinimalScenePolicyPilot(input: {
  pilotBaselineSha: string;
  mainSyncSha: string;
  invokeProvider?: typeof invokeBenchmarkProviderCall;
}): Promise<PilotRunResult> {
  const invoke = input.invokeProvider ?? invokeBenchmarkProviderCall;
  const pilotModel = getBenchmarkPilotModelDescriptor();
  const samples = deriveMinimalPilotSamples();
  const minimal = computeExecutionMatrix().plans.find((p) => p.name === "MINIMAL")!;
  const planningUsd = minimal.estimatedUpstreamUsd;

  const accounting: PilotCallAccounting = {
    plannedLogicalSamples: samples.length,
    attemptedPhysicalCalls: 0,
    successfulProviderCalls: 0,
    failedProviderCalls: 0,
    fallbackCalls: 0,
    retryCalls: 0,
    auxiliaryCalls: 0,
  };

  const captures: PilotCaptureRecord[] = [];
  let totalUpstreamUsd = 0;

  const trajectoryHistory = new Map<string, LiveTrajectoryPriorTurn[]>();
  const v2ReconvergenceByTraj = new Map<string, ReconvergenceState | undefined>();

  for (const sample of samples) {
    let fixture: ScenePolicyBenchmarkFixture;
    let reconvergenceBefore: unknown = null;
    let reconvergenceAfter: unknown = null;
    let normalizedNonSceneHash: string | null = null;
    let armHistoryProvenance: string[] = [];

    if (sample.kind === "single_turn") {
      const base = getBenchmarkFixtureById(sample.fixtureId);
      if (!base) {
        throw new PilotAbortError(`missing fixture ${sample.fixtureId}`, "PROVIDER_EXECUTION_UNSAFE");
      }
      const caseResult = runBenchmarkCase(base);
      if (!caseResult.parityValid) {
        throw new PilotAbortError(
          `single-turn parity failed before call: ${sample.fixtureId} ${caseResult.parityDiffs.join("; ")}`,
          "PILOT_INVALID_PAYLOAD_DRIFT"
        );
      }
      const delta = proveSceneOnlyDelta(caseResult.arms);
      if (!delta.rawPayloadDiffers || !delta.normalizedPayloadMatches) {
        throw new PilotAbortError(
          `scene-only delta invalid for ${sample.fixtureId}`,
          "PILOT_INVALID_PAYLOAD_DRIFT"
        );
      }
      normalizedNonSceneHash =
        caseResult.arms.v1.normalizedFinalPayload.nonSceneFingerprint.composite;
      fixture = base;
      armHistoryProvenance = base.history
        .filter((m) => m.role === "assistant")
        .map((m) => sha256(m.content).slice(0, 16));
    } else {
      const traj = listPilotTrajectories().find((t) => t.id === sample.trajectoryId);
      if (!traj || sample.turnIndex == null) {
        throw new PilotAbortError(
          `missing trajectory ${sample.trajectoryId}`,
          "PROVIDER_EXECUTION_UNSAFE"
        );
      }
      const turn = traj.turns.find((t) => t.turnIndex === sample.turnIndex);
      if (!turn) {
        throw new PilotAbortError(
          `missing turn ${sample.trajectoryId} T${sample.turnIndex}`,
          "PROVIDER_EXECUTION_UNSAFE"
        );
      }

      const histKey = `${sample.trajectoryId}:${sample.arm}`;
      const priorTurns = trajectoryHistory.get(histKey) ?? [];

      armHistoryProvenance = priorTurns.map(
        (p) => `${sha256(p.assistantOutputByArm[sample.arm]!).slice(0, 16)}`
      );

      const liveV2State =
        sample.arm === "v2" ? v2ReconvergenceByTraj.get(sample.trajectoryId!) : undefined;
      reconvergenceBefore = liveV2State ?? null;

      fixture = buildLiveTrajectoryTurnFixture({
        trajectory: traj,
        turn,
        arm: sample.arm,
        priorTurns,
        liveReconvergenceState: liveV2State,
      });

      if (sample.turnIndex === 1) {
        const offlineFixture = {
          ...fixture,
          id: `${traj.id}_T1`,
          reconvergenceState: undefined,
        };
        const arms = {
          v1: buildBenchmarkArmPayload({ fixture: offlineFixture, arm: "v1" }),
          v2: buildBenchmarkArmPayload({ fixture: offlineFixture, arm: "v2" }),
          living: buildBenchmarkArmPayload({ fixture: offlineFixture, arm: "living" }),
        };
        const fp = arms.v1.normalizedFinalPayload.nonSceneFingerprint.composite;
        if (
          arms.v2.normalizedFinalPayload.nonSceneFingerprint.composite !== fp ||
          arms.living.normalizedFinalPayload.nonSceneFingerprint.composite !== fp
        ) {
          throw new PilotAbortError(
            `trajectory turn1 parity failed ${sample.trajectoryId}`,
            "PILOT_INVALID_PAYLOAD_DRIFT"
          );
        }
        normalizedNonSceneHash = fp;
      }
    }

    const payload = buildBenchmarkArmPayload({ fixture, arm: sample.arm });
    assertPilotModelPayload(payload, pilotModel.modelId);

    accounting.attemptedPhysicalCalls += 1;
    const providerResult = await invoke({
      requestBody: payload.requestBody,
      pilotModelId: pilotModel.modelId,
    });

    if (providerResult.providerError || providerResult.httpStatus !== 200) {
      accounting.failedProviderCalls += 1;
      captures.push(
        buildCaptureFromPayload({
          sample,
          payload,
          pilotBaselineSha: input.pilotBaselineSha,
          pilotModel,
          providerResult,
          reconvergenceBefore,
          reconvergenceAfter: null,
          armHistoryProvenance,
          normalizedNonSceneHash,
        })
      );
      return {
        status: "PILOT_PARTIAL_PROVIDER_FAILURE",
        pilotBaselineSha: input.pilotBaselineSha,
        mainSyncSha: input.mainSyncSha,
        accounting,
        captures,
        failureReason: providerResult.providerError ?? `HTTP ${providerResult.httpStatus}`,
        totalUpstreamUsdEstimate: totalUpstreamUsd,
        planningUpstreamUsdEstimate: planningUsd,
      };
    }

    accounting.successfulProviderCalls += 1;
    if (providerResult.usage.promptTokens > 0 || providerResult.usage.completionTokens > 0) {
      totalUpstreamUsd += openRouterUsdCostFromRates({
        modelId: pilotModel.modelId,
        promptTokens: providerResult.usage.promptTokens,
        outputTokens: providerResult.usage.completionTokens,
      }).usdCost;
    }

    if (sample.kind === "trajectory" && sample.trajectoryId && sample.turnIndex != null) {
      const histKey = `${sample.trajectoryId}:${sample.arm}`;
      const priorTurns = trajectoryHistory.get(histKey) ?? [];
      const traj = listPilotTrajectories().find((t) => t.id === sample.trajectoryId)!;
      const turn = traj.turns.find((t) => t.turnIndex === sample.turnIndex)!;

      priorTurns.push({
        userMessage: turn.userMessage,
        assistantOutputByArm: {
          v1: sample.arm === "v1" ? providerResult.rawOutput : "__ARM_ISOLATED_V1__",
          v2: sample.arm === "v2" ? providerResult.rawOutput : "__ARM_ISOLATED_V2__",
          living: sample.arm === "living" ? providerResult.rawOutput : "__ARM_ISOLATED_LIVING__",
        },
      });
      trajectoryHistory.set(histKey, priorTurns);

      if (sample.arm === "v2") {
        const policyInput = buildScenePolicyInputFromFixture(fixture);
        const recentWithOutput: ChatMsg[] = [
          ...fixture.history,
          { role: "user", content: fixture.currentUserMessage },
          { role: "assistant", content: providerResult.rawOutput },
        ];
        const { nextState } = advanceV2ReconvergenceForBenchmark({
          policyInput: { ...policyInput, recentMessages: recentWithOutput },
          previousState: v2ReconvergenceByTraj.get(sample.trajectoryId),
        });
        reconvergenceAfter = nextState;
        v2ReconvergenceByTraj.set(sample.trajectoryId, nextState);
      }
    }

    captures.push(
      buildCaptureFromPayload({
        sample,
        payload,
        pilotBaselineSha: input.pilotBaselineSha,
        pilotModel,
        providerResult,
        reconvergenceBefore,
        reconvergenceAfter,
        armHistoryProvenance,
        normalizedNonSceneHash,
      })
    );

    if (planningUsd > 0 && totalUpstreamUsd > planningUsd * 3) {
      return {
        status: "PILOT_COST_ABORTED",
        pilotBaselineSha: input.pilotBaselineSha,
        mainSyncSha: input.mainSyncSha,
        accounting,
        captures,
        failureReason: `cost ${totalUpstreamUsd.toFixed(3)} exceeded 3× planning ${planningUsd}`,
        totalUpstreamUsdEstimate: totalUpstreamUsd,
        planningUpstreamUsdEstimate: planningUsd,
      };
    }
  }

  return {
    status: "PILOT_COMPLETE_READY_FOR_BLIND_EVALUATION",
    pilotBaselineSha: input.pilotBaselineSha,
    mainSyncSha: input.mainSyncSha,
    accounting,
    captures,
    totalUpstreamUsdEstimate: totalUpstreamUsd,
    planningUpstreamUsdEstimate: planningUsd,
  };
}

export type PilotBlindSample = {
  blind_id: string;
  fixture_context: string;
  raw_output: string;
  rubric_items: readonly string[];
};

export type PilotAnswerKeyEntry = {
  blind_id: string;
  arm_id: ScenePolicyArm;
  logical_id: string;
  benchmark_case_id: string;
};

/** Blind samples without arm identity; answer key separate. */
export function buildPilotBlindArtifacts(input: {
  captures: PilotCaptureRecord[];
}): { blindSamples: PilotBlindSample[]; answerKey: PilotAnswerKeyEntry[] } {
  const blindSamples: PilotBlindSample[] = [];
  const answerKey: PilotAnswerKeyEntry[] = [];

  for (const cap of input.captures) {
    if (!cap.raw_output) continue;
    const blindId = `BLIND_${cap.logical_id}`;
    blindSamples.push({
      blind_id: blindId,
      fixture_context: `# ${cap.benchmark_case_id}\ntrajectory=${cap.trajectory_id ?? "single"}`,
      raw_output: cap.raw_output,
      rubric_items: BLIND_EVALUATION_RUBRIC_ITEMS,
    });
    answerKey.push({
      blind_id: blindId,
      arm_id: cap.arm_id,
      logical_id: cap.logical_id,
      benchmark_case_id: cap.benchmark_case_id,
    });
  }

  return { blindSamples, answerKey };
}
