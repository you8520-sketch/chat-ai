/**
 * Opt-in live DeepSeek ↔ JEV TRPG mechanics referee shadow benchmark.
 *
 * Both arms receive the same PRE-GM public input, convert to FlashActorEffect,
 * then pass through the SAME parseFlashOrEmpty + resolveRoundMechanics path.
 * Without triple opt-in for BOTH benchmark credentials: NOT_RUN, HTTP = 0.
 * Never mutates campaign DB. Never enables production referee flag.
 */
import { callJevDecisions } from "@/lib/jevDecisions";
import {
  buildMechanicsRefereeUserBlock,
  callTrpgMechanicsReferee,
  TRPG_MECHANICS_REFEREE_SYSTEM,
} from "@/lib/trpg/mechanicsReferee";
import {
  MECHANICS_REFEREE_BENCHMARK_CORPUS,
  type MechanicsRefereeBenchmarkFixture,
  type MechanicsRefereeExpected,
} from "@/lib/trpg/mechanicsRefereeBenchmarkCorpus";
import {
  assertMechanicsJevStateIsPreGmOnly,
  buildMechanicsRefereeJevQuestions,
  buildMechanicsRefereeJevState,
  jevAnswersToFlashActorEffect,
} from "@/lib/trpg/mechanicsRefereeJevPolicy";
import { classRank, TIER_HARM_CAP } from "@/lib/trpg/mechanicsDice";
import { parseFlashOrEmpty, resolveRoundMechanics } from "@/lib/trpg/mechanicsResolve";
import {
  isTrpgMechanicsRefereeEnabled,
  TRPG_MECHANICS_REFEREE_MODEL,
  V1_ONGOING_KINDS,
  type FlashActorEffect,
  type MechanicsClass,
  type MechanicsResolution,
} from "@/lib/trpg/mechanicsTypes";
import { JEV_DECISIONS_MODEL } from "@/lib/jevDecisions";
import {
  BENCHMARK_CHEAPER_INFERENCE_ENV,
  resolveOptInTestCheaperInferenceApiKey,
  sanitizeBenchmarkCredentialText,
} from "./benchmarkCheaperInferenceCredential";
import {
  OPENROUTER_JEV_BENCHMARK_ENV,
  REAL_JEV_TRPG_MECHANICS_PROBE_ENV,
  resolveOptInJevTrpgMechanicsBenchmarkApiKey,
  sanitizeJevBenchmarkCredentialText,
} from "./benchmarkOpenRouterJevCredential";

export const TRPG_MECHANICS_JEV_PROBE_FLAG = REAL_JEV_TRPG_MECHANICS_PROBE_ENV;

const CLASS_RANK: Record<MechanicsClass, number> = {
  NONE: 0,
  CHIP: 1,
  LIGHT: 2,
  MEDIUM: 3,
  HEAVY: 4,
  SEVERE: 5,
  CRITICAL: 6,
};

export type ArmLatencySummary = {
  p50: number | null;
  p95: number | null;
  max: number | null;
  count: number;
};

export type FixtureArmRawScore = {
  harmHit: boolean | null;
  safeFalseHarm: boolean | null;
  severityCorrect: boolean | null;
  causeCorrect: boolean | null;
  ongoingRecall: boolean | null;
  ongoingFalsePositive: boolean | null;
  allyTargetCorrect: boolean | null;
  treatmentCorrect: boolean | null;
  falseClear: boolean | null;
  partialOversevere: boolean | null;
  malformed: boolean;
};

export type FixtureArmAcceptedScore = {
  safetyEscapeCount: number;
  downgraded: boolean;
  rejected: boolean;
  requiredEffectLost: boolean;
  wrongTargetEscape: boolean;
  inventoryOwnershipEscape: boolean;
  invalidOngoingEscape: boolean;
  validation: MechanicsResolution["validation"] | null;
};

export type FixtureArmOutcome = {
  fixtureId: string;
  expected: MechanicsRefereeExpected;
  category: string;
  rawEffects: FlashActorEffect[];
  flashRaw: string | null;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  actualCostUsd: number | null;
  providerCallAttempted: boolean;
  retries: number;
  failure: string | null;
  malformed: boolean;
  raw: FixtureArmRawScore;
  accepted: FixtureArmAcceptedScore;
  model: string;
};

