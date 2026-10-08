import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  MAIN_RP_MODEL_IDS,
  selectedAIProvider,
  type SelectedAI,
} from "@/lib/chatModels";
import { CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL } from "@/lib/cheaperInferenceConfig";
import {
  OPENROUTER_CHAT_COMPLETIONS_URL,
  resolveMainRpPrimaryWireModelId,
} from "@/lib/openRouterConfig";
import { resolveOpenRouterMaxTokens } from "@/lib/openRouterClient";
import {
  RP_QUALITY_PRECALL_FIXTURE_IDS,
  RP_QUALITY_PRECALL_MUTATION_POLICY,
  RP_QUALITY_PRECALL_PAID_STATUS,
  startRpQualityPrecallPaidExecution,
} from "@/lib/rpQualityPrecall";
import {
  RP_QUALITY_PAID_EXPERIMENT_SECRET_ENV,
  assertCurrentMainRpPaidAllowlist,
  buildPaidRunnerPublicManifest,
  createFilePaidRunnerJournalStore,
  createLivePaidRunnerTransport,
  createMemoryPaidRunnerJournalStore,
  createMockPaidRunnerTransport,
  createPaidRunnerJournal,
  evaluatePaidRunnerAuthorization,
  expectedPaidRunnerProvider,
  experimentSecretUsesProductionKey,
  isWellFormedPaidExperimentSecret,
  journalCanStartNextCall,
  paidRunnerManifestDraft,
  paidRunnerManifestFingerprint,
  paidRunnerRequestBodyFingerprint,
  paidRunnerRegistrySnapshot,
  paidRunnerSoftAimUncapped,
  publicMetadataContainsSecret,
  runPaidRunner,
  type PaidRunnerAuthorizationInput,
  type PaidRunnerIdentityHashes,
  type PaidRunnerJournalStore,
  type PaidRunnerPublicManifest,
  type PaidRunnerSealedCall,
} from "@/lib/rpQualityPaidRunner";

const SECRET = "rpq-paid-test-secret-000000000001";
const MAIN_SHA = "b1ade0f7f89708a3d29ca22e69a16256fab17413";
const DEPLOY_SHA = MAIN_SHA;
const HASHES: PaidRunnerIdentityHashes = {
  greetingSha256: "ab".repeat(32),
  systemPromptSha256: "cd".repeat(32),
  worldSha256: "ef".repeat(32),
  settingChunksSha256: "11".repeat(32),
  personaPublicSha256: "22".repeat(32),
};

function sealedCalls(): PaidRunnerSealedCall[] {
  const calls: PaidRunnerSealedCall[] = [];
  let order = 1;
  for (const fixtureId of RP_QUALITY_PRECALL_FIXTURE_IDS) {
    for (const canonicalId of MAIN_RP_MODEL_IDS) {
      const provider = expectedPaidRunnerProvider(canonicalId);
      const wireModel = resolveMainRpPrimaryWireModelId(canonicalId);
      const body = { model: wireModel, stream: true, messages: [{ role: "user", content: "hi" }] };
      calls.push({
        requestOrder: order,
        fixtureId,
        canonicalId,
        provider,
        wireModel,
        endpointKind: provider,
        endpoint: provider === "openrouter"
          ? OPENROUTER_CHAT_COMPLETIONS_URL
          : CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
        finalWireFingerprint: `${"aa".repeat(32)}${order.toString(16).padStart(2, "0")}`.slice(0, 64),
        requestBodyFingerprint: paidRunnerRequestBodyFingerprint(body),
        effectiveCanonMode: "FULL_LEGACY",
        authoringLevel: "NORMAL",
        contentMode: "SAFE",
        maxTokensPresent: false,
        requestBody: body,
      });
      order += 1;
    }
  }
  return calls;
}

function pack(overrides: Partial<PaidRunnerPublicManifest> = {}) {
  const calls = sealedCalls();
  const manifest = { ...buildPaidRunnerPublicManifest({
    mainSha: MAIN_SHA,
    productionDeploySha: DEPLOY_SHA,
    identityHashes: HASHES,
    sealedCalls: calls,
  }), ...overrides };
  if (overrides.calls || overrides.productionDeploySha || overrides.identityHash) {
    // keep explicit override
  }
  return { manifest, sealedCalls: calls };
}

