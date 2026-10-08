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
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { CHEAPER_INFERENCE_GPT_6_LUNA_MODEL } from "@/lib/chatModels";
import { CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL } from "@/lib/cheaperInferenceConfig";
import {
  ISOLATED_TEST_DB_REQUIRED,
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import { MEMORY_CAPACITY_FIXED } from "./memory-capacity-shared";
import { resolveGlobalCurrentMemory } from "./memory-lorebook-resolve";
import { buildMemoryContextForChat } from "./memory-manager";
import { listMemoryRecordsForChat } from "./memory-turn-summary";
import { AB_ANSWER_KEY, buildOracleDiagnosticMemory } from "./memory50TurnAbAnswerKey";
import {
  AB_CHAT_ID,
  AB_CHARACTER_ID,
  AB_COMPLETED_TURNS,
  AB_USER_ID,
  cleanupHarborExperimentChat,
  extractiveFakeHarborSummary,
  runHarborAbDryRun,
  seedHarborExperimentChat,
} from "./memory50TurnAbRunner";
import {
  LUNA_SUMMARY_GRADER_ITEMS,
  LUNA_SUMMARY_LIVE_EXECUTE_SHIPPED,
  LUNA_SUMMARY_MAIN_SHA,
  LUNA_SUMMARY_MAX_NETWORK_ATTEMPTS,
  LUNA_SUMMARY_PLANNED_POSTS,
  LUNA_SUMMARY_PREPARE_MODE,
  LUNA_SUMMARY_REQUEST_KIND,
  assertLunaSummaryManifestNotExecuted,
  attemptLunaSummaryLiveExecute,
  buildLunaSummaryPrepareManifest,
  createLunaSummaryCaller,
  estimateLunaSummaryPrepareCost,
  evaluateLunaSummaryGate,
  harborScriptHash,
  lunaSummaryBackgroundOwners,
  lunaSummaryResolvedCaps,
  markLunaSummaryManifestExecuted,
  planLunaSummaryLiveTransport,
  resetLunaSummaryPrepareStateForTests,
  sealHarborWithLunaCaller,
} from "./memory50TurnLunaSummaryPrepare";
import { __setSummarizeTurnBatchCallerForTests, summarizeTurnBatch } from "./memory-rolling-summary";

after(() => {
  resetLunaSummaryPrepareStateForTests();
});

describe("50-turn Luna summary prepare gate (provider-free)", () => {
  it("PREPARE captures 10 batch fingerprints with 0 network posts", async () => {
    assert.equal(LUNA_SUMMARY_PREPARE_MODE, "PREPARE");
    assert.equal(LUNA_SUMMARY_LIVE_EXECUTE_SHIPPED, false);
    assert.equal(LUNA_SUMMARY_MAIN_SHA, "3eea993444daaa0060843ce7d8ac29ae6025f182");
    const caps = lunaSummaryResolvedCaps();
    assert.equal(caps.modelId, CHEAPER_INFERENCE_GPT_6_LUNA_MODEL);
    assert.equal(caps.extractOutputTokensAppliedByLiveCaller, null);
    assert.equal(lunaSummaryBackgroundOwners().completionAdapter, "callOpenRouterCompletion");

    const gate = evaluateLunaSummaryGate({ mode: "PREPARE" });
    assert.equal(gate.ok, true);
    assert.equal(gate.paidPostsAllowed, 0);

    const manifest = await buildLunaSummaryPrepareManifest();
    assert.equal(manifest.providerPosts, 0);
    assert.equal(manifest.approvalStatus, "NOT_APPROVED");
    assert.equal(manifest.plannedPosts, LUNA_SUMMARY_PLANNED_POSTS);
    assert.equal(manifest.maximumNetworkAttempts, LUNA_SUMMARY_MAX_NETWORK_ATTEMPTS);
    assert.equal(manifest.batches.length, 10);
    assert.equal(manifest.modelId, "gpt-6-luna");
    assert.equal(manifest.wireModel, "gpt-6-luna");
    assert.equal(manifest.endpoint, CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL);
    assert.equal(manifest.scriptHash, harborScriptHash());
    assert.equal(manifest.liveCanonBound, false);
    assert.equal(manifest.outputTokenPolicy.productionMaxTokensApplied, null);
    assert.equal(manifest.journalStore.storesSecrets, false);
    assert.equal(manifest.experimentKeyEvidence.keyValueStored, false);
    const source = readFileSync("src/lib/memory/memory50TurnLunaSummaryPrepare.ts", "utf8");
    assert.doesNotMatch(source, /\bfetch\s*\(/);
    assert.doesNotMatch(source, /await callBackgroundMemory\(/);
    assert.doesNotMatch(source, /resolveCheaperInferenceApiKey\s*\(/);
    assert.equal(
      planLunaSummaryLiveTransport({
        experimentKey: "experiment-only-not-production",
        env: {},
      }).denial,
      "LIVE_EXECUTE_NOT_SHIPPED"
    );
    const cost = estimateLunaSummaryPrepareCost(manifest);
    assert.equal(cost.hardMaximumUsd, "UNBOUNDED_WITHOUT_REQUEST_MAX_TOKENS");
    assert.ok(cost.expectedUsdAtAcceptedClamp > 0);
    assert.ok(cost.expectedUsdAtAcceptedClamp < 0.02);
    assert.equal(LUNA_SUMMARY_GRADER_ITEMS.length, AB_ANSWER_KEY.length);
    assert.equal(LUNA_SUMMARY_GRADER_ITEMS.find((item) => item.id === "never_given")?.longMemEvalKind, "abstention");
    assert.equal(
      LUNA_SUMMARY_GRADER_ITEMS.find((item) => item.id === "invalidated_relationship")?.longMemEvalKind,
      "knowledge_update"
    );

    console.log(
      `MEMORY_50TURN_LUNA_PREPARE ${JSON.stringify({
        fingerprint: manifest.manifestFingerprint,
        cost,
        owners: lunaSummaryBackgroundOwners(),
      })}`
    );
    try {
      mkdirSync("/opt/cursor/artifacts", { recursive: true });
      writeFileSync(
        "/opt/cursor/artifacts/memory_50turn_luna_summary_prepare.json",
        `${JSON.stringify({ manifest, cost, graderItems: LUNA_SUMMARY_GRADER_ITEMS }, null, 2)}\n`,
        "utf8"
      );
    } catch {
      // CI does not need the artifact file.
    }
  });

  it("rejects AUTHORIZED without approval, production keys, and live execute", () => {
    assert.equal(
      evaluateLunaSummaryGate({ mode: "AUTHORIZED" }).reason,
      "MISSING_USER_COST_APPROVAL"
    );
    assert.equal(
      evaluateLunaSummaryGate({
        mode: "AUTHORIZED",
        userCostApproved: true,
      }).reason,
      "MISSING_EXPERIMENT_KEY"
    );
    assert.equal(
      evaluateLunaSummaryGate({
        mode: "AUTHORIZED",
        userCostApproved: true,
        experimentKey: "sk-prod",
        env: { CHEAPER_INFERENCE_API_KEY: "sk-prod" },
      }).reason,
      "PRODUCTION_KEY_FORBIDDEN"
    );
    const live = attemptLunaSummaryLiveExecute({
      mode: "AUTHORIZED",
      userCostApproved: true,
      experimentKey: "experiment-only-not-production",
      env: {},
    });
    assert.equal(live.executed, false);
    assert.equal(live.paidPosts, 0);
    assert.equal(live.gate.reason, "LIVE_EXECUTE_NOT_SHIPPED");
    assert.equal(
      evaluateLunaSummaryGate({
        mode: "AUTHORIZED",
        userCostApproved: true,
        experimentKey: "experiment-only-not-production",
        env: {},
        approvedManifestFingerprint: "old",
        expectedManifestFingerprint: "new",
      }).reason,
      "MANIFEST_FINGERPRINT_MISMATCH"
    );
  });

  it("refuses extra network posts on internal retry and after the hard limit", async () => {
    const journal = [];
    const limited = createLunaSummaryCaller({
      journal,
      stubSummary: () => "x".repeat(80),
      countStubAsNetwork: true,
      maxNetworkAttempts: 1,
    });
    const first = await limited("sys", [{ role: "user", content: "u" }], undefined, LUNA_SUMMARY_REQUEST_KIND);
    assert.equal(first.text.length, 80);
    assert.equal(limited.networkPosts, 1);
    await assert.rejects(
      () => limited("sys", [{ role: "user", content: "u" }], undefined, LUNA_SUMMARY_REQUEST_KIND),
      /NETWORK_ATTEMPT_LIMIT/
    );
    await assert.rejects(
      () =>
        limited("sys", [{ role: "user", content: "u" }], undefined, "background-memory-extract-retry"),
      /INTERNAL_RETRY_NETWORK_FORBIDDEN/
    );
    assert.equal(limited.networkPosts, 1);

    const unknown = { value: false };
    const uncertain = createLunaSummaryCaller({
      journal: [],
      stubSummary: () => {
        unknown.value = true;
        return "x".repeat(80);
      },
      lastUnknown: unknown,
    });
    await uncertain("sys", [{ role: "user", content: "u" }], undefined, LUNA_SUMMARY_REQUEST_KIND);
    await assert.rejects(
      () => uncertain("sys", [{ role: "user", content: "retry" }], undefined, LUNA_SUMMARY_REQUEST_KIND),
      /UNKNOWN_UNRESOLVED_NO_RESEND/
    );

    const prepareOnly = createLunaSummaryCaller({ journal: [] });
    await assert.rejects(
      () => prepareOnly("sys", [{ role: "user", content: "u" }], undefined, LUNA_SUMMARY_REQUEST_KIND),
      /PREPARE_MODE_DOES_NOT_POST/
    );
    assert.equal(prepareOnly.networkPosts, 0);

    const retryJournal = [];
    const retryCaller = createLunaSummaryCaller({
      journal: retryJournal,
      stubSummary: () => "",
      countStubAsNetwork: true,
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
  });

  it("rejects duplicate manifest execution", () => {
    resetLunaSummaryPrepareStateForTests();
    markLunaSummaryManifestExecuted("abc");
    assert.throws(() => assertLunaSummaryManifestNotExecuted("abc"), /DUPLICATE_MANIFEST_EXECUTION/);
    assert.doesNotThrow(() => assertLunaSummaryManifestNotExecuted("def"));
  });

  it("refuses seal without an isolated database", async () => {
    await assert.rejects(
      () =>
        sealHarborWithLunaCaller({
          stubSummary: extractiveFakeHarborSummary,
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, new RegExp(ISOLATED_TEST_DB_REQUIRED));
        return true;
      }
    );
  });
});

describe("50-turn Luna summary prepare isolated stub (provider-free)", () => {
  before(() => installIsolatedTestDatabase());
  after(() => {
    __setSummarizeTurnBatchCallerForTests(null);
    cleanupHarborExperimentChat();
    uninstallIsolatedTestDatabase();
    resetLunaSummaryPrepareStateForTests();
  });

  it("refuses seal without isolation when DATA_DIR is swapped", () => {
    const previous = process.env.DATA_DIR;
    process.env.DATA_DIR = "/tmp/luna-summary-not-isolated";
    try {
      assert.throws(
        () => seedHarborExperimentChat(),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, new RegExp(ISOLATED_TEST_DB_REQUIRED));
          return true;
        }
      );
    } finally {
      process.env.DATA_DIR = previous;
    }
  });

  it("seals 10 batches through the Luna caller without extra network posts", async () => {
    seedHarborExperimentChat();
    const sealed = await sealHarborWithLunaCaller({
      stubSummary: extractiveFakeHarborSummary,
      countStubAsNetwork: true,
    });
    assert.equal(sealed.sealedRounds, 10);
    assert.equal(sealed.frontier, AB_COMPLETED_TURNS);
    assert.equal(sealed.networkPosts, 10);
    assert.equal(sealed.abortReason, null);
    assert.ok(sealed.networkPosts <= LUNA_SUMMARY_MAX_NETWORK_ATTEMPTS);
    const stored = listMemoryRecordsForChat(AB_CHAT_ID).filter((record) => !record.inactive);
    assert.equal(stored.length, 10);
    const global = resolveGlobalCurrentMemory(AB_CHAT_ID, MEMORY_CAPACITY_FIXED);
    assert.match(global.text, /열쇠/);
    const injection = await buildMemoryContextForChat({
      chatId: AB_CHAT_ID,
      userId: AB_USER_ID,
      characterId: AB_CHARACTER_ID,
      tier: "pro",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
      userMessage: "셔터 고리에 손을 얹는다.",
      modelId: "deepseek-v4.1-flash",
    });
    assert.match(injection.text, /열쇠/);
    assert.equal(injection.text.includes("[진단 메모]"), false);
  });

  it("stops the next batch on an empty summary and does not resend", async () => {
    seedHarborExperimentChat();
    let calls = 0;
    const sealed = await sealHarborWithLunaCaller({
      stubSummary: () => {
        calls += 1;
        return calls === 1 ? "" : extractiveFakeHarborSummary("유저: 봄 밀물 전까지 열쇠를 외투에 둔다. 시 의회에는 넘기지 않는다.");
      },
      countStubAsNetwork: true,
    });
    assert.equal(sealed.sealedRounds, 0);
    assert.equal(sealed.networkPosts, 1);
    assert.equal(sealed.abortReason, "EMPTY_SUMMARY_STOP");
  });

  it("rejects a concurrent seal of the same prepare path", async () => {
    seedHarborExperimentChat();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = sealHarborWithLunaCaller({
      stubSummary: async (user) => {
        await held;
        return extractiveFakeHarborSummary(user);
      },
      countStubAsNetwork: true,
    });
    await new Promise((resolve) => setImmediate(resolve));
    const second = await sealHarborWithLunaCaller({
      stubSummary: extractiveFakeHarborSummary,
      countStubAsNetwork: true,
    });
    assert.equal(second.abortReason, "CONCURRENT_LAUNCH");
    assert.equal(second.networkPosts, 0);
    release();
    const finished = await first;
    assert.equal(finished.sealedRounds, 10);
    assert.equal(finished.networkPosts, 10);
  });

  it("injects stored summary into arm A and keeps the oracle out of A/DB", async () => {
    const result = await runHarborAbDryRun({ refreshTurn1: true });
    assert.equal(result.status, "READY");
    assert.equal(result.paidPosts, 0);
    assert.equal(result.frontier, 50);
    assert.equal(result.reconnectMatched, true);
    assert.equal(result.regenKeptPromise, true);
    assert.equal(result.oracleWrittenToDb, false);
    assert.equal(result.answerKeyLeakedIntoArmA, false);
    const promise = result.traces.find((row) => row.id === "promise");
    assert.equal(promise?.inArmA, true);
    assert.equal(promise?.inStoredSummary, true);
    assert.equal(buildOracleDiagnosticMemory().includes("[진단 메모]"), true);
    for (const row of result.assemblies.filter((item) => item.arm === "A")) {
      assert.equal(row.hasOracleHeader, false);
    }
  });
});
