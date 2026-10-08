import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import { CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL } from "@/lib/cheaperInferenceConfig";
import {
  OPENROUTER_CHAT_COMPLETIONS_URL,
  resolveMainRpPrimaryWireModelId,
} from "@/lib/openRouterConfig";
import {
  applyOpenAiCompatibleSseEvent,
  createOpenAiCompatibleSseEvidence,
  createOpenAiCompatibleSseFeedState,
  decodeOpenAiCompatibleSseResponse,
  feedOpenAiCompatibleSseChunk,
} from "@/lib/openAiCompatibleSseDecoder";
import { RP_QUALITY_PRECALL_FIXTURE_IDS } from "@/lib/rpQualityPrecall";
import {
  buildPaidRunnerPublicManifest,
  createFilePaidRunnerJournalStore,
  createMemoryPaidRunnerJournalStore,
  createPaidRunnerJournal,
  expectedPaidRunnerProvider,
  paidRunnerRequestBodyFingerprint,
  probePaidRunnerJournalDirectory,
  runPaidRunner,
  type PaidRunnerAuthorizationInput,
  type PaidRunnerIdentityHashes,
  type PaidRunnerPublicManifest,
  type PaidRunnerSealedCall,
} from "@/lib/rpQualityPaidRunner";
import {
  createFilePaidRunnerArtifactStore,
  createMemoryPaidRunnerArtifactStore,
  paidRunnerArtifactFingerprint,
} from "@/lib/rpQualityPaidRunnerArtifacts";
import {
  createIsolatedPaidRunnerLiveTransport,
  livePaidRunnerUsesCanonicalModels,
} from "@/lib/rpQualityPaidRunnerLiveTransport";
import {
  reconcilePaidRunnerSettlement,
} from "@/lib/rpQualityPaidRunnerReconciliation";

const SECRET = "rpq-paid-live-secret-000000000001";
const MAIN_SHA = "9829ceb5d2c720d6ac827db64daa8525e0a5ca6f";
const HASHES: PaidRunnerIdentityHashes = {
  greetingSha256: "ab".repeat(32),
  systemPromptSha256: "cd".repeat(32),
  worldSha256: "ef".repeat(32),
  settingChunksSha256: "11".repeat(32),
  personaPublicSha256: "22".repeat(32),
};
const KEYS = {
  openRouterKey: "or-exp-test-key-not-production",
  cheaperInferenceKey: "ci-exp-test-key-not-production",
};

function pack() {
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
  const manifest = buildPaidRunnerPublicManifest({
    mainSha: MAIN_SHA,
    productionDeploySha: MAIN_SHA,
    identityHashes: HASHES,
    sealedCalls: calls,
  });
  return { manifest, sealedCalls: calls };
}

