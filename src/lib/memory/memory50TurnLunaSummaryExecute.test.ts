import Module from "module";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  ISOLATED_TEST_DB_REQUIRED,
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import { AB_COMPLETED_TURNS, extractiveFakeHarborSummary } from "./memory50TurnAbRunner";
import {
  LUNA_SUMMARY_APPROVED_BATCH_FINGERPRINTS,
  LUNA_SUMMARY_APPROVED_PREPARE_MANIFEST,
  LUNA_SUMMARY_APPROVED_SCRIPT_HASH,
  LUNA_SUMMARY_LIVE_EXECUTE_SHIPPED,
  attemptLunaSummaryLiveExecute,
  evaluateLunaSummaryGate,
  harborScriptHash,
} from "./memory50TurnLunaSummaryPrepare";
import {
  LUNA_SUMMARY_APPROVED_PREPARE_MANIFEST_FINGERPRINT,
  LUNA_SUMMARY_EXECUTE_MAIN_SHA,
  countReservedNetworkAttempts,
  createLunaDurableJournalStore,
  createLunaSummaryLiveCaller,
  evaluateLunaSummaryExecuteGate,
  recoverLunaLeftoverSent,
  runAuthorizedLunaSummaryExperiment,
  verifyLunaRequestIdentity,
} from "./memory50TurnLunaSummaryExecute";
import { __setSummarizeTurnBatchCallerForTests, summarizeTurnBatch } from "./memory-rolling-summary";

const EXPERIMENT = "luna-experiment-only-not-production";

function stubCompletion(): NonNullable<Parameters<typeof runAuthorizedLunaSummaryExperiment>[0]["completion"]> {
  return async ({ history }) => ({
    text: extractiveFakeHarborSummary(history.map((message) => message.content).join("\n")),
    usage: {
      inputTokens: 10,
      outputTokens: 20,
      estimated: true,
    },
  });
}

