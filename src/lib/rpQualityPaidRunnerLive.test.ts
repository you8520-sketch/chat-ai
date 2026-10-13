import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, mock } from "node:test";

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
  PAID_RUNNER_LIVE_TIMEOUT_MS,
  PAID_RUNNER_LIVE_TIMEOUT_MS_BY_MODEL,
  createIsolatedPaidRunnerLiveTransport,
  livePaidRunnerUsesCanonicalModels,
} from "@/lib/rpQualityPaidRunnerLiveTransport";
import {
  PAID_RUNNER_OPENROUTER_GENERATION_RETRY_DELAYS_MS,
  PAID_RUNNER_OPENROUTER_GENERATION_TOTAL_BUDGET_MS,
  openRouterGenerationModelMatchesExpected,
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
const noWait = async () => undefined;

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
        reconcile: { fetchImpl, keys: KEYS, sleep: noWait },
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
      sleep: noWait,
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

  it("OpenRouter generation-id GET settles when the transport request id is absent", async () => {
    const { sealedCalls } = pack();
    const gemini = sealedCalls.find((call) => call.provider === "openrouter")!;
    const cheaper = sealedCalls.find((call) => call.provider === "cheaperinference")!;
    const generationId = "gen-1791704575-g9euUXxrA3vGySZiIS7J";
    const officialRequestId = "or-req-from-generation-metadata";
    const orBase = {
      ok: true as const,
      httpStatus: 200,
      text: "모의",
      finishReason: "stop",
      requestId: "",
      generationId,
      headers: { "x-generation-id": generationId },
      body: { id: generationId, model: gemini.wireModel },
      usage: {
        promptTokens: 13710,
        completionTokens: 2519,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        billedUsd: null,
      },
    };

    function generationFetch(data: Record<string, unknown>, gets: { n: number }): typeof fetch {
      return async (input) => {
        const url = String(input);
        assert.equal(url.includes("/chat/completions"), false);
        if (url.includes("/generation")) {
          gets.n += 1;
          const requested = new URL(url, "https://openrouter.ai").searchParams.get("id");
          assert.equal(requested, generationId);
          return Response.json({ data });
        }
        throw new Error(`unexpected ${url}`);
      };
    }

    const successGets = { n: 0 };
    const settled = await reconcilePaidRunnerSettlement({
      call: gemini,
      result: orBase,
      elapsedMs: 10,
      fetchImpl: generationFetch(
        {
          id: generationId,
          request_id: officialRequestId,
          model: gemini.wireModel,
          total_cost: 0.0050155,
        },
        successGets
      ),
      keys: KEYS,
    });
    assert.equal(successGets.n, 1);
    assert.equal(settled.settlementSource, "provider_exact");
    assert.equal(settled.billedUsd, 0.0050155);
    assert.equal(settled.providerRequestId, officialRequestId);

    const datedGets = { n: 0 };
    const dated = await reconcilePaidRunnerSettlement({
      call: gemini,
      result: orBase,
      elapsedMs: 10,
      fetchImpl: generationFetch(
        {
          id: generationId,
          request_id: officialRequestId,
          model: "google/gemini-3.8-flash-20260902",
          total_cost: 0.0050155,
        },
        datedGets
      ),
      keys: KEYS,
    });
    assert.equal(datedGets.n, 1);
    assert.equal(dated.settlementSource, "provider_exact");
    assert.equal(dated.billedUsd, 0.0050155);
    assert.equal(dated.providerRequestId, officialRequestId);
    assert.equal(
      openRouterGenerationModelMatchesExpected({
        expectedModel: gemini.wireModel,
        returnedModel: "google/gemini-3.8-flash-20260902",
      }),
      true
    );

    const spoofs = [
      "google/gemini-3.8-flash-20260903",
      "google/gemini-3.8-flash:batch",
      "google/gemini-3.8-pro",
      "google/gemini-3.7-flash",
      "gemini-3.8-flash",
    ];
    for (const spoof of spoofs) {
      const spoofGets = { n: 0 };
      const rejected = await reconcilePaidRunnerSettlement({
        call: gemini,
        result: orBase,
        elapsedMs: 10,
        fetchImpl: generationFetch(
          {
            id: generationId,
            request_id: officialRequestId,
            model: spoof,
            total_cost: 0.0050155,
          },
          spoofGets
        ),
        keys: KEYS,
      });
      assert.equal(spoofGets.n, 1, spoof);
      assert.equal(rejected.settlementSource, "missing", spoof);
      assert.equal(rejected.billedUsd, null, spoof);
      assert.equal(
        openRouterGenerationModelMatchesExpected({
          expectedModel: gemini.wireModel,
          returnedModel: spoof,
        }),
        false,
        spoof
      );
    }

    const mismatchGets = { n: 0 };
    const mismatch = await reconcilePaidRunnerSettlement({
      call: gemini,
      result: { ...orBase, requestId: "or-req-transport" },
      elapsedMs: 10,
      fetchImpl: generationFetch(
        {
          id: generationId,
          request_id: officialRequestId,
          model: gemini.wireModel,
          total_cost: 0.0050155,
        },
        mismatchGets
      ),
      keys: KEYS,
    });
    assert.equal(mismatchGets.n, 1);
    assert.equal(mismatch.settlementSource, "unsettled");
    assert.equal(mismatch.billedUsd, null);

    const wrongIdGets = { n: 0 };
    const wrongId = await reconcilePaidRunnerSettlement({
      call: gemini,
      result: orBase,
      elapsedMs: 10,
      fetchImpl: generationFetch(
        {
          id: "gen-other",
          request_id: officialRequestId,
          model: gemini.wireModel,
          total_cost: 0.0050155,
        },
        wrongIdGets
      ),
      keys: KEYS,
    });
    assert.equal(wrongIdGets.n, 1);
    assert.equal(wrongId.settlementSource, "missing");
    assert.equal(wrongId.billedUsd, null);

    const noOfficialRequestIdGets = { n: 0 };
    const noOfficialRequestId = await reconcilePaidRunnerSettlement({
      call: gemini,
      result: orBase,
      elapsedMs: 10,
      fetchImpl: generationFetch(
        {
          id: generationId,
          model: gemini.wireModel,
          total_cost: 0.0050155,
        },
        noOfficialRequestIdGets
      ),
      keys: KEYS,
    });
    assert.equal(noOfficialRequestIdGets.n, 1);
    assert.equal(noOfficialRequestId.settlementSource, "missing");
    assert.equal(noOfficialRequestId.billedUsd, null);

    const zeroCostGets = { n: 0 };
    const zeroCost = await reconcilePaidRunnerSettlement({
      call: gemini,
      result: orBase,
      elapsedMs: 10,
      fetchImpl: generationFetch(
        {
          id: generationId,
          request_id: officialRequestId,
          model: gemini.wireModel,
          total_cost: 0,
        },
        zeroCostGets
      ),
      keys: KEYS,
    });
    assert.equal(zeroCostGets.n, 1);
    assert.equal(zeroCost.settlementSource, "missing");
    assert.equal(zeroCost.billedUsd, null);

    const ciGets = { n: 0 };
    const ciMissing = await reconcilePaidRunnerSettlement({
      call: cheaper,
      result: {
        ok: true,
        httpStatus: 200,
        text: "모의",
        finishReason: "stop",
        requestId: "",
        generationId: null,
        headers: {},
        body: { model: cheaper.wireModel },
        usage: {
          promptTokens: 1,
          completionTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
          billedUsd: null,
        },
      },
      elapsedMs: 10,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/generation") || url.includes("/usage/requests")) ciGets.n += 1;
        throw new Error(`CI missing request id must not GET ${url}`);
      },
      keys: KEYS,
    });
    assert.equal(ciGets.n, 0);
    assert.equal(ciMissing.settlementSource, "missing");
    assert.equal(ciMissing.billedUsd, null);
  });
});

