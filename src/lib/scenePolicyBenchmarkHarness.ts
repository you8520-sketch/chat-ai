/**
 * Scene policy provider-evidence benchmark harness — offline payload assembly only.
 * No provider HTTP calls. No billing. No production route wiring.
 */
import { createHash } from "node:crypto";

import type { ChatMsg } from "@/lib/ai";
import {
  buildSceneDirective,
  renderSceneDirectiveForPrompt,
  type SceneDirective,
} from "@/lib/sceneDirective";
import {
  buildSceneDirectiveV2,
  getUpdatedReconvergenceStateFromBuild,
  renderSceneDirectiveV2ForPrompt,
  type SceneDirectiveV2,
} from "@/lib/sceneDirectiveV2";
import {
  buildLivingSceneDirective,
  renderLivingSceneDirectiveForPrompt,
  type LivingSceneDirective,
} from "@/lib/livingSceneDirective";
import {
  materializeSceneDirectivePromptBlock,
  type ScenePacingPromptOwner,
} from "@/lib/sceneDirectiveV2Policy";
import { SCENE_FLOW_BLOCK } from "@/lib/generationProcessBeatFlow";
import { assemblePrimaryRpRequest } from "@/lib/openRouterAdult";
import { flattenOpenRouterMessageContent } from "@/lib/openRouterClient";
import {
  countPacingOwners,
  renderCompactScenePacingCue,
} from "@/lib/scenePacingController";
import { openRouterUsdCostFromRates, resolveOpenRouterModelRates } from "@/lib/openRouterModelPricing";
import { estimateTokens } from "@/lib/tokenEstimate";
import { buildContext } from "@/services/contextBuilder";
import type { ContextBuildInput } from "@/types";
import { MAIN_RP_USER_SELECTABLE_OPTIONS } from "@/lib/chatModels";
import type { ReconvergenceState } from "@/lib/reconvergenceState";

import {
  BENCHMARK_CHAR_NAME,
  BENCHMARK_DEFAULT_MODEL,
  BENCHMARK_DEFAULT_TARGET_CHARS,
  BENCHMARK_PILOT_MODEL_ID,
  buildBenchmarkContextBase,
  getBenchmarkPilotModelDescriptor,
  countSingleTurnFixtures,
  listPilotFixtures,
  listPilotTrajectories,
  RECONVERGENCE_TRAJECTORIES,
  SCENE_POLICY_BENCHMARK_FIXTURES,
  type ScenePolicyBenchmarkFixture,
  type ScenePolicyBenchmarkTrajectory,
  type BenchmarkTrajectoryTurn,
} from "@/lib/scenePolicyBenchmarkDataset";

export type ScenePolicyArm = "v1" | "v2" | "living";

export const SCENE_POLICY_ARM_IDS: readonly ScenePolicyArm[] = ["v1", "v2", "living"] as const;

const V1_MARKER = "[PRIVATE SCENE ENGINE RULE]";
const V2_MARKER = "[PRIVATE SCENE PACING RULE]";
const LIVING_MARKER = "[PRIVATE SCENE CONTINUITY RULE]";

export type ScenePolicyBuildInput = {
  mode: "interactive";
  recentMessages: ChatMsg[];
  currentUserMessage: string;
  memoryText?: string;
  relationshipMemoryText?: string;
  lorebookText?: string;
  triggeredEventText?: string;
  currentTurn: number;
  chatId: number;
  reconvergenceState?: ScenePolicyBenchmarkFixture["reconvergenceState"];
};

export type SceneDeltaMetadata = {
  motion?: string;
  progression?: string[];
  npcPermission?: boolean | string;
  externalEventPermission?: boolean;
  newOrderPermission?: boolean;
  triggerHandling?: string;
  scenePhase?: string;
  eventSource?: string;
  reconvergence?: string;
  eventBudget?: number;
};

export type SceneArmArtifacts = {
  arm: ScenePolicyArm;
  owner: ScenePacingPromptOwner;
  sceneBlock: string;
  directive: SceneDirective | SceneDirectiveV2 | LivingSceneDirective;
  metadata: SceneDeltaMetadata;
};

export type NonSceneFingerprint = {
  model: string;
  temperature: string;
  maxOutput: string;
  targetLength: string;
  generationParams: string;
  normalizedMessages: string;
  composite: string;
};

export type SceneOwnerCounts = {
  scenePacing: number;
  v1Full: number;
  v2Full: number;
  livingFull: number;
  sceneDirective3d: number;
};

export type NormalizedFinalPayload = {
  normalizedMessages: Array<{ role: string; content: string }>;
  generationParams: Record<string, unknown>;
  rawMessagesHash: string;
  normalizedMessagesHash: string;
  sceneOwnedText: string;
  sceneOwnerCounts: SceneOwnerCounts;
  nonSceneFingerprint: NonSceneFingerprint;
};

export type BenchmarkArmPayload = {
  arm: ScenePolicyArm;
  owner: ScenePacingPromptOwner;
  /** Renderer artifact — not necessarily present in final Standard V1 payload */
  sceneBlockArtifact: string;
  sceneMetadata: SceneDeltaMetadata;
  systemPrompt: string;
  history: ChatMsg[];
  requestBody: Record<string, unknown>;
  messages: { role: string; content: string }[];
  inputTokenEstimate: number;
  scenePolicyTokenEstimate: number;
  basePayloadTokenEstimate: number;
  normalizedFinalPayload: NormalizedFinalPayload;
  /** @deprecated use normalizedFinalPayload.nonSceneFingerprint */
  nonSceneFingerprint: NonSceneFingerprint;
};

export type SceneOnlyDeltaProof = {
  rawPayloadDiffers: boolean;
  normalizedPayloadMatches: boolean;
  changedSections: string[];
};