export type ArmAggregateMetrics = {
  arm: "deepseek" | "jev";
  model: string;
  provider: string;
  totalFixtures: number;
  providerCalls: number;
  retries: number;
  inputTokens: number;
  outputTokens: number;
  actualProviderCostUsd: number | null;
  latencyMs: ArmLatencySummary;
  malformedCount: number;
  timeoutCount: number;
  failureCount: number;
  raw: {
    harmRecall: number | null;
    safeFalseHarmRate: number | null;
    severityCorrectRate: number | null;
    causeCorrectRate: number | null;
    ongoingRecall: number | null;
    ongoingFalsePositiveRate: number | null;
    allyTargetCorrectRate: number | null;
    treatmentCorrectRate: number | null;
    falseClearRate: number | null;
    partialOversevereRate: number | null;
    malformedRate: number | null;
  };
  accepted: {
    safetyEscapeCount: number;
    downgradeCount: number;
    downgradeRate: number | null;
    rejectCount: number;
    rejectRate: number | null;
    requiredEffectLossCount: number;
    requiredEffectLossRate: number | null;
    wrongTargetEscapeCount: number;
    inventoryOwnershipEscapeCount: number;
    invalidOngoingEscapeCount: number;
  };
  outcomes: FixtureArmOutcome[];
};

export type LiveTrpgMechanicsBenchmarkResult =
  | { status: "NOT_RUN"; reason: string; providerCalls: 0 }
  | {
      status: "RAN";
      totalFixtures: number;
      deepseek: ArmAggregateMetrics;
      jev: ArmAggregateMetrics;
      agreementCount: number;
      agreementRate: number | null;
      disagreements: Array<{
        fixtureId: string;
        category: string;
        deepseekDirect: string;
        jevDirect: string;
      }>;
      totalProviderCalls: number;
      totalActualProviderCostUsd: number | null;
      productionRefereeEnabled: boolean;
    };

function summarizeLatency(values: number[]): ArmLatencySummary {
  if (values.length === 0) return { p50: null, p95: null, max: null, count: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) =>
    Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]! * 10) / 10;
  return {
    p50: at(0.5),
    p95: at(0.95),
    max: Math.round(sorted[sorted.length - 1]! * 10) / 10,
    count: values.length,
  };
}

function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
}

function sourceRows(effects: FlashActorEffect[], sourceId: number): FlashActorEffect[] {
  return effects.filter((row) => (row.sourceParticipantId ?? row.participantId) === sourceId);
}

