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
  identityHashesFromRows,
  paidRunnerIdentityHashesMatchProof,
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
    assert.doesNotMatch(publicJson, /창가에 서서|Authorization|Bearer |"requestBody"/);
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

  it("identity: same rows/proof stay matched; section edits fail closed", () => {
    const rowsA = syntheticRows();
    const proofA = identityHashesFromRows(rowsA);
    const matched = preparePaidRunnerPack({
      rows: rowsA,
      mainSha: MAIN_SHA,
      productionDeploySha: MAIN_SHA,
    });
    assert.equal(
      paidRunnerIdentityHashesMatchProof(matched.manifest.identityHashes, proofA),
      true
    );
    assert.deepEqual(matched.manifest.identityHashes, proofA);
    assert.equal(matched.manifest.calls.length, 12);
    assert.equal(matched.manifest.providerPosts, 0);
    assert.equal(
      decidePaidRunnerPreapproval(readyInput({ identityHashesMatchProof: true })).decision,
      "READY_FOR_GPT_COST_REVIEW"
    );

    const systemChanged = {
      ...rowsA,
      character: {
        ...rowsA.character,
        system_prompt: "CHANGED-SYSTEM-PROMPT 라이크는 갑자기 말이 많아진다.",
      },
    };
    const personaChanged = {
      ...rowsA,
      persona: { ...rowsA.persona, description: "CHANGED-PERSONA 다른 사람" },
    };
    const greetingChanged = {
      ...rowsA,
      character: { ...rowsA.character, greeting: "CHANGED-GREETING 다른 인사." },
    };
    const worldChanged = {
      ...rowsA,
      character: { ...rowsA.character, world: "CHANGED-WORLD 다른 세계." },
    };
    const settingChanged = {
      ...rowsA,
      character: { ...rowsA.character, setting_chunks: "CHANGED-SETTING 다른 설정." },
    };

    for (const rowsB of [systemChanged, personaChanged, greetingChanged, worldChanged, settingChanged]) {
      const packB = preparePaidRunnerPack({
        rows: rowsB,
        mainSha: MAIN_SHA,
        productionDeploySha: MAIN_SHA,
      });
      assert.equal(
        paidRunnerIdentityHashesMatchProof(packB.manifest.identityHashes, proofA),
        false
      );
      assert.equal(
        paidRunnerIdentityHashesMatchProof(identityHashesFromRows(rowsB), proofA),
        false
      );
      assert.equal(packB.manifest.calls.length, 12);
      assert.equal(packB.manifest.providerPosts, 0);
      assert.equal(
        decidePaidRunnerPreapproval(readyInput({ identityHashesMatchProof: false })).decision,
        "BLOCKED_PRODUCTION_IDENTITY"
      );
    }

    assert.equal(matched.manifest.identityHash, "ce23d16dac7e90ce792ada3c8a4c8cab572b40979307a8d81ea2c1449bdd1937");
    assert.equal(matched.manifest.manifestFingerprint, "885133f416e8804a5fa5653f02d7c6a91cd3806b5c5dd1648e9bcf517db49288");
    assert.deepEqual(
      matched.manifest.calls.map((call) => call.requestBodyFingerprint),
      [
        "da3166b02cc85bea6d767dec10f87066997e881beddd7c15c70c7d5a7d8dba6b",
        "e93e2c69405d1d38b98aec53ac8a9b1b94d4449b8c93087c28aff8e4f2362f0d",
        "6e85834609be2e28c1f16802e85ea6819bccdcd908de2bf071c491931c5cc59d",
        "55824569c292d9df7c38c2a8f0497bc2827bb1a4f7d052e19ea644c8451df186",
        "743828c884ff697f3681c61a6a7709bdbdd83bcb8c6898b58135a822731e148c",
        "d9ce7a386577ffe4d15ece50c91c0208c69b108123cd8c419d0b19e911e550d8",
        "004b5609a6feabd70df5f69f9b927870be4d74446be5ec7330d3eb75be834760",
        "954961a6c46fa0f28cff40739369f5bfbe618f0bcfac353cdeafd83e56aa0b5f",
        "730fcfd2565491781ed74efcb13b659e48e5c8686e9e3cd54af90524fd375f55",
        "d0f88cccd091a6321eab690be408a854a8ee18343e605e966eba33c0ae6e3536",
        "a5846f034597a3bc52f7eb7e95213a75e584ff49773044f92056639656ffec09",
        "12ba6ef7994f779794016873ade00ef3fe28f3105e3d6b7c9f3352ee37b36573",
      ]
    );
    const publicJson = JSON.stringify({
      manifest: matched.manifest,
      calls: projectPaidRunnerPreapprovalCalls(matched),
    });
    assert.doesNotMatch(publicJson, /창가에 서서|CHANGED-SYSTEM-PROMPT|CHANGED-PERSONA|"requestBody"/);
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
