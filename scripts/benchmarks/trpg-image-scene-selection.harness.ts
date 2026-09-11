import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildTrpgIllustrationSituation } from "@/lib/chatLdIllustrationGeneration";
import {
  SCENE_PLAN_MAX_PROVIDER_ATTEMPTS,
  SCENE_PLAN_RETRY_COUNT,
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
  extractDeterministicEvents,
  type SceneEvent,
  type ScenePlan,
  type SceneSourceMessage,
} from "@/lib/chatImageScenePlan";
import {
  resolveChatImageSceneBriefFallbackModel,
  resolveChatImageSceneBriefModel,
} from "@/lib/chatImageSceneBrief";

export const BENCHMARK_DIR = join(process.cwd(), "docs/benchmarks/trpg-image-scene-selection");
export const FIXTURES_PATH = join(BENCHMARK_DIR, "fixtures.json");
export const RESULTS_PATH = join(BENCHMARK_DIR, "results.json");
export const REVIEW_PACKET_PATH = join(BENCHMARK_DIR, "REVIEW_PACKET.md");

export type TrpgBenchmarkAction = { name: string; body: string };

export type TrpgBenchmarkFixtureConstraints = {
  mustNotInventCharacter: string[];
  roundLocation: string;
  canonicalPartyNames: string[];
  canonicalActionNames: string[];
};

export type TrpgBenchmarkFixture = {
  fixtureId: string;
  category: string;
  fixtureProvenance: "REAL_DEV_CANONICAL" | "SYNTHETIC";
  roundNumber?: number;
  location: string;
  partyNames: string[];
  actions: TrpgBenchmarkAction[];
  narration: string;
  constraints: TrpgBenchmarkFixtureConstraints;
};

export type TrpgBenchmarkFixturesFile = {
  version: 1;
  fixtures: TrpgBenchmarkFixture[];
};

export type TrpgBenchmarkArmRaw = {
  situation: string;
  chars: number;
};

export type TrpgBenchmarkArmDeterministic = {
  events: SceneEvent[];
  heroEventIds: string[];
  heroScene: string;
  sceneBackground: string;
  atmosphere?: string;
  recommendedPanelCount: number;
  heroEventPositions: number[];
};

export type TrpgBenchmarkArmAi = {
  outcome:
    | "PRIMARY_MODEL_SUCCESS"
    | "SECONDARY_FALLBACK_SUCCESS"
    | "DETERMINISTIC_FALLBACK";
  resolvedPrimaryModel: string;
  resolvedFallbackModel: string | null;
  model: string;
  attempts: number;
  usedFallback: boolean;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  providerCostUsd: number | null;
  events: SceneEvent[];
  heroEventIds: string[];
  heroScene: string;
  sceneBackground: string;
  atmosphere?: string;
  recommendedPanelCount: number;
  panels: ScenePlan["panels"];
  heroEventPositions: number[];
};

export type TrpgBenchmarkObjective = {
  sourceEventCount: number;
  deterministicHeroCount: number;
  aiHeroCount: number;
  deterministicHeroPositions: number[];
  aiHeroPositions: number[];
  aiSelectedLastThird: boolean;
  aiModel: string;
  aiAttempts: number;
  aiUsedFallback: boolean;
  aiDeterministicFallback: boolean;
  aiLatencyMs: number;
  heroIdsValid: boolean;
  provenanceValid: boolean;
  inventedEvent: boolean;
  wrongRound: boolean;
  wrongLocation: boolean;
  rewritesPartyAction: boolean;
};

export type TrpgBenchmarkFixtureResult = {
  fixtureId: string;
  category: string;
  fixtureProvenance: "REAL_DEV_CANONICAL" | "SYNTHETIC";
  sourceSha256: string;
  source: {
    location: string;
    actions: TrpgBenchmarkAction[];
    narration: string;
  };
  currentRaw: TrpgBenchmarkArmRaw;
  deterministic: TrpgBenchmarkArmDeterministic;
  aiPlanner: TrpgBenchmarkArmAi | null;
  objective: TrpgBenchmarkObjective;
  review: { status: "GPT_SCORE_PENDING" };
};

