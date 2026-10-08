import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";

import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import { getPublishedPricing } from "@/lib/publishedModelPricing";
import { OPUS55_CI_PROCUREMENT_INPUT_USD_PER_MILLION, OPUS55_CI_PROCUREMENT_OUTPUT_USD_PER_MILLION } from "@/lib/opus55ProcurementPricing";
import {
  RP_QUALITY_PRECALL_FIXTURE_IDS,
  RP_QUALITY_PRECALL_PLANNED_CALLS,
} from "@/lib/rpQualityPrecall";
import {
  resolveOpenRouterMaxTokens,
} from "@/lib/openRouterClient";
import { resolveStreamCharCap } from "@/lib/responseLength";
import type { PrecallAssemblyRows } from "../../scripts/lib/rpQualityPrecallFinalWire";
import {
  decidePaidRunnerPreapproval,
  preparePaidRunnerPack,
  projectPaidRunnerPreapprovalCalls,
  publishedPlanningRateSnapshot,
  readPaidRunnerExperimentKeyPresence,
} from "../../scripts/lib/rpQualityPaidRunnerPrepare";
import {
  verifyPaidRunnerDispatchSeal,
} from "@/lib/rpQualityPaidRunner";

const MAIN_SHA = "88d277f868c4a445e8dd7d24ea50f322fff1483d";

function syntheticRows(): PrecallAssemblyRows {
  return {
    character: {
      id: 18,
      name: "라이크",
      greeting: "창가에 서서 잠시 너를 바라본다.",
      system_prompt: "라이크는 말수가 적고 상대의 말을 끝까지 듣는다.",
      world: "늦은 오후 도시.",
      setting_chunks: "",
      gender: "male",
      content_kind: "character",
      genres: "[]",
      assets: "[]",
      status_widget_allow_user_override: 1,
    },
    persona: {
      id: 5,
      name: "렌",
      gender: "male",
      description: "조용한 사람",
    },
    user: {
      id: 1,
      nickname: "렌",
      user_note: "",
    },
    creatorLorebookAttachments: 0,
    globalLorebook: [],
  };
}

function readyInput(overrides: Partial<Parameters<typeof decidePaidRunnerPreapproval>[0]> = {}) {
  return {
    productionSuccess: true,
    productionShaMatchesMain: true,
    liveTransportIncluded: true,
    proofStatus: "VERIFIED",
    sealOk: true,
    callCount: 12,
    fixtureCount: 3,
    modelCount: 4,
    modelsMatchRegistry: true,
    approvalStatus: "NOT_APPROVED",
    rawSourceLeak: false,
    secretLeak: false,
    costPlanningStatus: "PLANNING_ONLY_NOT_APPROVED",
    providerPosts: 0,
    identityHashesMatchProof: true,
    ...overrides,
  };
}