describe("50-turn Luna summary execute gate (provider-free)", () => {
  it("keeps #1473 request identity and refuses unpaid AUTHORIZED posts", async () => {
    assert.equal(LUNA_SUMMARY_LIVE_EXECUTE_SHIPPED, false);
    assert.equal(harborScriptHash(), LUNA_SUMMARY_APPROVED_SCRIPT_HASH);
    const identity = await verifyLunaRequestIdentity();
    assert.equal(identity.shaOnlyDifference.requestPayloadUnchanged, true);
    assert.equal(identity.prepareManifestFingerprint, LUNA_SUMMARY_APPROVED_PREPARE_MANIFEST);
    assert.deepEqual(identity.batchFingerprints, [...LUNA_SUMMARY_APPROVED_BATCH_FINGERPRINTS]);
    assert.equal(identity.shaOnlyDifference.currentMainSha, LUNA_SUMMARY_EXECUTE_MAIN_SHA);
    assert.equal(identity.liveSealMatchesPrepareCapture, false);
    assert.equal(identity.ok, false);
    assert.equal(identity.liveSealFingerprints[0] !== identity.batchFingerprints[0], true);
    assert.deepEqual(identity.liveSealFingerprints.slice(1), identity.batchFingerprints.slice(1));
    assert.equal(evaluateLunaSummaryGate({ mode: "PREPARE" }).paidPostsAllowed, 0);
    assert.equal(attemptLunaSummaryLiveExecute({ mode: "AUTHORIZED" }).paidPosts, 0);
    assert.equal(
      evaluateLunaSummaryExecuteGate({
        identityOk: true,
        isolatedDb: true,
      }).reason,
      "MISSING_USER_COST_APPROVAL"
    );
    assert.equal(
      evaluateLunaSummaryExecuteGate({
        userCostApproved: true,
        identityOk: true,
        isolatedDb: true,
        env: { CHEAPER_INFERENCE_API_KEY: "sk-prod" },
        experimentKey: "sk-prod",
      }).reason,
      "PRODUCTION_KEY_FORBIDDEN"
    );
    assert.equal(
      evaluateLunaSummaryExecuteGate({
        userCostApproved: true,
        experimentKey: EXPERIMENT,
        identityOk: true,
        isolatedDb: false,
        allowRealNetwork: true,
        env: {},
      }).reason,
      "ISOLATED_TEST_DB_REQUIRED"
    );
  });

  it("refuses an 11th reserved attempt and a leftover SENT after restart", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "luna-journal-"));
    const store = createLunaDurableJournalStore(dir);
    const journal = {
      manifestFingerprint: LUNA_SUMMARY_APPROVED_PREPARE_MANIFEST_FINGERPRINT,
      requestIdentityFingerprint: LUNA_SUMMARY_APPROVED_PREPARE_MANIFEST_FINGERPRINT,
      executed: false,
      networkAttempts: 10,
      entries: Array.from({ length: 10 }, (_, index) => ({
        batchIndex: index + 1,
        turnStart: index * 5 + 1,
        turnEnd: index * 5 + 5,
        requestKind: "background-memory-extract",
        requestFingerprint: LUNA_SUMMARY_APPROVED_BATCH_FINGERPRINTS[index]!,
        status: "SETTLED" as const,
        accepted: true,
        rejectedReason: null,
        rawSummaryFingerprint: null,
        storedSummaryFingerprint: null,
        promptTokens: 1,
        completionTokens: 1,
        billedUsd: null,
        settlementSource: "estimate_not_bill" as const,
        providerRequestId: null,
        networkAttempts: index + 1,
      })),
    };
    store.persist(journal);
    const reloaded = store.load(LUNA_SUMMARY_APPROVED_PREPARE_MANIFEST_FINGERPRINT)!;
    assert.equal(countReservedNetworkAttempts(reloaded), 10);
    const limited = createLunaSummaryLiveCaller({
      experimentKey: EXPERIMENT,
      env: {},
      journal: reloaded,
      persist: (next) => store.persist(next),
      artifactStore: store.artifactStore,
      completion: stubCompletion(),
    });
    await assert.rejects(
      () => limited("sys", [{ role: "user", content: "u" }], undefined, "background-memory-extract"),
      /NETWORK_ATTEMPT_LIMIT/
    );

    const crashed = {
      manifestFingerprint: LUNA_SUMMARY_APPROVED_PREPARE_MANIFEST_FINGERPRINT,
      requestIdentityFingerprint: LUNA_SUMMARY_APPROVED_PREPARE_MANIFEST_FINGERPRINT,
      executed: false,
      networkAttempts: 1,
      entries: [
        {
          ...journal.entries[0]!,
          status: "SENT" as const,
          settlementSource: "unsettled" as const,
        },
      ],
    };
    const crashDir = mkdtempSync(path.join(tmpdir(), "luna-journal-crash-"));
    const crashStore = createLunaDurableJournalStore(crashDir);
    crashStore.persist(crashed);
    const afterRestart = crashStore.load(LUNA_SUMMARY_APPROVED_PREPARE_MANIFEST_FINGERPRINT)!;
    assert.equal(recoverLunaLeftoverSent(afterRestart), true);
    crashStore.persist(afterRestart);
    const again = crashStore.load(LUNA_SUMMARY_APPROVED_PREPARE_MANIFEST_FINGERPRINT)!;
    assert.equal(again.entries[0]?.status, "UNKNOWN_UNRESOLVED");
    const blocked = createLunaSummaryLiveCaller({
      experimentKey: EXPERIMENT,
      env: {},
      journal: again,
      persist: (next) => crashStore.persist(next),
      artifactStore: crashStore.artifactStore,
      completion: stubCompletion(),
    });
    await assert.rejects(
      () => blocked("sys", [{ role: "user", content: "u" }], undefined, "background-memory-extract"),
      /UNKNOWN_UNRESOLVED_NO_RESEND/
    );
    assert.equal(countReservedNetworkAttempts(again), 1);
  });

  it("blocks a second process from taking the same journal lock", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "luna-lock-"));
    const store = createLunaDurableJournalStore(dir);
    const lock = store.lockStore.tryAcquireExclusiveLock(
      LUNA_SUMMARY_APPROVED_PREPARE_MANIFEST_FINGERPRINT
    );
    assert.equal(lock.ok, true);
    const child = spawnSync(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        "tsx",
        "scripts/luna-summary-lock-child.ts",
        dir,
        LUNA_SUMMARY_APPROVED_PREPARE_MANIFEST_FINGERPRINT,
      ],
      { encoding: "utf8" }
    );
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, "CONCURRENT_LAUNCH");
    if (lock.ok) lock.lock.release();
  });
});

