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
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { adaptCheaperInferenceChatBody } from "@/lib/cheaperInferenceConfig";
import { paidRunnerRequestBodyFingerprint } from "@/lib/rpQualityPaidRunner";
import { getDb } from "@/lib/db";
import {
  ISOLATED_TEST_DB_REQUIRED,
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import { AB_CHAT_ID, AB_COMPLETED_TURNS, extractiveFakeHarborSummary } from "./memory50TurnAbRunner";
import { AB_PROBES } from "./memory50TurnAbScript";
import {
  LUNA_SUMMARY_APPROVED_BATCH_FINGERPRINTS,
  LUNA_SUMMARY_APPROVED_PREPARE_MANIFEST,
  LUNA_SUMMARY_APPROVED_SCRIPT_HASH,
  LUNA_SUMMARY_GRADER_ITEMS,
  LUNA_SUMMARY_LIVE_EXECUTE_SHIPPED,
  attemptLunaSummaryLiveExecute,
  evaluateLunaSummaryGate,
  harborScriptHash,
} from "./memory50TurnLunaSummaryPrepare";
import {
  LUNA_SUMMARY_CANONICAL_JOURNAL_DIR,
  LUNA_SUMMARY_EXECUTE_MAIN_SHA,
  LUNA_SUMMARY_LIVE_APPROVAL_STATUS,
  LUNA_SUMMARY_LIVE_BATCH_FINGERPRINTS,
  LUNA_SUMMARY_LIVE_COUPLED_APPROVAL_MANIFEST,
  LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST,
  LUNA_SUMMARY_LIVE_WIRE_CONTRACT,
  loadLunaSummaryEvalEvidence,
  lunaSummaryEvalEvidencePath,
  lunaSummaryLiveExecuteManifestIdentity,
  countReservedNetworkAttempts,
  createLunaDurableJournalStore,
  createLunaSummaryLiveCaller,
  evaluateLunaSummaryExecuteGate,
  journalHasReservedHistory,
  lunaSummaryLiveExecuteManifestFingerprint,
  recoverLunaLeftoverSent,
  resolveLunaSummaryJournalDirectory,
  runAuthorizedLunaSummaryExperiment,
  verifyLunaRequestIdentity,
  type LunaDurableJournal,
  type LunaDurableJournalEntry,
  type LunaDurableStatus,
} from "./memory50TurnLunaSummaryExecute";
import { __setSummarizeTurnBatchCallerForTests, summarizeTurnBatch } from "./memory-rolling-summary";

const EXPERIMENT = "luna-experiment-only-not-production";

function journalDir(): string {
  return mkdtempSync(path.join(tmpdir(), "luna-summary-journal-"));
}

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

function reservedEntry(status: LunaDurableStatus, batchIndex = 1): LunaDurableJournalEntry {
  return {
    batchIndex,
    turnStart: (batchIndex - 1) * 5 + 1,
    turnEnd: batchIndex * 5,
    requestKind: "background-memory-extract",
    requestFingerprint: LUNA_SUMMARY_LIVE_BATCH_FINGERPRINTS[batchIndex - 1] ?? LUNA_SUMMARY_LIVE_BATCH_FINGERPRINTS[0]!,
    status,
    accepted: status === "SETTLED" ? true : false,
    rejectedReason: status === "FAILED" ? "provider" : null,
    rawSummaryFingerprint: null,
    storedSummaryFingerprint: null,
    promptTokens: 1,
    completionTokens: 1,
    billedUsd: null,
    settlementSource: status === "SETTLED" ? "estimate_not_bill" : "unsettled",
    providerRequestId: null,
    networkAttempts: batchIndex,
  };
}

function reservedJournal(status: LunaDurableStatus): LunaDurableJournal {
  return {
    manifestFingerprint: LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST,
    requestIdentityFingerprint: LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST,
    executed: false,
    networkAttempts: 1,
    entries: [reservedEntry(status)],
  };
}

function harborChatExists(): boolean {
  const row = getDb().prepare("SELECT id FROM chats WHERE id=?").get(AB_CHAT_ID) as { id: number } | undefined;
  return row?.id === AB_CHAT_ID;
}

describe("50-turn Luna summary execute gate (provider-free)", () => {
  it("keeps #1473 request identity and pins the live prelude fingerprints", async () => {
    assert.equal(LUNA_SUMMARY_LIVE_EXECUTE_SHIPPED, false);
    assert.equal(LUNA_SUMMARY_LIVE_APPROVAL_STATUS, "NOT_APPROVED");
    assert.equal(harborScriptHash(), LUNA_SUMMARY_APPROVED_SCRIPT_HASH);
    const identity = await verifyLunaRequestIdentity();
    assert.equal(identity.shaOnlyDifference.requestPayloadUnchanged, true);
    assert.equal(identity.prepareManifestFingerprint, LUNA_SUMMARY_APPROVED_PREPARE_MANIFEST);
    assert.deepEqual(identity.batchFingerprints, [...LUNA_SUMMARY_APPROVED_BATCH_FINGERPRINTS]);
    assert.equal(identity.shaOnlyDifference.currentMainSha, LUNA_SUMMARY_EXECUTE_MAIN_SHA);
    assert.equal(identity.liveSealMatchesPrepareCapture, false);
    assert.equal(identity.liveSealFingerprints[0], LUNA_SUMMARY_LIVE_BATCH_FINGERPRINTS[0]);
    assert.equal(
      identity.liveSealFingerprints[0],
      "b0bdd7591f55845993aa03fcc871fdc2fa07a1ae5c8c6ece10f47f805b7579ef"
    );
    assert.equal(
      identity.batchFingerprints[0],
      "de7bd2ffe3ad2b8dcf9740228674105eb9f33d8d82d46a373bbc577f14749372"
    );
    assert.deepEqual(identity.liveSealFingerprints.slice(1), identity.batchFingerprints.slice(1));
    assert.deepEqual(identity.liveSealFingerprints, [...LUNA_SUMMARY_LIVE_BATCH_FINGERPRINTS]);
    assert.equal(identity.liveSealMatchesLivePins, true);
    assert.equal(identity.ok, true);
    assert.equal(identity.liveExecuteManifestFingerprint, LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST);
    assert.equal(lunaSummaryLiveExecuteManifestFingerprint(), LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST);
    assert.notEqual(LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST, LUNA_SUMMARY_APPROVED_PREPARE_MANIFEST);
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
    assert.equal(
      evaluateLunaSummaryExecuteGate({
        userCostApproved: true,
        experimentKey: EXPERIMENT,
        identityOk: true,
        isolatedDb: true,
        allowRealNetwork: true,
        requireLiveApproval: true,
        env: {},
      }).reason,
      "APPROVAL_STATUS_NOT_APPROVED"
    );
  });

  it("keeps manifest identity stable when approval status flips", () => {
    const identity = lunaSummaryLiveExecuteManifestIdentity();
    assert.equal("approvalStatus" in identity, false);
    assert.deepEqual(identity.liveBatchFingerprints, [...LUNA_SUMMARY_LIVE_BATCH_FINGERPRINTS]);
    assert.equal(lunaSummaryLiveExecuteManifestFingerprint(), LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST);
    assert.equal(
      LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST,
      "a638043e55fc89e216a9c02bb213a46514620d82ff8e028d0b91068d79a2515f"
    );
    const coupledNotApproved = paidRunnerRequestBodyFingerprint({
      version: identity.version,
      mode: identity.mode,
      mainSha: identity.mainSha,
      prepareManifestFingerprint: identity.prepareManifestFingerprint,
      scriptHash: identity.scriptHash,
      liveBatchFingerprints: identity.liveBatchFingerprints,
      prepareBatchFingerprints: identity.prepareBatchFingerprints,
      approvalStatus: "NOT_APPROVED",
      temperature: identity.temperature,
      stream: identity.stream,
      disableReasoning: identity.disableReasoning,
      maxTokens: identity.maxTokens,
      journalCanonicalDirectory: identity.journalCanonicalDirectory,
    });
    const coupledApproved = paidRunnerRequestBodyFingerprint({
      version: identity.version,
      mode: identity.mode,
      mainSha: identity.mainSha,
      prepareManifestFingerprint: identity.prepareManifestFingerprint,
      scriptHash: identity.scriptHash,
      liveBatchFingerprints: identity.liveBatchFingerprints,
      prepareBatchFingerprints: identity.prepareBatchFingerprints,
      approvalStatus: "APPROVED",
      temperature: identity.temperature,
      stream: identity.stream,
      disableReasoning: identity.disableReasoning,
      maxTokens: identity.maxTokens,
      journalCanonicalDirectory: identity.journalCanonicalDirectory,
    });
    assert.equal(coupledNotApproved, LUNA_SUMMARY_LIVE_COUPLED_APPROVAL_MANIFEST);
    assert.notEqual(coupledApproved, coupledNotApproved);
    assert.notEqual(LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST, coupledNotApproved);
    assert.notEqual(LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST, coupledApproved);
    assert.equal(LUNA_SUMMARY_LIVE_APPROVAL_STATUS, "NOT_APPROVED");
  });

  it("fail-closes journal identity and refuses mkdtemp attempt paths", () => {
    const attemptSrc = readFileSync("scripts/luna-summary-attempt-execute.ts", "utf8");
    assert.equal(attemptSrc.includes("mkdtempSync"), false);
    assert.match(attemptSrc, /LUNA_SUMMARY_CANONICAL_JOURNAL_DIR/);
    assert.equal(resolveLunaSummaryJournalDirectory({}).ok, false);
    assert.equal(resolveLunaSummaryJournalDirectory({ journalDirectory: "" }).reason, "JOURNAL_PATH_MISSING");
    assert.equal(
      resolveLunaSummaryJournalDirectory({
        journalDirectory: mkdtempSync(path.join(tmpdir(), "luna-attempt-")),
      }).reason,
      "JOURNAL_PATH_UNSAFE"
    );
    assert.equal(
      resolveLunaSummaryJournalDirectory({
        journalDirectory: path.join(tmpdir(), "luna-summary-journal-inside-data"),
        env: { DATA_DIR: tmpdir() },
      }).reason,
      "JOURNAL_PATH_UNSAFE"
    );
    assert.equal(
      resolveLunaSummaryJournalDirectory({
        journalDirectory: "/workspace/data/luna-summary-journal-prod",
      }).reason,
      "JOURNAL_PATH_UNSAFE"
    );
    const resolved = resolveLunaSummaryJournalDirectory({
      journalDirectory: LUNA_SUMMARY_CANONICAL_JOURNAL_DIR,
    });
    assert.equal(resolved.ok, true);
    if (resolved.ok) {
      assert.equal(
        resolveLunaSummaryJournalDirectory({ journalDirectory: LUNA_SUMMARY_CANONICAL_JOURNAL_DIR }).directory,
        resolved.directory
      );
    }
    const tmp = journalDir();
    assert.equal(resolveLunaSummaryJournalDirectory({ journalDirectory: tmp }).ok, true);
  });

  it("refuses an 11th reserved attempt and keeps leftover SENT as a follow-up", async () => {
    const dir = journalDir();
    const store = createLunaDurableJournalStore(dir);
    const journal = {
      manifestFingerprint: LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST,
      requestIdentityFingerprint: LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST,
      executed: false,
      networkAttempts: 10,
      entries: Array.from({ length: 10 }, (_, index) => reservedEntry("SETTLED", index + 1)),
    };
    store.persist(journal);
    const reloaded = store.load(LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST)!;
    assert.equal(countReservedNetworkAttempts(reloaded), 10);
    assert.equal(journalHasReservedHistory(reloaded), true);
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

    const crashed = reservedJournal("SENT");
    const crashDir = journalDir();
    const crashStore = createLunaDurableJournalStore(crashDir);
    crashStore.persist(crashed);
    const afterRestart = crashStore.load(LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST)!;
    assert.equal(recoverLunaLeftoverSent(afterRestart), true);
    crashStore.persist(afterRestart);
    const again = crashStore.load(LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST)!;
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
    const dir = journalDir();
    const store = createLunaDurableJournalStore(dir);
    const lock = store.lockStore.tryAcquireExclusiveLock(LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST);
    assert.equal(lock.ok, true);
    const child = spawnSync(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        "tsx",
        "scripts/luna-summary-lock-child.ts",
        dir,
        LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST,
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
        journalDirectory: journalDir(),
        completion: stubCompletion(),
      });
      assert.equal(result.executed, false);
      assert.equal(result.paidPosts, 0);
      assert.equal(result.abortReason, "ISOLATED_TEST_DB_REQUIRED");
    } finally {
      process.env.DATA_DIR = previous;
    }
  });

  it("refuses reserved SENT/SETTLED/FAILED history before seed and extra POSTs", async () => {
    for (const status of ["SENT", "SETTLED", "FAILED", "EMPTY_STOP", "UNKNOWN_UNRESOLVED"] as const) {
      const dir = journalDir();
      const store = createLunaDurableJournalStore(dir);
      store.persist(reservedJournal(status));
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
      assert.equal(result.abortReason, "PRIOR_RESERVED_HISTORY");
      assert.equal(result.paidPosts, 0);
      assert.equal(posts, 0);
      assert.equal(result.journal.entries[0]?.status, status);
      assert.equal(harborChatExists(), false);
    }
  });

  it("blocks a second process on the same journal directory from posting", async () => {
    const dir = journalDir();
    const store = createLunaDurableJournalStore(dir);
    store.persist(reservedJournal("SETTLED"));
    const child = spawnSync(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        "tsx",
        "scripts/luna-summary-restart-child.ts",
        dir,
      ],
      { encoding: "utf8" }
    );
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout.includes("POST"), false);
    assert.match(child.stdout, /^PRIOR_RESERVED_HISTORY/);
    assert.equal(harborChatExists(), false);
  });

  it("refuses missing and production keys with zero POSTs and no seed", async () => {
    const missing = await runAuthorizedLunaSummaryExperiment({
      userCostApproved: true,
      experimentKey: null,
      env: {},
      journalDirectory: journalDir(),
      allowRealNetwork: true,
    });
    assert.equal(missing.paidPosts, 0);
    assert.equal(missing.abortReason, "MISSING_EXPERIMENT_KEY");
    assert.equal(harborChatExists(), false);

    const production = await runAuthorizedLunaSummaryExperiment({
      userCostApproved: true,
      experimentKey: "sk-prod",
      env: { CHEAPER_INFERENCE_API_KEY: "sk-prod" },
      journalDirectory: journalDir(),
      allowRealNetwork: true,
    });
    assert.equal(production.paidPosts, 0);
    assert.equal(production.abortReason, "PRODUCTION_KEY_FORBIDDEN");
    assert.equal(harborChatExists(), false);
  });

  it("records HTTP success without accepted=true when summary validation fails", async () => {
    const dir = journalDir();
    let posts = 0;
    const result = await runAuthorizedLunaSummaryExperiment({
      userCostApproved: true,
      experimentKey: EXPERIMENT,
      env: {},
      journalDirectory: dir,
      completion: async (opts) => {
        posts += 1;
        assert.equal(opts.model, LUNA_SUMMARY_LIVE_WIRE_CONTRACT.model);
        assert.equal(opts.temperature, LUNA_SUMMARY_LIVE_WIRE_CONTRACT.temperature);
        assert.equal(opts.maxTokens, LUNA_SUMMARY_LIVE_WIRE_CONTRACT.maxTokens);
        assert.equal(opts.disableReasoning, LUNA_SUMMARY_LIVE_WIRE_CONTRACT.disableReasoning);
        assert.equal(opts.requestKind, LUNA_SUMMARY_LIVE_WIRE_CONTRACT.requestKind);
        const wire = adaptCheaperInferenceChatBody({
          model: opts.model,
          messages: [
            { role: "system", content: opts.system },
            ...opts.history,
          ],
          stream: false,
          temperature: opts.temperature,
          ...(opts.maxTokens != null ? { max_tokens: opts.maxTokens } : {}),
          reasoning: { effort: "none" },
          include_reasoning: false,
        });
        assert.equal(wire.stream, false);
        assert.equal("max_tokens" in wire, false);
        assert.deepEqual(wire.reasoning, { effort: "none" });
        return {
          text: "너무 짧은 응답",
          usage: { inputTokens: 8, outputTokens: 3, estimated: true },
        };
      },
    });
    assert.equal(posts, 1);
    assert.equal(result.networkPosts, 1);
    assert.equal(result.paidPosts, 0);
    assert.equal(result.sealedRounds, 0);
    assert.equal(result.abortReason, "SUMMARY_VALIDATION_FAILED");
    assert.equal(result.journal.entries[0]?.status, "SETTLED");
    assert.equal(result.journal.entries[0]?.accepted, false);
    assert.equal(result.journal.entries[0]?.rejectedReason, "SUMMARY_VALIDATION_FAILED");

    const restart = await runAuthorizedLunaSummaryExperiment({
      userCostApproved: true,
      experimentKey: EXPERIMENT,
      env: {},
      journalDirectory: dir,
      completion: async () => {
        posts += 1;
        return stubCompletion()({
          system: "",
          history: [],
          model: LUNA_SUMMARY_LIVE_WIRE_CONTRACT.model,
        });
      },
    });
    assert.equal(restart.abortReason, "PRIOR_RESERVED_HISTORY");
    assert.equal(posts, 1);
  });

  it("seals 10 stub batches through the live caller without a second retry POST", async () => {
    const dir = journalDir();
    let posts = 0;
    const captured: Array<{
      model: string;
      temperature?: number;
      maxTokens?: number | null;
      disableReasoning?: boolean;
      requestKind?: string;
    }> = [];
    const result = await runAuthorizedLunaSummaryExperiment({
      userCostApproved: true,
      experimentKey: EXPERIMENT,
      env: {},
      journalDirectory: dir,
      completion: async (opts) => {
        posts += 1;
        captured.push({
          model: opts.model,
          temperature: opts.temperature,
          maxTokens: opts.maxTokens,
          disableReasoning: opts.disableReasoning,
          requestKind: opts.requestKind,
        });
        return stubCompletion()(opts);
      },
    });
    assert.equal(result.identity.shaOnlyDifference.requestPayloadUnchanged, true);
    assert.equal(result.identity.ok, true);
    assert.equal(result.sealedRounds, 10);
    assert.equal(result.frontier, AB_COMPLETED_TURNS);
    assert.equal(result.networkPosts, 10);
    assert.equal(result.paidPosts, 0);
    assert.equal(posts, 10);
    assert.equal(result.oracleWrittenToDb, false);
    assert.equal(result.answerKeyLeakedIntoArmA, false);
    assert.match(result.globalMemory, /열쇠/);
    assert.match(result.armAMemory, /열쇠/);
    assert.deepEqual(
      result.journal.entries.map((entry) => entry.requestFingerprint),
      [...LUNA_SUMMARY_LIVE_BATCH_FINGERPRINTS]
    );
    assert.equal(result.journal.entries.every((entry) => entry.status === "SETTLED"), true);
    assert.equal(result.journal.entries.every((entry) => entry.accepted === true), true);
    assert.equal(
      result.journal.entries.every((entry) =>
        Boolean(entry.storedSummaryFingerprint && entry.storedSummaryFingerprint === entry.storedSummaryFingerprint)
      ),
      true
    );
    assert.equal(captured.every((opts) => opts.model === LUNA_SUMMARY_LIVE_WIRE_CONTRACT.model), true);
    assert.equal(captured.every((opts) => opts.temperature === 0.3), true);
    assert.equal(captured.every((opts) => opts.maxTokens === null), true);
    assert.equal(captured.every((opts) => opts.disableReasoning === true), true);
    assert.equal(captured.every((opts) => opts.requestKind === "background-memory-extract"), true);

    const retryCaller = createLunaSummaryLiveCaller({
      experimentKey: EXPERIMENT,
      env: {},
      journal: {
        manifestFingerprint: LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST,
        requestIdentityFingerprint: LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST,
        executed: false,
        networkAttempts: 0,
        entries: [],
      },
      persist() {},
      artifactStore: createLunaDurableJournalStore(journalDir()).artifactStore,
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
    assert.equal(duplicate.abortReason, "PRIOR_RESERVED_HISTORY");
    assert.equal(duplicate.paidPosts, 0);
    assert.equal(result.evalEvidence?.probes.length, AB_PROBES.length);
    assert.equal(result.evalEvidence?.batches.length, 10);
    assert.deepEqual(result.evalEvidence?.graderItems, [...LUNA_SUMMARY_GRADER_ITEMS]);
    assert.equal(result.evalEvidence?.manifestFingerprint, LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST);
    const reopenedWhileDbLive = loadLunaSummaryEvalEvidence(dir);
    assert.equal(reopenedWhileDbLive?.probes.length, 8);
    assert.equal(reopenedWhileDbLive?.globalMemory, result.globalMemory);
    assert.equal(reopenedWhileDbLive?.armAMemory, result.armAMemory);
    assert.equal(reopenedWhileDbLive?.batches.every((batch) => Boolean(batch.rawSummary)), true);
    assert.equal(reopenedWhileDbLive?.batches.every((batch) => Boolean(batch.storedSummary)), true);
    assert.equal(
      reopenedWhileDbLive?.batches.every(
        (batch) => batch.promptTokens != null && batch.completionTokens != null
      ),
      true
    );
  });
});