describe("rp quality paid runner OpenRouter settlement recovery", () => {
  const generationUrlId = (input: RequestInfo | URL): string =>
    new URL(String(input), "https://openrouter.ai").searchParams.get("id") ?? "";

  /**
   * Real Gemini shape from the 2026-10-12 live run: stream ends with HTTP 200, no
   * x-request-id header, and the first /generation GETs land before the record exists.
   */
  function gatedGenerationFetch(options: { notReadyGets: number; notReadyStatus?: number }) {
    const base = createScenarioFetch();
    const gets = { generation: 0 };
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = String(init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.includes("/generation")) {
        gets.generation += 1;
        if (gets.generation <= options.notReadyGets) {
          return new Response(JSON.stringify({ error: { code: options.notReadyStatus ?? 404 } }), {
            status: options.notReadyStatus ?? 404,
          });
        }
      }
      const response = await base.fetchImpl(input, init);
      if (method === "POST" && url.includes("openrouter.ai")) {
        const headers = new Headers(response.headers);
        headers.delete("x-request-id");
        return new Response(response.body, { status: response.status, headers });
      }
      return response;
    };
    return { fetchImpl, gets, counts: base.counts };
  }

  function recordSleeps() {
    const waits: number[] = [];
    return {
      waits,
      sleep: async (ms: number) => {
        waits.push(ms);
      },
    };
  }

  it("1/2. back-to-back 404s used to lose settlement; delayed metadata now settles with bounded GET-only retries", async () => {
    const { manifest, sealedCalls } = pack();
    const { fetchImpl, gets, counts } = gatedGenerationFetch({ notReadyGets: 2 });
    const { waits, sleep } = recordSleeps();
    const artifacts = createMemoryPaidRunnerArtifactStore();
    const result = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls,
      authorization: auth(manifest),
      transport: simulatedLive(fetchImpl),
      artifactStore: artifacts,
      reconcile: { fetchImpl, keys: KEYS, sleep },
    });
    assert.equal(result.denialReason, null);
    assert.equal(result.journal.entries.every((entry) => entry.status === "SETTLED"), true);
    assert.equal(counts.posts, 12);
    assert.equal(result.transportPosts, 12);
    assert.deepEqual(waits.slice(0, 2), [2_000, 4_000]);
    assert.equal(gets.generation, 2 + 3);
    for (const entry of result.journal.entries) {
      assert.ok(artifacts.load(entry.artifactFingerprint!));
    }
  });

  it("3/4. HTTP 200 text survives a never-ready generation record and blocks every later POST", async () => {
    const { manifest, sealedCalls } = pack();
    const { fetchImpl, gets, counts } = gatedGenerationFetch({ notReadyGets: Number.MAX_SAFE_INTEGER });
    const { waits, sleep } = recordSleeps();
    const artifacts = createMemoryPaidRunnerArtifactStore();
    const store = createMemoryPaidRunnerJournalStore();
    const run = () =>
      runPaidRunner({
        mode: "AUTHORIZED",
        manifest,
        sealedCalls,
        authorization: auth(manifest),
        transport: simulatedLive(fetchImpl),
        journalStore: store,
        artifactStore: artifacts,
        reconcile: { fetchImpl, keys: KEYS, sleep },
      });
    const first = await run();
    assert.equal(first.denialReason, "COST_EVIDENCE_MISSING");
    assert.equal(counts.posts, 2);
    assert.equal(first.transportPosts, 2);
    assert.equal(gets.generation, PAID_RUNNER_OPENROUTER_GENERATION_RETRY_DELAYS_MS.length + 1);
    assert.deepEqual(waits, [...PAID_RUNNER_OPENROUTER_GENERATION_RETRY_DELAYS_MS]);
    assert.ok(
      waits.reduce((sum, ms) => sum + ms, 0) < PAID_RUNNER_OPENROUTER_GENERATION_TOTAL_BUDGET_MS
    );

    const [deepseek, gemini, next] = first.journal.entries;
    assert.equal(deepseek?.status, "SETTLED");
    assert.equal(gemini?.status, "UNKNOWN_UNRESOLVED");
    assert.equal(gemini?.settlementSource, "missing");
    assert.equal(gemini?.billedUsd, null);
    assert.equal(next?.status, "PREPARED");
    const preserved = artifacts.load(gemini!.artifactFingerprint!);
    assert.equal(preserved, "라이브 모의 google/gemini-3.8-flash");
    assert.equal(paidRunnerArtifactFingerprint(preserved!), gemini!.artifactFingerprint);
    assert.equal(JSON.stringify(first.journal).includes(preserved!), false);

    const replay = await run();
    assert.notEqual(replay.denialReason, null);
    assert.equal(replay.transportPosts, 0);
    assert.equal(counts.posts, 2);
  });

  it("5. forged generation id, request id, and model are rejected immediately without waiting", async () => {
    const { sealedCalls } = pack();
    const gemini = sealedCalls.find((call) => call.provider === "openrouter")!;
    const generationId = "gen-1791805405-sjMuOf8odbGPP9ucumMD";
    const result = {
      ok: true as const,
      httpStatus: 200,
      text: "모의",
      finishReason: "stop",
      requestId: "",
      generationId,
      headers: { "x-generation-id": generationId },
      body: { id: generationId, model: gemini.wireModel },
      usage: {
        promptTokens: 1,
        completionTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        billedUsd: null,
      },
    };
    const genuine = {
      id: generationId,
      request_id: "req-1791805405-h7knpPISZld8XDwVGUOG",
      model: "google/gemini-3.8-flash-20260902",
      total_cost: 0.004702375,
    };
    const forgeries: Array<[string, Record<string, unknown>, string | undefined]> = [
      ["other generation id", { ...genuine, id: "gen-other" }, undefined],
      ["missing request id", { ...genuine, request_id: undefined }, undefined],
      ["other request id", genuine, "req-transport-other"],
      ["other model", { ...genuine, model: "google/gemini-3.8-pro" }, undefined],
      ["non-positive cost", { ...genuine, total_cost: 0 }, undefined],
    ];
    for (const [label, data, transportRequestId] of forgeries) {
      let getCount = 0;
      const { waits, sleep } = recordSleeps();
      const usage = await reconcilePaidRunnerSettlement({
        call: gemini,
        result: { ...result, requestId: transportRequestId ?? "" },
        elapsedMs: 10,
        fetchImpl: (async (input) => {
          assert.equal(generationUrlId(input), generationId);
          getCount += 1;
          return Response.json({ data });
        }) as typeof fetch,
        keys: KEYS,
        sleep,
      });
      assert.notEqual(usage.settlementSource, "provider_exact", label);
      assert.equal(usage.billedUsd, null, label);
      assert.equal(getCount, 1, label);
      assert.equal(waits.length, 0, label);
    }

    for (const status of [400, 401, 402, 403]) {
      let getCount = 0;
      const { waits, sleep } = recordSleeps();
      const usage = await reconcilePaidRunnerSettlement({
        call: gemini,
        result,
        elapsedMs: 10,
        fetchImpl: (async () => {
          getCount += 1;
          return new Response("no", { status });
        }) as typeof fetch,
        keys: KEYS,
        sleep,
      });
      assert.equal(usage.settlementSource, "missing", String(status));
      assert.equal(getCount, 1, String(status));
      assert.equal(waits.length, 0, String(status));
    }
  });

  it("6. artifact store failure stops the run even when settlement is also unresolved", async () => {
    const { manifest, sealedCalls } = pack();
    const { fetchImpl, counts } = gatedGenerationFetch({ notReadyGets: Number.MAX_SAFE_INTEGER });
    const { sleep } = recordSleeps();
    const broken = createMemoryPaidRunnerArtifactStore();
    const realPersist = broken.persist.bind(broken);
    broken.persist = (record) => {
      if (record.requestOrder === 2) throw new Error("artifact disk full");
      return realPersist(record);
    };
    const result = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls,
      authorization: auth(manifest),
      transport: simulatedLive(fetchImpl),
      artifactStore: broken,
      reconcile: { fetchImpl, keys: KEYS, sleep },
    });
    assert.equal(result.denialReason, "ARTIFACT_STORE_UNAVAILABLE");
    assert.equal(counts.posts, 2);
    assert.equal(result.journal.entries[1]?.status, "UNKNOWN_UNRESOLVED");
    assert.equal(result.journal.entries[1]?.finishReason, "artifact_persist_failed");
    assert.equal(result.journal.entries[2]?.status, "PREPARED");
  });
});

