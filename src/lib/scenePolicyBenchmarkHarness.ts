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
import { assemblePrimaryRpRequest } from "@/lib/openRouterAdult";
import { flattenOpenRouterMessageContent } from "@/lib/openRouterClient";
import { openRouterUsdCostFromRates } from "@/lib/openRouterModelPricing";
import { estimateTokens } from "@/lib/tokenEstimate";
import { buildContext } from "@/services/contextBuilder";
import type { ContextBuildInput } from "@/types";
import { MAIN_RP_USER_SELECTABLE_OPTIONS } from "@/lib/chatModels";
import { resolveOpenRouterModelRates } from "@/lib/openRouterModelPricing";

import {
  BENCHMARK_CHAR_NAME,
  BENCHMARK_DEFAULT_MODEL,
  BENCHMARK_DEFAULT_TARGET_CHARS,
  buildBenchmarkContextBase,
  countSingleTurnFixtures,
  listPilotFixtures,
  RECONVERGENCE_TRAJECTORIES,
  SCENE_POLICY_BENCHMARK_FIXTURES,
  type ScenePolicyBenchmarkFixture,
  type ScenePolicyBenchmarkTrajectory,
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
  canon: string;
  userPersona: string;
  memory: string;
  history: string;
  lore: string;
  trigger: string;
  speech: string;
  agency: string;
  style: string;
  otherSystemSections: string;
  composite: string;
};

export type BenchmarkArmPayload = {
  arm: ScenePolicyArm;
  owner: ScenePacingPromptOwner;
  sceneBlock: string;
  sceneMetadata: SceneDeltaMetadata;
  systemPrompt: string;
  history: ChatMsg[];
  requestBody: Record<string, unknown>;
  messages: { role: string; content: string }[];
  inputTokenEstimate: number;
  scenePolicyTokenEstimate: number;
  basePayloadTokenEstimate: number;
  nonSceneFingerprint: NonSceneFingerprint;
};

