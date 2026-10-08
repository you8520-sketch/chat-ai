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
  type PaidRunnerTransport,
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

function simulatedLive(fetchImpl: typeof fetch) {
  return createIsolatedPaidRunnerLiveTransport({ ...KEYS, fetchImpl, simulation: true });
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
  requestId?: string;
  cheaper?: boolean;
  done?: boolean;
  usage?: boolean;
  billedUsd?: number;
  omitEnvelope?: boolean;
  omitRequestId?: boolean;
  unsettled?: boolean;
  firstChunkIdOnly?: boolean;
}) {
  const frames = [
    `data: ${JSON.stringify({
      id: input.id ?? `gen-${input.model}`,
      model: input.model,
      choices: [{ delta: { content: input.text }, finish_reason: null }],
    })}\n\n`,
    `data: ${JSON.stringify({
      ...(input.firstChunkIdOnly ? {} : { id: input.id ?? `gen-${input.model}` }),
      model: input.model,
      choices: [{ delta: {}, finish_reason: "stop" }],
      usage: input.usage === false ? undefined : { prompt_tokens: 10, completion_tokens: 8, cost: 0.02 },
      cheaper_inference: input.cheaper && !input.omitEnvelope
        ? {
            ...(input.requestId && !input.omitRequestId ? { request_id: input.requestId } : {}),
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
  firstChunkIdOnly?: boolean;
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
            requestId,
            cheaper,
            done: options?.eofBeforeDone ? false : true,
            billedUsd: options?.billedUsd,
            omitEnvelope: options?.omitEnvelope,
            omitRequestId: options?.omitRequestId,
            unsettled: options?.unsettled,
            firstChunkIdOnly: options?.firstChunkIdOnly,
          });
      return new Response(payload, {
        status: 200,
        headers: {
          "content-type": options?.contentType ?? "text/event-stream",
          ...(options?.omitRequestId
            ? {}
            : cheaper
              ? { "x-ci-request-id": requestId }
              : {
                  "x-request-id": requestId,
                  ...(generationId ? { "x-generation-id": generationId } : {}),
                }),
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
          request_id: requested?.startsWith("or-gen-")
            ? requested.replace("or-gen-", "or-req-")
            : "or-req-1",
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
      transport: simulatedLive(fetchImpl),
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
      transport: simulatedLive(fetchImpl),
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
        transport: simulatedLive(fetchImpl),
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
      transport: simulatedLive(fetchImpl),
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
      transport: simulatedLive(fetchImpl),
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
      transport: simulatedLive(fetchImpl),
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
      transport: simulatedLive(okFetch),
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
      transport: simulatedLive(fetchImpl),
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
        transport: simulatedLive(fetchImpl),
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
      transport: simulatedLive(createScenarioFetch().fetchImpl),
      reconcile: { fetchImpl: createScenarioFetch().fetchImpl, keys: KEYS },
    });
    const replay = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls,
      authorization: auth(manifest),
      transport: simulatedLive(fetchImpl),
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
        transport: simulatedLive(fetchImpl),
        reconcile: { fetchImpl, keys: KEYS },
      }],
      ["identity", {
        mode: "AUTHORIZED",
        manifest,
        sealedCalls,
        authorization: auth(manifest, { expectedIdentityHash: "22".repeat(32) }),
        transport: simulatedLive(fetchImpl),
        reconcile: { fetchImpl, keys: KEYS },
      }],
      ["approval", {
        mode: "AUTHORIZED",
        manifest,
        sealedCalls,
        authorization: auth(manifest, { userCostApproved: false }),
        transport: simulatedLive(fetchImpl),
        reconcile: { fetchImpl, keys: KEYS },
      }],
      ["secret", {
        mode: "AUTHORIZED",
        manifest,
        sealedCalls,
        authorization: auth(manifest, { experimentSecret: null }),
        transport: simulatedLive(fetchImpl),
        reconcile: { fetchImpl, keys: KEYS },
      }],
      ["production key", {
        mode: "AUTHORIZED",
        manifest,
        sealedCalls,
        authorization: auth(manifest, { experimentSecret: "sk-or-production-lookalike-0001" }),
        transport: simulatedLive(fetchImpl),
        reconcile: { fetchImpl, keys: KEYS },
      }],
      ["tampered body", {
        mode: "AUTHORIZED",
        manifest,
        sealedCalls: sealedCalls.map((call, index) => index === 0
          ? { ...call, requestBody: { ...call.requestBody, messages: [{ role: "user", content: "hj" }] } }
          : call),
        authorization: auth(manifest),
        transport: simulatedLive(fetchImpl),
        reconcile: { fetchImpl, keys: KEYS },
      }],
      ["13th", {
        mode: "AUTHORIZED",
        manifest,
        sealedCalls: [...sealedCalls, { ...sealedCalls[0]!, requestOrder: 13 }],
        authorization: auth(manifest),
        transport: simulatedLive(fetchImpl),
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
      transport: simulatedLive(fetchImpl),
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
      transport: simulatedLive(fetchImpl),
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

  it("1-3. real-network live dispatch stays closed without execute grant or file stores", async () => {
    const { manifest, sealedCalls } = pack();
    const { fetchImpl } = createScenarioFetch({ maxPosts: 0 });
    const spy = (posts: { n: number }): PaidRunnerTransport => ({
      kind: "live",
      realNetwork: true,
      async post() {
        posts.n += 1;
        throw new Error("real network post must not run");
      },
    });

    const noGrantPosts = { n: 0 };
    const noGrant = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls,
      authorization: auth(manifest),
      transport: spy(noGrantPosts),
      reconcile: { fetchImpl, keys: KEYS },
    });
    assert.equal(noGrant.denialReason, "LIVE_EXECUTE_NOT_APPROVED");
    assert.equal(noGrant.transportPosts, 0);
    assert.equal(noGrantPosts.n, 0);

    const memoryJournalPosts = { n: 0 };
    const dir = mkdtempSync(path.join(tmpdir(), "rpq-live-file-art-"));
    const memoryJournal = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls,
      authorization: auth(manifest),
      transport: spy(memoryJournalPosts),
      reconcile: { fetchImpl, keys: KEYS },
      liveExecuteApproved: true,
      artifactStore: createFilePaidRunnerArtifactStore(path.join(dir, "artifacts")),
    });
    assert.equal(memoryJournal.denialReason, "JOURNAL_STORE_UNAVAILABLE");
    assert.equal(memoryJournalPosts.n, 0);

    const memoryArtifactPosts = { n: 0 };
    const memoryArtifact = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls,
      authorization: auth(manifest),
      transport: spy(memoryArtifactPosts),
      reconcile: { fetchImpl, keys: KEYS },
      liveExecuteApproved: true,
      journalStore: createFilePaidRunnerJournalStore(path.join(dir, "journal")),
    });
    assert.equal(memoryArtifact.denialReason, "ARTIFACT_STORE_UNAVAILABLE");
    assert.equal(memoryArtifactPosts.n, 0);

    assert.throws(
      () => createIsolatedPaidRunnerLiveTransport({ ...KEYS }),
      /LIVE_EXECUTE_NOT_APPROVED/
    );
  });

  it("4-12. exact-cost identity negatives stay unresolved; matching contracts settle", async () => {
    const { sealedCalls } = pack();
    const openrouter = sealedCalls.find((call) => call.provider === "openrouter")!;
    const cheaper = sealedCalls.find((call) => call.provider === "cheaperinference")!;
    const orResult = {
      ok: true as const,
      httpStatus: 200,
      text: "모의",
      finishReason: "stop",
      usage: {
        promptTokens: 10,
        completionTokens: 8,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        billedUsd: null,
      },
      requestId: "or-req-1",
      headers: { "x-request-id": "or-req-1" },
      body: { id: "or-gen-1", model: openrouter.wireModel },
      generationId: "or-gen-1",
    };
    const generationFetch = (data: Record<string, unknown>): typeof fetch =>
      (async (input) => {
        if (String(input).includes("/generation")) return Response.json({ data });
        throw new Error(`unexpected ${String(input)}`);
      }) as typeof fetch;
    const matchingGeneration = {
      id: "or-gen-1",
      request_id: "or-req-1",
      model: openrouter.wireModel,
      total_cost: 0.02,
    };

    const missingId = await reconcilePaidRunnerSettlement({
      call: openrouter,
      result: orResult,
      elapsedMs: 10,
      fetchImpl: generationFetch({ request_id: "or-req-1", model: openrouter.wireModel, total_cost: 0.02 }),
      keys: KEYS,
    });
    assert.equal(missingId.settlementSource, "unsettled");

    const wrongId = await reconcilePaidRunnerSettlement({
      call: openrouter,
      result: orResult,
      elapsedMs: 10,
      fetchImpl: generationFetch({ ...matchingGeneration, id: "or-gen-other" }),
      keys: KEYS,
    });
    assert.equal(wrongId.settlementSource, "unsettled");

    const wrongRequest = await reconcilePaidRunnerSettlement({
      call: openrouter,
      result: orResult,
      elapsedMs: 10,
      fetchImpl: generationFetch({ ...matchingGeneration, request_id: "or-req-other" }),
      keys: KEYS,
    });
    assert.equal(wrongRequest.settlementSource, "unsettled");

    const wrongModel = await reconcilePaidRunnerSettlement({
      call: openrouter,
      result: orResult,
      elapsedMs: 10,
      fetchImpl: generationFetch({ ...matchingGeneration, model: "wrong-provider-model" }),
      keys: KEYS,
    });
    assert.equal(wrongModel.settlementSource, "unsettled");

    const successStatus = await reconcilePaidRunnerSettlement({
      call: cheaper,
      result: {
        ...orResult,
        requestId: "ci-req-1",
        headers: { "x-ci-request-id": "ci-req-1" },
        body: {
          model: cheaper.wireModel,
          cheaper_inference: { billing: { status: "success", billed_cost_usd: 0.02 } },
        },
        generationId: null,
      },
      elapsedMs: 10,
      fetchImpl: createScenarioFetch({ usageFail: true }).fetchImpl,
      keys: KEYS,
    });
    assert.equal(successStatus.settlementSource, "unsettled");

    const pending = await reconcilePaidRunnerSettlement({
      call: cheaper,
      result: {
        ...orResult,
        requestId: "ci-req-1",
        headers: { "x-ci-request-id": "ci-req-1" },
        body: {
          model: cheaper.wireModel,
          cheaper_inference: { billing: { status: "pending", billed_cost_usd: 0.02 } },
        },
        generationId: null,
      },
      elapsedMs: 10,
      fetchImpl: createScenarioFetch({ usageFail: true }).fetchImpl,
      keys: KEYS,
    });
    assert.equal(pending.settlementSource, "unsettled");

    const settledEnvelope = await reconcilePaidRunnerSettlement({
      call: cheaper,
      result: {
        ...orResult,
        requestId: "ci-req-1",
        headers: { "x-ci-request-id": "ci-req-1" },
        body: {
          model: cheaper.wireModel,
          cheaper_inference: {
            request_id: "ci-req-1",
            billing: { status: "settled", billed_cost_usd: 0.02 },
          },
        },
        generationId: null,
      },
      elapsedMs: 10,
      fetchImpl: createScenarioFetch({ usageFail: true }).fetchImpl,
      keys: KEYS,
    });
    assert.equal(settledEnvelope.settlementSource, "provider_exact");
    assert.equal(settledEnvelope.billedUsd, 0.02);

    const usageGet = await reconcilePaidRunnerSettlement({
      call: cheaper,
      result: {
        ...orResult,
        requestId: "ci-req-1",
        headers: { "x-ci-request-id": "ci-req-1" },
        body: { model: cheaper.wireModel },
        generationId: null,
      },
      elapsedMs: 10,
      fetchImpl: createScenarioFetch().fetchImpl,
      keys: KEYS,
    });
    assert.equal(usageGet.settlementSource, "provider_exact");

    const matchingOr = await reconcilePaidRunnerSettlement({
      call: openrouter,
      result: orResult,
      elapsedMs: 10,
      fetchImpl: generationFetch(matchingGeneration),
      keys: KEYS,
    });
    assert.equal(matchingOr.settlementSource, "provider_exact");
    assert.equal(matchingOr.billedUsd, 0.02);
  });

  it("13. first-chunk-only generation id is preserved through the SSE owner", () => {
    const evidence = createOpenAiCompatibleSseEvidence();
    applyOpenAiCompatibleSseEvent(evidence, {
      kind: "json",
      value: {
        id: "or-gen-first",
        model: resolveMainRpPrimaryWireModelId("gemini-3.8-flash"),
        choices: [{ delta: { content: "안녕" } }],
      },
    });
    applyOpenAiCompatibleSseEvent(evidence, {
      kind: "json",
      value: {
        model: resolveMainRpPrimaryWireModelId("gemini-3.8-flash"),
        choices: [{ delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
    });
    assert.equal(evidence.generationId, "or-gen-first");
  });

  it("14-15. mock 12-call still settles and UNKNOWN does not POST again", async () => {
    const { manifest, sealedCalls } = pack();
    const { fetchImpl, counts } = createScenarioFetch();
    const first = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls,
      authorization: auth(manifest),
      transport: simulatedLive(fetchImpl),
      reconcile: { fetchImpl, keys: KEYS },
    });
    assert.equal(first.transportPosts, 12);
    assert.equal(first.providerPosts, 0);
    assert.equal(counts.posts, 12);
    assert.equal(first.journal.entries.every((entry) => entry.status === "SETTLED"), true);

    const leftover = createPaidRunnerJournal(manifest.manifestFingerprint);
    leftover.entries.push({
      requestOrder: 1,
      fixtureId: manifest.calls[0]!.fixtureId,
      canonicalId: manifest.calls[0]!.canonicalId,
      finalWireFingerprint: manifest.calls[0]!.finalWireFingerprint,
      requestBodyFingerprint: manifest.calls[0]!.requestBodyFingerprint,
      status: "UNKNOWN_UNRESOLVED",
      settlementSource: "unsettled",
      providerRequestId: null,
      httpResult: null,
      finishReason: "process_crash",
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
    const { fetchImpl: blockedFetch, counts: blockedCounts } = createScenarioFetch({ maxPosts: 0 });
    const replay = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls,
      authorization: auth(manifest),
      transport: simulatedLive(blockedFetch),
      journal: leftover,
      reconcile: { fetchImpl: blockedFetch, keys: KEYS },
    });
    assert.equal(replay.transportPosts, 0);
    assert.equal(blockedCounts.posts, 0);
    assert.equal(replay.journal.entries[0]?.status, "UNKNOWN_UNRESOLVED");
  });

  it("1. unapproved real-fetch-like transport never POSTs", async () => {
    const { manifest, sealedCalls } = pack();
    let posts = 0;
    const spyFetch: typeof fetch = async (_input, init) => {
      if (String(init?.method ?? "GET").toUpperCase() === "POST") posts += 1;
      return new Response("no", { status: 500, headers: { "content-type": "application/json" } });
    };
    assert.throws(
      () => createIsolatedPaidRunnerLiveTransport({ ...KEYS, fetchImpl: spyFetch }),
      /LIVE_EXECUTE_NOT_APPROVED/
    );
    const transport: PaidRunnerTransport = {
      kind: "live",
      realNetwork: false,
      async post() {
        posts += 1;
        throw new Error("unapproved fetch-like post must not run");
      },
    };
    const result = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls,
      authorization: auth(manifest),
      transport,
      reconcile: { fetchImpl: spyFetch, keys: KEYS },
    });
    assert.equal(result.denialReason, "LIVE_EXECUTE_NOT_APPROVED");
    assert.equal(posts, 0);
    assert.equal(result.providerPosts, 0);
    assert.equal(result.transportPosts, 0);
  });

  it("2. memory journal or artifact cannot bypass live file-store gates", async () => {
    const { manifest, sealedCalls } = pack();
    const { fetchImpl } = createScenarioFetch({ maxPosts: 0 });
    const posts = { n: 0 };
    const transport: PaidRunnerTransport = {
      kind: "live",
      realNetwork: false,
      async post() {
        posts.n += 1;
        throw new Error("memory-store live bypass must not POST");
      },
    };
    const dir = mkdtempSync(path.join(tmpdir(), "rpq-live-memory-bypass-"));
    const memoryJournal = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls,
      authorization: auth(manifest),
      transport,
      reconcile: { fetchImpl, keys: KEYS },
      liveExecuteApproved: true,
      journalStore: createMemoryPaidRunnerJournalStore(),
      artifactStore: createFilePaidRunnerArtifactStore(path.join(dir, "artifacts")),
    });
    assert.equal(memoryJournal.denialReason, "JOURNAL_STORE_UNAVAILABLE");
    assert.equal(memoryJournal.providerPosts, 0);
    assert.equal(posts.n, 0);

    const memoryArtifact = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls,
      authorization: auth(manifest),
      transport,
      reconcile: { fetchImpl, keys: KEYS },
      liveExecuteApproved: true,
      journalStore: createFilePaidRunnerJournalStore(path.join(dir, "journal")),
      artifactStore: createMemoryPaidRunnerArtifactStore(),
    });
    assert.equal(memoryArtifact.denialReason, "ARTIFACT_STORE_UNAVAILABLE");
    assert.equal(memoryArtifact.providerPosts, 0);
    assert.equal(posts.n, 0);
  });

  it("3. live non-simulation providerPosts match actual POST attempts", async () => {
    const { manifest, sealedCalls } = pack();
    const { fetchImpl, counts } = createScenarioFetch();
    const dir = mkdtempSync(path.join(tmpdir(), "rpq-live-post-count-"));
    const result = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls,
      authorization: auth(manifest),
      transport: createIsolatedPaidRunnerLiveTransport({
        ...KEYS,
        fetchImpl,
        liveExecuteApproved: true,
      }),
      reconcile: { fetchImpl, keys: KEYS },
      liveExecuteApproved: true,
      journalStore: createFilePaidRunnerJournalStore(path.join(dir, "journal")),
      artifactStore: createFilePaidRunnerArtifactStore(path.join(dir, "artifacts")),
    });
    assert.equal(result.authorized, true);
    assert.equal(result.denialReason, null);
    assert.equal(counts.posts, 12);
    assert.equal(result.transportPosts, 12);
    assert.equal(result.providerPosts, 12);
    assert.equal(result.providerPosts, counts.posts);
    assert.equal(result.journal.entries.every((entry) => entry.status === "SETTLED"), true);
  });

  it("4-6. CI envelope request identity mismatch/missing fail-closed; numeric equivalent binds", async () => {
    const { sealedCalls } = pack();
    const cheaper = sealedCalls.find((call) => call.provider === "cheaperinference")!;
    const usageFail = createScenarioFetch({ usageFail: true }).fetchImpl;
    const base = {
      ok: true as const,
      httpStatus: 200,
      text: "모의",
      finishReason: "stop",
      usage: {
        promptTokens: 1,
        completionTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        billedUsd: null,
      },
      generationId: null as string | null,
    };

    const mismatch = await reconcilePaidRunnerSettlement({
      call: cheaper,
      result: {
        ...base,
        requestId: "ci-req-trusted",
        headers: { "x-ci-request-id": "ci-req-trusted" },
        body: {
          model: cheaper.wireModel,
          cheaper_inference: {
            request_id: "ci-req-OTHER",
            billing: { status: "settled", billed_cost_usd: 0.02 },
          },
        },
      },
      elapsedMs: 10,
      fetchImpl: usageFail,
      keys: KEYS,
    });
    assert.equal(mismatch.settlementSource, "unsettled");
    assert.notEqual(mismatch.settlementSource, "provider_exact");

    const missing = await reconcilePaidRunnerSettlement({
      call: cheaper,
      result: {
        ...base,
        requestId: "ci-req-trusted",
        headers: { "x-ci-request-id": "ci-req-trusted" },
        body: {
          model: cheaper.wireModel,
          cheaper_inference: {
            billing: { status: "settled", billed_cost_usd: 0.02 },
          },
        },
      },
      elapsedMs: 10,
      fetchImpl: usageFail,
      keys: KEYS,
    });
    assert.equal(missing.settlementSource, "unsettled");
    assert.notEqual(missing.settlementSource, "provider_exact");

    const numeric = await reconcilePaidRunnerSettlement({
      call: cheaper,
      result: {
        ...base,
        requestId: "4812",
        headers: { "x-ci-request-id": "4812" },
        body: {
          model: cheaper.wireModel,
          cheaper_inference: {
            request_id: 4812,
            billing: { status: "settled", billed_cost_usd: 0.02 },
          },
        },
      },
      elapsedMs: 10,
      fetchImpl: usageFail,
      keys: KEYS,
    });
    assert.equal(numeric.settlementSource, "provider_exact");
    assert.equal(numeric.billedUsd, 0.02);
    assert.equal(numeric.providerRequestId, "4812");
  });
});