function scoreRaw(fixture: MechanicsRefereeBenchmarkFixture, effects: FlashActorEffect[], malformed: boolean): FixtureArmRawScore {
  const rows = sourceRows(effects, fixture.actor.participantId);
  const exp = fixture.expected;
  const harmRows = rows.filter((r) => r.directEffect === "harm" && r.directClass !== "NONE");
  const ongoingAdds = rows.flatMap((r) => r.ongoingAdd ?? []);
  const clearIds = new Set(rows.flatMap((r) => r.ongoingRemoveIds ?? []));
  const reduceIds = new Set(rows.flatMap((r) => r.ongoingReduceIds ?? []));
  const primary = rows[0] ?? null;

  const harmHit = exp.expectHarm ? harmRows.length > 0 : null;
  const safeFalseHarm = exp.expectSafe ? harmRows.length > 0 || ongoingAdds.length > 0 : null;
  const severityCorrect =
    primary == null
      ? false
      : CLASS_RANK[primary.directClass] <= CLASS_RANK[exp.maxDirectClass] &&
        (exp.directEffect === "none"
          ? primary.directEffect === "none" || primary.directClass === "NONE"
          : primary.directEffect === exp.directEffect);
  const causeCorrect = primary != null && primary.cause === exp.cause;
  const ongoingRecall =
    exp.ongoingKind === "NONE" ? null : ongoingAdds.some((o) => o.kind === exp.ongoingKind);
  const ongoingFalsePositive =
    exp.forbidInventedOngoing === true || exp.ongoingKind === "NONE"
      ? ongoingAdds.length > 0 && exp.ongoingKind === "NONE"
        ? true
        : exp.forbidInventedOngoing === true
          ? ongoingAdds.length > 0
          : null
      : null;
  const allyTargetCorrect =
    exp.allyTarget == null ? null : rows.some((r) => r.targetParticipantId === exp.allyTarget);
  let treatmentCorrect: boolean | null = null;
  if (exp.treatment === "none") {
    treatmentCorrect =
      exp.treatmentEffectId != null
        ? !clearIds.has(exp.treatmentEffectId) && !reduceIds.has(exp.treatmentEffectId)
        : !rows.some((r) => (r.ongoingRemoveIds?.length ?? 0) > 0 || (r.ongoingReduceIds?.length ?? 0) > 0);
  } else if (exp.treatment === "heal") {
    treatmentCorrect = rows.some(
      (r) =>
        r.directEffect === "heal" &&
        (exp.allyTarget == null || r.targetParticipantId === exp.allyTarget) &&
        (!exp.treatmentItem || r.consumeItem === exp.treatmentItem)
    );
  } else if (exp.treatment === "remove") {
    treatmentCorrect = Boolean(
      exp.treatmentEffectId != null &&
        clearIds.has(exp.treatmentEffectId) &&
        (!exp.treatmentItem || rows.some((r) => r.consumeItem === exp.treatmentItem))
    );
  } else if (exp.treatment === "reduce") {
    treatmentCorrect = Boolean(
      exp.treatmentEffectId != null &&
        reduceIds.has(exp.treatmentEffectId) &&
        !clearIds.has(exp.treatmentEffectId)
    );
  }
  const falseClear =
    exp.treatment === "none" && exp.treatmentEffectId != null
      ? clearIds.has(exp.treatmentEffectId) || reduceIds.has(exp.treatmentEffectId)
      : null;
  const partialOversevere =
    exp.partial === true
      ? rows.some((r) => r.directEffect === "harm" && CLASS_RANK[r.directClass] > CLASS_RANK.MEDIUM) ||
        ongoingAdds.some(
          (o) =>
            CLASS_RANK[o.severity] > CLASS_RANK.MEDIUM ||
            o.durationBand === "LONG" ||
            o.durationBand === "PERSISTENT"
        )
      : null;

  return {
    harmHit,
    safeFalseHarm,
    severityCorrect,
    causeCorrect,
    ongoingRecall,
    ongoingFalsePositive,
    allyTargetCorrect,
    treatmentCorrect,
    falseClear,
    partialOversevere,
    malformed,
  };
}