export type BenchmarkCaseResult = {
  caseId: string;
  family?: string;
  kind: string;
  arms: Record<ScenePolicyArm, BenchmarkArmPayload>;
  parityValid: boolean;
  parityDiffs: string[];
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
  singleTurnCalls: number;
  trajectoryCalls: number;
  totalCalls: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedUpstreamUsd: number;
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

export function stripScenePolicySections(text: string): string {
  let out = text;
  const markers: Array<{ marker: string; token: string }> = [
    { marker: V1_MARKER, token: "<<SCENE_POLICY_REMOVED:V1>>" },
    { marker: V2_MARKER, token: "<<SCENE_POLICY_REMOVED:V2>>" },
    { marker: LIVING_MARKER, token: "<<SCENE_POLICY_REMOVED:LIVING>>" },
    { marker: "[SCENE PACING]", token: "<<SCENE_POLICY_REMOVED:PACING>>" },
    { marker: "[SCENE STATE]", token: "<<SCENE_POLICY_REMOVED:STATE>>" },
    { marker: "[SCENE FLOW]", token: "<<SCENE_POLICY_REMOVED:FLOW>>" },
  ];
  for (const { marker, token } of markers) {
    while (out.includes(marker)) {
      const start = out.indexOf(marker);
      const nextSection = out.slice(start + marker.length).search(/\n\[[0-9]/);
      const end =
        nextSection >= 0 ? start + marker.length + nextSection : out.length;
      out = out.slice(0, start) + token + out.slice(end);
    }
  }
  return out
    .replace(/<<SCENE_POLICY_REMOVED:[^>]+>>/g, "<<SCENE>>")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSectionByHeading(text: string, headingNeedle: string): string {
  const start = text.indexOf(headingNeedle);
  if (start < 0) return "";
  const rest = text.slice(start + headingNeedle.length);
  const next = rest.search(/\n\[[0-9]/);
  return (next >= 0 ? rest.slice(0, next) : rest).trim();
}

export function computeNonSceneFingerprint(input: {
  systemPrompt: string;
  history: ChatMsg[];
  requestBody: Record<string, unknown>;
  targetResponseChars: number;
  memoryText: string;
  loreText: string;
  triggerText: string;
  userPersona: string;
}): NonSceneFingerprint {
  const strippedSystem = stripScenePolicySections(input.systemPrompt);
  const model = String(input.requestBody.model ?? "");
  const temperature = String(input.requestBody.temperature ?? "unset");
  const maxOutput = String(input.requestBody.max_tokens ?? "unset");
  const targetLength = String(input.targetResponseChars);
  const canon = sha256(
    extractSectionByHeading(input.systemPrompt, "[2] Structured character canon") ||
      extractSectionByHeading(input.systemPrompt, "[2] Structured character")
  );
  const userPersona = sha256(input.userPersona);
  const memory = sha256(input.memoryText);
  const history = sha256(
    input.history.map((m) => `${m.role}:${m.content}`).join("\n")
  );
  const lore = sha256(input.loreText);
  const trigger = sha256(input.triggerText);
  const speech = sha256(extractSectionByHeading(input.systemPrompt, "[2b] Private speech"));
  const agency = sha256(extractSectionByHeading(input.systemPrompt, "[0] Identity & Rules"));
  const style = sha256(extractSectionByHeading(input.systemPrompt, "Narrative style"));
  const otherSystemSections = sha256(strippedSystem);
  const composite = sha256(
    [
      model,
      temperature,
      maxOutput,
      targetLength,
      canon,
      userPersona,
      memory,
      history,
      lore,
      trigger,
      speech,
      agency,
      style,
      otherSystemSections,
    ].join("|")
  );
  return {
    model,
    temperature,
    maxOutput,
    targetLength,
    canon,
    userPersona,
    memory,
    history,
    lore,
    trigger,
    speech,
    agency,
    style,
    otherSystemSections,
    composite,
  };
}

export function buildBenchmarkArmPayload(input: {
  fixture: ScenePolicyBenchmarkFixture;
  arm: ScenePolicyArm;
  modelId?: string;
  targetResponseChars?: number;
}): BenchmarkArmPayload {
  const modelId = input.modelId ?? BENCHMARK_DEFAULT_MODEL;
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

  const sharedContextInput: ContextBuildInput = {
    ...contextInput,
    sceneDirectiveBlock: undefined,
    scenePacingPromptOwner: undefined,
  };
  const sharedBuilt = buildContext(sharedContextInput);
  const built = buildContext(contextInput);
  const skipMotionCue = input.arm !== "v1";

  const assembled = assemblePrimaryRpRequest({
    system: built.systemPrompt,
    history: built.history,
    modelId,
    targetResponseChars,
    stream: false,
    messageOpts: {
      transportProvider: "cheaperinference",
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
  const inputTokenEstimate = estimateTokens(
    flatMessages.map((m) => m.content).join("\n")
  );
  const scenePolicyTokenEstimate = estimateTokens(artifacts.sceneBlock);
  const basePayloadTokenEstimate = Math.max(0, inputTokenEstimate - scenePolicyTokenEstimate);

  const fingerprint = computeNonSceneFingerprint({
    systemPrompt: sharedBuilt.systemPrompt,
    history: sharedBuilt.history,
    requestBody: assembled.requestBody,
    targetResponseChars,
    memoryText: input.fixture.memoryText ?? contextBase.longTermMemory ?? "",
    loreText: input.fixture.lorebookText ?? "",
    triggerText: input.fixture.triggeredEventText ?? "",
    userPersona: contextBase.userPersona ?? "",
  });

  return {
    arm: input.arm,
    owner: artifacts.owner,
    sceneBlock: artifacts.sceneBlock,
    sceneMetadata: artifacts.metadata,
    systemPrompt,
    history: built.history,
    requestBody: assembled.requestBody,
    messages: flatMessages,
    inputTokenEstimate,
    scenePolicyTokenEstimate,
    basePayloadTokenEstimate,
    nonSceneFingerprint: fingerprint,
  };
}

export function verifyThreeArmParity(
  arms: Record<ScenePolicyArm, BenchmarkArmPayload>
): { valid: boolean; diffs: string[] } {
  const diffs: string[] = [];
  const ref = arms.v1.nonSceneFingerprint;
  for (const arm of ["v2", "living"] as const) {
    const fp = arms[arm].nonSceneFingerprint;
    if (fp.model !== ref.model) diffs.push(`${arm}: model mismatch`);
    if (fp.temperature !== ref.temperature) diffs.push(`${arm}: temperature mismatch`);
    if (fp.maxOutput !== ref.maxOutput) diffs.push(`${arm}: max_output mismatch`);
    if (fp.targetLength !== ref.targetLength) diffs.push(`${arm}: target_length mismatch`);
    if (fp.canon !== ref.canon) diffs.push(`${arm}: canon mismatch`);
    if (fp.userPersona !== ref.userPersona) diffs.push(`${arm}: user_persona mismatch`);
    if (fp.memory !== ref.memory) diffs.push(`${arm}: memory mismatch`);
    if (fp.history !== ref.history) diffs.push(`${arm}: history mismatch`);
    if (fp.lore !== ref.lore) diffs.push(`${arm}: lore mismatch`);
    if (fp.trigger !== ref.trigger) diffs.push(`${arm}: trigger mismatch`);
    if (fp.speech !== ref.speech) diffs.push(`${arm}: speech mismatch`);
    if (fp.agency !== ref.agency) diffs.push(`${arm}: agency mismatch`);
    if (fp.style !== ref.style) diffs.push(`${arm}: style mismatch`);
    if (fp.otherSystemSections !== ref.otherSystemSections) {
      diffs.push(`${arm}: other_system_sections mismatch`);
    }
    if (fp.composite !== ref.composite) diffs.push(`${arm}: composite mismatch`);
  }
  const sceneBlocks = new Set(SCENE_POLICY_ARM_IDS.map((a) => arms[a].sceneBlock));
  if (sceneBlocks.size === 1) {
    diffs.push("scene blocks identical across arms — benchmark invalid");
  }
  return { valid: diffs.length === 0, diffs };
}

export function runBenchmarkCase(fixture: ScenePolicyBenchmarkFixture): BenchmarkCaseResult {
  const arms = {
    v1: buildBenchmarkArmPayload({ fixture, arm: "v1" }),
    v2: buildBenchmarkArmPayload({ fixture, arm: "v2" }),
    living: buildBenchmarkArmPayload({ fixture, arm: "living" }),
  };
  const parity = verifyThreeArmParity(arms);
  return {
    caseId: fixture.id,
    family: fixture.family,
    kind: fixture.kind,
    arms,
    parityValid: parity.valid,
    parityDiffs: parity.diffs,
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

export function buildTrajectoryTurnFixture(input: {
  trajectory: ScenePolicyBenchmarkTrajectory;
  turn: ScenePolicyBenchmarkTrajectory["turns"][number];
  priorTurns: ScenePolicyBenchmarkTrajectory["turns"];
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
    model_id: String(input.payload.requestBody.model ?? BENCHMARK_DEFAULT_MODEL),
    provider: "cheaperinference",
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

function avgOutputTokensPerCall(targetChars: number): number {
  return Math.ceil(targetChars * 0.9);
}

export function computeExecutionMatrix(input?: {
  modelId?: string;
  targetResponseChars?: number;
}): BenchmarkExecutionMatrix {
  const modelId = input?.modelId ?? BENCHMARK_DEFAULT_MODEL;
  const targetResponseChars = input?.targetResponseChars ?? BENCHMARK_DEFAULT_TARGET_CHARS;
  const singleTurnCount = countSingleTurnFixtures();
  const pilotCount = listPilotFixtures().length;
  const trajectoryCount = RECONVERGENCE_TRAJECTORIES.length;
  const trajectoryTurnCount = RECONVERGENCE_TRAJECTORIES.reduce(
    (s, t) => s + t.turns.length,
    0
  );
  const avgIn = avgInputTokensPerCall(modelId);
  const avgOut = avgOutputTokensPerCall(targetResponseChars);

  const planDefs: Array<{ name: CallPlan["name"]; repeat: number; scope: string }> = [
    { name: "MINIMAL", repeat: 1, scope: "pilot" },
    { name: "BALANCED", repeat: 2, scope: "full_single_plus_recon" },
    { name: "HIGH-CONFIDENCE", repeat: 3, scope: "full_all" },
  ];

  const plans = planDefs.map(({ name, repeat, scope }) => {
    let singleTurnCalls = 0;
    let trajectoryCalls = 0;
    if (scope === "pilot") {
      singleTurnCalls = pilotCount * 3 * repeat;
      trajectoryCalls = 2 * 4 * repeat; // R1 + R5 approx
    } else if (scope === "full_single_plus_recon") {
      singleTurnCalls = singleTurnCount * 3 * repeat;
      trajectoryCalls = trajectoryTurnCount * 2 * repeat; // v1 + v2 only
    } else {
      singleTurnCalls = singleTurnCount * 3 * repeat;
      trajectoryCalls = trajectoryTurnCount * 2 * repeat;
    }
    const totalCalls = singleTurnCalls + trajectoryCalls;
    const estimatedInputTokens = totalCalls * avgIn;
    const estimatedOutputTokens = totalCalls * avgOut;
    const { usdCost } = openRouterUsdCostFromRates({
      modelId,
      promptTokens: estimatedInputTokens,
      outputTokens: estimatedOutputTokens,
    });
    return {
      name,
      repeat,
      singleTurnCalls,
      trajectoryCalls,
      totalCalls,
      estimatedInputTokens,
      estimatedOutputTokens,
      estimatedUpstreamUsd: Math.round(usdCost * 1000) / 1000,
      notes: [
        `scope=${scope}`,
        `avg_input_tokens_per_call=${avgIn} (pilot sample)`,
        `avg_output_tokens_per_call=${avgOut} (targetResponseChars=${targetResponseChars})`,
        "upstream cost via openRouterUsdCostFromRates — not user billing points",
      ],
    };
  });

  return {
    singleTurnFixtureCount: singleTurnCount,
    pilotFixtureCount: pilotCount,
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
  cacheBehavior: string;
  availability: string;
};

export function listModelCandidateFacts(): ModelCandidateFacts[] {
  return MAIN_RP_USER_SELECTABLE_OPTIONS.map((opt, idx) => {
    const rates = resolveOpenRouterModelRates(opt.id);
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
      cacheBehavior: rates.explicitCacheInjection
        ? `${rates.label} — explicit cache_control injection`
        : `${rates.label} — provider automatic prefix cache`,
      availability: "User-selectable in Main RP picker",
    };
  });
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
  PROVIDER_COST_OWNER: "openRouterModelPricing.openRouterUsdCostFromRates + billingRawCost",
  BILLING_PRICE_OWNER: "points.ts + billingDisplay (user-facing — benchmark must bypass)",
  BENCHMARK_FIXTURE_OWNER: "scenePolicyBenchmarkDataset.ts",
  MOCK_DRY_RUN_OWNER: "assemblePrimaryRpRequest (credential-free) + MOCK_MODE in openRouterAdult fetch path",
} as const;
