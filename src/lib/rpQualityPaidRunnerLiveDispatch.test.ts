import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";

import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import {
  createMemoryPaidRunnerJournalStore,
  createMockPaidRunnerTransport,
  type PaidRunnerAuthorizationInput,
  type PaidRunnerPublicManifest,
} from "@/lib/rpQualityPaidRunner";
import type { PrecallAssemblyRows } from "../../scripts/lib/rpQualityPrecallFinalWire";
import { preparePaidRunnerPack } from "../../scripts/lib/rpQualityPaidRunnerPrepare";
import {
  dispatchPaidRunnerLive,
} from "../../scripts/lib/rpQualityPaidRunnerLiveDispatch";
import {
  compareToPublished1466Seal,
  published1466ComparableSeal,
} from "../../scripts/lib/rpQualityPaidRunnerPublished1466Seal";

const SECRET = "rpq-paid-dispatch-secret-0000000001";
const MAIN_SHA = "7573e6fd3552a5802e97d1507f8f671d361447a2";
const KEYS = {
  openRouterKey: "or-exp-dispatch-key-not-production",
  cheaperInferenceKey: "ci-exp-dispatch-key-not-production",
};

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

function fixturePack() {
  return preparePaidRunnerPack({
    rows: syntheticRows(),
    mainSha: MAIN_SHA,
    productionDeploySha: MAIN_SHA,
  });
}

function auth(
  manifest: PaidRunnerPublicManifest,
  extra: Partial<PaidRunnerAuthorizationInput> = {}
): PaidRunnerAuthorizationInput {
  return {
    userCostApproved: true,
    approvedManifestFingerprint: manifest.manifestFingerprint,
    expectedProductionSha: manifest.productionDeploySha,
    expectedIdentityHash: manifest.identityHash,
    experimentSecret: SECRET,
    allowlist: [...MAIN_RP_MODEL_IDS],
    plannedCalls: 12,
    ...extra,
  };
}

function countingMock() {
  const counts = { posts: 0 };
  const inner = createMockPaidRunnerTransport();
  return {
    counts,
    transport: {
      kind: "mock" as const,
      async post(input: Parameters<typeof inner.post>[0]) {
        counts.posts += 1;
        return inner.post(input);
      },
    },
  };
}

function runLiveCli(args: string[], env: NodeJS.ProcessEnv = {}): {
  report: {
    providerPosts: number;
    denialReason: string | null;
    approvalStatus: string;
    liveExecuteEnabled: boolean;
    acceptPaidExecution?: boolean;
    dbWrites: number;
  };
  stdout: string;
} {
  let stdout = "";
  try {
    stdout = execFileSync(
      process.execPath,
      ["--conditions=react-server", "--import", "tsx", "scripts/rp-quality-paid-runner-live.ts", ...args],
      {
        encoding: "utf8",
        env: (() => {
          const next = { ...process.env, ...env };
          for (const key of [
            "RP_QUALITY_PAID_LIVE_EXECUTE",
            "RP_QUALITY_PAID_OPENROUTER_KEY",
            "RP_QUALITY_PAID_CHEAPERINFERENCE_KEY",
            "RP_QUALITY_PAID_EXPERIMENT_SECRET",
            "OPENROUTER_API_KEY",
            "CHEAPER_INFERENCE_API_KEY",
            "OPENAI_API_KEY",
          ]) {
            if (!(key in env)) delete next[key];
          }
          return next;
        })(),
      }
    );
  } catch (error) {
    stdout = String((error as { stdout?: string }).stdout ?? "");
  }
  return { report: JSON.parse(stdout) as ReturnType<typeof runLiveCli>["report"], stdout };
}