function scoreAccepted(
  fixture: MechanicsRefereeBenchmarkFixture,
  rawEffects: FlashActorEffect[],
  resolution: MechanicsResolution | null
): FixtureArmAcceptedScore {
  if (!resolution) {
    return {
      safetyEscapeCount: 0,
      downgraded: false,
      rejected: true,
      requiredEffectLost: true,
      wrongTargetEscape: false,
      inventoryOwnershipEscape: false,
      invalidOngoingEscape: false,
      validation: null,
    };
  }
  const rows = sourceRows(rawEffects, fixture.actor.participantId);
  const serverActor = resolution.actors.find((a) => a.participantId === fixture.actor.participantId);
  const serverDirect = serverActor?.direct ?? null;
  const acceptedOngoing = resolution.ongoingAdds;
  const rawHarm = rows.filter((r) => r.directEffect === "harm" && r.directClass !== "NONE");
  const rawDirect = rawHarm[0] ?? rows.find((r) => r.directEffect !== "none") ?? rows[0] ?? null;
  const rawOngoing = rows.flatMap((r) => r.ongoingAdd ?? []);

  const directDowngraded = Boolean(
    rawDirect &&
      (rawDirect.directEffect !== (serverDirect?.effect ?? "none") ||
        rawDirect.directClass !== (serverDirect?.class ?? "NONE"))
  );
  const ongoingDowngraded = rawOngoing.length > acceptedOngoing.length;
  const treatmentDowngraded = rows.some((row) => {
    const removeRejected = (row.ongoingRemoveIds ?? []).some((id) => !resolution.ongoingClearedIds.includes(id));
    const reduceRejected = (row.ongoingReduceIds ?? []).some((id) => {
      const update = resolution.ongoingUpdates.find((item) => item.id === id);
      return !update && !resolution.ongoingClearedIds.includes(id);
    });
    return removeRejected || reduceRejected;
  });
  const downgraded = directDowngraded || ongoingDowngraded || treatmentDowngraded;
  const rejected =
    resolution.validation !== "ok" || Boolean(serverDirect?.rejected) || ongoingDowngraded || treatmentDowngraded;

  const safety: string[] = [];
  const tierCap = TIER_HARM_CAP[fixture.actor.tier ?? "FAILURE"];
  if (serverDirect?.effect === "harm" && classRank(serverDirect.class) > classRank(tierCap)) {
    safety.push("tier_cap_escape");
  }
  if (
    (fixture.actor.tier === "FAILURE" ||
      fixture.actor.tier === "SEVERE_FAILURE" ||
      fixture.actor.tier === "CRITICAL_FAILURE") &&
    serverDirect?.effect === "heal"
  ) {
    safety.push("failure_heal_escape");
  }
  if (fixture.expected.expectSafe && (serverDirect?.effect === "harm" || acceptedOngoing.length > 0)) {
    safety.push("safe_negative_effect_escape");
  }
  if (acceptedOngoing.some((row) => !(V1_ONGOING_KINDS as readonly string[]).includes(row.kind))) {
    safety.push("invalid_kind_escape");
  }
  if (resolution.consumeItems.length > 1) safety.push("multiple_item_consumes");
  if (resolution.ongoingClearedIds.length > 1) safety.push("multiple_treatment_targets");

  let inventoryOwnershipEscape = false;
  for (const consume of resolution.consumeItems) {
    const owner = fixture.sheets.find((row) => row.participantId === consume.participantId);
    if (!owner?.inventory.includes(consume.item)) {
      inventoryOwnershipEscape = true;
      safety.push("item_ownership_escape");
    }
  }

  let wrongTargetEscape = false;
  if (fixture.expected.allyTarget != null && serverDirect) {
    if (serverDirect.targetParticipantId !== fixture.expected.allyTarget && serverDirect.effect !== "none") {
      wrongTargetEscape = true;
      safety.push("wrong_target_escape");
    }
  }

  const invalidOngoingEscape = acceptedOngoing.some(
    (row) => !(V1_ONGOING_KINDS as readonly string[]).includes(row.kind)
  );

  const requiredEffectLost =
    (fixture.expected.expectHarm && !(serverDirect?.effect === "harm")) ||
    (fixture.expected.treatment === "remove" &&
      fixture.expected.treatmentEffectId != null &&
      !resolution.ongoingClearedIds.includes(fixture.expected.treatmentEffectId)) ||
    (fixture.expected.treatment === "heal" && serverDirect?.effect !== "heal");

  return {
    safetyEscapeCount: safety.length,
    downgraded,
    rejected,
    requiredEffectLost,
    wrongTargetEscape,
    inventoryOwnershipEscape,
    invalidOngoingEscape,
    validation: resolution.validation,
  };
}

function runThroughSameValidator(
  fixture: MechanicsRefereeBenchmarkFixture,
  index: number,
  flash: { effects: FlashActorEffect[] },
  flashRaw: string | null,
  model: string,
  latencyMs: number
): MechanicsResolution {
  return resolveRoundMechanics({
    campaignId: 1,
    roundId: index + 1,
    roundNumber: 6,
    sheets: fixture.sheets,
    effects: fixture.effects,
    actors: [fixture.actor],
    flash,
    flashRaw,
    fallback: "none",
    calledFlash: true,
    model,
    latencyMs,
    baseDc: 12,
    specialRules: fixture.specialRules ?? "",
    scene: fixture.previousScene,
    rng: () => 3,
    recoveryRng: () => 1,
  });
}