export type BenchmarkCaseResult = {
  caseId: string;
  family?: string;
  kind: string;
  arms: Record<ScenePolicyArm, BenchmarkArmPayload>;
  parityValid: boolean;
  parityDiffs: string[];
  sceneOnlyDelta: SceneOnlyDeltaProof;
};

export type CostOwnerStatus =
  | "COST_OWNER_CONFIRMED"
  | "COST_OWNER_MISMATCH"
  | "COST_OWNER_UNCONFIRMED";

export type LiveTrajectoryPriorTurn = {
  userMessage: string;
  assistantOutputByArm: Record<ScenePolicyArm, string>;
};

export type BlindEvaluationSlot = "A" | "B" | "C";

export type BlindEvaluationPackage = {
  caseId: string;
  fixtureContext: string;
  slots: Record<BlindEvaluationSlot, { rawOutputPlaceholder: string }>;
  answerKey: Record<BlindEvaluationSlot, ScenePolicyArm>;
  rubricItems: readonly string[];
};

export type CallPlan = {
  name: "MINIMAL" | "BALANCED" | "HIGH-CONFIDENCE";
  repeat: number;
  singleTurnFixtureIds: string[];
  trajectoryIds: string[];
  armSet: ScenePolicyArm[] | Array<"v1" | "v2">;
  callFormula: string;
  singleTurnCalls: number;
  trajectoryCalls: number;
  totalCalls: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedUpstreamUsd: number;
  outputTokenEstimateMethod: "ESTIMATE_HEURISTIC";
  notes: string[];
};

export type BenchmarkExecutionMatrix = {
  singleTurnFixtureCount: number;
  pilotFixtureCount: number;
  trajectoryCount: number;
  trajectoryTurnCount: number;
  plans: CallPlan[];
};

export type BenchmarkResultCaptureSchema = {
  benchmark_case_id: string;
  arm_id: ScenePolicyArm;
  model_id: string;
  provider: string;
  generation_parameters: Record<string, unknown>;
  scene_policy_metadata: SceneDeltaMetadata;
  input_token_estimate: number;
  actual_input_tokens: number | null;
  actual_output_tokens: number | null;
  latency: number | null;
  raw_output: string | null;
  finish_reason: string | null;
  provider_error: string | null;
  request_id: string | null;
  reconvergence_state_before: unknown;
  reconvergence_state_after: unknown;
};

export const BLIND_EVALUATION_RUBRIC_ITEMS = [
  "Character Initiative",
  "User Agency Preservation",
  "Scene Continuity",
  "Causal Progression",
  "Unnecessary Event Injection",
  "NPC Grounding",
  "Forced NPC / Message / Order",
  "Quiet Scene Naturalness",
  "Stagnation Recovery",
  "Trigger Handling",
  "Relationship Continuity",
  "Over-Steering",
  "Repetition",
  "Mechanical/Formulaic Feeling",
  "Long-Horizon Continuity",
  "Reconvergence Naturalness",
  "Premature Reconvergence",
  "Overall RP Preference",
] as const;

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function armToOwner(arm: ScenePolicyArm): ScenePacingPromptOwner {
  switch (arm) {
    case "v1":
      return "legacy_v1";
    case "v2":
      return "event_restraint_v2";
    case "living":
      return "living_continuity_director";
    default: {
      const _exhaustive: never = arm;
      return _exhaustive;
    }
  }
}

export function buildScenePolicyInputFromFixture(
  fixture: ScenePolicyBenchmarkFixture
): ScenePolicyBuildInput {
  return {
    mode: "interactive",
    recentMessages: fixture.history,
    currentUserMessage: fixture.currentUserMessage,
    memoryText: fixture.memoryText ?? "",
    relationshipMemoryText: fixture.relationshipMemoryText ?? "",
    lorebookText: fixture.lorebookText ?? "",
    triggeredEventText: fixture.triggeredEventText ?? "",
    currentTurn: fixture.currentTurn ?? fixture.history.length + 1,
    chatId: 88001,
    reconvergenceState: fixture.reconvergenceState,
  };
}

function extractSceneMetadata(
  arm: ScenePolicyArm,
  directive: SceneDirective | SceneDirectiveV2 | LivingSceneDirective
): SceneDeltaMetadata {
  if (arm === "v1") {
    const d = directive as SceneDirective;
    return {
      motion: d.motionDecision,
      progression: d.progressionTypes,
      npcPermission: d.npcGrounding.newNpcAllowed,
      triggerHandling: d.progressionTypes.includes("world_reaction") ? "trigger_active" : "none",
    };
  }
  if (arm === "v2") {
    const d = directive as SceneDirectiveV2;
    return {
      motion: d.pacingDecision,
      progression: d.progressionTypes,
      npcPermission: d.allowNewNpc,
      externalEventPermission: d.allowNewExternalMessage,
      newOrderPermission: d.allowNewOrderOrSchedule,
      triggerHandling: d.pacingDecision === "resolve_trigger" ? "resolve_trigger" : "none",
      reconvergence: d.reconvergenceState.state,
      eventBudget: d.eventBudget,
    };
  }
  const d = directive as LivingSceneDirective;
  return {
    motion: String(d.recommendedIntensityInternal),
    progression: d.progressionTypes,
    scenePhase: d.scenePhase,
    eventSource: d.eventSource,
    triggerHandling: d.eventSource === "TRIGGERED_EVENT" ? "triggered_event" : "none",
  };
}

