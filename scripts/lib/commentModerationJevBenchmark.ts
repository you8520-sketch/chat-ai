/**
 * Opt-in live Gemini ↔ JEV comment-moderation shadow benchmark.
 *
 * Compares the current production Gemini moderation owner against TypeSafe Jev
 * Decisions on a synthetic labeled corpus. Never mutates comments, strikes,
 * bans, or report state. Without triple opt-in: NOT_RUN, HTTP = 0.
 */
import { moderateCommentWithAi } from "@/lib/commentModeration";
import {
  COMMENT_MODERATION_BENCHMARK_CORPUS,
  resolveFixtureNormalized,
  type CommentModerationBenchmarkFixture,
} from "@/lib/commentModerationBenchmarkCorpus";
import {
  COMMENT_SEMANTIC_JEV_QUESTION_ID,
  buildCommentSemanticJevQuestions,
  buildCommentSemanticJevState,
  type CommentSemanticVerdict,
} from "@/lib/commentSemanticModerationPolicy";
import { callJevDecisions, type JevDecisionChoiceAnswer } from "@/lib/jevDecisions";
import {
  resolveOptInJevModerationBenchmarkApiKey,
  sanitizeJevModerationBenchmarkCredentialText,
} from "./benchmarkOpenRouterJevCredential";

export type ArmLatencySummary = {
  p50: number | null;
  p95: number | null;
  max: number | null;
  count: number;
};

export type FixtureArmOutcome = {
  fixtureId: string;
  expected: CommentSemanticVerdict;
  category: string;
  clarity: CommentModerationBenchmarkFixture["clarity"];
  verdict: CommentSemanticVerdict | null;
  responseSource: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  actualCostUsd: number | null;
  failure: string | null;
  /** True only for fixtures representing the real production semantic-moderation entry condition. */
  productionTriggered: boolean;
  /** Whether this outcome corresponds to an attempted provider request. */
  providerCallAttempted: boolean;
  /** JEV-only diagnostics */
  confidence?: number | null;
  probabilities?: Record<string, number> | null;
};

export type ArmMetrics = {
  arm: "gemini" | "jev";
  totalFixtures: number;
  /** Primary scope: current production semantic-moderation path (synthetic matchedWords non-empty). */
  primaryFixtures: number;
  /** Exploratory policy probes that current production would not send to the semantic model. */
  policyProbeFixtures: number;
  /** Actual model responses in the primary scope (fallback BLOCK is not a model response). */
  modelResponseCount: number;
  modelResponseCoverage: number | null;
  /** Effective runtime outcome including Gemini fail-closed BLOCK fallbacks. */
  effectiveOutcomeAccuracy: number | null;
  /** Model-only accuracy on exploratory policy probes; never used as the primary comparison. */
  policyProbeAccuracy: number | null;
  /** Strict primary semantic accuracy: actual model-correct / all primary fixtures. Failures count as misses. */
  overallAccuracy: number | null;
  blockRecall: number | null;
  allowRecall: number | null;
  falseBlockCount: number;
  falseBlockRate: number | null;
  falseAllowCount: number;
  falseAllowRate: number | null;
  clearCaseAccuracy: number | null;
  boundaryCaseAccuracy: number | null;
  malformedResponseCount: number;
  timeoutCount: number;
  failureCount: number;
  latencyMs: ArmLatencySummary;
  inputTokens: number;
  outputTokens: number;
  actualProviderCostUsd: number | null;
  providerCalls: number;
  outcomes: FixtureArmOutcome[];
};

export type DisagreementRow = {
  fixtureId: string;
  expected: CommentSemanticVerdict;
  category: string;
  geminiVerdict: CommentSemanticVerdict | null;
  geminiSource: string;
  jevVerdict: CommentSemanticVerdict | null;
  jevConfidence: number | null;
  jevProbabilities: Record<string, number> | null;
};