function aggregateArm(
  arm: "deepseek" | "jev",
  model: string,
  provider: string,
  outcomes: FixtureArmOutcome[]
): ArmAggregateMetrics {
  const latencies = outcomes.filter((o) => o.providerCallAttempted).map((o) => o.latencyMs);
  const costs = outcomes.map((o) => o.actualCostUsd).filter((c): c is number => c != null);
  const boolRate = (pick: (o: FixtureArmOutcome) => boolean | null) => {
    const rows = outcomes.map(pick).filter((v): v is boolean => v != null);
    return rate(rows.filter(Boolean).length, rows.length);
  };
  return {
    arm,
    model,
    provider,
    totalFixtures: outcomes.length,
    providerCalls: outcomes.filter((o) => o.providerCallAttempted).length,
    retries: outcomes.reduce((s, o) => s + o.retries, 0),
    inputTokens: outcomes.reduce((s, o) => s + o.inputTokens, 0),
    outputTokens: outcomes.reduce((s, o) => s + o.outputTokens, 0),
    actualProviderCostUsd: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
    latencyMs: summarizeLatency(latencies),
    malformedCount: outcomes.filter((o) => o.malformed).length,
    timeoutCount: outcomes.filter((o) => /timeout|aborted/i.test(o.failure ?? "")).length,
    failureCount: outcomes.filter((o) => o.failure != null).length,
    raw: {
      harmRecall: boolRate((o) => o.raw.harmHit),
      safeFalseHarmRate: boolRate((o) => o.raw.safeFalseHarm),
      severityCorrectRate: boolRate((o) => o.raw.severityCorrect),
      causeCorrectRate: boolRate((o) => o.raw.causeCorrect),
      ongoingRecall: boolRate((o) => o.raw.ongoingRecall),
      ongoingFalsePositiveRate: boolRate((o) => o.raw.ongoingFalsePositive),
      allyTargetCorrectRate: boolRate((o) => o.raw.allyTargetCorrect),
      treatmentCorrectRate: boolRate((o) => o.raw.treatmentCorrect),
      falseClearRate: boolRate((o) => o.raw.falseClear),
      partialOversevereRate: boolRate((o) => o.raw.partialOversevere),
      malformedRate: rate(outcomes.filter((o) => o.malformed).length, outcomes.length),
    },
    accepted: {
      safetyEscapeCount: outcomes.reduce((s, o) => s + o.accepted.safetyEscapeCount, 0),
      downgradeCount: outcomes.filter((o) => o.accepted.downgraded).length,
      downgradeRate: rate(outcomes.filter((o) => o.accepted.downgraded).length, outcomes.length),
      rejectCount: outcomes.filter((o) => o.accepted.rejected).length,
      rejectRate: rate(outcomes.filter((o) => o.accepted.rejected).length, outcomes.length),
      requiredEffectLossCount: outcomes.filter((o) => o.accepted.requiredEffectLost).length,
      requiredEffectLossRate: rate(
        outcomes.filter((o) => o.accepted.requiredEffectLost).length,
        outcomes.length
      ),
      wrongTargetEscapeCount: outcomes.filter((o) => o.accepted.wrongTargetEscape).length,
      inventoryOwnershipEscapeCount: outcomes.filter((o) => o.accepted.inventoryOwnershipEscape).length,
      invalidOngoingEscapeCount: outcomes.filter((o) => o.accepted.invalidOngoingEscape).length,
    },
    outcomes,
  };
}

