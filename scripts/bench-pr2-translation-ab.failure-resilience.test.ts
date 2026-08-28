import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PRODUCTION_OUTCOME_KOREAN_FALLBACK,
  auditTranslationPlan,
  buildFixtures,
  runTranslationAbBenchmark,
  validateF12SourceChars,
} from "./lib/pr2TranslationAbHarness";

function mockTransportError(message: string): Error {
  return Object.assign(new Error(message), {
    name: "CompatibleCompletionError",
    httpStatus: null,
    finishReason: null,
    usage: null,
  });
}

test("failure-resilient harness continues after request 10 transport error", async () => {
  validateF12SourceChars();
  const fixtures = await buildFixtures();
  const promptTranslation = await import("@/lib/promptTranslation");
  const audit = await auditTranslationPlan(fixtures);
  assert.equal(audit.plannedProviderRequestCount, 40);

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "pr2-ab-failure-test-"));
  let providerCalls = 0;

  const result = await runTranslationAbBenchmark({
    outDir,
    fixtures,
    audit,
    lunaModel: "gpt-5.6-luna",
    flashModel: "deepseek-v4-flash-0731",
    harnessHead: "test-harness-head",
    runId: "failure-resilience-test",
    callPromptTranslation: async (_system, history, modelId) => {
      providerCalls += 1;
      if (providerCalls === 10) {
        throw mockTransportError("NO_OPENROUTER_KEY");
      }

      const segMatches = history[0]!.content.match(/⟦SEG \d+⟧/g) ?? [];
      const segCount = segMatches.length;
      const segments = Array.from({ length: segCount }, (_, idx) => {
        return `Mock EN ${providerCalls}-${idx + 1}`;
      });
      const text = segments
        .map((segment, idx) => `⟦SEG ${idx + 1}⟧\n${segment}\n⟦/SEG ${idx + 1}⟧`)
        .join("\n\n");

      return {
        text,
        usage: {
          inputTokens: 12,
          outputTokens: 24,
          estimated: false,
          responseModelId: modelId,
        },
      };
    },
    promptTranslation,
  });

  assert.equal(providerCalls, 40, "REAL_PROVIDER_CALLS=0 expected 40 simulated calls");
  assert.equal(result.attemptedProviderRequestCount, 40, "ATTEMPTED_REQUESTS=40");
  assert.equal(result.failedProviderRequestCount, 1, "FAILED_REQUESTS=1");
  assert.equal(result.successfulProviderRequestCount, 39);

  const rawRequestsPath = path.join(outDir, "raw-requests.jsonl");
  const rawRequests = fs
    .readFileSync(rawRequestsPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(rawRequests.length, 40, "RAW_REQUESTS_PRESERVED=40");

  const request10 = rawRequests.find(
    (row: { globalRequestIndex: number }) => row.globalRequestIndex === 10
  );
  assert.equal(request10.fixtureId, "F05");
  assert.equal(request10.label, "B");
  assert.equal(request10.status, "failure");

  const request11 = rawRequests.find(
    (row: { globalRequestIndex: number }) => row.globalRequestIndex === 11
  );
  assert.ok(request11, "REQUESTS_AFTER_10_EXECUTED=true");
  assert.equal(request11.status, "success");

  const runState = JSON.parse(fs.readFileSync(path.join(outDir, "run-state.json"), "utf8"));
  assert.equal(runState.completed, true, "RUN_STATE_COMPLETED=true");
  assert.equal(runState.attemptedProviderRequestCount, 40);
  assert.equal(runState.failedProviderRequestCount, 1);

  assert.ok(fs.existsSync(path.join(outDir, "summary.md")), "FINAL_SUMMARY_GENERATED=true");
  assert.ok(fs.existsSync(path.join(outDir, "blind-review.md")), "BLIND_REVIEW_GENERATED=true");
  assert.ok(fs.existsSync(path.join(outDir, "raw-results.jsonl")));

  const rawResults = fs
    .readFileSync(path.join(outDir, "raw-results.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(rawResults.length, 24);

  const f05B = rawResults.find(
    (row: { fixtureId: string; label: string }) =>
      row.fixtureId === "F05" && row.label === "B"
  );
  assert.ok(f05B);
  assert.equal(
    f05B.productionTranslationSuccess,
    false,
    "FAILED_FIXTURE_PRODUCTION_TRANSLATION_SUCCESS=false"
  );
  assert.equal(
    f05B.productionOutcome,
    PRODUCTION_OUTCOME_KOREAN_FALLBACK,
    "FAILED_FIXTURE_PRODUCTION_OUTCOME=KOREAN_FALLBACK"
  );
  assert.equal(f05B.productionPublishedOutput, null);
  assert.ok(f05B.rawSuccessfulBatchOutputs.length === 0);

  const f05After = rawResults.find(
    (row: { fixtureId: string; label: string }) =>
      row.fixtureId === "F06" && row.label === "A"
  );
  assert.ok(f05After?.productionTranslationSuccess, "requests after F05-B still complete");

  const blindReview = fs.readFileSync(path.join(outDir, "blind-review.md"), "utf8");
  assert.match(
    blindReview,
    /Fixture F05[\s\S]*OUTPUT B:[\s\S]*\[TRANSPORT FAILURE — production result would use Korean fallback\]/
  );
  assert.doesNotMatch(blindReview, /gpt-5\.6-luna|deepseek-v4-flash-0731/);

  fs.rmSync(outDir, { recursive: true, force: true });
});