export function buildSceneArmArtifacts(
  input: ScenePolicyBuildInput,
  arm: ScenePolicyArm
): SceneArmArtifacts {
  const common = {
    mode: input.mode,
    recentMessages: input.recentMessages,
    currentUserMessage: input.currentUserMessage,
    memoryText: input.memoryText,
    relationshipMemoryText: input.relationshipMemoryText,
    lorebookText: input.lorebookText,
    triggeredEventText: input.triggeredEventText,
    currentTurn: input.currentTurn,
  };

  const v1Directive = buildSceneDirective({
    ...common,
    primaryCharacterName: BENCHMARK_CHAR_NAME,
    chatId: input.chatId,
    progressionHistory: [],
  });
  const v2Directive = buildSceneDirectiveV2({
    ...common,
    reconvergenceState: input.reconvergenceState,
    isRegenerate: false,
  });
  const livingDirective = buildLivingSceneDirective(common);

  const owner = armToOwner(arm);
  const sceneBlock = materializeSceneDirectivePromptBlock({
    scenePacingOwner: owner,
    v2Block: renderSceneDirectiveV2ForPrompt(v2Directive),
    livingBlock: renderLivingSceneDirectiveForPrompt(livingDirective),
    legacyBlock: renderSceneDirectiveForPrompt(v1Directive),
  });

  const directive =
    arm === "v1" ? v1Directive : arm === "v2" ? v2Directive : livingDirective;

  return {
    arm,
    owner,
    sceneBlock,
    directive,
    metadata: extractSceneMetadata(arm, directive),
  };
}

/** Fallback patterns for residual scene wire not covered by exact renderer blocks. */
const SCENE_OWNED_FALLBACK_PATTERNS: RegExp[] = [
  /\[SCENE STATE\][\s\S]*?(?=\n\[(?:RHYTHM|IMMERSIVE|2[cab]|1\.|7\]|4\]|Mem)|$)/g,
];

function collectSceneOwnedFallbackMatches(text: string): string[] {
  const parts: string[] = [];
  for (const pattern of SCENE_OWNED_FALLBACK_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      parts.push(match[0]);
    }
  }
  return parts;
}

function collapseScenePlaceholders(text: string): string {
  return text.replace(/<<SCENE>>/g, "").replace(/\s+/g, " ").trim();
}

/** Exact scene-owned blocks present in actual final payloads (renderer-aligned). */
export function resolveSceneStripTextsForArm(input: {
  arm: ScenePolicyArm;
  systemPrompt: string;
  sceneBlockArtifact: string;
  v1Directive?: SceneDirective;
}): string[] {
  const texts: string[] = [];
  if (input.systemPrompt.includes(SCENE_FLOW_BLOCK)) {
    texts.push(SCENE_FLOW_BLOCK);
  }
  if (input.arm === "v1" && input.v1Directive) {
    const compact = renderCompactScenePacingCue(input.v1Directive);
    if (compact && input.systemPrompt.includes(compact)) texts.push(compact);
  } else if (
    (input.arm === "v2" || input.arm === "living") &&
    input.sceneBlockArtifact &&
    input.systemPrompt.includes(input.sceneBlockArtifact)
  ) {
    texts.push(input.sceneBlockArtifact);
  }
  for (const extra of collectSceneOwnedFallbackMatches(input.systemPrompt)) {
    if (!texts.some((t) => t.includes(extra) || extra.includes(t))) texts.push(extra);
  }
  return texts.sort((a, b) => b.length - a.length);
}

function stripExactSceneBlocks(text: string, exactBlocks: readonly string[]): string {
  let out = text;
  for (const block of exactBlocks) {
    if (block && out.includes(block)) out = out.split(block).join("<<SCENE>>");
  }
  return out;
}

/** Strip scene-owned sections from prompt text for final-payload parity normalization. */
export function stripSceneOwnedSections(text: string, exactBlocks: readonly string[] = []): string {
  let out = stripExactSceneBlocks(text, exactBlocks);
  for (const pattern of SCENE_OWNED_FALLBACK_PATTERNS) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, "<<SCENE>>");
  }
  return collapseScenePlaceholders(out);
}

export function countSceneOwnerMarkers(systemText: string): SceneOwnerCounts {
  const pacing = countPacingOwners(systemText);
  return {
    scenePacing: pacing.scene_pacing,
    v1Full: (systemText.match(/\[PRIVATE SCENE ENGINE RULE\]/g) ?? []).length,
    v2Full: (systemText.match(/\[PRIVATE SCENE PACING RULE\]/g) ?? []).length,
    livingFull: (systemText.match(/\[PRIVATE SCENE CONTINUITY RULE\]/g) ?? []).length,
    sceneDirective3d: (systemText.match(/\[3d\] Private scene directive/g) ?? []).length,
  };
}

function extractGenerationParams(body: Record<string, unknown>): Record<string, unknown> {
  const keys = [
    "model",
    "temperature",
    "max_tokens",
    "stream",
    "top_p",
    "frequency_penalty",
    "presence_penalty",
    "repetition_penalty",
    "seed",
    "reasoning",
    "thinking",
    "provider",
  ] as const;
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
}