function auth(manifest: PaidRunnerPublicManifest, extra: Partial<PaidRunnerAuthorizationInput> = {}) {
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

function sseBody(input: {
  text: string;
  model: string;
  id?: string;
  cheaper?: boolean;
  done?: boolean;
  usage?: boolean;
  billedUsd?: number;
  omitEnvelope?: boolean;
  unsettled?: boolean;
}) {
  const frames = [
    `data: ${JSON.stringify({
      id: input.id ?? `gen-${input.model}`,
      model: input.model,
      choices: [{ delta: { content: input.text }, finish_reason: null }],
    })}\n\n`,
    `data: ${JSON.stringify({
      id: input.id ?? `gen-${input.model}`,
      model: input.model,
      choices: [{ delta: {}, finish_reason: "stop" }],
      usage: input.usage === false ? undefined : { prompt_tokens: 10, completion_tokens: 8, cost: 0.02 },
      cheaper_inference: input.cheaper && !input.omitEnvelope
        ? {
            billing: {
              status:
                input.unsettled || (input.billedUsd != null && input.billedUsd <= 0)
                  ? "pending"
                  : "settled",
              billed_cost_usd: input.billedUsd ?? 0.02,
            },
          }
        : undefined,
    })}\n\n`,
  ];
  if (input.done !== false) frames.push("data: [DONE]\n\n");
  return frames.join("");
}

function createScenarioFetch(options?: {
  httpStatus?: number;
  contentType?: string;
  malformed?: boolean;
  eofBeforeDone?: boolean;
  emptyContent?: boolean;
  throwRead?: boolean;
  reset?: boolean;
  timeout?: boolean;
  wrongModel?: boolean;
  omitRequestId?: boolean;
  billedUsd?: number;
  generationFail?: boolean;
  usageFail?: boolean;
  omitEnvelope?: boolean;
  unsettled?: boolean;
  unknownCost?: boolean;
  sameIds?: boolean;
  maxPosts?: number;
}) {
  const counts = { posts: 0, gets: 0 };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = String(init?.method ?? "GET").toUpperCase();
    if (method === "POST" && url.includes("/chat/completions")) {
      counts.posts += 1;
      if (options?.maxPosts != null && counts.posts > options.maxPosts) {
        throw new Error("extra paid POST");
      }
      if (options?.timeout) throw new Error("aborted timeout");
      if (options?.reset) throw new Error("ECONNRESET");
      if (options?.httpStatus) {
        return new Response("no", { status: options.httpStatus, headers: { "content-type": "application/json" } });
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      const model = options?.wrongModel ? "wrong-provider-model" : String(body.model);
      const cheaper = url.includes("cheaperinference");
      if (options?.throwRead) {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error("reader boom"));
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } }
        );
      }
      const text = options?.emptyContent ? "" : `라이브 모의 ${model}`;
      const requestId = cheaper ? `ci-req-${counts.posts}` : `or-req-${counts.posts}`;
      const generationId = options?.sameIds ? requestId : cheaper ? undefined : `or-gen-${counts.posts}`;
      const payload = options?.malformed
        ? "data: {not-json\n\n"
        : sseBody({
            text,
            model,
            id: generationId,
            cheaper,
            done: options?.eofBeforeDone ? false : true,
            billedUsd: options?.billedUsd,
            omitEnvelope: options?.omitEnvelope,
            unsettled: options?.unsettled,
          });
      return new Response(payload, {
        status: 200,
        headers: {
          "content-type": options?.contentType ?? "text/event-stream",
          ...(options?.omitRequestId
            ? {}
            : cheaper
              ? { "x-ci-request-id": requestId }
              : { "x-request-id": requestId }),
        },
      });
    }
    counts.gets += 1;
    if (options?.generationFail && url.includes("/generation")) {
      return new Response("no", { status: 500 });
    }
    if (options?.usageFail && url.includes("/usage/requests")) {
      return new Response("no", { status: 500 });
    }
    if (url.includes("/generation")) {
      const requested = new URL(url, "https://openrouter.ai").searchParams.get("id");
      return Response.json({
        data: {
          id: requested,
          model: resolveMainRpPrimaryWireModelId("gemini-3.8-flash"),
          ...(options?.unknownCost ? {} : { total_cost: options?.billedUsd ?? 0.02 }),
        },
      });
    }
    return Response.json({
      requests: [
        {
          request_id: "ci-req-1",
          billed_cost_usd: options?.billedUsd ?? 0.02,
          status:
            options?.unsettled || (options?.billedUsd != null && options.billedUsd <= 0)
              ? "pending"
              : "settled",
          model: resolveMainRpPrimaryWireModelId("deepseek-v4.1-flash"),
        },
      ],
    });
  };
  return { fetchImpl, counts };
}