describe("rp quality paid runner live dispatch NO_POST", () => {
  it("published #1466 seal rematches itself and treats body edits as drift", () => {
    const published = published1466ComparableSeal();
    assert.equal(compareToPublished1466Seal(published).verdict, "MATCH");
    assert.equal(compareToPublished1466Seal(published).bodyDrift, false);

    const rotated = compareToPublished1466Seal({
      ...published,
      productionDeploySha: MAIN_SHA,
      mainSha: MAIN_SHA,
      manifestFingerprint: "ff".repeat(32),
    });
    assert.equal(rotated.verdict, "EXPECTED_DEPLOY_SHA_ROTATION");
    assert.equal(rotated.bodyDrift, false);

    const drifted = compareToPublished1466Seal({
      ...published,
      calls: published.calls.map((call, index) =>
        index === 0 ? { ...call, requestBodyFingerprint: "aa".repeat(32) } : call
      ),
    });
    assert.equal(drifted.verdict, "BODY_DRIFT");
    assert.equal(drifted.requestBodyMatch, false);

    const identityDrift = compareToPublished1466Seal({
      ...published,
      identityHash: "bb".repeat(32),
    });
    assert.equal(identityDrift.verdict, "BODY_DRIFT");
    assert.equal(identityDrift.identityMatch, false);
  });

  it("승인 없음 / 잘못된 SHA / fingerprint / identity / 운영키 fallback 모두 POST 0", async () => {
    const pack = fixturePack();
    const noAccept = countingMock();
    const noAcceptReport = await dispatchPaidRunnerLive({
      acceptPaidExecution: false,
      liveExecuteEnabled: true,
      modelsCanonical: true,
      authorization: auth(pack.manifest),
      manifest: pack.manifest,
      sealedCalls: pack.sealedCalls,
      keys: KEYS,
      transport: noAccept.transport,
    });
    assert.equal(noAcceptReport.denialReason, "LIVE_EXECUTE_NOT_APPROVED");
    assert.equal(noAcceptReport.providerPosts, 0);
    assert.equal(noAccept.counts.posts, 0);

    const noUser = countingMock();
    const noUserReport = await dispatchPaidRunnerLive({
      acceptPaidExecution: true,
      liveExecuteEnabled: true,
      modelsCanonical: true,
      authorization: auth(pack.manifest, { userCostApproved: false }),
      manifest: pack.manifest,
      sealedCalls: pack.sealedCalls,
      keys: KEYS,
      transport: noUser.transport,
    });
    assert.equal(noUserReport.denialReason, "MISSING_USER_COST_APPROVAL");
    assert.equal(noUser.counts.posts, 0);

    const wrongSha = countingMock();
    const wrongShaReport = await dispatchPaidRunnerLive({
      acceptPaidExecution: true,
      liveExecuteEnabled: true,
      modelsCanonical: true,
      authorization: auth(pack.manifest, { expectedProductionSha: "0".repeat(40) }),
      manifest: pack.manifest,
      sealedCalls: pack.sealedCalls,
      keys: KEYS,
      transport: wrongSha.transport,
    });
    assert.equal(wrongShaReport.denialReason, "PRODUCTION_SHA_MISMATCH");
    assert.equal(wrongSha.counts.posts, 0);

    const wrongFingerprint = countingMock();
    const wrongFingerprintReport = await dispatchPaidRunnerLive({
      acceptPaidExecution: true,
      liveExecuteEnabled: true,
      modelsCanonical: true,
      authorization: auth(pack.manifest, { approvedManifestFingerprint: "cc".repeat(32) }),
      manifest: pack.manifest,
      sealedCalls: pack.sealedCalls,
      keys: KEYS,
      transport: wrongFingerprint.transport,
    });
    assert.equal(wrongFingerprintReport.denialReason, "MANIFEST_FINGERPRINT_MISMATCH");
    assert.equal(wrongFingerprint.counts.posts, 0);

    const wrongIdentity = countingMock();
    const wrongIdentityReport = await dispatchPaidRunnerLive({
      acceptPaidExecution: true,
      liveExecuteEnabled: true,
      modelsCanonical: true,
      authorization: auth(pack.manifest, { expectedIdentityHash: "dd".repeat(32) }),
      manifest: pack.manifest,
      sealedCalls: pack.sealedCalls,
      keys: KEYS,
      transport: wrongIdentity.transport,
    });
    assert.equal(wrongIdentityReport.denialReason, "IDENTITY_HASH_MISMATCH");
    assert.equal(wrongIdentity.counts.posts, 0);

    process.env.OPENROUTER_API_KEY = "sk-or-production-lookalike-dispatch";
    try {
      const fallback = countingMock();
      const fallbackReport = await dispatchPaidRunnerLive({
        acceptPaidExecution: true,
        liveExecuteEnabled: true,
        modelsCanonical: true,
        authorization: auth(pack.manifest),
        manifest: pack.manifest,
        sealedCalls: pack.sealedCalls,
        keys: {
          openRouterKey: "sk-or-production-lookalike-dispatch",
          cheaperInferenceKey: KEYS.cheaperInferenceKey,
        },
        transport: fallback.transport,
      });
      assert.equal(fallbackReport.denialReason, "PRODUCTION_KEY_FALLBACK_FORBIDDEN");
      assert.equal(fallback.counts.posts, 0);
    } finally {
      delete process.env.OPENROUTER_API_KEY;
    }
  });

  it("accept 없이 sealed 없음 / 중복 실행은 POST 0, mock 정상 승인만 fixture POST", async () => {
    const pack = fixturePack();
    const missingSeal = countingMock();
    const missingSealReport = await dispatchPaidRunnerLive({
      acceptPaidExecution: true,
      liveExecuteEnabled: true,
      modelsCanonical: true,
      authorization: auth(pack.manifest),
      manifest: pack.manifest,
      sealedCalls: null,
      keys: KEYS,
      transport: missingSeal.transport,
    });
    assert.equal(missingSealReport.denialReason, "SEAL_VALIDATION_FAILED");
    assert.equal(missingSeal.counts.posts, 0);
    assert.equal(missingSealReport.sealedBodiesExported, false);

    const journal = createMemoryPaidRunnerJournalStore();
    const firstMock = countingMock();
    const first = await dispatchPaidRunnerLive({
      acceptPaidExecution: true,
      liveExecuteEnabled: true,
      modelsCanonical: true,
      authorization: auth(pack.manifest),
      manifest: pack.manifest,
      sealedCalls: pack.sealedCalls,
      keys: KEYS,
      transport: firstMock.transport,
      journalStore: journal,
    });
    assert.equal(first.denialReason, null);
    assert.equal(first.providerPosts, 0);
    assert.equal(first.transportPosts, 12);
    assert.equal(firstMock.counts.posts, 12);
    assert.equal(first.unknownSingleCallCost, true);
    assert.equal(first.dbWrites, 0);
    assert.doesNotMatch(JSON.stringify(first), /창가에 서서|Authorization|Bearer |requestBody|rpq-paid-dispatch/);

    const replayMock = countingMock();
    const replay = await dispatchPaidRunnerLive({
      acceptPaidExecution: true,
      liveExecuteEnabled: true,
      modelsCanonical: true,
      authorization: auth(pack.manifest),
      manifest: pack.manifest,
      sealedCalls: pack.sealedCalls,
      keys: KEYS,
      transport: replayMock.transport,
      journalStore: journal,
    });
    assert.equal(replay.denialReason, "DUPLICATE_MANIFEST_EXECUTION");
    assert.equal(replay.providerPosts, 0);
    assert.equal(replayMock.counts.posts, 0);
  });

  it("live CLI default and LIVE_EXECUTE=1 without accept stay POST 0", () => {
    const defaultRun = runLiveCli([]);
    assert.equal(defaultRun.report.providerPosts, 0);
    assert.equal(defaultRun.report.denialReason, "LIVE_EXECUTE_NOT_APPROVED");
    assert.equal(defaultRun.report.approvalStatus, "NOT_APPROVED");
    assert.equal(defaultRun.report.liveExecuteEnabled, false);
    assert.equal(defaultRun.report.dbWrites, 0);

    const executeWithoutAccept = runLiveCli(["--user-cost-approved", "--accept-paid-execution"], {
      RP_QUALITY_PAID_LIVE_EXECUTE: "0",
      RP_QUALITY_PAID_OPENROUTER_KEY: KEYS.openRouterKey,
      RP_QUALITY_PAID_CHEAPERINFERENCE_KEY: KEYS.cheaperInferenceKey,
      RP_QUALITY_PAID_EXPERIMENT_SECRET: SECRET,
    });
    assert.equal(executeWithoutAccept.report.providerPosts, 0);
    assert.equal(executeWithoutAccept.report.denialReason, "LIVE_EXECUTE_NOT_APPROVED");

    const liveEnvNoAccept = runLiveCli(["--user-cost-approved"], {
      RP_QUALITY_PAID_LIVE_EXECUTE: "1",
      RP_QUALITY_PAID_OPENROUTER_KEY: KEYS.openRouterKey,
      RP_QUALITY_PAID_CHEAPERINFERENCE_KEY: KEYS.cheaperInferenceKey,
      RP_QUALITY_PAID_EXPERIMENT_SECRET: SECRET,
    });
    assert.equal(liveEnvNoAccept.report.providerPosts, 0);
    assert.equal(liveEnvNoAccept.report.denialReason, "MANIFEST_FINGERPRINT_MISMATCH");
    assert.equal(liveEnvNoAccept.report.liveExecuteEnabled, true);
    assert.doesNotMatch(defaultRun.stdout + executeWithoutAccept.stdout + liveEnvNoAccept.stdout, /sk-or-|ci_liv|Bearer /);
  });
});