function auth(manifest: PaidRunnerPublicManifest, extra: Partial<PaidRunnerAuthorizationInput> = {}): PaidRunnerAuthorizationInput {
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

describe("rp quality paid runner prepare and mock execution", () => {
  it("A. mock 12 calls settle exactly 12 times with provider POST 0", async () => {
    const { manifest, sealedCalls: calls } = pack();
    const result = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls: calls,
      authorization: auth(manifest),
      transport: createMockPaidRunnerTransport(),
    });
    assert.equal(result.transportPosts, 12);
    assert.equal(result.providerPosts, 0);
    assert.equal(result.networkAttempts, 0);
    assert.equal(result.dbWrites, 0);
    assert.equal(result.publicResults.length, 12);
    assert.equal(result.privateResults.length, 12);
    assert.equal(result.journal.entries.filter((entry) => entry.status === "SETTLED").length, 12);
  });

  it("B. thirteenth request is rejected", () => {
    const { manifest } = pack();
    const journal = createPaidRunnerJournal(manifest.manifestFingerprint);
    const extra = { ...manifest.calls[0]!, requestOrder: 13 };
    const gate = journalCanStartNextCall(journal, extra);
    assert.equal(gate.ok, false);
    if (!gate.ok) assert.equal(gate.reason, "THIRTEENTH_CALL_FORBIDDEN");
  });

  it("C. duplicate manifest execution is blocked", async () => {
    const { manifest, sealedCalls: calls } = pack();
    const journal = createPaidRunnerJournal(manifest.manifestFingerprint);
    const first = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls: calls,
      authorization: auth(manifest),
      transport: createMockPaidRunnerTransport(),
      journal,
    });
    assert.equal(first.transportPosts, 12);
    const second = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls: calls,
      authorization: auth(manifest),
      transport: createMockPaidRunnerTransport(),
      journal,
    });
    assert.equal(second.transportPosts, 0);
    assert.equal(second.denialReason, "DUPLICATE_MANIFEST_EXECUTION");
  });

  it("D. same fixture/model replay is blocked", () => {
    const { manifest } = pack();
    const journal = createPaidRunnerJournal(manifest.manifestFingerprint);
    journal.entries.push({
      requestOrder: 1,
      fixtureId: manifest.calls[0]!.fixtureId,
      canonicalId: manifest.calls[0]!.canonicalId,
      finalWireFingerprint: manifest.calls[0]!.finalWireFingerprint,
      requestBodyFingerprint: manifest.calls[0]!.requestBodyFingerprint,
      status: "SETTLED",
      settlementSource: "provider_exact",
      providerRequestId: "x",
      httpResult: 200,
      finishReason: "stop",
      promptTokens: 1,
      completionTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      billedUsd: 0.01,
      visibleChars: 10,
      elapsedMs: 1,
      blockReason: null,
    });
    const gate = journalCanStartNextCall(journal, manifest.calls[0]!);
    assert.equal(gate.ok, false);
    if (!gate.ok) assert.equal(gate.reason, "FIXTURE_MODEL_REPLAY");
  });

  it("E-K. authorization denials keep POST 0", async () => {
    const { manifest, sealedCalls: calls } = pack();
    const cases: Array<[Partial<PaidRunnerAuthorizationInput> | { mode?: "PREPARE" }, string]> = [
      [{ userCostApproved: false }, "MISSING_USER_COST_APPROVAL"],
      [{ experimentSecret: null }, "MISSING_EXPERIMENT_SECRET"],
      [{ experimentSecret: "sk-not-an-experiment" }, "MALFORMED_EXPERIMENT_SECRET"],
      [{ approvedManifestFingerprint: "0".repeat(64) }, "MANIFEST_FINGERPRINT_MISMATCH"],
      [{ expectedProductionSha: "1".repeat(40) }, "PRODUCTION_SHA_MISMATCH"],
      [{ expectedIdentityHash: "2".repeat(64) }, "IDENTITY_HASH_MISMATCH"],
      [{ allowlist: ["deepseek-v4.1-flash"] as SelectedAI[] }, "MODEL_ALLOWLIST_MISMATCH"],
    ];
    for (const [extra, reason] of cases) {
      const result = await runPaidRunner({
        mode: extra && "mode" in extra ? "PREPARE" : "AUTHORIZED",
        manifest,
        sealedCalls: calls,
        authorization: auth(manifest, extra),
        transport: createMockPaidRunnerTransport(),
      });
      assert.equal(result.providerPosts, 0, reason);
      assert.equal(result.transportPosts, 0, reason);
      assert.equal(result.denialReason, reason);
    }
    const prepare = await runPaidRunner({
      mode: "PREPARE",
      manifest,
      sealedCalls: calls,
      authorization: auth(manifest),
      transport: createMockPaidRunnerTransport(),
    });
    assert.equal(prepare.denialReason, "PREPARE_MODE_DOES_NOT_POST");
    assert.equal(prepare.transportPosts, 0);
    process.env.OPENROUTER_API_KEY = "sk-or-production-lookalike-0001";
    assert.equal(experimentSecretUsesProductionKey("sk-or-production-lookalike-0001"), true);
    const fallback = evaluatePaidRunnerAuthorization(manifest, auth(manifest, {
      experimentSecret: "sk-or-production-lookalike-0001",
    }), "AUTHORIZED");
    assert.equal(fallback.authorized, false);
    if (!fallback.authorized) assert.equal(fallback.reason, "PRODUCTION_KEY_FALLBACK_FORBIDDEN");
    delete process.env.OPENROUTER_API_KEY;
    const mappedCalls = manifest.calls.map((call, index) => index === 0 ? { ...call, provider: "openrouter" as const, wireModel: "wrong" } : call);
    const mappedDraft = { ...paidRunnerManifestDraft(manifest), calls: mappedCalls };
    const mapped = {
      ...manifest,
      calls: mappedCalls,
      manifestFingerprint: paidRunnerManifestFingerprint(mappedDraft),
    };
    const mapping = evaluatePaidRunnerAuthorization(mapped, auth(mapped), "AUTHORIZED");
    assert.equal(mapping.authorized, false);
    if (!mapping.authorized) assert.equal(mapping.reason, "PROVIDER_MAPPING_MISMATCH");
  });

  it("L. timeout/unknown blocks later calls", async () => {
    const { manifest, sealedCalls: calls } = pack();
    const result = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls: calls,
      authorization: auth(manifest),
      transport: createMockPaidRunnerTransport({ failAt: 1, failureKind: "timeout" }),
    });
    assert.equal(result.transportPosts, 1);
    assert.equal(result.providerPosts, 0);
    assert.equal(result.denialReason, "PRIOR_CALL_UNRESOLVED");
    assert.equal(result.journal.entries[0]?.status, "UNKNOWN_UNRESOLVED");
    const next = journalCanStartNextCall(result.journal, manifest.calls[1]!);
    assert.equal(next.ok, false);
  });

  it("M. missing cost evidence blocks later calls", async () => {
    const { manifest, sealedCalls: calls } = pack();
    const result = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls: calls,
      authorization: auth(manifest),
      transport: createMockPaidRunnerTransport({ omitBilledUsd: true, omitRequestId: true }),
    });
    assert.equal(result.transportPosts, 1);
    assert.equal(result.denialReason, "COST_EVIDENCE_MISSING");
  });

  it("N. partial stream is a clear failure and does not retry", async () => {
    const { manifest, sealedCalls: calls } = pack();
    const result = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls: calls,
      authorization: auth(manifest),
      transport: createMockPaidRunnerTransport({ failAt: 1, failureKind: "partial_stream" }),
    });
    assert.equal(result.transportPosts, 1);
    assert.equal(result.journal.entries[0]?.status, "UNKNOWN_UNRESOLVED");
    assert.equal(result.journal.entries[0]?.finishReason, "partial_stream");
  });

  it("O. malformed provider response stops the run", async () => {
    const { manifest, sealedCalls: calls } = pack();
    const result = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls: calls,
      authorization: auth(manifest),
      transport: createMockPaidRunnerTransport({ failAt: 1, failureKind: "malformed" }),
    });
    assert.equal(result.transportPosts, 1);
    assert.equal(result.journal.entries[0]?.status, "FAILED");
  });

  it("P. restart after uncertain POST does not replay", () => {
    const { manifest } = pack();
    const journal = createPaidRunnerJournal(manifest.manifestFingerprint);
    journal.entries.push({
      requestOrder: 1,
      fixtureId: manifest.calls[0]!.fixtureId,
      canonicalId: manifest.calls[0]!.canonicalId,
      finalWireFingerprint: manifest.calls[0]!.finalWireFingerprint,
      requestBodyFingerprint: manifest.calls[0]!.requestBodyFingerprint,
      status: "UNKNOWN_UNRESOLVED",
      settlementSource: "unsettled",
      providerRequestId: null,
      httpResult: null,
      finishReason: "timeout",
      promptTokens: null,
      completionTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      reasoningTokens: null,
      billedUsd: null,
      visibleChars: null,
      elapsedMs: 1,
      blockReason: null,
    });
    assert.equal(journalCanStartNextCall(journal, manifest.calls[0]!).ok, false);
    assert.equal(journalCanStartNextCall(journal, manifest.calls[1]!).ok, false);
  });

  it("Q-R. secrets and output text stay out of public metadata", async () => {
    const { manifest, sealedCalls: calls } = pack();
    const result = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls: calls,
      authorization: auth(manifest),
      transport: createMockPaidRunnerTransport(),
    });
    const publicJson = JSON.stringify({ manifest, publicResults: result.publicResults });
    assert.equal(publicJson.includes(SECRET), false);
    assert.equal(publicJson.includes("Authorization"), false);
    assert.equal(result.publicMetadataSafe, true);
    assert.equal(publicMetadataContainsSecret({ token: SECRET }), true);
    assert.ok(result.privateResults[0]?.packet.generatedText.includes("모의 출력"));
  });

  it("S. 3200+ soft aim and no max_tokens", () => {
    const length = paidRunnerSoftAimUncapped();
    assert.equal(length.softAimChars, 3200);
    assert.equal(length.applicationMaxTokens, undefined);
    assert.equal(resolveOpenRouterMaxTokens(3200, 8192, "gemini-3.8-flash"), undefined);
    const { sealedCalls: calls } = pack();
    for (const call of calls) {
      assert.equal("max_tokens" in call.requestBody, false);
      assert.equal(call.maxTokensPresent, false);
    }
  });

  it("T. mock evaluation scores stay null", async () => {
    const { manifest, sealedCalls: calls } = pack();
    const result = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls: calls,
      authorization: auth(manifest),
      transport: createMockPaidRunnerTransport(),
    });
    for (const row of result.privateResults) {
      assert.ok(Object.values(row.packet.scores).every((score) => score === null));
    }
    for (const row of result.publicResults) {
      assert.ok(Object.values(row.scores).every((score) => score === null));
    }
  });

  it("U. PRECALL default owner still does not execute", () => {
    const denied = startRpQualityPrecallPaidExecution({
      approvedCostBoundUsd: 25,
      paidExecutionAuthorized: true,
    });
    assert.equal(denied.started, false);
    assert.equal(denied.providerPosts, 0);
    assert.equal(denied.paidExecutionStatus, RP_QUALITY_PRECALL_PAID_STATUS);
  });

  it("V. registry mapping is the current Main RP picker", () => {
    const snapshot = paidRunnerRegistrySnapshot();
    assert.equal(snapshot.models.length, 4);
    assert.deepEqual(snapshot.fixtures, RP_QUALITY_PRECALL_FIXTURE_IDS);
    assert.equal(snapshot.plannedCalls, 12);
    assertCurrentMainRpPaidAllowlist(MAIN_RP_MODEL_IDS);
    assert.equal(selectedAIProvider("gemini-3.8-flash"), "openrouter");
    assert.equal(selectedAIProvider("deepseek-v4.1-flash"), "cheaperinference");
    assert.equal(selectedAIProvider("gpt-6.1-sol"), "cheaperinference");
    assert.equal(selectedAIProvider("claude-opus-5.5"), "cheaperinference");
    assert.equal(resolveMainRpPrimaryWireModelId("gemini-3.8-flash"), "google/gemini-3.8-flash");
  });

  it("W. chat/billing/DB mutation policy stays false", () => {
    assert.equal(RP_QUALITY_PRECALL_MUTATION_POLICY.db, false);
    assert.equal(RP_QUALITY_PRECALL_MUTATION_POLICY.userPoints, false);
    assert.equal(RP_QUALITY_PRECALL_MUTATION_POLICY.chat, false);
    const src = readFileSync("src/lib/rpQualityPaidRunner.ts", "utf8");
    assert.doesNotMatch(src, /getDb\(|INSERT INTO|user_points|POST \/api\/chat/);
    assert.match(src, /LIVE_TRANSPORT_NOT_SHIPPED/);
  });

  it("default prepare CLI stays no-network and refuses --authorized", () => {
    const ok = execFileSync(process.execPath, [
      "--conditions=react-server",
      "--import",
      "tsx",
      "scripts/rp-quality-paid-runner.ts",
    ], { encoding: "utf8" });
    const report = JSON.parse(ok) as { providerPosts: number; mode: string; reason: string };
    assert.equal(report.mode, "PREPARE");
    assert.equal(report.providerPosts, 0);
    assert.equal(report.reason, "PREPARE_DEFAULT_NO_NETWORK");
    let failed = false;
    try {
      execFileSync(process.execPath, [
        "--conditions=react-server",
        "--import",
        "tsx",
        "scripts/rp-quality-paid-runner.ts",
        "--authorized",
      ], { encoding: "utf8" });
    } catch (error) {
      failed = true;
      const stdout = String((error as { stdout?: string }).stdout ?? "");
      assert.match(stdout, /WRONG_ENTRYPOINT/);
      assert.match(stdout, /"providerPosts": 0/);
    }
    assert.equal(failed, true);
    assert.equal(isWellFormedPaidExperimentSecret(SECRET), true);
    assert.throws(() => createLivePaidRunnerTransport(), /LIVE_TRANSPORT_NOT_SHIPPED/);
    assert.equal(RP_QUALITY_PAID_EXPERIMENT_SECRET_ENV, "RP_QUALITY_PAID_EXPERIMENT_SECRET");
  });

  it("replay after timeout keeps UNKNOWN and does not POST again", async () => {
    const { manifest, sealedCalls: calls } = pack();
    const journal = createPaidRunnerJournal(manifest.manifestFingerprint);
    const first = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls: calls,
      authorization: auth(manifest),
      transport: createMockPaidRunnerTransport({ failAt: 1, failureKind: "timeout" }),
      journal,
    });
    assert.equal(first.transportPosts, 1);
    assert.equal(first.journal.entries[0]?.status, "UNKNOWN_UNRESOLVED");
    const second = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls: calls,
      authorization: auth(manifest),
      transport: createMockPaidRunnerTransport(),
      journal,
    });
    assert.equal(second.transportPosts, 0);
    assert.equal(second.providerPosts, 0);
    assert.equal(second.journal.entries[0]?.status, "UNKNOWN_UNRESOLVED");
    assert.ok(
      second.denialReason === "FIXTURE_MODEL_REPLAY" ||
        second.denialReason === "PRIOR_CALL_UNRESOLVED"
    );
  });

  it("leftover SENT after crash is recovered as UNKNOWN and is not resent", async () => {
    const { manifest, sealedCalls: calls } = pack();
    const journal = createPaidRunnerJournal(manifest.manifestFingerprint);
    journal.entries.push({
      requestOrder: 1,
      fixtureId: manifest.calls[0]!.fixtureId,
      canonicalId: manifest.calls[0]!.canonicalId,
      finalWireFingerprint: manifest.calls[0]!.finalWireFingerprint,
      requestBodyFingerprint: manifest.calls[0]!.requestBodyFingerprint,
      status: "SENT",
      settlementSource: "unsettled",
      providerRequestId: null,
      httpResult: null,
      finishReason: null,
      promptTokens: null,
      completionTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      reasoningTokens: null,
      billedUsd: null,
      visibleChars: null,
      elapsedMs: null,
      blockReason: null,
    });
    const result = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls: calls,
      authorization: auth(manifest),
      transport: createMockPaidRunnerTransport(),
      journal,
    });
    assert.equal(result.transportPosts, 0);
    assert.equal(result.journal.entries[0]?.status, "UNKNOWN_UNRESOLVED");
    assert.equal(result.denialReason, "PRIOR_CALL_UNRESOLVED");
  });

  it("journal persist failure stops before the first POST", async () => {
    const { manifest, sealedCalls: calls } = pack();
    const store: PaidRunnerJournalStore = {
      kind: "memory",
      load: () => null,
      persist() {
        throw new Error("disk full");
      },
      tryAcquireExclusiveLock() {
        return { ok: true, lock: { release() {} } };
      },
    };
    const result = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls: calls,
      authorization: auth(manifest),
      transport: createMockPaidRunnerTransport(),
      journalStore: store,
    });
    assert.equal(result.transportPosts, 0);
    assert.equal(result.denialReason, "JOURNAL_STORE_UNAVAILABLE");
  });

  it("concurrent launch on the same manifest is rejected with zero POSTs", async () => {
    const { manifest, sealedCalls: calls } = pack();
    const store = createMemoryPaidRunnerJournalStore();
    const held = store.tryAcquireExclusiveLock(manifest.manifestFingerprint);
    assert.equal(held.ok, true);
    try {
      const result = await runPaidRunner({
        mode: "AUTHORIZED",
        manifest,
        sealedCalls: calls,
        authorization: auth(manifest),
        transport: createMockPaidRunnerTransport(),
        journalStore: store,
      });
      assert.equal(result.transportPosts, 0);
      assert.equal(result.denialReason, "CONCURRENT_LAUNCH");
    } finally {
      if (held.ok) held.lock.release();
    }
  });

  it("file journal fingerprint mismatch and exclusive lock fail closed", async () => {
    const { manifest, sealedCalls: calls } = pack();
    const dir = mkdtempSync(path.join(tmpdir(), "rpq-journal-"));
    const store = createFilePaidRunnerJournalStore(dir);
    const held = store.tryAcquireExclusiveLock(manifest.manifestFingerprint);
    assert.equal(held.ok, true);
    try {
      const concurrent = await runPaidRunner({
        mode: "AUTHORIZED",
        manifest,
        sealedCalls: calls,
        authorization: auth(manifest),
        transport: createMockPaidRunnerTransport(),
        journalStore: store,
      });
      assert.equal(concurrent.transportPosts, 0);
      assert.equal(concurrent.denialReason, "CONCURRENT_LAUNCH");
    } finally {
      if (held.ok) held.lock.release();
    }
    const other = createPaidRunnerJournal("cd".repeat(32));
    const mismatch = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls: calls,
      authorization: auth(manifest),
      transport: createMockPaidRunnerTransport(),
      journal: other,
    });
    assert.equal(mismatch.transportPosts, 0);
    assert.equal(mismatch.denialReason, "JOURNAL_FINGERPRINT_MISMATCH");
  });

  it("tampered sealed bodies and manifest fields never reach mock POST", async () => {
    const { manifest, sealedCalls: calls } = pack();
    const cases: Array<[string, { manifest?: PaidRunnerPublicManifest; sealedCalls?: PaidRunnerSealedCall[] }]> = [
      ["user message 1-char", {
        sealedCalls: calls.map((call, index) => index === 0
          ? {
              ...call,
              requestBody: {
                ...call.requestBody,
                messages: [{ role: "user", content: "hj" }],
              },
            }
          : call),
      }],
      ["system content", {
        sealedCalls: calls.map((call, index) => index === 0
          ? {
              ...call,
              requestBody: {
                ...call.requestBody,
                messages: [
                  { role: "system", content: "changed-system" },
                  { role: "user", content: "hi" },
                ],
              },
            }
          : call),
      }],
      ["endpoint", {
        sealedCalls: calls.map((call, index) => index === 0
          ? { ...call, endpoint: "https://example.invalid/v1/chat/completions" }
          : call),
      }],
      ["provider", {
        sealedCalls: calls.map((call, index) => index === 0
          ? { ...call, provider: call.provider === "openrouter" ? "cheaperinference" : "openrouter" }
          : call),
      }],
      ["wire model", {
        sealedCalls: calls.map((call, index) => index === 0
          ? { ...call, wireModel: "tampered/wire-model" }
          : call),
      }],
      ["manifest order", {
        manifest: {
          ...manifest,
          calls: [manifest.calls[1]!, manifest.calls[0]!, ...manifest.calls.slice(2)],
        },
      }],
      ["missing sealedCalls", { sealedCalls: calls.slice(0, 11) }],
      ["13 sealedCalls", { sealedCalls: [...calls, { ...calls[0]!, requestOrder: 13 }] }],
      ["identityHash", {
        manifest: { ...manifest, identityHash: "33".repeat(32) },
      }],
      ["manifestFingerprint", {
        manifest: { ...manifest, manifestFingerprint: "44".repeat(32) },
      }],
      ["requestBodyFingerprint", {
        manifest: {
          ...manifest,
          calls: manifest.calls.map((call, index) => index === 0
            ? { ...call, requestBodyFingerprint: "55".repeat(32) }
            : call),
        },
      }],
    ];
    for (const [label, override] of cases) {
      const result = await runPaidRunner({
        mode: "AUTHORIZED",
        manifest: override.manifest ?? manifest,
        sealedCalls: override.sealedCalls ?? calls,
        authorization: auth(override.manifest ?? manifest),
        transport: createMockPaidRunnerTransport(),
      });
      assert.equal(result.transportPosts, 0, label);
      assert.equal(result.providerPosts, 0, label);
      assert.ok(result.denialReason, label);
    }
  });

  it("transport throw/reject/reset and settlement defects stop without retry", async () => {
    const { manifest, sealedCalls: calls } = pack();
    const throwResult = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls: calls,
      authorization: auth(manifest),
      transport: createMockPaidRunnerTransport({ throwAt: 1 }),
    });
    assert.equal(throwResult.transportPosts, 1);
    assert.equal(throwResult.journal.entries[0]?.status, "UNKNOWN_UNRESOLVED");
    assert.equal(throwResult.journal.entries[0]?.finishReason, "throw");

    const rejectResult = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls: calls,
      authorization: auth(manifest),
      transport: createMockPaidRunnerTransport({ rejectAt: 1 }),
    });
    assert.equal(rejectResult.transportPosts, 1);
    assert.equal(rejectResult.journal.entries[0]?.status, "UNKNOWN_UNRESOLVED");

    const resetResult = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls: calls,
      authorization: auth(manifest),
      transport: createMockPaidRunnerTransport({ failAt: 1, failureKind: "connection_reset" }),
    });
    assert.equal(resetResult.transportPosts, 1);
    assert.equal(resetResult.journal.entries[0]?.status, "UNKNOWN_UNRESOLVED");

    const httpResult = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls: calls,
      authorization: auth(manifest),
      transport: createMockPaidRunnerTransport({ httpStatus: 500 }),
    });
    assert.equal(httpResult.transportPosts, 1);
    assert.equal(httpResult.journal.entries[0]?.status, "FAILED");

    const zeroBill = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls: calls,
      authorization: auth(manifest),
      transport: createMockPaidRunnerTransport({ billedUsd: 0 }),
    });
    assert.equal(zeroBill.transportPosts, 1);
    assert.equal(zeroBill.denialReason, "COST_EVIDENCE_MISSING");
    assert.notEqual(zeroBill.journal.entries[0]?.settlementSource, "provider_exact");

    const negativeBill = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls: calls,
      authorization: auth(manifest),
      transport: createMockPaidRunnerTransport({ billedUsd: -0.01 }),
    });
    assert.equal(negativeBill.transportPosts, 1);
    assert.equal(negativeBill.denialReason, "COST_EVIDENCE_MISSING");

    const wrongModel = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls: calls,
      authorization: auth(manifest),
      transport: createMockPaidRunnerTransport({ wrongModel: true }),
    });
    assert.equal(wrongModel.transportPosts, 1);
    assert.equal(wrongModel.journal.entries[0]?.status, "FAILED");
    assert.equal(wrongModel.journal.entries[0]?.finishReason, "wrong_provider_model");

    const happy = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls: calls,
      authorization: auth(manifest),
      transport: createMockPaidRunnerTransport(),
    });
    assert.equal(happy.transportPosts, 12);
    assert.equal(happy.providerPosts, 0);
    assert.equal(happy.journal.entries.every((entry) => entry.settlementSource === "mock_exact"), true);
    assert.equal(happy.journal.entries.every((entry) => entry.settlementSource !== "provider_exact"), true);
  });
});
