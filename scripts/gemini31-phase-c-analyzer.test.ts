/**
 * Phase C.1 analyzer deterministic tests — no provider calls.
 * node --conditions=react-server --import tsx --test scripts/gemini31-phase-c-analyzer.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  assessSummaryContention,
  assessSummaryOverlap,
  buildPhaseC1Diagnosis,
  classifyCacheDrop,
  extractTurnFromPhaseReport,
  normalizeLegacyTurnRecord,
  pearsonCorrelation,
  spearmanCorrelation,
} from "./lib/gemini31PhaseCAnalyzer";

test("missing cached_tokens -> cache ratio NOT_MEASURABLE", () => {
  const row = normalizeLegacyTurnRecord({
    fixture: "A",
    turnIndex: 1,
    chatId: 1,
    userMessage: "x",
    clientSubmitMs: 1,
    prompt_tokens: 1000,
    cached_tokens: null,
    cache_ratio: 0,
    cache_drop_class: "UNKNOWN",
    httpStatus: 200,
  });
  assert.equal(row.cache_ratio, null);
  assert.equal(row.uncached_tokens, null);
  assert.equal(row.cache_drop_class, "NOT_MEASURABLE");
});

test("cache field explicit 0 -> cache ratio 0 allowed", () => {
  const row = normalizeLegacyTurnRecord({
    fixture: "A",
    turnIndex: 1,
    chatId: 1,
    userMessage: "x",
    clientSubmitMs: 1,
    prompt_tokens: 1000,
    cached_tokens: 0,
    cache_read_tokens_reported: true,
    httpStatus: 200,
  });
  assert.equal(row.cache_ratio, 0);
  assert.equal(row.uncached_tokens, 1000);
});

test("summary overlap alone -> contention not YES", () => {
  const turns = [
    normalizeLegacyTurnRecord({
      fixture: "C",
      turnIndex: 1,
      chatId: 1,
      userMessage: "a",
      clientSubmitMs: 1,
      summary_contention_active: true,
      ttft_ms: 40_000,
      httpStatus: 200,
    }),
    normalizeLegacyTurnRecord({
      fixture: "C",
      turnIndex: 2,
      chatId: 1,
      userMessage: "b",
      clientSubmitMs: 1,
      summary_contention_active: false,
      ttft_ms: 50_000,
      httpStatus: 200,
    }),
    normalizeLegacyTurnRecord({
      fixture: "C",
      turnIndex: 3,
      chatId: 1,
      userMessage: "c",
      clientSubmitMs: 1,
      summary_contention_active: true,
      ttft_ms: 35_000,
      httpStatus: 200,
    }),
    normalizeLegacyTurnRecord({
      fixture: "C",
      turnIndex: 4,
      chatId: 1,
      userMessage: "d",
      clientSubmitMs: 1,
      summary_contention_active: false,
      ttft_ms: 55_000,
      httpStatus: 200,
    }),
  ];
  assert.equal(assessSummaryOverlap(turns), "OBSERVED");
  assert.notEqual(assessSummaryContention(turns, { minActive: 2 }), "YES");
});

test("active faster than inactive -> contention NO_EVIDENCE", () => {
  const turns = Array.from({ length: 6 }, (_, i) =>
    normalizeLegacyTurnRecord({
      fixture: "C",
      turnIndex: i + 1,
      chatId: 1,
      userMessage: "x",
      clientSubmitMs: 1,
      summary_contention_active: i % 2 === 0,
      ttft_ms: i % 2 === 0 ? 30_000 : 60_000,
      reasoning_tokens: 4000,
      httpStatus: 200,
    })
  );
  assert.equal(assessSummaryContention(turns, { minActive: 2 }), "NO_EVIDENCE");
});

test("active materially slower -> contention candidate INCONCLUSIVE or YES", () => {
  const turns = [
    ...Array.from({ length: 3 }, (_, i) =>
      normalizeLegacyTurnRecord({
        fixture: "C",
        turnIndex: i + 1,
        chatId: 1,
        userMessage: "x",
        clientSubmitMs: 1,
        summary_contention_active: true,
        ttft_ms: 90_000,
        reasoning_tokens: 4000,
        httpStatus: 200,
      })
    ),
    ...Array.from({ length: 3 }, (_, i) =>
      normalizeLegacyTurnRecord({
        fixture: "C",
        turnIndex: i + 4,
        chatId: 1,
        userMessage: "x",
        clientSubmitMs: 1,
        summary_contention_active: false,
        ttft_ms: 40_000,
        reasoning_tokens: 4000,
        httpStatus: 200,
      })
    ),
  ];
  const v = assessSummaryContention(turns, { minActive: 3 });
  assert.ok(v === "INCONCLUSIVE" || v === "YES");
});

test("provider_wait < visible_ttft -> pre_visible_gap correct", () => {
  const extracted = extractTurnFromPhaseReport({
    phaseReport: {
      PROVIDER_WAIT_MS: 10_000,
      PROVIDER_VISIBLE_TTFT_MS: 45_000,
      tokens: {},
    },
    doneUsage: null,
    doneCost: 200,
    doneProviderBilledUsd: null,
    visibleChars: 100,
    clientSubmitMs: Date.now(),
    firstDeltaMs: null,
  });
  assert.equal(extracted.provider_wait_ms, 10_000);
  assert.equal(extracted.visible_ttft_ms, 45_000);
  assert.equal(extracted.pre_visible_gap_ms, 35_000);
});

test("cost unit mapping -> user_charge_points not USD", () => {
  const row = normalizeLegacyTurnRecord({
    fixture: "A",
    turnIndex: 1,
    chatId: 1,
    userMessage: "x",
    clientSubmitMs: 1,
    billed_cost_usd: 293,
    httpStatus: 200,
  });
  assert.equal(row.user_charge_points, 293);
  assert.equal(row.provider_billed_cost_usd, null);
});

test("completion token label -> provider_completion_tokens", () => {
  const row = normalizeLegacyTurnRecord({
    fixture: "A",
    turnIndex: 1,
    chatId: 1,
    userMessage: "x",
    clientSubmitMs: 1,
    visible_output_tokens: 8000,
    httpStatus: 200,
  });
  assert.equal(row.provider_completion_tokens, 8000);
});

test("pearson and spearman on monotonic series", () => {
  const xs = [1, 2, 3, 4, 5];
  const ys = [10, 20, 30, 40, 50];
  assert.ok((pearsonCorrelation(xs, ys) ?? 0) > 0.99);
  assert.ok((spearmanCorrelation(xs, ys) ?? 0) > 0.99);
});

test("buildPhaseC1Diagnosis flags corrected contention on legacy 36-run shape", () => {
  const turns = [
    ...Array.from({ length: 29 }, (_, i) =>
      normalizeLegacyTurnRecord({
        fixture: i < 12 ? "A" : i < 24 ? "B" : "C",
        turnIndex: (i % 12) + 1,
        chatId: 1,
        userMessage: "x",
        clientSubmitMs: 1,
        summary_contention_active: false,
        ttft_ms: 50_000,
        reasoning_tokens: 4000 + i * 100,
        cached_tokens: null,
        cache_ratio: 0,
        httpStatus: 200,
      })
    ),
    ...Array.from({ length: 7 }, (_, i) =>
      normalizeLegacyTurnRecord({
        fixture: "C",
        turnIndex: i + 1,
        chatId: 2,
        userMessage: "x",
        clientSubmitMs: 1,
        summary_contention_active: true,
        ttft_ms: 41_000,
        reasoning_tokens: 4100,
        cached_tokens: null,
        cache_ratio: 0,
        httpStatus: 200,
      })
    ),
  ];
  const d = buildPhaseC1Diagnosis(turns, { legacyReportContentionCount: 7, stageTimingAvailable: false });
  assert.equal(d.GEMINI31_CI_PHASE_C1_ROOT_CAUSE.BACKGROUND_SUMMARY_OVERLAP, "OBSERVED");
  assert.equal(d.GEMINI31_CI_PHASE_C1_ROOT_CAUSE.BACKGROUND_SUMMARY_CONTENTION, "NO_EVIDENCE");
  assert.equal(d.GEMINI31_CI_PHASE_C1_ROOT_CAUSE.CACHE_RATIO, "NOT_MEASURABLE");
});