export type TrpgBenchmarkResultsFile = {
  version: 1;
  baseMainSha: string;
  benchmarkHeadSha: string;
  nodeVersion: string;
  resolvedPrimaryModel: string;
  resolvedFallbackModel: string | null;
  scenePlanMaxProviderAttempts: number;
  scenePlanRetryCount: number;
  compatibility: {
    status: "PASS" | "FAIL" | "PENDING";
    probeFixtureIds: string[];
    checks: Record<string, boolean>;
  };
  invocationCounts: {
    planChatImageSceneInvocations: number;
    primarySuccessCount: number;
    secondaryFallbackSuccessCount: number;
    deterministicFallbackCount: number;
    paidImageGenerationCalls: number;
  };
  latenciesMs: number[];
  fixtures: TrpgBenchmarkFixtureResult[];
};

/** Single canonical TRPG-safe SceneSourceMessage adapter for the benchmark only. */
export function buildTrpgNarrationSceneMessages(narration: string): SceneSourceMessage[] {
  return buildSceneSourceMessages([{ id: 1, role: "assistant", content: narration }]);
}

export function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function loadFixtures(path = FIXTURES_PATH): TrpgBenchmarkFixturesFile {
  return JSON.parse(readFileSync(path, "utf8")) as TrpgBenchmarkFixturesFile;
}

export function runCurrentRawArm(fixture: TrpgBenchmarkFixture): TrpgBenchmarkArmRaw {
  const situation = buildTrpgIllustrationSituation({
    location: fixture.location,
    actions: fixture.actions,
    narration: fixture.narration,
  });
  return { situation, chars: situation.length };
}

export function runDeterministicArm(
  messages: readonly SceneSourceMessage[]
): TrpgBenchmarkArmDeterministic {
  const plan = buildDeterministicScenePlan(messages);
  return {
    events: plan.events,
    heroEventIds: plan.heroEventIds,
    heroScene: plan.heroScene,
    sceneBackground: plan.sceneBackground,
    atmosphere: plan.atmosphere,
    recommendedPanelCount: plan.recommendedPanelCount,
    heroEventPositions: heroEventPositions(plan.events, plan.heroEventIds),
  };
}

export function heroEventPositions(
  events: readonly SceneEvent[],
  heroEventIds: readonly string[]
): number[] {
  const visual = visualEvents(events);
  if (visual.length === 0) return heroEventIds.map(() => 0);
  return heroEventIds.map((id) => {
    const index = visual.findIndex((event) => event.id === id);
    if (index < 0) return 0;
    return (index + 1) / visual.length;
  });
}

function visualEvents(events: readonly SceneEvent[]): SceneEvent[] {
  return events.filter((event) => event.kind !== "assistant_echo");
}

export function classifyAiOutcome(opts: {
  model: string;
  usedFallback: boolean;
  resolvedPrimaryModel: string;
}): TrpgBenchmarkArmAi["outcome"] {
  if (opts.model === "deterministic-fallback") return "DETERMINISTIC_FALLBACK";
  if (opts.usedFallback) return "SECONDARY_FALLBACK_SUCCESS";
  return "PRIMARY_MODEL_SUCCESS";
}