describe("rp quality paid runner preapproval evidence", () => {
  it("1-2. deployment mismatch and missing SUCCESS stay blocked", () => {
    assert.equal(
      decidePaidRunnerPreapproval(readyInput({ productionShaMatchesMain: false })).decision,
      "BLOCKED_DEPLOYMENT"
    );
    assert.equal(
      decidePaidRunnerPreapproval(readyInput({ productionSuccess: false })).decision,
      "BLOCKED_DEPLOYMENT"
    );
    assert.equal(
      decidePaidRunnerPreapproval(readyInput({ liveTransportIncluded: false })).decision,
      "BLOCKED_DEPLOYMENT"
    );
  });

  it("3-5. character, persona, and stale identity stay blocked", () => {
    assert.throws(
      () => preparePaidRunnerPack({
        rows: { ...syntheticRows(), character: { ...syntheticRows().character, id: 99 } },
        mainSha: MAIN_SHA,
        productionDeploySha: MAIN_SHA,
      }),
      /PAID_RUNNER_CHARACTER_SELECTOR_MISMATCH/
    );
    assert.throws(
      () => preparePaidRunnerPack({
        rows: { ...syntheticRows(), persona: { ...syntheticRows().persona, name: "다른이름" } },
        mainSha: MAIN_SHA,
        productionDeploySha: MAIN_SHA,
      }),
      /PAID_RUNNER_PERSONA_SELECTOR_MISMATCH/
    );
    assert.equal(
      decidePaidRunnerPreapproval(readyInput({ proofStatus: "UNVERIFIED" })).decision,
      "BLOCKED_PRODUCTION_IDENTITY"
    );
    assert.equal(
      decidePaidRunnerPreapproval(readyInput({ identityHashesMatchProof: false })).decision,
      "BLOCKED_PRODUCTION_IDENTITY"
    );
  });

  it("6-10. fixture/model/call counts, tamper, and registry stay sealed", () => {
    const pack = preparePaidRunnerPack({
      rows: syntheticRows(),
      mainSha: MAIN_SHA,
      productionDeploySha: MAIN_SHA,
    });
    assert.equal(pack.manifest.calls.length, RP_QUALITY_PRECALL_PLANNED_CALLS);
    assert.equal(new Set(pack.manifest.calls.map((call) => call.fixtureId)).size, RP_QUALITY_PRECALL_FIXTURE_IDS.length);
    assert.equal(new Set(pack.manifest.calls.map((call) => call.canonicalId)).size, MAIN_RP_MODEL_IDS.length);
    assert.deepEqual([...MAIN_RP_MODEL_IDS], [
      "deepseek-v4.1-flash",
      "gemini-3.8-flash",
      "gpt-6.1-sol",
      "claude-opus-5.5",
    ]);
    const ok = verifyPaidRunnerDispatchSeal({ manifest: pack.manifest, sealedCalls: pack.sealedCalls });
    assert.equal(ok.ok, true);
    const tampered = {
      ...pack.sealedCalls[0]!,
      requestBody: { ...pack.sealedCalls[0]!.requestBody, messages: [{ role: "user", content: "tamper" }] },
    };
    const broken = verifyPaidRunnerDispatchSeal({
      manifest: pack.manifest,
      sealedCalls: [tampered, ...pack.sealedCalls.slice(1)],
    });
    assert.equal(broken.ok, false);
    assert.equal(decidePaidRunnerPreapproval(readyInput({ callCount: 11 })).decision, "BLOCKED_MANIFEST_INTEGRITY");
    assert.equal(decidePaidRunnerPreapproval(readyInput({ fixtureCount: 2 })).decision, "BLOCKED_MANIFEST_INTEGRITY");
    assert.equal(decidePaidRunnerPreapproval(readyInput({ modelCount: 3 })).decision, "BLOCKED_MANIFEST_INTEGRITY");
    assert.equal(decidePaidRunnerPreapproval(readyInput({ modelsMatchRegistry: false })).decision, "BLOCKED_MANIFEST_INTEGRITY");
  });

  it("11. no max_tokens and no output ceiling", () => {
    const pack = preparePaidRunnerPack({
      rows: syntheticRows(),
      mainSha: MAIN_SHA,
      productionDeploySha: MAIN_SHA,
    });
    for (const call of pack.sealedCalls) {
      assert.equal("max_tokens" in call.requestBody, false);
      assert.equal("max_completion_tokens" in call.requestBody, false);
      assert.equal(call.maxTokensPresent, false);
    }
    assert.equal(resolveOpenRouterMaxTokens(3200, 8192, MAIN_RP_MODEL_IDS[0]), undefined);
    assert.equal(resolveStreamCharCap({}), Number.MAX_SAFE_INTEGER);
  });

  it("12-17. public projection stays approval-safe and NOT_APPROVED", () => {
    const pack = preparePaidRunnerPack({
      rows: syntheticRows(),
      mainSha: MAIN_SHA,
      productionDeploySha: MAIN_SHA,
    });
    const publicJson = JSON.stringify({
      manifest: pack.manifest,
      calls: projectPaidRunnerPreapprovalCalls(pack),
    });
    assert.doesNotMatch(publicJson, /창가에 서서|system_prompt|Authorization|Bearer |requestBody/);
    assert.equal(pack.manifest.approvalStatus, "NOT_APPROVED");
    assert.equal(pack.manifest.unknownSingleCallCost, true);
    assert.equal(
      decidePaidRunnerPreapproval(readyInput({ costPlanningStatus: "APPROVED" })).decision,
      "BLOCKED_COST_EVIDENCE"
    );
    assert.equal(decidePaidRunnerPreapproval(readyInput({ rawSourceLeak: true })).decision, "BLOCKED_PRIVACY");
    assert.equal(decidePaidRunnerPreapproval(readyInput({ secretLeak: true })).decision, "BLOCKED_PRIVACY");
    assert.equal(decidePaidRunnerPreapproval(readyInput({ approvalStatus: "APPROVED" })).decision, "BLOCKED_OTHER");
    assert.equal(decidePaidRunnerPreapproval(readyInput({ providerPosts: 1 })).decision, "BLOCKED_OTHER");
    assert.equal(decidePaidRunnerPreapproval(readyInput()).decision, "READY_FOR_GPT_COST_REVIEW");
  });

  it("18. live CLI still never executes without later approval", () => {
    let stdout = "";
    try {
      stdout = execFileSync(
        process.execPath,
        [
          "--conditions=react-server",
          "--import",
          "tsx",
          "scripts/rp-quality-paid-runner-live.ts",
        ],
        { encoding: "utf8" }
      );
    } catch (error) {
      stdout = String((error as { stdout?: string }).stdout ?? "");
    }
    const report = JSON.parse(stdout) as {
      providerPosts: number;
      denialReason: string;
      approvalStatus: string;
      liveExecuteEnabled: boolean;
    };
    assert.equal(report.providerPosts, 0);
    assert.equal(report.denialReason, "LIVE_EXECUTE_NOT_APPROVED");
    assert.equal(report.approvalStatus, "NOT_APPROVED");
    assert.equal(report.liveExecuteEnabled, false);
  });

  it("experiment key readiness reports names only and published rates stay local", () => {
    const presence = readPaidRunnerExperimentKeyPresence({
      RP_QUALITY_PAID_OPENROUTER_KEY: "  ",
      RP_QUALITY_PAID_CHEAPERINFERENCE_KEY: undefined,
      RP_QUALITY_PAID_LIVE_EXECUTE: "0",
    });
    assert.equal(presence.experimentOpenRouterKeyPresent, false);
    assert.equal(presence.experimentCheaperInferenceKeyPresent, false);
    assert.equal(presence.liveExecuteEnabled, false);
    assert.deepEqual(presence.envNamesOnly, {
      openRouter: "RP_QUALITY_PAID_OPENROUTER_KEY",
      cheaperInference: "RP_QUALITY_PAID_CHEAPERINFERENCE_KEY",
      liveExecute: "RP_QUALITY_PAID_LIVE_EXECUTE",
    });
    const opus = publishedPlanningRateSnapshot("claude-opus-5.5");
    assert.equal(opus.inputUsdPerMillion, OPUS55_CI_PROCUREMENT_INPUT_USD_PER_MILLION);
    assert.equal(opus.outputUsdPerMillion, OPUS55_CI_PROCUREMENT_OUTPUT_USD_PER_MILLION);
    assert.equal(opus.providerCatalogLiveFetch, false);
    const deepseek = getPublishedPricing("deepseek-v4.1-flash");
    assert.equal(deepseek.billingReferenceInputUsdPerMillion, 0.3);
    assert.equal(deepseek.billingReferenceOutputUsdPerMillion, 1.2);
  });
});