describe("50-turn Luna summary execute isolated stub (provider-free)", () => {
  before(() => installIsolatedTestDatabase());
  after(() => {
    __setSummarizeTurnBatchCallerForTests(null);
    uninstallIsolatedTestDatabase();
  });

  it("refuses execute without isolation", async () => {
    const previous = process.env.DATA_DIR;
    process.env.DATA_DIR = "/tmp/luna-execute-not-isolated";
    try {
      assert.match(ISOLATED_TEST_DB_REQUIRED, /ISOLATED/);
      const result = await runAuthorizedLunaSummaryExperiment({
        userCostApproved: true,
        experimentKey: EXPERIMENT,
        env: {},
        journalDirectory: mkdtempSync(path.join(tmpdir(), "luna-exec-")),
        completion: stubCompletion(),
      });
      assert.equal(result.executed, false);
      assert.equal(result.paidPosts, 0);
      assert.equal(result.abortReason, "ISOLATED_TEST_DB_REQUIRED");
    } finally {
      process.env.DATA_DIR = previous;
    }
  });

  it("seals 10 stub batches through the live caller without a second retry POST", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "luna-exec-"));
    let posts = 0;
    const result = await runAuthorizedLunaSummaryExperiment({
      userCostApproved: true,
      experimentKey: EXPERIMENT,
      env: {},
      journalDirectory: dir,
      completion: async (opts) => {
        posts += 1;
        return stubCompletion()(opts);
      },
    });
    assert.equal(result.identity.shaOnlyDifference.requestPayloadUnchanged, true);
    assert.equal(result.sealedRounds, 10);
    assert.equal(result.frontier, AB_COMPLETED_TURNS);
    assert.equal(result.networkPosts, 10);
    assert.equal(result.paidPosts, 0);
    assert.equal(posts, 10);
    assert.equal(result.oracleWrittenToDb, false);
    assert.equal(result.answerKeyLeakedIntoArmA, false);
    assert.match(result.globalMemory, /열쇠/);
    assert.match(result.armAMemory, /열쇠/);

    const retryCaller = createLunaSummaryLiveCaller({
      experimentKey: EXPERIMENT,
      env: {},
      journal: {
        manifestFingerprint: LUNA_SUMMARY_APPROVED_PREPARE_MANIFEST_FINGERPRINT,
        requestIdentityFingerprint: LUNA_SUMMARY_APPROVED_PREPARE_MANIFEST_FINGERPRINT,
        executed: false,
        networkAttempts: 0,
        entries: [],
      },
      persist() {},
      artifactStore: createLunaDurableJournalStore(mkdtempSync(path.join(tmpdir(), "luna-art-"))).artifactStore,
      completion: async () => ({
        text: "",
        usage: { inputTokens: 1, outputTokens: 0, estimated: true },
      }),
    });
    __setSummarizeTurnBatchCallerForTests(retryCaller);
    try {
      const empty = await summarizeTurnBatch({
        dialogue: "유저: 봄 밀물 전까지 열쇠를 외투에 둔다.\n이안: 시 의회에는 넘기지 않는다.",
        charName: "이안",
        startTurn: 1,
        endTurn: 5,
      });
      assert.equal(empty, "");
      assert.equal(retryCaller.networkPosts, 1);
    } finally {
      __setSummarizeTurnBatchCallerForTests(null);
    }

    const duplicate = await runAuthorizedLunaSummaryExperiment({
      userCostApproved: true,
      experimentKey: EXPERIMENT,
      env: {},
      journalDirectory: dir,
      completion: stubCompletion(),
    });
    assert.equal(duplicate.abortReason, "DUPLICATE_MANIFEST_EXECUTION");
    assert.equal(duplicate.paidPosts, 0);
  });
});

after(() => {
  try {
    mkdirSync("/opt/cursor/artifacts", { recursive: true });
    writeFileSync(
      "/opt/cursor/artifacts/memory_50turn_luna_summary_execute_prepare.json",
      `${JSON.stringify({ executeShipped: true, paidPostsThisSuite: 0 }, null, 2)}\n`,
      "utf8"
    );
  } catch {
    /* CI */
  }
});