describe("50-turn Luna eval evidence survives isolated DB removal", () => {
  it("reopens journal texts after the temp DB is gone", async () => {
    installIsolatedTestDatabase();
    const dir = journalDir();
    let result: Awaited<ReturnType<typeof runAuthorizedLunaSummaryExperiment>>;
    try {
      result = await runAuthorizedLunaSummaryExperiment({
        userCostApproved: true,
        experimentKey: EXPERIMENT,
        env: {},
        journalDirectory: dir,
        completion: stubCompletion(),
      });
    } finally {
      uninstallIsolatedTestDatabase();
    }
    assert.equal(result.sealedRounds, 10);
    assert.equal(result.evalEvidence?.probes.map((probe) => probe.id).join(","), AB_PROBES.map((probe) => probe.id).join(","));
    assert.equal(existsSync(lunaSummaryEvalEvidencePath(dir, LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST)), true);
    const reopened = loadLunaSummaryEvalEvidence(dir);
    assert.ok(reopened);
    assert.equal(reopened.evidence.liveApprovalStatus, "NOT_APPROVED");
    assert.equal(reopened.evidence.manifestFingerprint, LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST);
    assert.equal(reopened.globalMemory, result.globalMemory);
    assert.equal(reopened.armAMemory, result.armAMemory);
    assert.match(reopened.globalMemory ?? "", /열쇠/);
    assert.match(reopened.armAMemory ?? "", /열쇠/);
    assert.equal(reopened.probes.length, 8);
    assert.equal(reopened.probes.every((probe) => Boolean(probe.injection && probe.armACurrentMemory)), true);
    assert.equal(reopened.batches.length, 10);
    assert.equal(reopened.batches.every((batch) => Boolean(batch.rawSummary && batch.storedSummary)), true);
    assert.equal(
      reopened.batches.every((batch) => batch.promptTokens === 10 && batch.completionTokens === 20),
      true
    );
    assert.equal(lunaSummaryLiveExecuteManifestFingerprint(), LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST);
    assert.equal(LUNA_SUMMARY_LIVE_APPROVAL_STATUS, "NOT_APPROVED");
  });
});

after(() => {
  try {
    mkdirSync("/opt/cursor/artifacts", { recursive: true });
    writeFileSync(
      "/opt/cursor/artifacts/memory_50turn_luna_summary_execute_prepare.json",
      `${JSON.stringify({
        executeShipped: true,
        liveApprovalStatus: LUNA_SUMMARY_LIVE_APPROVAL_STATUS,
        liveExecuteManifest: LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST,
        liveBatchFingerprints: LUNA_SUMMARY_LIVE_BATCH_FINGERPRINTS,
        paidPostsThisSuite: 0,
      }, null, 2)}\n`,
      "utf8"
    );
  } catch {
    /* CI */
  }
});