export function buildAiArmFromPlan(opts: {
  plan: ScenePlan;
  model: string;
  usedFallback: boolean;
  attempts: number;
  latencyMs: number;
  resolvedPrimaryModel: string;
  resolvedFallbackModel: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  providerCostUsd?: number | null;
}): TrpgBenchmarkArmAi {
  return {
    outcome: classifyAiOutcome({
      model: opts.model,
      usedFallback: opts.usedFallback,
      resolvedPrimaryModel: opts.resolvedPrimaryModel,
    }),
    resolvedPrimaryModel: opts.resolvedPrimaryModel,
    resolvedFallbackModel: opts.resolvedFallbackModel,
    model: opts.model,
    attempts: opts.attempts,
    usedFallback: opts.usedFallback,
    latencyMs: opts.latencyMs,
    inputTokens: opts.inputTokens ?? null,
    outputTokens: opts.outputTokens ?? null,
    providerCostUsd: opts.providerCostUsd ?? null,
    events: opts.plan.events,
    heroEventIds: opts.plan.heroEventIds,
    heroScene: opts.plan.heroScene,
    sceneBackground: opts.plan.sceneBackground,
    atmosphere: opts.plan.atmosphere,
    recommendedPanelCount: opts.plan.recommendedPanelCount,
    panels: opts.plan.panels,
    heroEventPositions: heroEventPositions(opts.plan.events, opts.plan.heroEventIds),
  };
}

export function heroIdsExistInEvents(
  events: readonly SceneEvent[],
  heroEventIds: readonly string[]
): boolean {
  const ids = new Set(events.map((event) => event.id));
  return heroEventIds.every((id) => ids.has(id));
}

export function heroTextProvenanceValid(
  events: readonly SceneEvent[],
  heroEventIds: readonly string[],
  narration: string
): boolean {
  const normalizedNarration = normalizeForMatch(narration);
  for (const id of heroEventIds) {
    const event = events.find((entry) => entry.id === id);
    if (!event) return false;
    const normalizedEvent = normalizeForMatch(event.text);
    if (!normalizedEvent) return false;
    if (!normalizedNarration.includes(normalizedEvent)) {
      // Allow partial clause match for sanitized/truncated spans.
      const clause = normalizedEvent.slice(0, Math.min(24, normalizedEvent.length));
      if (clause.length >= 8 && normalizedNarration.includes(clause)) continue;
      return false;
    }
  }
  return true;
}