describe("rp quality paid runner live transport integration", () => {
  it("keeps the current Main RP 4-model registry", () => {
    assert.equal(livePaidRunnerUsesCanonicalModels(MAIN_RP_MODEL_IDS), true);
    assert.deepEqual([...MAIN_RP_MODEL_IDS], [
      "deepseek-v4.1-flash",
      "gemini-3.8-flash",
      "gpt-6.1-sol",
      "claude-opus-5.5",
    ]);
  });

  it("decodes UTF-8 and SSE event-boundary splits", () => {
    const state = createOpenAiCompatibleSseFeedState();
    const evidence = createOpenAiCompatibleSseEvidence();
    const raw = "data: {\"choices\":[{\"delta\":{\"content\":\"안녕\"}}]}\n\ndata: [DONE]\n\n";
    const mid = raw.indexOf("안") + 1;
    for (const event of feedOpenAiCompatibleSseChunk(state, raw.slice(0, mid))) {
      applyOpenAiCompatibleSseEvent(evidence, event);
    }
    for (const event of feedOpenAiCompatibleSseChunk(state, raw.slice(mid), true)) {
      applyOpenAiCompatibleSseEvent(evidence, event);
    }
    assert.equal(evidence.text, "안녕");
    assert.equal(evidence.doneObserved, true);
  });

  it("1. mock live 12-call stream settles 12 private artifacts with provider POST 0", async () => {
    const { manifest, sealedCalls } = pack();
    const { fetchImpl, counts } = createScenarioFetch();
    const artifacts = createMemoryPaidRunnerArtifactStore();
    const result = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls,
      authorization: auth(manifest),
      transport: createIsolatedPaidRunnerLiveTransport({ ...KEYS, fetchImpl }),
      artifactStore: artifacts,
      reconcile: { fetchImpl, keys: KEYS },
    });
    assert.equal(result.transportPosts, 12);
    assert.equal(result.providerPosts, 0);
    assert.equal(result.dbWrites, 0);
    assert.equal(counts.posts, 12);
    assert.equal(result.privateResults.length, 12);
    assert.equal(result.journal.entries.every((entry) => entry.status === "SETTLED"), true);
    assert.equal(result.journal.entries.every((entry) => entry.settlementSource === "provider_exact"), true);
    assert.equal(result.publicResults.every((row) => Object.values(row.scores).every((score) => score === null)), true);
    assert.equal(result.publicMetadataSafe, true);
    for (const entry of result.journal.entries) {
      assert.ok(entry.artifactFingerprint);
      assert.ok(artifacts.load(entry.artifactFingerprint!));
    }
  });

  it("2-3. CI envelope and OpenRouter generation GET are distinct exact-cost sources", async () => {
    const { manifest, sealedCalls } = pack();
    const { fetchImpl } = createScenarioFetch();
    const result = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls,
      authorization: auth(manifest),
      transport: createIsolatedPaidRunnerLiveTransport({ ...KEYS, fetchImpl }),
      reconcile: { fetchImpl, keys: KEYS },
    });
    const ci = result.journal.entries.find((_, index) => sealedCalls[index]?.provider === "cheaperinference");
    const openrouter = result.journal.entries.find((_, index) => sealedCalls[index]?.provider === "openrouter");
    assert.equal(ci?.settlementSource, "provider_exact");
    assert.equal(openrouter?.settlementSource, "provider_exact");
    assert.ok(openrouter?.generationId);
    assert.notEqual(openrouter?.generationId, openrouter?.providerRequestId);
  });

  it("failure paths stop with zero extra paid POSTs", async () => {
    const cases: Array<[string, Parameters<typeof createScenarioFetch>[0], string, number]> = [
      ["401", { httpStatus: 401 }, "http", 1],
      ["402", { httpStatus: 402 }, "http", 1],
      ["429", { httpStatus: 429 }, "http", 1],
      ["500", { httpStatus: 500 }, "http", 1],
      ["malformed SSE", { malformed: true }, "malformed", 1],
      ["EOF before DONE", { eofBeforeDone: true }, "partial_stream", 1],
      ["timeout", { timeout: true }, "timeout", 1],
      ["reset", { reset: true }, "connection_reset", 1],
      ["content-type", { contentType: "application/json" }, "malformed", 1],
      ["reader throw", { throwRead: true }, "throw", 1],
      ["wrong model", { wrongModel: true }, "wrong_provider_model", 1],
      ["missing request id", { omitRequestId: true }, "COST_EVIDENCE_MISSING", 1],
      ["zero billed", { billedUsd: 0, generationFail: true, usageFail: true }, "RECONCILIATION_FAILED", 1],
      ["negative billed", { billedUsd: -0.01, generationFail: true, usageFail: true }, "RECONCILIATION_FAILED", 1],
      ["unsettled billing", { unsettled: true, usageFail: true }, "RECONCILIATION_FAILED", 1],
      ["CI usage GET fail", { omitEnvelope: true, usageFail: true }, "RECONCILIATION_FAILED", 1],
      ["generation GET fail", { generationFail: true }, "RECONCILIATION_FAILED", 2],
      ["unknown cost", { unknownCost: true }, "RECONCILIATION_FAILED", 2],
      ["billing source mismatch", { sameIds: true }, "RECONCILIATION_FAILED", 2],
    ];
    for (const [label, option, expected, maxPosts] of cases) {
      const { manifest, sealedCalls } = pack();
      const { fetchImpl, counts } = createScenarioFetch({
        ...option,
        maxPosts,
      });
      const result = await runPaidRunner({
        mode: "AUTHORIZED",
        manifest,
        sealedCalls,
        authorization: auth(manifest),
        transport: createIsolatedPaidRunnerLiveTransport({ ...KEYS, fetchImpl }),
        reconcile: { fetchImpl, keys: KEYS },
      });
      assert.ok(result.transportPosts <= maxPosts, `${label} posts=${result.transportPosts}`);
      assert.equal(counts.posts, result.transportPosts, label);
      assert.equal(result.providerPosts, 0, label);
      if (expected === "COST_EVIDENCE_MISSING" || expected === "RECONCILIATION_FAILED") {
        assert.equal(result.denialReason, expected, label);
      } else {
        assert.ok(
          result.journal.entries[0]?.finishReason === expected ||
            result.journal.entries[0]?.status === "FAILED" ||
            result.journal.entries[0]?.status === "UNKNOWN_UNRESOLVED",
          `${label} ${result.journal.entries[0]?.finishReason} ${result.denialReason}`
        );
      }
    }
  });

  it("empty content is not a successful evaluation", async () => {
    const { manifest, sealedCalls } = pack();
    const { fetchImpl, counts } = createScenarioFetch({ emptyContent: true, maxPosts: 1 });
    const result = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls,
      authorization: auth(manifest),
      transport: createIsolatedPaidRunnerLiveTransport({ ...KEYS, fetchImpl }),
      reconcile: { fetchImpl, keys: KEYS },
    });
    assert.equal(counts.posts, 1);
    assert.equal(result.journal.entries[0]?.status, "FAILED");
    assert.equal(result.privateResults.length, 0);
  });

  it("16-18. crash before SENT / leftover SENT / artifact persist failure do not replay", async () => {
    const { manifest, sealedCalls } = pack();
    const failStore = createMemoryPaidRunnerJournalStore();
    const originalPersist = failStore.persist.bind(failStore);
    let persistCount = 0;
    failStore.persist = (journal) => {
      persistCount += 1;
      if (journal.entries.some((entry) => entry.status === "SENT") && persistCount <= 2) {
        throw new Error("disk full");
      }
      originalPersist(journal);
    };
    const { fetchImpl, counts } = createScenarioFetch({ maxPosts: 0 });
    const beforeSent = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls,
      authorization: auth(manifest),
      transport: createIsolatedPaidRunnerLiveTransport({ ...KEYS, fetchImpl }),
      journalStore: failStore,
      reconcile: { fetchImpl, keys: KEYS },
    });
    assert.equal(beforeSent.transportPosts, 0);
    assert.equal(counts.posts, 0);

    const leftover = createPaidRunnerJournal(manifest.manifestFingerprint);
    leftover.entries.push({
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
    const recovered = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls,
      authorization: auth(manifest),
      transport: createIsolatedPaidRunnerLiveTransport({ ...KEYS, fetchImpl }),
      journal: leftover,
      reconcile: { fetchImpl, keys: KEYS },
    });
    assert.equal(recovered.transportPosts, 0);
    assert.equal(recovered.journal.entries[0]?.status, "UNKNOWN_UNRESOLVED");

    const brokenArtifacts = createMemoryPaidRunnerArtifactStore();
    brokenArtifacts.persist = () => {
      throw new Error("artifact disk full");
    };
    const { fetchImpl: okFetch, counts: okCounts } = createScenarioFetch({ maxPosts: 1 });
    const artifactFail = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls,
      authorization: auth(manifest),
      transport: createIsolatedPaidRunnerLiveTransport({ ...KEYS, fetchImpl: okFetch }),
      artifactStore: brokenArtifacts,
      reconcile: { fetchImpl: okFetch, keys: KEYS },
    });
    assert.equal(okCounts.posts, 1);
    assert.equal(artifactFail.denialReason, "ARTIFACT_STORE_UNAVAILABLE");
    assert.equal(artifactFail.journal.entries[0]?.status, "UNKNOWN_UNRESOLVED");
  });

  it("19-21. corrupt journal, concurrent launch, and replay stay fail-closed", async () => {
    const { manifest, sealedCalls } = pack();
    const dir = mkdtempSync(path.join(tmpdir(), "rpq-live-journal-"));
    const store = createFilePaidRunnerJournalStore(dir);
    writeFileSync(path.join(dir, `rp-quality-paid-journal-${manifest.manifestFingerprint}.json`), "{not-json");
    const { fetchImpl, counts } = createScenarioFetch({ maxPosts: 0 });
    const corrupt = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls,
      authorization: auth(manifest),
      transport: createIsolatedPaidRunnerLiveTransport({ ...KEYS, fetchImpl }),
      journalStore: store,
      reconcile: { fetchImpl, keys: KEYS },
    });
    assert.equal(corrupt.denialReason, "CORRUPT_JOURNAL");
    assert.equal(counts.posts, 0);

    const held = createMemoryPaidRunnerJournalStore();
    const lock = held.tryAcquireExclusiveLock(manifest.manifestFingerprint);
    try {
      const concurrent = await runPaidRunner({
        mode: "AUTHORIZED",
        manifest,
        sealedCalls,
        authorization: auth(manifest),
        transport: createIsolatedPaidRunnerLiveTransport({ ...KEYS, fetchImpl }),
        journalStore: held,
        reconcile: { fetchImpl, keys: KEYS },
      });
      assert.equal(concurrent.denialReason, "CONCURRENT_LAUNCH");
      assert.equal(concurrent.transportPosts, 0);
    } finally {
      if (lock.ok) lock.lock.release();
    }

    const first = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls,
      authorization: auth(manifest),
      transport: createIsolatedPaidRunnerLiveTransport({ ...KEYS, fetchImpl: createScenarioFetch().fetchImpl }),
      reconcile: { fetchImpl: createScenarioFetch().fetchImpl, keys: KEYS },
    });
    const replay = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls,
      authorization: auth(manifest),
      transport: createIsolatedPaidRunnerLiveTransport({ ...KEYS, fetchImpl }),
      journal: first.journal,
      reconcile: { fetchImpl, keys: KEYS },
    });
    assert.equal(replay.transportPosts, 0);
    assert.equal(replay.denialReason, "DUPLICATE_MANIFEST_EXECUTION");
  });

  it("22-30. authorization, tamper, thirteenth, secrets, and live CLI stay closed", async () => {
    const { manifest, sealedCalls } = pack();
    const { fetchImpl, counts } = createScenarioFetch({ maxPosts: 0 });
    const cases: Array<[string, Parameters<typeof runPaidRunner>[0]]> = [
      ["sha", {
        mode: "AUTHORIZED",
        manifest,
        sealedCalls,
        authorization: auth(manifest, { expectedProductionSha: "1".repeat(40) }),
        transport: createIsolatedPaidRunnerLiveTransport({ ...KEYS, fetchImpl }),
        reconcile: { fetchImpl, keys: KEYS },
      }],
      ["identity", {
        mode: "AUTHORIZED",
        manifest,
        sealedCalls,
        authorization: auth(manifest, { expectedIdentityHash: "22".repeat(32) }),
        transport: createIsolatedPaidRunnerLiveTransport({ ...KEYS, fetchImpl }),
        reconcile: { fetchImpl, keys: KEYS },
      }],
      ["approval", {
        mode: "AUTHORIZED",
        manifest,
        sealedCalls,
        authorization: auth(manifest, { userCostApproved: false }),
        transport: createIsolatedPaidRunnerLiveTransport({ ...KEYS, fetchImpl }),
        reconcile: { fetchImpl, keys: KEYS },
      }],
      ["secret", {
        mode: "AUTHORIZED",
        manifest,
        sealedCalls,
        authorization: auth(manifest, { experimentSecret: null }),
        transport: createIsolatedPaidRunnerLiveTransport({ ...KEYS, fetchImpl }),
        reconcile: { fetchImpl, keys: KEYS },
      }],
      ["production key", {
        mode: "AUTHORIZED",
        manifest,
        sealedCalls,
        authorization: auth(manifest, { experimentSecret: "sk-or-production-lookalike-0001" }),
        transport: createIsolatedPaidRunnerLiveTransport({ ...KEYS, fetchImpl }),
        reconcile: { fetchImpl, keys: KEYS },
      }],
      ["tampered body", {
        mode: "AUTHORIZED",
        manifest,
        sealedCalls: sealedCalls.map((call, index) => index === 0
          ? { ...call, requestBody: { ...call.requestBody, messages: [{ role: "user", content: "hj" }] } }
          : call),
        authorization: auth(manifest),
        transport: createIsolatedPaidRunnerLiveTransport({ ...KEYS, fetchImpl }),
        reconcile: { fetchImpl, keys: KEYS },
      }],
      ["13th", {
        mode: "AUTHORIZED",
        manifest,
        sealedCalls: [...sealedCalls, { ...sealedCalls[0]!, requestOrder: 13 }],
        authorization: auth(manifest),
        transport: createIsolatedPaidRunnerLiveTransport({ ...KEYS, fetchImpl }),
        reconcile: { fetchImpl, keys: KEYS },
      }],
    ];
    process.env.OPENROUTER_API_KEY = "sk-or-production-lookalike-0001";
    for (const [label, input] of cases) {
      const result = await runPaidRunner(input);
      assert.equal(result.transportPosts, 0, label);
      assert.equal(result.providerPosts, 0, label);
    }
    delete process.env.OPENROUTER_API_KEY;
    assert.equal(counts.posts, 0);

    const maxTokens = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls: sealedCalls.map((call, index) => index === 0
        ? { ...call, requestBody: { ...call.requestBody, max_tokens: 16 } }
        : call),
      authorization: auth(manifest),
      transport: createIsolatedPaidRunnerLiveTransport({ ...KEYS, fetchImpl }),
      reconcile: { fetchImpl, keys: KEYS },
    });
    assert.equal(maxTokens.transportPosts, 0);

    const publicJson = JSON.stringify({ manifest, secret: "nope" });
    assert.equal(publicJson.includes(SECRET), false);

    let stdout = "";
    try {
      stdout = execFileSync(process.execPath, [
        "--conditions=react-server",
        "--import",
        "tsx",
        "scripts/rp-quality-paid-runner-live.ts",
        "--user-cost-approved",
      ], { encoding: "utf8" });
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

  it("journal durability probe and private artifact files stay operator-local", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rpq-live-durable-"));
    const probe = probePaidRunnerJournalDirectory(dir);
    assert.equal(probe.dirFsyncSupported, true);
    const artifacts = createFilePaidRunnerArtifactStore(path.join(dir, "artifacts"));
    const text = "비공개 생성 원문";
    const fingerprint = paidRunnerArtifactFingerprint(text);
    artifacts.persist({ requestOrder: 1, fingerprint, text });
    assert.equal(artifacts.load(fingerprint), text);
  });

  it("decodeOpenAiCompatibleSseResponse marks EOF before DONE", async () => {
    const res = new Response("data: {\"choices\":[{\"delta\":{\"content\":\"x\"}}]}\n\n", {
      headers: { "content-type": "text/event-stream" },
    });
    const evidence = await decodeOpenAiCompatibleSseResponse(res);
    assert.match(evidence.schemaError ?? "", /eof before terminal/);
  });

  it("27-28. missing and production inference keys never POST", async () => {
    assert.throws(
      () => createIsolatedPaidRunnerLiveTransport({ openRouterKey: "", cheaperInferenceKey: "ci-exp-test-key-not-production" }),
      /MISSING_INFERENCE_KEY/
    );
    process.env.OPENROUTER_API_KEY = "sk-or-production-lookalike-0001";
    try {
      assert.throws(
        () => createIsolatedPaidRunnerLiveTransport({
          openRouterKey: "sk-or-production-lookalike-0001",
          cheaperInferenceKey: "ci-exp-test-key-not-production",
        }),
        /PRODUCTION_KEY_FALLBACK_FORBIDDEN/
      );
    } finally {
      delete process.env.OPENROUTER_API_KEY;
    }
    const { manifest, sealedCalls } = pack();
    const { fetchImpl, counts } = createScenarioFetch({ maxPosts: 0 });
    const missingReconcile = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls,
      authorization: auth(manifest),
      transport: createIsolatedPaidRunnerLiveTransport({ ...KEYS, fetchImpl }),
    });
    assert.equal(missingReconcile.denialReason, "MISSING_INFERENCE_KEY");
    assert.equal(counts.posts, 0);
  });

  it("stale lock recovers and artifact files stay 0600", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rpq-live-stale-"));
    const { manifest } = pack();
    const store = createFilePaidRunnerJournalStore(dir);
    const lockPath = path.join(dir, `rp-quality-paid-journal-${manifest.manifestFingerprint}.json.lock`);
    writeFileSync(lockPath, "999999999\n");
    const lock = store.tryAcquireExclusiveLock(manifest.manifestFingerprint);
    assert.equal(lock.ok, true);
    if (lock.ok) lock.lock.release();

    const artifacts = createFilePaidRunnerArtifactStore(path.join(dir, "artifacts"));
    const text = "비공개 생성 원문";
    const fingerprint = paidRunnerArtifactFingerprint(text);
    artifacts.persist({ requestOrder: 1, fingerprint, text });
    const file = path.join(dir, "artifacts", `${fingerprint}.txt`);
    assert.equal((statSync(file).mode & 0o777), 0o600);
    assert.equal((statSync(path.join(dir, "artifacts")).mode & 0o777), 0o700);
  });

  it("stream usage.cost is never provider_exact without a verified billing contract", async () => {
    const { sealedCalls } = pack();
    const openrouter = sealedCalls.find((call) => call.provider === "openrouter")!;
    const cheaper = sealedCalls.find((call) => call.provider === "cheaperinference")!;
    const { fetchImpl } = createScenarioFetch({ generationFail: true, usageFail: true });
    const orUsage = await reconcilePaidRunnerSettlement({
      call: openrouter,
      result: {
        ok: true,
        httpStatus: 200,
        text: "모의",
        finishReason: "stop",
        usage: {
          promptTokens: 10,
          completionTokens: 8,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
          billedUsd: 0.02,
        },
        requestId: "or-req-1",
        headers: { "x-request-id": "or-req-1" },
        body: { id: "or-gen-1", model: openrouter.wireModel, usage: { cost: 0.02 } },
        generationId: "or-gen-1",
      },
      elapsedMs: 10,
      fetchImpl,
      keys: KEYS,
    });
    assert.equal(orUsage.settlementSource, "unsettled");
    assert.notEqual(orUsage.settlementSource, "provider_exact");

    const ciUsage = await reconcilePaidRunnerSettlement({
      call: cheaper,
      result: {
        ok: true,
        httpStatus: 200,
        text: "모의",
        finishReason: "stop",
        usage: {
          promptTokens: 10,
          completionTokens: 8,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
          billedUsd: 0.02,
        },
        requestId: "ci-req-1",
        headers: { "x-ci-request-id": "ci-req-1" },
        body: { model: cheaper.wireModel, usage: { cost: 0.02 } },
      },
      elapsedMs: 10,
      fetchImpl,
      keys: KEYS,
    });
    assert.equal(ciUsage.settlementSource, "unsettled");
  });
});