describe("rp quality paid runner interrupted streams and Opus/Sol timeout", () => {
  const PARTIAL_TEXT = "앞부분 원문. 두 번째 문장까지 도착했다.";

  const sseFrame = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;
  const textFrames = (model: string) => [
    sseFrame({ id: "gen-partial", model, choices: [{ delta: { content: "앞부분 원문. " } }] }),
    sseFrame({ id: "gen-partial", model, choices: [{ delta: { content: "두 번째 문장까지 도착했다." } }] }),
  ];

  function interruptedResponse(
    model: string,
    mode: "reader_error" | "timeout_error" | "eof" | "no_text_timeout" | "complete",
    headers: Record<string, string> = {}
  ): Response {
    const encoder = new TextEncoder();
    const chunks: string[] = mode === "no_text_timeout" ? [] : textFrames(model);
    if (mode === "complete") {
      chunks.push(
        sseFrame({
          id: "gen-partial",
          model,
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 8, cost: 0.02 },
        }),
        "data: [DONE]\n\n"
      );
    }
    let index = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index < chunks.length) {
          controller.enqueue(encoder.encode(chunks[index]));
          index += 1;
          return;
        }
        if (mode === "reader_error") controller.error(new Error("reader boom"));
        else if (mode === "timeout_error" || mode === "no_text_timeout") {
          controller.error(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
        } else {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream", ...headers },
    });
  }

  function callFor(canonicalId: string) {
    const { sealedCalls } = pack();
    return sealedCalls.find((call) => call.canonicalId === canonicalId)!;
  }

  async function postInterrupted(
    canonicalId: string,
    mode: Parameters<typeof interruptedResponse>[1]
  ) {
    const call = callFor(canonicalId);
    const transport = simulatedLive((async () =>
      interruptedResponse(call.wireModel, mode)) as typeof fetch);
    return transport.post({
      endpoint: call.endpoint,
      body: call.requestBody,
      canonicalId: call.canonicalId,
      provider: call.provider,
    });
  }

  it("timeout policy is Opus and Sol only and is a network timeout, not an output cap", async () => {
    const requested: Array<{ model: string; ms: number }> = [];
    const spy = mock.method(AbortSignal, "timeout", (ms: number) => {
      requested.push({ model: current, ms });
      return new AbortController().signal;
    });
    let current = "";
    try {
      for (const canonicalId of MAIN_RP_MODEL_IDS) {
        current = canonicalId;
        const call = callFor(canonicalId);
        const result = await simulatedLive((async (_url: RequestInfo | URL, init?: RequestInit) => {
          const sent = String(init?.body);
          assert.equal(sent, JSON.stringify(call.requestBody), canonicalId);
          assert.doesNotMatch(sent, /max_tokens|max_completion_tokens/, canonicalId);
          return interruptedResponse(call.wireModel, "complete");
        }) as typeof fetch).post({
          endpoint: call.endpoint,
          body: call.requestBody,
          canonicalId,
          provider: call.provider,
        });
        assert.equal(result.ok, true, canonicalId);
      }
    } finally {
      spy.mock.restore();
    }
    assert.deepEqual(
      requested.map((row) => [row.model, row.ms]),
      MAIN_RP_MODEL_IDS.map((id) => [id, PAID_RUNNER_LIVE_TIMEOUT_MS_BY_MODEL[id] ?? PAID_RUNNER_LIVE_TIMEOUT_MS])
    );
    assert.equal(PAID_RUNNER_LIVE_TIMEOUT_MS, 90_000);
    assert.equal(PAID_RUNNER_LIVE_TIMEOUT_MS_BY_MODEL["claude-opus-5.5"], 240_000);
    assert.equal(PAID_RUNNER_LIVE_TIMEOUT_MS_BY_MODEL["gpt-6.1-sol"], 240_000);
    assert.deepEqual(Object.keys(PAID_RUNNER_LIVE_TIMEOUT_MS_BY_MODEL).sort(), [
      "claude-opus-5.5",
      "gpt-6.1-sol",
    ]);
    for (const canonicalId of ["deepseek-v4.1-flash", "gemini-3.8-flash"] as const) {
      assert.equal(PAID_RUNNER_LIVE_TIMEOUT_MS_BY_MODEL[canonicalId] ?? PAID_RUNNER_LIVE_TIMEOUT_MS, 90_000);
    }
  });

  it("a 100 s provider response completes for Opus and Sol but times out for the 90 s models", async () => {
    const PROVIDER_LATENCY_MS = 100_000;
    let configuredMs = 0;
    const spy = mock.method(AbortSignal, "timeout", (ms: number) => {
      configuredMs = ms;
      return new AbortController().signal;
    });
    try {
      for (const canonicalId of MAIN_RP_MODEL_IDS) {
        const call = callFor(canonicalId);
        const result = await simulatedLive((async () =>
          interruptedResponse(
            call.wireModel,
            configuredMs < PROVIDER_LATENCY_MS ? "timeout_error" : "complete"
          )) as typeof fetch).post({
          endpoint: call.endpoint,
          body: call.requestBody,
          canonicalId,
          provider: call.provider,
        });
        if (canonicalId === "claude-opus-5.5" || canonicalId === "gpt-6.1-sol") {
          assert.equal(result.ok, true, canonicalId);
          assert.equal(result.ok && result.text, PARTIAL_TEXT, canonicalId);
        } else {
          assert.equal(result.ok, false, canonicalId);
        }
      }
    } finally {
      spy.mock.restore();
    }
  });

  it("a provider response slower than 240 s still times out for Sol and Opus with the partial text kept", async () => {
    const PROVIDER_LATENCY_MS = 250_000;
    let configuredMs = 0;
    const spy = mock.method(AbortSignal, "timeout", (ms: number) => {
      configuredMs = ms;
      return new AbortController().signal;
    });
    try {
      for (const canonicalId of ["gpt-6.1-sol", "claude-opus-5.5"] as const) {
        const call = callFor(canonicalId);
        const result = await simulatedLive((async () =>
          interruptedResponse(
            call.wireModel,
            configuredMs < PROVIDER_LATENCY_MS ? "timeout_error" : "complete"
          )) as typeof fetch).post({
          endpoint: call.endpoint,
          body: call.requestBody,
          canonicalId,
          provider: call.provider,
        });
        assert.equal(configuredMs, 240_000, canonicalId);
        assert.equal(result.ok, false, canonicalId);
        assert.equal(!result.ok && result.kind, "timeout", canonicalId);
        assert.equal(result.text, PARTIAL_TEXT, canonicalId);
        assert.equal(result.httpStatus, 200, canonicalId);
      }
    } finally {
      spy.mock.restore();
    }
  });

  it("keeps text parsed before AbortError / reader exception and never marks it complete", async () => {
    const aborted = await postInterrupted("claude-opus-5.5", "timeout_error");
    assert.equal(aborted.ok, false);
    assert.equal(!aborted.ok && aborted.kind, "timeout");
    assert.equal(aborted.text, PARTIAL_TEXT);
    assert.equal(aborted.httpStatus, 200);

    const reader = await postInterrupted("claude-opus-5.5", "reader_error");
    assert.equal(reader.ok, false);
    assert.equal(!reader.ok && reader.kind, "throw");
    assert.equal(reader.text, PARTIAL_TEXT);

    const eof = await postInterrupted("claude-opus-5.5", "eof");
    assert.equal(eof.ok, false);
    assert.equal(!eof.ok && eof.kind, "partial_stream");
    assert.equal(eof.text, PARTIAL_TEXT);

    const noText = await postInterrupted("claude-opus-5.5", "no_text_timeout");
    assert.equal(noText.ok, false);
    assert.equal(noText.text, "");
  });

  async function runInterrupted(
    mode: Parameters<typeof interruptedResponse>[1],
    extra: {
      artifactStore?: ReturnType<typeof createMemoryPaidRunnerArtifactStore>;
      journalStore?: ReturnType<typeof createMemoryPaidRunnerJournalStore>;
      headers?: Record<string, string>;
    } = {}
  ) {
    const { manifest, sealedCalls } = pack();
    const posts = { n: 0 };
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(init?.method ?? "GET").toUpperCase() === "POST") {
        posts.n += 1;
        const model = String(JSON.parse(String(init?.body)).model);
        return interruptedResponse(model, mode, extra.headers);
      }
      throw new Error(`unexpected GET ${String(input)}`);
    }) as typeof fetch;
    const artifactStore = extra.artifactStore ?? createMemoryPaidRunnerArtifactStore();
    const journalStore = extra.journalStore ?? createMemoryPaidRunnerJournalStore();
    const run = () =>
      runPaidRunner({
        mode: "AUTHORIZED",
        manifest,
        sealedCalls,
        authorization: auth(manifest),
        transport: simulatedLive(fetchImpl),
        journalStore,
        artifactStore,
        reconcile: { fetchImpl, keys: KEYS, sleep: async () => undefined },
      });
    return { run, posts, artifactStore, journalStore };
  }

  it("partial text is stored privately as PARTIAL, journal keeps only the hash, next POST is 0", async () => {
    for (const mode of ["timeout_error", "reader_error", "eof"] as const) {
      const dir = mkdtempSync(path.join(tmpdir(), "rpq-partial-"));
      const artifactStore = createFilePaidRunnerArtifactStore(path.join(dir, "artifacts"));
      const { run, posts } = await runInterrupted(mode, {
        artifactStore,
        headers: { "x-ci-request-id": "ci-req-partial-1" },
      });
      const first = await run();
      assert.equal(posts.n, 1, mode);
      assert.equal(first.denialReason, "PRIOR_CALL_UNRESOLVED", mode);
      const entry = first.journal.entries[0]!;
      assert.equal(entry.status, "UNKNOWN_UNRESOLVED", mode);
      assert.equal(entry.artifactPartial, true, mode);
      assert.equal(entry.artifactFingerprint, paidRunnerArtifactFingerprint(PARTIAL_TEXT), mode);
      assert.equal(entry.providerRequestId, "ci-req-partial-1", mode);
      assert.equal(entry.settlementSource, "unsettled", mode);
      assert.equal(artifactStore.load(entry.artifactFingerprint!), PARTIAL_TEXT, mode);
      const file = path.join(dir, "artifacts", `${entry.artifactFingerprint}.partial.txt`);
      assert.equal(statSync(file).mode & 0o777, 0o600, mode);
      assert.equal(JSON.stringify(first.journal).includes("앞부분"), false, mode);
      assert.equal(first.journal.entries.filter((row) => row.status === "SETTLED").length, 0);

      const replay = await run();
      assert.notEqual(replay.denialReason, null, mode);
      assert.equal(replay.transportPosts, 0, mode);
      assert.equal(posts.n, 1, mode);
    }
  });

  it("Sol timeout stops the runner at order 3: partial kept as PARTIAL, never SETTLED, Opus and replay POST 0", async () => {
    const { manifest, sealedCalls } = pack();
    const solWireModel = sealedCalls.find((call) => call.canonicalId === "gpt-6.1-sol")!.wireModel;
    const scenario = createScenarioFetch();
    const posts: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(init?.method ?? "GET").toUpperCase() === "POST") {
        const model = String(JSON.parse(String(init?.body)).model);
        posts.push(model);
        if (model === solWireModel) {
          return interruptedResponse(model, "timeout_error", { "x-ci-request-id": "ci-req-sol-timeout" });
        }
      }
      return scenario.fetchImpl(input, init);
    }) as typeof fetch;
    const artifactStore = createMemoryPaidRunnerArtifactStore();
    const journalStore = createMemoryPaidRunnerJournalStore();
    const run = () =>
      runPaidRunner({
        mode: "AUTHORIZED",
        manifest,
        sealedCalls,
        authorization: auth(manifest),
        transport: simulatedLive(fetchImpl),
        journalStore,
        artifactStore,
        reconcile: { fetchImpl, keys: KEYS, sleep: async () => undefined },
      });
    const first = await run();
    assert.equal(first.denialReason, "PRIOR_CALL_UNRESOLVED");
    assert.equal(posts.length, 3);
    assert.equal(posts.includes(sealedCalls.find((call) => call.canonicalId === "claude-opus-5.5")!.wireModel), false);
    const sol = first.journal.entries[2]!;
    assert.equal(sol.canonicalId, "gpt-6.1-sol");
    assert.equal(sol.status, "UNKNOWN_UNRESOLVED");
    assert.equal(sol.finishReason, "timeout");
    assert.equal(sol.artifactPartial, true);
    assert.equal(sol.artifactFingerprint, paidRunnerArtifactFingerprint(PARTIAL_TEXT));
    assert.equal(sol.providerRequestId, "ci-req-sol-timeout");
    assert.equal(sol.billedUsd, null);
    assert.equal(first.journal.entries[3]?.status, "PREPARED");
    assert.deepEqual(
      first.journal.entries.filter((row) => row.status === "SETTLED").map((row) => row.canonicalId),
      ["deepseek-v4.1-flash", "gemini-3.8-flash"]
    );
    const replay = await run();
    assert.notEqual(replay.denialReason, null);
    assert.equal(replay.transportPosts, 0);
    assert.equal(posts.length, 3);
  });

  it("timeout without any text stores no artifact and is not a result", async () => {
    const { run, posts, artifactStore } = await runInterrupted("no_text_timeout");
    const result = await run();
    assert.equal(posts.n, 1);
    const entry = result.journal.entries[0]!;
    assert.equal(entry.status, "UNKNOWN_UNRESOLVED");
    assert.equal(entry.artifactFingerprint ?? null, null);
    assert.equal(entry.artifactPartial, undefined);
    assert.equal(artifactStore.load(paidRunnerArtifactFingerprint("")), null);
    assert.equal(result.privateResults.length, 0);
  });

  it("partial artifact store failure stops the run safely", async () => {
    const broken = createMemoryPaidRunnerArtifactStore();
    broken.persist = () => {
      throw new Error("artifact disk full");
    };
    const { run, posts } = await runInterrupted("timeout_error", { artifactStore: broken });
    const result = await run();
    assert.equal(posts.n, 1);
    assert.equal(result.denialReason, "ARTIFACT_STORE_UNAVAILABLE");
    assert.equal(result.journal.entries[0]?.status, "UNKNOWN_UNRESOLVED");
    assert.equal(result.journal.entries[0]?.finishReason, "artifact_persist_failed");
  });
});