function normalizeForMatch(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function detectRewritesPartyAction(
  fixture: TrpgBenchmarkFixture,
  heroScene: string
): boolean {
  const hero = normalizeForMatch(heroScene);
  const narration = normalizeForMatch(fixture.narration);
  for (const action of fixture.actions) {
    const body = normalizeForMatch(action.body);
    if (!body || body.length < 12) continue;
    if (hero.includes(body) && !narration.includes(body)) {
      return true;
    }
  }
  return false;
}

export function detectWrongLocation(fixture: TrpgBenchmarkFixture, sceneBackground: string): boolean {
  const canonical = normalizeForMatch(fixture.constraints.roundLocation || fixture.location);
  const background = normalizeForMatch(sceneBackground);
  if (!background) return false;
  if (!canonical) return false;
  return !background.includes(canonical) && !canonical.includes(background);
}

export function detectInventedEvent(
  narrationMessages: readonly SceneSourceMessage[],
  planEvents: readonly SceneEvent[]
): boolean {
  const canonical = extractDeterministicEvents(narrationMessages);
  if (planEvents.length !== canonical.length) return true;
  for (let i = 0; i < canonical.length; i += 1) {
    const left = canonical[i];
    const right = planEvents[i];
    if (
      left.id !== right.id ||
      left.kind !== right.kind ||
      left.text !== right.text ||
      left.actor !== right.actor
    ) {
      return true;
    }
  }
  return false;
}

export function computeObjectiveMetrics(opts: {
  fixture: TrpgBenchmarkFixture;
  messages: SceneSourceMessage[];
  deterministic: TrpgBenchmarkArmDeterministic;
  ai: TrpgBenchmarkArmAi | null;
}): TrpgBenchmarkObjective {
  const ai = opts.ai;
  const aiHeroIdsValid = ai ? heroIdsExistInEvents(ai.events, ai.heroEventIds) : false;
  const aiProvenanceValid = ai
    ? heroTextProvenanceValid(ai.events, ai.heroEventIds, opts.fixture.narration)
    : false;
  const aiInvented = ai ? detectInventedEvent(opts.messages, ai.events) : false;
  const aiPositions = ai?.heroEventPositions ?? [];
  return {
    sourceEventCount: opts.deterministic.events.length,
    deterministicHeroCount: opts.deterministic.heroEventIds.length,
    aiHeroCount: ai?.heroEventIds.length ?? 0,
    deterministicHeroPositions: opts.deterministic.heroEventPositions,
    aiHeroPositions: aiPositions,
    aiSelectedLastThird: aiPositions.some((position) => position >= 2 / 3),
    aiModel: ai?.model ?? "",
    aiAttempts: ai?.attempts ?? 0,
    aiUsedFallback: ai?.usedFallback ?? false,
    aiDeterministicFallback: ai?.outcome === "DETERMINISTIC_FALLBACK",
    aiLatencyMs: ai?.latencyMs ?? 0,
    heroIdsValid: aiHeroIdsValid,
    provenanceValid: aiProvenanceValid,
    inventedEvent: aiInvented,
    wrongRound: false,
    wrongLocation: ai ? detectWrongLocation(opts.fixture, ai.sceneBackground) : false,
    rewritesPartyAction: ai ? detectRewritesPartyAction(opts.fixture, ai.heroScene) : false,
  };
}

export function buildFixtureResult(
  fixture: TrpgBenchmarkFixture,
  ai: TrpgBenchmarkArmAi | null
): TrpgBenchmarkFixtureResult {
  const source = {
    location: fixture.location,
    actions: fixture.actions,
    narration: fixture.narration,
  };
  const messages = buildTrpgNarrationSceneMessages(fixture.narration);
  const currentRaw = runCurrentRawArm(fixture);
  const deterministic = runDeterministicArm(messages);
  const objective = computeObjectiveMetrics({ fixture, messages, deterministic, ai });
  return {
    fixtureId: fixture.fixtureId,
    category: fixture.category,
    fixtureProvenance: fixture.fixtureProvenance,
    sourceSha256: sha256Canonical(source),
    source,
    currentRaw,
    deterministic,
    aiPlanner: ai,
    objective,
    review: { status: "GPT_SCORE_PENDING" },
  };
}

export function evaluateCompatibilityProbe(results: TrpgBenchmarkFixtureResult[]): {
  status: "PASS" | "FAIL";
  checks: Record<string, boolean>;
} {
  const checks: Record<string, boolean> = {
    AI_OUTPUT_VALIDATED_BY_EXISTING_VALIDATOR: results.every(
      (row) =>
        row.aiPlanner != null &&
        row.aiPlanner.outcome !== "DETERMINISTIC_FALLBACK" &&
        row.objective.heroIdsValid
    ),
    HERO_EVENT_IDS_EXIST_IN_CANONICAL_EVENTS: results.every((row) => row.objective.heroIdsValid),
    HERO_TEXT_PROVENANCE_FROM_ROUND_NARRATION: results.every((row) => row.objective.provenanceValid),
    NAMED_PARTY_ACTIONS_REWRITTEN_BY_PLANNER: !results.some(
      (row) => row.objective.rewritesPartyAction
    ),
    WRONG_ROUND_EVIDENCE: !results.some((row) => row.objective.wrongRound),
    INVENTED_EVENT: !results.some((row) => row.objective.inventedEvent),
  };
  const status = Object.values(checks).every(Boolean) ? "PASS" : "FAIL";
  return { status, checks };
}

export function summarizeInvocationCounts(
  fixtureResults: TrpgBenchmarkFixtureResult[],
  invocations: number
): TrpgBenchmarkResultsFile["invocationCounts"] {
  const aiRows = fixtureResults.map((row) => row.aiPlanner).filter((row): row is TrpgBenchmarkArmAi => !!row);
  return {
    planChatImageSceneInvocations: invocations,
    primarySuccessCount: aiRows.filter((row) => row.outcome === "PRIMARY_MODEL_SUCCESS").length,
    secondaryFallbackSuccessCount: aiRows.filter(
      (row) => row.outcome === "SECONDARY_FALLBACK_SUCCESS"
    ).length,
    deterministicFallbackCount: aiRows.filter((row) => row.outcome === "DETERMINISTIC_FALLBACK").length,
    paidImageGenerationCalls: 0,
  };
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index] ?? 0;
}

