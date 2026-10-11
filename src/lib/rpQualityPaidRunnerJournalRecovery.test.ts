import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import { CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL } from "@/lib/cheaperInferenceConfig";
import {
  OPENROUTER_CHAT_COMPLETIONS_URL,
  resolveMainRpPrimaryWireModelId,
} from "@/lib/openRouterConfig";
import { RP_QUALITY_PRECALL_FIXTURE_IDS } from "@/lib/rpQualityPrecall";
import {
  buildPaidRunnerPublicManifest,
  classifyPaidRunnerJournalContinuity,
  createFilePaidRunnerJournalStore,
  createMemoryPaidRunnerJournalStore,
  createMockPaidRunnerTransport,
  createPaidRunnerJournal,
  expectedPaidRunnerProvider,
  markPaidRunnerJournalPrepared,
  paidRunnerExperimentContinuityFingerprint,
  paidRunnerManifestDraft,
  paidRunnerRequestBodyFingerprint,
  runPaidRunner,
  type PaidRunnerAuthorizationInput,
  type PaidRunnerIdentityHashes,
  type PaidRunnerJournal,
  type PaidRunnerPublicManifest,
  type PaidRunnerSealedCall,
} from "@/lib/rpQualityPaidRunner";

const SECRET = "rpq-paid-recovery-secret-00000000001";
const MAIN_SHA = "f338ac6d2affa2a95e05538de04d2ee157d6cd33";
const ROTATED_SHA = "796d279f41fc34a974cab57aaa14f0e809774a5f";
const HASHES: PaidRunnerIdentityHashes = {
  greetingSha256: "ab".repeat(32),
  systemPromptSha256: "cd".repeat(32),
  worldSha256: "ef".repeat(32),
  settingChunksSha256: "11".repeat(32),
  personaPublicSha256: "22".repeat(32),
};
const KEYS = {
  openRouterKey: "or-exp-recovery-key-not-production",
  cheaperInferenceKey: "ci-exp-recovery-key-not-production",
};
const GEMINI_GENERATION_ID = "gen-1791704575-g9euUXxrA3vGySZiIS7J";
const OFFICIAL_REQUEST_ID = "or-req-from-generation-metadata";

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
        endpoint:
          provider === "openrouter"
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

function pack(sha = MAIN_SHA) {
  const calls = sealedCalls();
  const manifest = buildPaidRunnerPublicManifest({
    mainSha: sha,
    productionDeploySha: sha,
    identityHashes: HASHES,
    sealedCalls: calls,
  });
  return { manifest, sealedCalls: calls };
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

function emptyUsage(entry: PaidRunnerJournal["entries"][number]): PaidRunnerJournal["entries"][number] {
  return {
    ...entry,
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
    artifactFingerprint: null,
    generationId: null,
    blockReason: null,
  };
}

function seedPartialJournal(manifest: PaidRunnerPublicManifest): PaidRunnerJournal {
  const journal = createPaidRunnerJournal(manifest.manifestFingerprint, {
    identityHash: manifest.identityHash,
    experimentContinuityFingerprint: paidRunnerExperimentContinuityFingerprint(
      paidRunnerManifestDraft(manifest)
    ),
  });
  markPaidRunnerJournalPrepared(journal, manifest.calls);
  const first = journal.entries[0]!;
  journal.entries[0] = {
    ...emptyUsage(first),
    status: "SETTLED",
    settlementSource: "provider_exact",
    billedUsd: 0.001239,
    httpResult: 200,
    finishReason: "stop",
    visibleChars: 2729,
    artifactFingerprint: "0218e0bbc01dad26775cf76c5e6c55f1def15f1e3c59f1e078f95bccb8ce9ca0",
    outputAvailability: "persisted",
    providerRequestId: "ci-req-call-1",
  };
  const second = journal.entries[1]!;
  journal.entries[1] = {
    ...emptyUsage(second),
    status: "UNKNOWN_UNRESOLVED",
    settlementSource: "missing",
    httpResult: 200,
    finishReason: "stop",
    generationId: GEMINI_GENERATION_ID,
    elapsedMs: 23625,
    outputAvailability: "unavailable",
  };
  return journal;
}

function generationFetch(data: Record<string, unknown>, gets: { n: number; posts: number }): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    if (String(init?.method ?? "GET").toUpperCase() === "POST") {
      gets.posts += 1;
      throw new Error(`unexpected POST ${url}`);
    }
    if (url.includes("/generation")) {
      gets.n += 1;
      const requested = new URL(url, "https://openrouter.ai").searchParams.get("id");
      assert.equal(requested, GEMINI_GENERATION_ID);
      return Response.json({ data });
    }
    throw new Error(`unexpected ${url}`);
  };
}