async function runDeepSeekArm(
  apiKey: string,
  fixtures: readonly MechanicsRefereeBenchmarkFixture[]
): Promise<FixtureArmOutcome[]> {
  const out: FixtureArmOutcome[] = [];
  for (let i = 0; i < fixtures.length; i++) {
    const fixture = fixtures[i]!;
    const user = buildMechanicsRefereeUserBlock({
      scene: fixture.previousScene,
      resolutionOrder: `[RESOLUTION ORDER]\n1. ${fixture.actor.name}`,
      actors: [fixture.actor],
      sheets: fixture.sheets,
      effects: fixture.effects,
      specialRules: fixture.specialRules ?? "",
    });
    const started = performance.now();
    try {
      const call = await callTrpgMechanicsReferee({
        system: TRPG_MECHANICS_REFEREE_SYSTEM,
        user,
        cheaperInferenceApiKeyOverride: apiKey,
      });
      const parsed = parseFlashOrEmpty(call.text);
      const resolution = runThroughSameValidator(
        fixture,
        i,
        parsed,
        call.text,
        call.model,
        call.latencyMs
      );
      const malformed = parsed.effects.length === 0 && call.text.trim() !== "" && !/"effects"\s*:\s*\[/.test(call.text);
      out.push({
        fixtureId: fixture.id,
        expected: fixture.expected,
        category: fixture.category,
        rawEffects: parsed.effects,
        flashRaw: call.text,
        latencyMs: call.latencyMs || performance.now() - started,
        inputTokens: call.usage.inputTokens,
        outputTokens: call.usage.outputTokens,
        actualCostUsd: call.usage.upstreamCostUsd,
        providerCallAttempted: true,
        retries: 0,
        failure: null,
        malformed,
        raw: scoreRaw(fixture, parsed.effects, malformed),
        accepted: scoreAccepted(fixture, parsed.effects, resolution),
        model: call.model,
      });
    } catch (e) {
      const msg = sanitizeBenchmarkCredentialText((e as Error).message).slice(0, 240);
      out.push({
        fixtureId: fixture.id,
        expected: fixture.expected,
        category: fixture.category,
        rawEffects: [],
        flashRaw: null,
        latencyMs: performance.now() - started,
        inputTokens: 0,
        outputTokens: 0,
        actualCostUsd: null,
        providerCallAttempted: true,
        retries: 0,
        failure: msg,
        malformed: true,
        raw: scoreRaw(fixture, [], true),
        accepted: scoreAccepted(fixture, [], null),
        model: TRPG_MECHANICS_REFEREE_MODEL,
      });
    }
  }
  return out;
}

async function runJevArm(
  apiKey: string,
  fixtures: readonly MechanicsRefereeBenchmarkFixture[]
): Promise<FixtureArmOutcome[]> {
  const out: FixtureArmOutcome[] = [];
  for (let i = 0; i < fixtures.length; i++) {
    const fixture = fixtures[i]!;
    const state = buildMechanicsRefereeJevState(fixture);
    const leak = assertMechanicsJevStateIsPreGmOnly(state);
    const questions = buildMechanicsRefereeJevQuestions(fixture);
    const started = performance.now();
    try {
      if (leak.length) {
        throw new Error(`jev_state_invariant_violation:${leak.join(",")}`);
      }
      const result = await callJevDecisions({
        state,
        questions,
        apiKey,
        ledger: null,
        timeoutMs: 60_000,
      });
      const effect = jevAnswersToFlashActorEffect({ fixture, answers: result.answers });
      const flashEffects = effect ? [effect] : [];
      const malformed = effect == null;
      const flashRaw = JSON.stringify({ effects: flashEffects });
      const parsed = parseFlashOrEmpty(flashRaw);
      const resolution = runThroughSameValidator(
        fixture,
        i,
        parsed,
        flashRaw,
        result.responseModel || JEV_DECISIONS_MODEL,
        performance.now() - started
      );
      out.push({
        fixtureId: fixture.id,
        expected: fixture.expected,
        category: fixture.category,
        rawEffects: parsed.effects,
        flashRaw,
        latencyMs: performance.now() - started,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        actualCostUsd: result.usage.upstreamCostUsd ?? null,
        providerCallAttempted: true,
        retries: 0,
        failure: malformed ? "jev_malformed_or_unmappable" : null,
        malformed,
        raw: scoreRaw(fixture, parsed.effects, malformed),
        accepted: scoreAccepted(fixture, parsed.effects, resolution),
        model: result.responseModel || JEV_DECISIONS_MODEL,
      });
    } catch (e) {
      const msg = sanitizeJevBenchmarkCredentialText((e as Error).message).slice(0, 240);
      out.push({
        fixtureId: fixture.id,
        expected: fixture.expected,
        category: fixture.category,
        rawEffects: [],
        flashRaw: null,
        latencyMs: performance.now() - started,
        inputTokens: 0,
        outputTokens: 0,
        actualCostUsd: null,
        providerCallAttempted: true,
        retries: 0,
        failure: msg,
        malformed: true,
        raw: scoreRaw(fixture, [], true),
        accepted: scoreAccepted(fixture, [], null),
        model: JEV_DECISIONS_MODEL,
      });
    }
  }
  return out;
}

export function resolveTrpgMechanicsBenchmarkCredentials(env: NodeJS.ProcessEnv = process.env): {
  deepseekKey: string | null;
  jevKey: string | null;
} {
  return {
    deepseekKey: resolveOptInTestCheaperInferenceApiKey(TRPG_MECHANICS_JEV_PROBE_FLAG, env),
    jevKey: resolveOptInJevTrpgMechanicsBenchmarkApiKey(env),
  };
}

export async function runTrpgMechanicsJevBenchmark(opts: {
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
  fixtures?: readonly MechanicsRefereeBenchmarkFixture[];
} = {}): Promise<LiveTrpgMechanicsBenchmarkResult> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const env = opts.env ?? process.env;
  const { deepseekKey, jevKey } = resolveTrpgMechanicsBenchmarkCredentials(env);

  if (!deepseekKey || !jevKey) {
    const missing: string[] = [];
    if (env.REGULAR_TEST_REAL_PROVIDER_CALLS !== "1") missing.push("REGULAR_TEST_REAL_PROVIDER_CALLS=1");
    if (env[TRPG_MECHANICS_JEV_PROBE_FLAG] !== "1") missing.push(`${TRPG_MECHANICS_JEV_PROBE_FLAG}=1`);
    if (!env[BENCHMARK_CHEAPER_INFERENCE_ENV]?.trim()) missing.push(BENCHMARK_CHEAPER_INFERENCE_ENV);
    if (!env[OPENROUTER_JEV_BENCHMARK_ENV]?.trim()) missing.push(OPENROUTER_JEV_BENCHMARK_ENV);
    const reason = `triple opt-in absent (${missing.join(", ") || "benchmark credentials"})`;
    log(`NOT_RUN — ${reason}`);
    log("provider calls=0");
    return { status: "NOT_RUN", reason, providerCalls: 0 };
  }

  const fixtures = opts.fixtures ?? MECHANICS_REFEREE_BENCHMARK_CORPUS;
  const deepseekOutcomes = await runDeepSeekArm(deepseekKey, fixtures);
  const jevOutcomes = await runJevArm(jevKey, fixtures);
  const deepseek = aggregateArm("deepseek", TRPG_MECHANICS_REFEREE_MODEL, "cheaperinference", deepseekOutcomes);
  const jev = aggregateArm("jev", JEV_DECISIONS_MODEL, "openrouter-decisions", jevOutcomes);

  const disagreements: Array<{
    fixtureId: string;
    category: string;
    deepseekDirect: string;
    jevDirect: string;
  }> = [];
  let agreementCount = 0;
  for (const fixture of fixtures) {
    const d = deepseekOutcomes.find((o) => o.fixtureId === fixture.id)!;
    const j = jevOutcomes.find((o) => o.fixtureId === fixture.id)!;
    const dKey = `${d.rawEffects[0]?.directEffect ?? "none"}:${d.rawEffects[0]?.directClass ?? "NONE"}:${d.rawEffects[0]?.cause ?? "none"}`;
    const jKey = `${j.rawEffects[0]?.directEffect ?? "none"}:${j.rawEffects[0]?.directClass ?? "NONE"}:${j.rawEffects[0]?.cause ?? "none"}`;
    if (dKey === jKey && !d.malformed && !j.malformed) {
      agreementCount += 1;
    } else {
      disagreements.push({
        fixtureId: fixture.id,
        category: fixture.category,
        deepseekDirect: dKey,
        jevDirect: jKey,
      });
    }
  }

  const costs = [deepseek.actualProviderCostUsd, jev.actualProviderCostUsd].filter(
    (c): c is number => c != null
  );
  const result: LiveTrpgMechanicsBenchmarkResult = {
    status: "RAN",
    totalFixtures: fixtures.length,
    deepseek,
    jev,
    agreementCount,
    agreementRate: rate(agreementCount, fixtures.length),
    disagreements,
    totalProviderCalls: deepseek.providerCalls + jev.providerCalls,
    totalActualProviderCostUsd: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
    productionRefereeEnabled: isTrpgMechanicsRefereeEnabled(env),
  };
  log(JSON.stringify(result));
  return result;
}