export type LiveCommentModerationBenchmarkResult =
  | { status: "NOT_RUN"; reason: string; providerCalls: 0 }
  | {
      status: "RAN";
      totalFixtures: number;
      gemini: ArmMetrics;
      jev: ArmMetrics;
      agreementCount: number;
      agreementRate: number | null;
      disagreements: DisagreementRow[];
      totalProviderCalls: number;
      totalActualProviderCostUsd: number | null;
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

export function buildCommentModerationArmMetrics(
  arm: "gemini" | "jev",
  outcomes: FixtureArmOutcome[]
): ArmMetrics {
  // Primary comparison must reflect the real current owner: submitProfileComment
  // calls semantic moderation only after a banned-word match with AI-check enabled.
  // In this synthetic corpus, non-empty matchedWords marks that entry condition;
  // empty-match cases remain useful policy probes but cannot drive the winner.
  const primary = outcomes.filter((o) => o.productionTriggered);
  const policyProbe = outcomes.filter((o) => !o.productionTriggered);
  const modelPrimary = primary.filter((o) => o.responseSource === "model");

  const expectedBlock = primary.filter((o) => o.expected === "BLOCK");
  const expectedAllow = primary.filter((o) => o.expected === "ALLOW");
  const trueBlock = primary.filter(
    (o) => o.responseSource === "model" && o.expected === "BLOCK" && o.verdict === "BLOCK"
  ).length;
  const trueAllow = primary.filter(
    (o) => o.responseSource === "model" && o.expected === "ALLOW" && o.verdict === "ALLOW"
  ).length;
  // False-action rates remain end-to-end: a Gemini fail-closed BLOCK is a real
  // user-visible false block on an ALLOW case, even though it is never credited
  // as semantic model accuracy.
  const falseBlock = primary.filter((o) => o.expected === "ALLOW" && o.verdict === "BLOCK").length;
  const falseAllow = primary.filter((o) => o.expected === "BLOCK" && o.verdict === "ALLOW").length;
  const clear = primary.filter((o) => o.clarity === "clear");
  const boundary = primary.filter((o) => o.clarity === "boundary");
  const clearCorrect = clear.filter(
    (o) => o.responseSource === "model" && o.verdict === o.expected
  ).length;
  const boundaryCorrect = boundary.filter(
    (o) => o.responseSource === "model" && o.verdict === o.expected
  ).length;
  const latencies = outcomes.filter((o) => o.providerCallAttempted).map((o) => o.latencyMs);
  const costs = outcomes.map((o) => o.actualCostUsd).filter((c): c is number => c != null);
  const malformed = outcomes.filter(
    (o) => o.responseSource === "parse_fail_block" || o.responseSource === "jev_malformed"
  ).length;
  const timeouts = outcomes.filter((o) => /timeout|aborted/i.test(o.failure ?? "")).length;
  const failures = outcomes.filter((o) => o.failure != null || o.verdict == null).length;

  return {
    arm,
    totalFixtures: outcomes.length,
    primaryFixtures: primary.length,
    policyProbeFixtures: policyProbe.length,
    modelResponseCount: modelPrimary.length,
    modelResponseCoverage: rate(modelPrimary.length, primary.length),
    effectiveOutcomeAccuracy: rate(
      primary.filter((o) => o.verdict === o.expected).length,
      primary.length
    ),
    policyProbeAccuracy: rate(
      policyProbe.filter((o) => o.responseSource === "model" && o.verdict === o.expected).length,
      policyProbe.length
    ),
    overallAccuracy: rate(
      modelPrimary.filter((o) => o.verdict === o.expected).length,
      primary.length
    ),
    blockRecall: rate(trueBlock, expectedBlock.length),
    allowRecall: rate(trueAllow, expectedAllow.length),
    falseBlockCount: falseBlock,
    falseBlockRate: rate(falseBlock, expectedAllow.length),
    falseAllowCount: falseAllow,
    falseAllowRate: rate(falseAllow, expectedBlock.length),
    clearCaseAccuracy: rate(clearCorrect, clear.length),
    boundaryCaseAccuracy: rate(boundaryCorrect, boundary.length),
    malformedResponseCount: malformed,
    timeoutCount: timeouts,
    failureCount: failures,
    latencyMs: summarizeLatency(latencies),
    inputTokens: outcomes.reduce((s, o) => s + o.inputTokens, 0),
    outputTokens: outcomes.reduce((s, o) => s + o.outputTokens, 0),
    actualProviderCostUsd: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
    providerCalls: outcomes.filter((o) => o.providerCallAttempted).length,
    outcomes,
  };
}
function fixtureInput(fixture: CommentModerationBenchmarkFixture) {
  return {
    content: fixture.content,
    normalized: resolveFixtureNormalized(fixture),
    matchedWords: [...fixture.matchedWords],
    trigger: fixture.trigger,
  };
}

async function runGeminiArm(
  apiKey: string,
  fixtures: readonly CommentModerationBenchmarkFixture[]
): Promise<FixtureArmOutcome[]> {
  const out: FixtureArmOutcome[] = [];
  for (const fixture of fixtures) {
    const started = performance.now();
    try {
      const result = await moderateCommentWithAi({
        ...fixtureInput(fixture),
        openRouterApiKey: apiKey,
        persistBackgroundLedger: false,
      });
      out.push({
        fixtureId: fixture.id,
        expected: fixture.expected,
        category: fixture.category,
        clarity: fixture.clarity,
        productionTriggered: fixture.matchedWords.length > 0,
        providerCallAttempted: result.responseSource !== "dev_skip",
        verdict: result.verdict,
        responseSource: result.responseSource,
        latencyMs: performance.now() - started,
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
        actualCostUsd: result.usage?.upstreamCostUsd ?? null,
        failure:
          result.responseSource === "transport_fail_block" || result.responseSource === "parse_fail_block"
            ? result.reason
            : null,
      });
    } catch (e) {
      out.push({
        fixtureId: fixture.id,
        expected: fixture.expected,
        category: fixture.category,
        clarity: fixture.clarity,
        productionTriggered: fixture.matchedWords.length > 0,
        providerCallAttempted: true,
        verdict: null,
        responseSource: "transport_fail_block",
        latencyMs: performance.now() - started,
        inputTokens: 0,
        outputTokens: 0,
        actualCostUsd: null,
        failure: sanitizeJevModerationBenchmarkCredentialText((e as Error).message).slice(0, 240),
      });
    }
  }
  return out;
}

async function runJevArm(
  apiKey: string,
  fixtures: readonly CommentModerationBenchmarkFixture[]
): Promise<FixtureArmOutcome[]> {
  const questions = buildCommentSemanticJevQuestions();
  const out: FixtureArmOutcome[] = [];
  for (const fixture of fixtures) {
    const started = performance.now();
    const state = buildCommentSemanticJevState(fixtureInput(fixture));
    try {
      const result = await callJevDecisions({
        state,
        questions,
        apiKey,
        ledger: null,
        timeoutMs: 60_000,
      });
      const answer = result.answers[COMMENT_SEMANTIC_JEV_QUESTION_ID];
      if (!answer || answer.type !== "choice") {
        out.push({
          fixtureId: fixture.id,
          expected: fixture.expected,
          category: fixture.category,
          clarity: fixture.clarity,
          productionTriggered: fixture.matchedWords.length > 0,
          providerCallAttempted: true,
          verdict: null,
          responseSource: "jev_malformed",
          latencyMs: performance.now() - started,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          actualCostUsd: result.usage.upstreamCostUsd ?? null,
          failure: "missing or non-choice moderation_verdict answer",
          confidence: null,
          probabilities: null,
        });
        continue;
      }
      const choice = answer as JevDecisionChoiceAnswer;
      const verdict =
        choice.choice === "ALLOW" || choice.choice === "BLOCK"
          ? (choice.choice as CommentSemanticVerdict)
          : null;
      out.push({
        fixtureId: fixture.id,
        expected: fixture.expected,
        category: fixture.category,
        clarity: fixture.clarity,
        productionTriggered: fixture.matchedWords.length > 0,
        providerCallAttempted: true,
        verdict,
        responseSource: verdict ? "model" : "jev_malformed",
        latencyMs: performance.now() - started,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        actualCostUsd: result.usage.upstreamCostUsd ?? null,
        failure: verdict ? null : `unexpected choice ${JSON.stringify(choice.choice)}`,
        confidence: choice.confidence,
        probabilities: choice.probabilities,
      });
    } catch (e) {
      out.push({
        fixtureId: fixture.id,
        expected: fixture.expected,
        category: fixture.category,
        clarity: fixture.clarity,
        productionTriggered: fixture.matchedWords.length > 0,
        providerCallAttempted: true,
        verdict: null,
        responseSource: "transport_fail_block",
        latencyMs: performance.now() - started,
        inputTokens: 0,
        outputTokens: 0,
        actualCostUsd: null,
        failure: sanitizeJevModerationBenchmarkCredentialText((e as Error).message).slice(0, 240),
        confidence: null,
        probabilities: null,
      });
    }
  }
  return out;
}

export async function runCommentModerationJevBenchmark(opts: {
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
  fixtures?: readonly CommentModerationBenchmarkFixture[];
} = {}): Promise<LiveCommentModerationBenchmarkResult> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const apiKey = resolveOptInJevModerationBenchmarkApiKey(opts.env ?? process.env);
  if (!apiKey) {
    const reason =
      "triple opt-in absent (REGULAR_TEST_REAL_PROVIDER_CALLS=1, REAL_JEV_MODERATION_PROBE=1, OPENROUTER_JEV_BENCHMARK_API_KEY)";
    log(`NOT_RUN — ${reason}`);
    log("provider calls=0");
    return { status: "NOT_RUN", reason, providerCalls: 0 };
  }

  const fixtures = opts.fixtures ?? COMMENT_MODERATION_BENCHMARK_CORPUS;
  const geminiOutcomes = await runGeminiArm(apiKey, fixtures);
  const jevOutcomes = await runJevArm(apiKey, fixtures);
  const gemini = buildCommentModerationArmMetrics("gemini", geminiOutcomes);
  const jev = buildCommentModerationArmMetrics("jev", jevOutcomes);

  const disagreements: DisagreementRow[] = [];
  let agreementCount = 0;
  for (const fixture of fixtures) {
    const g = geminiOutcomes.find((o) => o.fixtureId === fixture.id)!;
    const j = jevOutcomes.find((o) => o.fixtureId === fixture.id)!;
    if (g.verdict != null && j.verdict != null && g.verdict === j.verdict) {
      agreementCount += 1;
    } else {
      disagreements.push({
        fixtureId: fixture.id,
        expected: fixture.expected,
        category: fixture.category,
        geminiVerdict: g.verdict,
        geminiSource: g.responseSource,
        jevVerdict: j.verdict,
        jevConfidence: j.confidence ?? null,
        jevProbabilities: j.probabilities ?? null,
      });
    }
  }

  const costs = [gemini.actualProviderCostUsd, jev.actualProviderCostUsd].filter(
    (c): c is number => c != null
  );
  const result: LiveCommentModerationBenchmarkResult = {
    status: "RAN",
    totalFixtures: fixtures.length,
    gemini,
    jev,
    agreementCount,
    agreementRate: rate(agreementCount, fixtures.length),
    disagreements,
    totalProviderCalls: gemini.providerCalls + jev.providerCalls,
    totalActualProviderCostUsd: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
  };
  log(JSON.stringify(result));
  return result;
}