describe("paid runner journal recovery and SHA-only continuity", () => {
  it("continuity fingerprint ignores deploy SHA and changes when a body hash changes", () => {
    const original = pack(MAIN_SHA);
    const rotated = pack(ROTATED_SHA);
    assert.notEqual(original.manifest.manifestFingerprint, rotated.manifest.manifestFingerprint);
    assert.equal(
      paidRunnerExperimentContinuityFingerprint(paidRunnerManifestDraft(original.manifest)),
      paidRunnerExperimentContinuityFingerprint(paidRunnerManifestDraft(rotated.manifest))
    );
    const driftedCalls = original.sealedCalls.map((call, index) =>
      index === 1
        ? {
            ...call,
            requestBodyFingerprint: "bb".repeat(32),
            requestBody: { ...call.requestBody, extra: true },
          }
        : call
    );
    const drifted = buildPaidRunnerPublicManifest({
      mainSha: MAIN_SHA,
      productionDeploySha: MAIN_SHA,
      identityHashes: HASHES,
      sealedCalls: driftedCalls,
    });
    assert.notEqual(
      paidRunnerExperimentContinuityFingerprint(paidRunnerManifestDraft(original.manifest)),
      paidRunnerExperimentContinuityFingerprint(paidRunnerManifestDraft(drifted))
    );
  });

  it("classifies SHA-only rotation versus body or identity drift", () => {
    const { manifest } = pack(MAIN_SHA);
    const rotated = pack(ROTATED_SHA).manifest;
    const journal = seedPartialJournal(manifest);
    const discovery = {
      continuityFingerprint: paidRunnerExperimentContinuityFingerprint(
        paidRunnerManifestDraft(rotated)
      ),
      identityHash: rotated.identityHash,
      calls: rotated.calls,
    };
    assert.equal(
      classifyPaidRunnerJournalContinuity(journal, discovery, rotated.manifestFingerprint),
      "sha_only_rotation"
    );
    journal.identityHash = "99".repeat(32);
    assert.equal(
      classifyPaidRunnerJournalContinuity(journal, discovery, rotated.manifestFingerprint),
      "body_or_identity_drift"
    );
  });

  it("file store adopts the prior SHA journal and does not create an empty file", async () => {
    const original = pack(MAIN_SHA);
    const rotated = pack(ROTATED_SHA);
    const dir = mkdtempSync(path.join(tmpdir(), "rpq-journal-recovery-"));
    const store = createFilePaidRunnerJournalStore(dir);
    const seeded = seedPartialJournal(original.manifest);
    seeded.entries[1] = {
      ...seeded.entries[1]!,
      status: "SETTLED",
      settlementSource: "provider_exact",
      billedUsd: 0.0050155,
      providerRequestId: OFFICIAL_REQUEST_ID,
      outputAvailability: "unavailable",
    };
    store.persist(seeded);
    const result = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest: rotated.manifest,
      sealedCalls: rotated.sealedCalls,
      authorization: auth(rotated.manifest),
      transport: createMockPaidRunnerTransport(),
      journalStore: store,
    });
    assert.equal(result.transportPosts, 10);
    assert.equal(result.providerPosts, 0);
    assert.equal(result.journal.manifestFingerprint, original.manifest.manifestFingerprint);
    assert.equal(result.journal.entries[0]?.status, "SETTLED");
    assert.equal(result.journal.entries[0]?.billedUsd, 0.001239);
    assert.equal(result.journal.entries[1]?.status, "SETTLED");
    assert.equal(result.journal.entries[1]?.billedUsd, 0.0050155);
    assert.equal(result.journal.entries[1]?.outputAvailability, "unavailable");
    assert.equal(
      result.journal.entries.filter((entry) => entry.status === "SETTLED").length,
      12
    );
    const names = readdirSync(dir).filter((name) => name.endsWith(".json"));
    assert.deepEqual(names, [
      `rp-quality-paid-journal-${original.manifest.manifestFingerprint}.json`,
    ]);
  });

  it("body drift on a SHA-rotated journal stops with zero POSTs", async () => {
    const original = pack(MAIN_SHA);
    const driftedCalls = original.sealedCalls.map((call, index) => {
      if (index !== 0) return call;
      const requestBody = { ...call.requestBody, x: 1 };
      return {
        ...call,
        requestBody,
        requestBodyFingerprint: paidRunnerRequestBodyFingerprint(requestBody),
      };
    });
    const drifted = buildPaidRunnerPublicManifest({
      mainSha: ROTATED_SHA,
      productionDeploySha: ROTATED_SHA,
      identityHashes: HASHES,
      sealedCalls: driftedCalls,
    });
    const dir = mkdtempSync(path.join(tmpdir(), "rpq-journal-drift-"));
    const store = createFilePaidRunnerJournalStore(dir);
    store.persist(seedPartialJournal(original.manifest));
    const result = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest: drifted,
      sealedCalls: driftedCalls,
      authorization: auth(drifted),
      transport: createMockPaidRunnerTransport(),
      journalStore: store,
    });
    assert.equal(result.transportPosts, 0);
    assert.equal(result.denialReason, "BODY_DRIFT");
    const onDisk = store.load(original.manifest.manifestFingerprint);
    assert.equal(onDisk?.entries[0]?.status, "SETTLED");
    assert.equal(onDisk?.entries[1]?.status, "UNKNOWN_UNRESOLVED");
  });

  it("continuity lock blocks a different deploy SHA of the same experiment", async () => {
    const original = pack(MAIN_SHA);
    const rotated = pack(ROTATED_SHA);
    const store = createMemoryPaidRunnerJournalStore();
    const continuity = paidRunnerExperimentContinuityFingerprint(
      paidRunnerManifestDraft(original.manifest)
    );
    const held = store.tryAcquireExclusiveLock("ab".repeat(32), continuity);
    assert.equal(held.ok, true);
    try {
      const result = await runPaidRunner({
        mode: "AUTHORIZED",
        manifest: rotated.manifest,
        sealedCalls: rotated.sealedCalls,
        authorization: auth(rotated.manifest),
        transport: createMockPaidRunnerTransport(),
        journalStore: store,
      });
      assert.equal(result.transportPosts, 0);
      assert.equal(result.denialReason, "CONCURRENT_LAUNCH");
    } finally {
      if (held.ok) held.lock.release();
    }
  });

  it("recovers UNKNOWN #2 from generation metadata without POST and then runs #3-12 once", async () => {
    const { manifest, sealedCalls: calls } = pack();
    const journal = seedPartialJournal(manifest);
    const gets = { n: 0, posts: 0 };
    const fetchImpl = generationFetch(
      {
        id: GEMINI_GENERATION_ID,
        request_id: OFFICIAL_REQUEST_ID,
        model: "google/gemini-3.8-flash-20260902",
        total_cost: 0.0050155,
      },
      gets
    );
    const result = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls: calls,
      authorization: auth(manifest),
      transport: createMockPaidRunnerTransport(),
      journal,
      reconcile: { fetchImpl, keys: KEYS },
    });
    assert.equal(gets.posts, 0);
    assert.equal(gets.n, 1);
    assert.equal(result.transportPosts, 10);
    assert.equal(result.providerPosts, 0);
    assert.equal(result.journal.entries[0]?.status, "SETTLED");
    assert.equal(result.journal.entries[0]?.billedUsd, 0.001239);
    assert.equal(result.journal.entries[1]?.status, "SETTLED");
    assert.equal(result.journal.entries[1]?.billedUsd, 0.0050155);
    assert.equal(result.journal.entries[1]?.providerRequestId, OFFICIAL_REQUEST_ID);
    assert.equal(result.journal.entries[1]?.generationId, GEMINI_GENERATION_ID);
    assert.equal(result.journal.entries[1]?.outputAvailability, "unavailable");
    assert.equal(result.journal.entries[1]?.visibleChars, null);
    assert.equal(result.journal.entries[1]?.artifactFingerprint, null);
    assert.equal(result.publicResults[0]?.requestOrder, 3);
    assert.equal(result.denialReason, null);
  });

  it("insufficient #2 generation evidence blocks #3-12 with zero POSTs", async () => {
    const { manifest, sealedCalls: calls } = pack();
    const journal = seedPartialJournal(manifest);
    const gets = { n: 0, posts: 0 };
    const fetchImpl = generationFetch(
      {
        id: GEMINI_GENERATION_ID,
        request_id: OFFICIAL_REQUEST_ID,
        model: "google/gemini-3.8-flash-preview",
        total_cost: 0.0050155,
      },
      gets
    );
    const result = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls: calls,
      authorization: auth(manifest),
      transport: createMockPaidRunnerTransport(),
      journal,
      reconcile: { fetchImpl, keys: KEYS },
    });
    assert.equal(gets.n, 1);
    assert.equal(gets.posts, 0);
    assert.equal(result.transportPosts, 0);
    assert.equal(result.denialReason, "RECONCILIATION_FAILED");
    assert.equal(result.journal.entries[1]?.status, "UNKNOWN_UNRESOLVED");
    assert.equal(result.journal.entries[1]?.billedUsd, null);
    assert.equal(result.journal.entries[2]?.status, "PREPARED");
  });

  it("does not replay SETTLED #1 or recovered #2 on a second launch", async () => {
    const { manifest, sealedCalls: calls } = pack();
    const journal = seedPartialJournal(manifest);
    journal.entries[1] = {
      ...journal.entries[1]!,
      status: "SETTLED",
      settlementSource: "provider_exact",
      billedUsd: 0.0050155,
      providerRequestId: OFFICIAL_REQUEST_ID,
      outputAvailability: "unavailable",
    };
    const first = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest,
      sealedCalls: calls,
      authorization: auth(manifest),
      transport: createMockPaidRunnerTransport(),
      journal,
    });
    assert.equal(first.transportPosts, 10);
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
    assert.equal(second.journal.entries[0]?.billedUsd, 0.001239);
    assert.equal(second.journal.entries[1]?.billedUsd, 0.0050155);
  });

  it("SHA-only rotation of a completed journal is duplicate execution", async () => {
    const original = pack(MAIN_SHA);
    const rotated = pack(ROTATED_SHA);
    const journal = createPaidRunnerJournal(original.manifest.manifestFingerprint, {
      identityHash: original.manifest.identityHash,
      experimentContinuityFingerprint: paidRunnerExperimentContinuityFingerprint(
        paidRunnerManifestDraft(original.manifest)
      ),
    });
    markPaidRunnerJournalPrepared(journal, original.manifest.calls);
    for (const entry of journal.entries) {
      entry.status = "SETTLED";
      entry.settlementSource = "provider_exact";
      entry.billedUsd = 0.01;
      entry.providerRequestId = `req-${entry.requestOrder}`;
    }
    const result = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest: rotated.manifest,
      sealedCalls: rotated.sealedCalls,
      authorization: auth(rotated.manifest),
      transport: createMockPaidRunnerTransport(),
      journal,
    });
    assert.equal(result.transportPosts, 0);
    assert.equal(result.denialReason, "DUPLICATE_MANIFEST_EXECUTION");
  });
});