export function resolvedPlannerModels(): {
  primary: string;
  fallback: string | null;
} {
  const primary = resolveChatImageSceneBriefModel();
  const fallback = resolveChatImageSceneBriefFallbackModel(undefined, primary);
  return { primary, fallback };
}

export function plannerConstants(): {
  scenePlanMaxProviderAttempts: number;
  scenePlanRetryCount: number;
} {
  return {
    scenePlanMaxProviderAttempts: SCENE_PLAN_MAX_PROVIDER_ATTEMPTS,
    scenePlanRetryCount: SCENE_PLAN_RETRY_COUNT,
  };
}

export function renderReviewPacket(results: TrpgBenchmarkResultsFile): string {
  const blocks = results.fixtures.map((fixture) => {
    const ai = fixture.aiPlanner;
    const actions = fixture.source.actions
      .map((action) => `- ${action.name}: ${action.body}`)
      .join("\n");
    return [
      "================================================",
      `${fixture.fixtureId} — ${fixture.category}`,
      "================================================",
      `CATEGORY:\n${fixture.category}`,
      `CANONICAL LOCATION:\n${fixture.source.location}`,
      "ROUND ACTIONS:",
      actions || "(none)",
      "FULL GM NARRATION:",
      fixture.source.narration,
      "----------------",
      "ARM A — CURRENT_RAW",
      "----------------",
      fixture.currentRaw.situation,
      "----------------",
      "ARM B — DETERMINISTIC_FIRST",
      "----------------",
      "MODEL: deterministic",
      `HERO IDs:\n${fixture.deterministic.heroEventIds.join(", ") || "(none)"}`,
      `HERO:\n${fixture.deterministic.heroScene || "(empty)"}`,
      `BACKGROUND:\n${fixture.deterministic.sceneBackground || "(empty)"}`,
      `HERO POSITIONS:\n${fixture.deterministic.heroEventPositions.map((p) => p.toFixed(2)).join(", ") || "(none)"}`,
      "----------------",
      "ARM C — AI_PLANNER",
      "----------------",
      ai
        ? [
            `MODEL:\n${ai.model}`,
            `ATTEMPTS:\n${ai.attempts}`,
            `FALLBACK:\n${ai.usedFallback}`,
            `OUTCOME:\n${ai.outcome}`,
            `LATENCY_MS:\n${ai.latencyMs}`,
            `HERO IDs:\n${ai.heroEventIds.join(", ") || "(none)"}`,
            `HERO:\n${ai.heroScene || "(empty)"}`,
            `BACKGROUND:\n${ai.sceneBackground || "(empty)"}`,
            `ATMOSPHERE:\n${ai.atmosphere ?? "(empty)"}`,
          ].join("\n")
        : "AI planner not run.",
      "----------------",
      "OBJECTIVE FLAGS",
      "----------------",
      `PROVENANCE:\n${fixture.objective.provenanceValid}`,
      `INVENTED EVENT:\n${fixture.objective.inventedEvent}`,
      `WRONG ROUND:\n${fixture.objective.wrongRound}`,
      `WRONG LOCATION:\n${fixture.objective.wrongLocation}`,
      `ACTION REWRITE:\n${fixture.objective.rewritesPartyAction}`,
      `AI SELECTED LAST THIRD:\n${fixture.objective.aiSelectedLastThird}`,
      "----------------",
      "GPT SCORE",
      "----------------",
      "PENDING",
      "",
    ].join("\n");
  });
  return blocks.join("\n");
}