function stableJson(value: unknown): string {
  const normalize = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(normalize);
    if (v && typeof v === "object") {
      const obj = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(obj).sort()) {
        out[key] = normalize(obj[key]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(normalize(value));
}

/** @deprecated use stripSceneOwnedSections */
export function stripScenePolicySections(text: string): string {
  return stripSceneOwnedSections(text);
}

/** Normalize actual assembled provider payload for cross-arm non-scene parity. */
export function normalizeFinalPayloadForSceneParity(input: {
  messages: Array<{ role: string; content: string }>;
  requestBody: Record<string, unknown>;
  targetResponseChars: number;
  sceneStripTexts?: readonly string[];
}): NormalizedFinalPayload {
  const rawMessagesHash = sha256(
    stableJson(input.messages.map((m) => ({ role: m.role, content: m.content })))
  );
  const systemText =
    input.messages.find((m) => m.role === "system")?.content ?? "";
  const stripTexts = input.sceneStripTexts ?? [];
  const sceneOwnedText =
    stripTexts.join("\n\n").trim() ||
    collectSceneOwnedFallbackMatches(systemText).join("\n\n").trim();
  const normalizedMessages = input.messages.map((m) =>
    m.role === "system"
      ? { role: m.role, content: stripSceneOwnedSections(m.content, stripTexts) }
      : { role: m.role, content: m.content }
  );
  const normalizedMessagesHash = sha256(stableJson(normalizedMessages));
  const generationParams = extractGenerationParams(input.requestBody);
  const model = String(input.requestBody.model ?? "");
  const temperature = String(input.requestBody.temperature ?? "unset");
  const maxOutput = String(input.requestBody.max_tokens ?? "unset");
  const targetLength = String(input.targetResponseChars);
  const generationParamsHash = sha256(stableJson(generationParams));
  const composite = sha256(
    [normalizedMessagesHash, generationParamsHash, targetLength].join("|")
  );
  const nonSceneFingerprint: NonSceneFingerprint = {
    model,
    temperature,
    maxOutput,
    targetLength,
    generationParams: generationParamsHash,
    normalizedMessages: normalizedMessagesHash,
    composite,
  };
  return {
    normalizedMessages,
    generationParams,
    rawMessagesHash,
    normalizedMessagesHash,
    sceneOwnedText,
    sceneOwnerCounts: countSceneOwnerMarkers(systemText),
    nonSceneFingerprint,
  };
}

export function extractSceneOwnedTextFromFinalPayload(
  payload: Pick<BenchmarkArmPayload, "messages" | "systemPrompt" | "sceneBlockArtifact" | "arm">,
  v1Directive?: SceneDirective
): string {
  const systemText =
    payload.messages.find((m) => m.role === "system")?.content ?? payload.systemPrompt;
  return resolveSceneStripTextsForArm({
    arm: payload.arm,
    systemPrompt: systemText,
    sceneBlockArtifact: payload.sceneBlockArtifact,
    v1Directive,
  }).join("\n\n");
}

export function buildBenchmarkArmPayload(input: {
  fixture: ScenePolicyBenchmarkFixture;
  arm: ScenePolicyArm;
  modelId?: string;
  targetResponseChars?: number;
}): BenchmarkArmPayload {
  const pilotModel = getBenchmarkPilotModelDescriptor();
  const modelId = input.modelId ?? pilotModel.modelId;
  const targetResponseChars = input.targetResponseChars ?? BENCHMARK_DEFAULT_TARGET_CHARS;
  const policyInput = buildScenePolicyInputFromFixture(input.fixture);
  const artifacts = buildSceneArmArtifacts(policyInput, input.arm);
  const v1Directive = buildSceneDirective({
    ...policyInput,
    primaryCharacterName: BENCHMARK_CHAR_NAME,
    chatId: policyInput.chatId,
    progressionHistory: [],
  });

  const contextBase = buildBenchmarkContextBase();
  const contextInput: ContextBuildInput = {
    ...contextBase,
    modelId,
    targetResponseChars,
    shortTermHistory: input.fixture.history,
    currentUserMessage: input.fixture.currentUserMessage,
    longTermMemory: input.fixture.memoryText ?? contextBase.longTermMemory,
    keywordLorebookBlock: input.fixture.lorebookText ?? "",
    triggeredScenarioEventsBlock: input.fixture.triggeredEventText ?? "",
    sceneDirectiveBlock: artifacts.sceneBlock,
    scenePacingPromptOwner: artifacts.owner,
  };

  const built = buildContext(contextInput);
  const skipMotionCue = input.arm !== "v1";

  const assembled = assemblePrimaryRpRequest({
    system: built.systemPrompt,
    history: built.history,
    modelId,
    targetResponseChars,
    stream: false,
    messageOpts: {
      transportProvider: pilotModel.transportProvider,
      charName: BENCHMARK_CHAR_NAME,
      sceneServerControls: {
        mode: "interactive",
        contentKind: "character",
        primaryCharacterName: BENCHMARK_CHAR_NAME,
        currentUserMessage: input.fixture.currentUserMessage,
        recentMessages: input.fixture.history,
        memoryText: input.fixture.memoryText ?? "",
        relationshipMemoryText: input.fixture.relationshipMemoryText ?? "",
        lorebookText: input.fixture.lorebookText ?? "",
        triggeredEventText: input.fixture.triggeredEventText ?? "",
        canonicalSceneDirective: v1Directive,
        skipMotionCue,
        currentTurn: policyInput.currentTurn,
        chatId: policyInput.chatId,
      },
    },
  });

  const flatMessages = assembled.messages.map((m) => ({
    role: m.role,
    content: flattenOpenRouterMessageContent(m.content),
  }));

  const systemPrompt = flatMessages.find((m) => m.role === "system")?.content ?? built.systemPrompt;
  const sceneStripTexts = resolveSceneStripTextsForArm({
    arm: input.arm,
    systemPrompt,
    sceneBlockArtifact: artifacts.sceneBlock,
    v1Directive: input.arm === "v1" ? v1Directive : undefined,
  });
  const normalizedFinalPayload = normalizeFinalPayloadForSceneParity({
    messages: flatMessages,
    requestBody: assembled.requestBody,
    targetResponseChars,
    sceneStripTexts,
  });
  const sceneOwnedText = normalizedFinalPayload.sceneOwnedText;
  const inputTokenEstimate = estimateTokens(
    flatMessages.map((m) => m.content).join("\n")
  );
  const scenePolicyTokenEstimate = estimateTokens(sceneOwnedText);
  const basePayloadTokenEstimate = estimateTokens(
    normalizedFinalPayload.normalizedMessages.map((m) => m.content).join("\n")
  );

  return {
    arm: input.arm,
    owner: artifacts.owner,
    sceneBlockArtifact: artifacts.sceneBlock,
    sceneMetadata: artifacts.metadata,
    systemPrompt,
    history: built.history,
    requestBody: assembled.requestBody,
    messages: flatMessages,
    inputTokenEstimate,
    scenePolicyTokenEstimate,
    basePayloadTokenEstimate,
    normalizedFinalPayload,
    nonSceneFingerprint: normalizedFinalPayload.nonSceneFingerprint,
  };
}

export function verifyThreeArmParity(
  arms: Record<ScenePolicyArm, BenchmarkArmPayload>
): { valid: boolean; diffs: string[] } {
  const diffs: string[] = [];
  const ref = arms.v1.normalizedFinalPayload.nonSceneFingerprint;
  for (const arm of ["v2", "living"] as const) {
    const fp = arms[arm].normalizedFinalPayload.nonSceneFingerprint;
    if (fp.model !== ref.model) diffs.push(`${arm}: model mismatch`);
    if (fp.temperature !== ref.temperature) diffs.push(`${arm}: temperature mismatch`);
    if (fp.maxOutput !== ref.maxOutput) diffs.push(`${arm}: max_output mismatch`);
    if (fp.targetLength !== ref.targetLength) diffs.push(`${arm}: target_length mismatch`);
    if (fp.generationParams !== ref.generationParams) {
      diffs.push(`${arm}: generation_params mismatch`);
    }
    if (fp.normalizedMessages !== ref.normalizedMessages) {
      diffs.push(`${arm}: normalized_messages mismatch`);
    }
    if (fp.composite !== ref.composite) diffs.push(`${arm}: composite mismatch`);
  }
  return { valid: diffs.length === 0, diffs };
}

export function proveSceneOnlyDelta(
  arms: Record<ScenePolicyArm, BenchmarkArmPayload>
): SceneOnlyDeltaProof {
  const rawHashes = SCENE_POLICY_ARM_IDS.map(
    (a) => arms[a].normalizedFinalPayload.rawMessagesHash
  );
  const normalizedHashes = SCENE_POLICY_ARM_IDS.map(
    (a) => arms[a].normalizedFinalPayload.normalizedMessagesHash
  );
  const rawPayloadDiffers = new Set(rawHashes).size > 1;
  const normalizedPayloadMatches =
    normalizedHashes[0] === normalizedHashes[1] &&
    normalizedHashes[1] === normalizedHashes[2];
  const changedSections =
    rawPayloadDiffers && normalizedPayloadMatches ? (["scene-policy"] as const) : [];
  return {
    rawPayloadDiffers,
    normalizedPayloadMatches,
    changedSections: [...changedSections],
  };
}

export function runBenchmarkCase(fixture: ScenePolicyBenchmarkFixture): BenchmarkCaseResult {
  const arms = {
    v1: buildBenchmarkArmPayload({ fixture, arm: "v1" }),
    v2: buildBenchmarkArmPayload({ fixture, arm: "v2" }),
    living: buildBenchmarkArmPayload({ fixture, arm: "living" }),
  };
  const parity = verifyThreeArmParity(arms);
  const sceneOnlyDelta = proveSceneOnlyDelta(arms);
  return {
    caseId: fixture.id,
    family: fixture.family,
    kind: fixture.kind,
    arms,
    parityValid: parity.valid && sceneOnlyDelta.normalizedPayloadMatches,
    parityDiffs: parity.valid
      ? sceneOnlyDelta.normalizedPayloadMatches
        ? []
        : ["normalized final payload mismatch across arms"]
      : parity.diffs,
    sceneOnlyDelta,
  };
}

function deterministicShuffle<T>(seed: string, items: readonly T[]): T[] {
  const order = sha256(seed)
    .match(/.{2}/g)!
    .map((h) => parseInt(h, 16));
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = order[i % order.length]! % (i + 1);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

export function buildBlindEvaluationPackage(caseResult: BenchmarkCaseResult): BlindEvaluationPackage {
  const arms = SCENE_POLICY_ARM_IDS;
  const shuffled = deterministicShuffle(caseResult.caseId, arms);
  const slots: BlindEvaluationPackage["slots"] = {
    A: { rawOutputPlaceholder: "" },
    B: { rawOutputPlaceholder: "" },
    C: { rawOutputPlaceholder: "" },
  };
  const answerKey: BlindEvaluationPackage["answerKey"] = { A: "v1", B: "v1", C: "v1" };
  (["A", "B", "C"] as const).forEach((slot, idx) => {
    answerKey[slot] = shuffled[idx]!;
  });
  const fixture = getFixtureById(caseResult.caseId);
  const fixtureContext = [
    `# Fixture ${caseResult.caseId}`,
    fixture ? `User: ${fixture.currentUserMessage}` : "",
    fixture ? `History turns: ${fixture.history.length}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    caseId: caseResult.caseId,
    fixtureContext,
    slots,
    answerKey,
    rubricItems: BLIND_EVALUATION_RUBRIC_ITEMS,
  };
}

function getFixtureById(id: string): ScenePolicyBenchmarkFixture | undefined {
  return SCENE_POLICY_BENCHMARK_FIXTURES.find((f) => f.id === id);
}

/**
 * OFFLINE PREPARATION ONLY — uses frozenAssistantResponse placeholders.
 * Must not be used for live provider trajectory execution.
 */
export function buildOfflineTrajectoryTurnFixture(input: {
  trajectory: ScenePolicyBenchmarkTrajectory;
  turn: BenchmarkTrajectoryTurn;
  priorTurns: BenchmarkTrajectoryTurn[];
}): ScenePolicyBenchmarkFixture {
  const history: ChatMsg[] = [];
  for (const prev of input.priorTurns) {
    history.push({ role: "user", content: prev.userMessage });
    history.push({ role: "assistant", content: prev.frozenAssistantResponse });
  }
  return {
    id: `${input.trajectory.id}_T${input.turn.turnIndex}`,
    family: "B14_LONG_SEPARATION",
    kind: "reconvergence_trajectory",
    label: `${input.trajectory.label} turn ${input.turn.turnIndex}`,
    history,
    currentUserMessage: input.turn.userMessage,
    reconvergenceState: input.turn.reconvergenceStateBefore,
    currentTurn: input.turn.turnIndex,
  };
}

/** @deprecated use buildOfflineTrajectoryTurnFixture */
export function buildTrajectoryTurnFixture(input: {
  trajectory: ScenePolicyBenchmarkTrajectory;
  turn: BenchmarkTrajectoryTurn;
  priorTurns: BenchmarkTrajectoryTurn[];
}): ScenePolicyBenchmarkFixture {
  return buildOfflineTrajectoryTurnFixture(input);
}

/**
 * LIVE PROVIDER TRAJECTORY — each arm carries its own actual assistant outputs in history.
 * Does not read frozenAssistantResponse.
 */
export function buildLiveTrajectoryTurnFixture(input: {
  trajectory: ScenePolicyBenchmarkTrajectory;
  turn: BenchmarkTrajectoryTurn;
  arm: ScenePolicyArm;
  priorTurns: LiveTrajectoryPriorTurn[];
}): ScenePolicyBenchmarkFixture {
  const history: ChatMsg[] = [];
  for (const prev of input.priorTurns) {
    history.push({ role: "user", content: prev.userMessage });
    history.push({ role: "assistant", content: prev.assistantOutputByArm[input.arm] });
  }
  return {
    id: `${input.trajectory.id}_T${input.turn.turnIndex}_${input.arm}`,
    family: "B14_LONG_SEPARATION",
    kind: "reconvergence_trajectory",
    label: `${input.trajectory.label} turn ${input.turn.turnIndex} (${input.arm})`,
    history,
    currentUserMessage: input.turn.userMessage,
    reconvergenceState:
      input.arm === "v2" ? input.turn.reconvergenceStateBefore : undefined,
    currentTurn: input.turn.turnIndex,
  };
}

/** In-memory V2 reconvergence transition for benchmark live runner (no DB). */
export function advanceV2ReconvergenceForBenchmark(input: {
  policyInput: ScenePolicyBuildInput;
  previousState?: ReconvergenceState;
}): { directive: SceneDirectiveV2; nextState: ReconvergenceState } {
  const v2Input = {
    mode: input.policyInput.mode,
    recentMessages: input.policyInput.recentMessages,
    currentUserMessage: input.policyInput.currentUserMessage,
    memoryText: input.policyInput.memoryText,
    relationshipMemoryText: input.policyInput.relationshipMemoryText,
    lorebookText: input.policyInput.lorebookText,
    triggeredEventText: input.policyInput.triggeredEventText,
    reconvergenceState: input.previousState,
    currentTurn: input.policyInput.currentTurn,
    isRegenerate: false,
  };
  const directive = buildSceneDirectiveV2(v2Input);
  const nextState = getUpdatedReconvergenceStateFromBuild(v2Input, directive);
  return { directive, nextState };
}

export function serializeReconvergenceState(state: unknown): string {
  return JSON.stringify(state ?? null);
}

export function buildResultCaptureSchema(input: {
  caseId: string;
  arm: ScenePolicyArm;
  payload: BenchmarkArmPayload;
  reconvergenceBefore?: unknown;
  reconvergenceAfter?: unknown;
}): BenchmarkResultCaptureSchema {
  return {
    benchmark_case_id: input.caseId,
    arm_id: input.arm,
    model_id: String(input.payload.requestBody.model ?? getBenchmarkPilotModelDescriptor().modelId),
    provider: getBenchmarkPilotModelDescriptor().transportProvider,
    generation_parameters: {
      temperature: input.payload.requestBody.temperature,
      max_tokens: input.payload.requestBody.max_tokens,
    },
    scene_policy_metadata: input.payload.sceneMetadata,
    input_token_estimate: input.payload.inputTokenEstimate,
    actual_input_tokens: null,
    actual_output_tokens: null,
    latency: null,
    raw_output: null,
    finish_reason: null,
    provider_error: null,
    request_id: null,
    reconvergence_state_before: input.reconvergenceBefore ?? null,
    reconvergence_state_after: input.reconvergenceAfter ?? null,
  };
}

let cachedAvgInputTokensPerCall: number | null = null;

function avgInputTokensPerCall(modelId: string): number {
  if (cachedAvgInputTokensPerCall != null) return cachedAvgInputTokensPerCall;
  const pilot = listPilotFixtures();
  if (pilot.length === 0) {
    cachedAvgInputTokensPerCall = 4000;
    return cachedAvgInputTokensPerCall;
  }
  const sampleFixture = pilot[0]!;
  const samples = SCENE_POLICY_ARM_IDS.map(
    (arm) => buildBenchmarkArmPayload({ fixture: sampleFixture, arm, modelId }).inputTokenEstimate
  );
  cachedAvgInputTokensPerCall = Math.round(
    samples.reduce((a, b) => a + b, 0) / samples.length
  );
  return cachedAvgInputTokensPerCall;
}

/** ESTIMATE_HEURISTIC — tokenEstimate.estimateTokens uses chars×0.9, not provider tokenizer. */
function avgOutputTokensPerCall(targetChars: number): number {
  return estimateTokens("x".repeat(Math.max(1, targetChars)));
}

function trajectoryCallsExact(
  trajectories: ScenePolicyBenchmarkTrajectory[],
  armsPerTurn: number,
  repeat: number
): number {
  return trajectories.reduce((sum, t) => sum + t.turns.length * armsPerTurn, 0) * repeat;
}

export function verifyBenchmarkCostOwner(input?: {
  modelId?: string;
  transportProvider?: "cheaperinference" | "openrouter";
}): {
  status: CostOwnerStatus;
  modelId: string;
  transportProvider: string;
  upstreamCostSource: string;
  notes: string[];
} {
  const pilotModel = getBenchmarkPilotModelDescriptor();
  const modelId = input?.modelId ?? pilotModel.modelId;
  const transportProvider = input?.transportProvider ?? pilotModel.transportProvider;
  const option = MAIN_RP_USER_SELECTABLE_OPTIONS.find((o) => o.id === modelId);
  const rates = resolveOpenRouterModelRates(modelId);
  const notes: string[] = [];
  if (!option) {
    return {
      status: "COST_OWNER_UNCONFIRMED",
      modelId,
      transportProvider,
      upstreamCostSource: "unknown",
      notes: ["model not in MAIN_RP_USER_SELECTABLE_OPTIONS"],
    };
  }
  if (option.provider !== transportProvider) {
    notes.push(`picker provider=${option.provider} transport=${transportProvider}`);
  }
  const ciMapped =
    modelId === "deepseek-v4-pro-0813" ||
    modelId === "claude-opus-5" ||
    modelId.startsWith("gemini-") ||
    modelId.startsWith("gpt-");
  const pickerProvider = option.provider as "cheaperinference" | "openrouter" | "openai";
  let upstreamCostSource = "unmapped";
  if (pickerProvider === "cheaperinference" && ciMapped) {
    upstreamCostSource =
      "openRouterModelPricing.resolveOpenRouterModelRates (CheaperInference catalog snapshot + live catalog merge)";
  } else if (pickerProvider === "openrouter") {
    upstreamCostSource =
      "openRouterModelPricing.resolveOpenRouterModelRates (OpenRouter list rates)";
  }
  const status: CostOwnerStatus =
    upstreamCostSource.startsWith("openRouterModelPricing") &&
    pickerProvider === transportProvider
      ? "COST_OWNER_CONFIRMED"
      : pickerProvider !== transportProvider
        ? "COST_OWNER_MISMATCH"
        : "COST_OWNER_UNCONFIRMED";
  notes.push(`rates.label=${rates.label}`);
  notes.push("billingRawCost.openRouterUsdCostFromRates uses same rate table for upstream USD");
  return { status, modelId, transportProvider, upstreamCostSource, notes };
}

export function computeExecutionMatrix(input?: {
  modelId?: string;
  targetResponseChars?: number;
}): BenchmarkExecutionMatrix {
  const modelId = input?.modelId ?? BENCHMARK_DEFAULT_MODEL;
  const targetResponseChars = input?.targetResponseChars ?? BENCHMARK_DEFAULT_TARGET_CHARS;
  const singleTurnCount = countSingleTurnFixtures();
  const pilotFixtures = listPilotFixtures();
  const pilotTrajectories = listPilotTrajectories();
  const trajectoryCount = RECONVERGENCE_TRAJECTORIES.length;
  const trajectoryTurnCount = RECONVERGENCE_TRAJECTORIES.reduce(
    (s, t) => s + t.turns.length,
    0
  );
  const avgIn = avgInputTokensPerCall(modelId);
  const avgOut = avgOutputTokensPerCall(targetResponseChars);
  const threeArms = SCENE_POLICY_ARM_IDS.length;
  const reconArms = 2;

  const planDefs: Array<{
    name: CallPlan["name"];
    repeat: number;
    fixtures: ScenePolicyBenchmarkFixture[];
    trajectories: ScenePolicyBenchmarkTrajectory[];
    trajectoryArms: number;
  }> = [
    {
      name: "MINIMAL",
      repeat: 1,
      fixtures: pilotFixtures,
      trajectories: pilotTrajectories,
      trajectoryArms: reconArms,
    },
    {
      name: "BALANCED",
      repeat: 2,
      fixtures: SCENE_POLICY_BENCHMARK_FIXTURES,
      trajectories: RECONVERGENCE_TRAJECTORIES,
      trajectoryArms: reconArms,
    },
    {
      name: "HIGH-CONFIDENCE",
      repeat: 3,
      fixtures: SCENE_POLICY_BENCHMARK_FIXTURES,
      trajectories: RECONVERGENCE_TRAJECTORIES,
      trajectoryArms: reconArms,
    },
  ];

  const plans = planDefs.map(({ name, repeat, fixtures, trajectories, trajectoryArms }) => {
    const singleTurnCalls = fixtures.length * threeArms * repeat;
    const trajectoryCalls = trajectoryCallsExact(trajectories, trajectoryArms, repeat);
    const totalCalls = singleTurnCalls + trajectoryCalls;
    const estimatedInputTokens = totalCalls * avgIn;
    const estimatedOutputTokens = totalCalls * avgOut;
    const { usdCost } = openRouterUsdCostFromRates({
      modelId,
      promptTokens: estimatedInputTokens,
      outputTokens: estimatedOutputTokens,
    });
    const fixtureIds = fixtures.map((f) => f.id);
    const trajectoryIds = trajectories.map((t) => t.id);
    const callFormula = `single:${fixtureIds.length}×${threeArms}×${repeat} + trajectory:sum(turns×${trajectoryArms})×${repeat}`;
    return {
      name,
      repeat,
      singleTurnFixtureIds: fixtureIds,
      trajectoryIds,
      armSet: ["v1", "v2"] as Array<"v1" | "v2">,
      callFormula,
      singleTurnCalls,
      trajectoryCalls,
      totalCalls,
      estimatedInputTokens,
      estimatedOutputTokens,
      estimatedUpstreamUsd: Math.round(usdCost * 1000) / 1000,
      outputTokenEstimateMethod: "ESTIMATE_HEURISTIC" as const,
      notes: [
        callFormula,
        `avg_input_tokens_per_call=${avgIn} (pilot final-payload sample)`,
        `avg_output_tokens_per_call=${avgOut} (ESTIMATE_HEURISTIC: estimateTokens on targetResponseChars=${targetResponseChars})`,
        verifyBenchmarkCostOwner({ modelId }).upstreamCostSource,
      ],
    };
  });

  return {
    singleTurnFixtureCount: singleTurnCount,
    pilotFixtureCount: pilotFixtures.length,
    trajectoryCount,
    trajectoryTurnCount,
    plans,
  };
}

export type ModelCandidateFacts = {
  slot: string;
  modelId: string;
  provider: string;
  displayLabel: string;
  productionUsage: string;
  temperatureOwner: string;
  maxOutputOwner: string;
  estimatedInputUsdPerM: number;
  estimatedOutputUsdPerM: number;
  upstreamCostSource: string;
  cacheBehavior: string;
  availability: string;
};

export function listModelCandidateFacts(): ModelCandidateFacts[] {
  return MAIN_RP_USER_SELECTABLE_OPTIONS.map((opt, idx) => {
    const rates = resolveOpenRouterModelRates(opt.id);
    const costOwner = verifyBenchmarkCostOwner({
      modelId: opt.id,
      transportProvider: opt.provider,
    });
    return {
      slot: `MODEL_${String.fromCharCode(65 + idx)}`,
      modelId: opt.id,
      provider: opt.provider,
      displayLabel: opt.label,
      productionUsage: "Main RP user-selectable (canonical 4)",
      temperatureOwner: "openRouterClient.buildOpenRouterRequestBody + model-specific generation params",
      maxOutputOwner: "openRouterClient.resolveOpenRouterMaxTokens + targetResponseChars",
      estimatedInputUsdPerM: rates.inputUsdPerM,
      estimatedOutputUsdPerM: rates.outputUsdPerM,
      upstreamCostSource: costOwner.upstreamCostSource,
      cacheBehavior: rates.explicitCacheInjection
        ? `${rates.label} — explicit cache_control injection`
        : `${rates.label} — provider automatic prefix cache`,
      availability: "User-selectable in Main RP picker",
    };
  });
}

/** Fill blind package slots from captured benchmark results (no scoring). */
export function applyCaptureResultsToBlindPackage(input: {
  blindPackage: BlindEvaluationPackage;
  captures: Array<{ arm: ScenePolicyArm; rawOutput: string }>;
}): BlindEvaluationPackage {
  const slots: BlindEvaluationPackage["slots"] = { ...input.blindPackage.slots };
  for (const slot of ["A", "B", "C"] as const) {
    const arm = input.blindPackage.answerKey[slot];
    const capture = input.captures.find((c) => c.arm === arm);
    slots[slot] = { rawOutputPlaceholder: capture?.rawOutput ?? "" };
  }
  return { ...input.blindPackage, slots };
}

export function runFullBenchmarkPreparation(): {
  cases: BenchmarkCaseResult[];
  invalidCases: BenchmarkCaseResult[];
  blindPackages: BlindEvaluationPackage[];
  matrix: BenchmarkExecutionMatrix;
  modelCandidates: ModelCandidateFacts[];
} {
  const cases = SCENE_POLICY_BENCHMARK_FIXTURES.map(runBenchmarkCase);
  const invalidCases = cases.filter((c) => !c.parityValid);
  const blindPackages = cases.map(buildBlindEvaluationPackage);
  return {
    cases,
    invalidCases,
    blindPackages,
    matrix: computeExecutionMatrix(),
    modelCandidates: listModelCandidateFacts(),
  };
}

/** Owner map for provider-evidence benchmark preparation report. */
export const BENCHMARK_OWNER_MAP = {
  PROVIDER_MODEL_OWNER: "route.ts resolveSelectedAI + chatModels MAIN_RP_USER_SELECTABLE_OPTIONS",
  MODEL_PARAMETERS_OWNER: "openRouterClient.buildOpenRouterRequestBody",
  TEMPERATURE_OWNER: "openRouterClient.resolveGenerationParamsForModel (model-specific)",
  MAX_OUTPUT_OWNER: "openRouterClient.resolveOpenRouterMaxTokens",
  TARGET_LENGTH_OWNER: "responseLength.resolveTargetLengthForPrompt / targetResponseChars",
  SYSTEM_PROMPT_ASSEMBLY_OWNER: "services/contextBuilder.buildContext",
  SCENE_POLICY_OWNER:
    "sceneDirective (v1.2) | sceneDirectiveV2 | livingSceneDirective + sceneDirectiveV2Policy.materializeSceneDirectivePromptBlock",
  CANON_OWNER: "contextBuilder + canonPlan / characterParser chunks",
  MEMORY_OWNER: "contextBuilder longTermMemory + memoryMeta + episodic injection",
  USER_AGENCY_OWNER: "contextBuilder identity/rules + userAgency modules",
  SPEECH_OWNER: "privateSpeechControlBlock + sceneDirective speech rules",
  REGEN_OWNER: "route.ts regenerate branch (benchmark follow-up — not in phase 1 pilot)",
  PROVIDER_PAYLOAD_OWNER: "openRouterAdult.assemblePrimaryRpRequest",
  TOKEN_ESTIMATE_OWNER: "tokenEstimate.estimateTokens + openRouterAdult estimatePayloadFromBody",
  PROVIDER_COST_OWNER:
    "openRouterModelPricing.resolveOpenRouterModelRates / openRouterUsdCostFromRates (CheaperInference slugs use CI catalog snapshot; billingRawCost for production receipts)",
  BILLING_PRICE_OWNER: "points.ts + billingDisplay (user-facing — benchmark must bypass)",
  BENCHMARK_PILOT_MODEL_OWNER:
    "scenePolicyBenchmarkDataset.getBenchmarkPilotModelDescriptor (Gemini 3.7 Flash CheaperInference)",
  BENCHMARK_FIXTURE_OWNER: "scenePolicyBenchmarkDataset.ts",
  MOCK_DRY_RUN_OWNER: "assemblePrimaryRpRequest (credential-free) + MOCK_MODE in openRouterAdult fetch path",
} as const;
