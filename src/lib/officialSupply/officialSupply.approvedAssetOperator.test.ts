import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { parseAssets } from "@/lib/characterAssets";
import { OPENROUTER_QWEN38_FLASH_MODEL, OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL } from "@/lib/chatModels";
import { getDb } from "@/lib/db";
import {
  approvedAssetReviewTemplate,
  approvedAssetStatus,
  knownVisionAttemptCostUsd,
  openApprovedAssetOperator,
  runApprovedAssetApply,
  runApprovedAssetIntake,
  runApprovedAssetModeration,
  runApprovedAssetReview,
  runApprovedAssetRollback,
  type ApprovedAssetOperatorTarget,
  type ModerationMeter,
  type ReviewEvidence,
} from "@/lib/officialSupply/approvedAssetApplyOperator";
import {
  ADMIN,
  APPROVED_PLAN_PATH,
  CANDIDATES,
  DOC,
  MANIFEST_PATH,
  REP,
  seedApprovedApplyUsers,
  stageApprovedWolfgangDraft,
  STRANGER,
  TEST_ONLY_REVIEWER,
  TestPorts,
  compositionCheck,
} from "@/lib/officialSupply/officialSupply.approvedApplyFixtures";
import { testBatchConfig, testStyleCandidate } from "@/lib/officialSupply/officialSupply.fixtures";
import { OfficialSupplyGateError, OfficialSupplyStore } from "@/lib/officialSupply/store";
import type { OfficialAssetStorage } from "@/lib/officialSupply/runner";
import { OPENROUTER_CHAT_COMPLETIONS_URL } from "@/lib/openRouterConfig";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { analyzeAssetImage } from "@/lib/vision";

/**
 * Isolated-DB run of the approved-asset operator over the real 14 manifest
 * files. Moderation results and the review evidence here are gate fixtures
 * for this temporary database only, not a quality approval.
 */
const DRAFT = "operator-wolfgang";
const BATCH = "operator-batch";
const ISOLATED_REVIEWER = "isolated-operator-proof";
const ISOLATED_EVIDENCE = "isolated DB wrapper proof only; production review uses its own evidence file";

let store: OfficialSupplyStore;
let ports: TestPorts;
let characterId = 0;
let target: ApprovedAssetOperatorTarget;
const originalFetch = globalThis.fetch;
const originalBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
const egressAttempts: string[] = [];
const tempDirs: string[] = [];

function expectGate(code: string) {
  return (error: unknown) => {
    assert.ok(error instanceof OfficialSupplyGateError, String(error));
    assert.equal(error.code, code, error.message);
    return true;
  };
}

function open(overrides: Partial<Parameters<typeof openApprovedAssetOperator>[0]> = {}) {
  return openApprovedAssetOperator({
    store,
    draftKey: DRAFT,
    characterId,
    adminEmail: ADMIN.email,
    manifestPath: MANIFEST_PATH,
    approvedPlanPath: APPROVED_PLAN_PATH,
    ...overrides,
  });
}

function withoutUpdatedAt(row: unknown): Record<string, unknown> {
  const { updated_at: _updatedAt, ...rest } = (row ?? {}) as Record<string, unknown>;
  return rest;
}

function dbState() {
  const db = store.database;
  return {
    character: db.prepare("SELECT assets, images, official, visibility, creator_id FROM characters WHERE id=?").get(characterId),
    supply: withoutUpdatedAt(db.prepare("SELECT * FROM official_supply_characters WHERE draft_key=?").get(DRAFT)),
    assets: db.prepare("SELECT * FROM official_supply_assets WHERE draft_key=? ORDER BY slot_key").all(DRAFT),
    replacements: db.prepare("SELECT * FROM official_supply_asset_replacements WHERE draft_key=? ORDER BY slot_key").all(DRAFT),
    applies: db.prepare("SELECT * FROM official_supply_replacement_applies WHERE draft_key=? ORDER BY apply_id").all(DRAFT),
  };
}

function tamperedManifest(mutate: (candidates: typeof CANDIDATES) => void): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "operator-manifest-"));
  tempDirs.push(dir);
  const candidates = CANDIDATES.map((c) => ({ ...c }));
  mutate(candidates);
  for (const candidate of CANDIDATES) fs.symlinkSync(path.join(DOC, candidate.file), path.join(dir, candidate.file));
  const manifestPath = path.join(dir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify({ candidates }));
  return manifestPath;
}

type ProviderReply =
  | { status: number; content?: string; costUsd?: number; usage?: boolean }
  | { broken: "truncated_json" | "unreadable_body" };

function brokenProviderResponse(broken: "truncated_json" | "unreadable_body"): Response {
  if (broken === "truncated_json") {
    return new Response('{"choices":[{"message":{"content":', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.error(new Error("body read failed"));
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

const PRIMARY = OPENROUTER_QWEN38_FLASH_MODEL;
const FALLBACK = OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL;
const DUMMY_KEY = "test-dummy-key-not-a-credential";
const PARSED = JSON.stringify({
  imageType: "person",
  personTag: "미소",
  backgroundTag: null,
  adult: false,
  reject: false,
  reason: "mock provider",
  nippleExposure: "none",
});
const parsed = (costUsd?: number): ProviderReply => ({ status: 200, content: PARSED, costUsd, usage: true });
const unparsed = (costUsd?: number): ProviderReply => ({ status: 200, content: "not json", costUsd, usage: true });
const noUsage: ProviderReply = { status: 200, content: PARSED, usage: false };
const http500: ProviderReply = { status: 500 };

let providerReplies: ProviderReply[] = [];
let providerPosts: string[] = [];

/** Same mapping as the production vision moderator, over the real vision owner and the mock provider. */
const visionMeter: ModerationMeter = {
  attemptsPerCall: 2,
  createModerator: (control) => ({
    moderate: async (url) => {
      const result = await analyzeAssetImage(url, 0, control);
      if (result.stoppedBeforeProviderPost) {
        return { status: "unavailable", reason: `asset vision moderation stopped: ${result.stoppedBeforeProviderPost}` };
      }
      if (result.estimated) return { status: "unavailable", reason: "asset vision moderation unavailable" };
      return {
        status: "checked",
        adultFlagged: result.adultFlagged,
        moderationReject: result.moderationReject,
        reason: result.moderationReason,
        visionTag: result.tag,
      };
    },
  }),
};

function failingStorage(failSlot: string): { storage: OfficialAssetStorage; failures: string[] } {
  const failures: string[] = [];
  return {
    failures,
    storage: {
      store: async (filename, buffer) => {
        if (filename.includes(`__${failSlot}-ext-`) && failures.length === 0) {
          failures.push(filename);
          throw new Error("disk full (injected)");
        }
        return ports.storage.store(filename, buffer);
      },
    },
  };
}

function evidence(overrides: Partial<ReviewEvidence> = {}): ReviewEvidence {
  const template = approvedAssetReviewTemplate(target);
  return {
    draftKey: DRAFT,
    characterId,
    isolatedProofOnly: true,
    reviewer: ISOLATED_REVIEWER,
    approvalEvidence: ISOLATED_EVIDENCE,
    slots: template.slots.map((slot) => ({
      slot: slot.slot,
      candidateUrl: slot.candidateUrl!,
      candidateSha256: slot.candidateSha256,
      qa: Object.fromEntries(
        Object.keys(slot.qa).map((key) => [
          key,
          key === "compositionIndependence"
            ? { ...compositionCheck(slot.candidateUrl!, slot.candidateSha256), note: `${slot.slot} ${key} isolated check` }
            : { ok: true, note: `${slot.slot} ${key} isolated check` },
        ])
      ),
    })),
    ...overrides,
  };
}

const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));

before(async () => {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === OPENROUTER_CHAT_COMPLETIONS_URL && init?.method === "POST" && providerReplies.length > 0) {
      providerPosts.push((JSON.parse(String(init.body)) as { model: string }).model);
      const next = providerReplies.shift()!;
      if ("broken" in next) return brokenProviderResponse(next.broken);
      if (next.status !== 200) return new Response("upstream error", { status: next.status });
      const usage = next.usage
        ? { prompt_tokens: 3000, completion_tokens: 40, ...(next.costUsd != null ? { cost: next.costUsd } : {}) }
        : undefined;
      return Response.json({ choices: [{ message: { content: next.content } }], ...(usage ? { usage } : {}) });
    }
    egressAttempts.push(url);
    throw new Error("network egress is not allowed in operator tests");
  }) as typeof fetch;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  installIsolatedTestDatabase();
  const db = getDb();
  seedApprovedApplyUsers(db);
  store = new OfficialSupplyStore(db);
  ports = new TestPorts();
  store.createBatch(BATCH, testBatchConfig({ budgetUsd: { batch: 100 } }));
  store.proposeStyle({ styleKey: "romance_fantasy_v4", genre: "로맨스 판타지", candidates: ["c1", "c2", "c3"].map(testStyleCandidate) });
  store.approveStyleCandidate(
    "romance_fantasy_v4",
    "c2",
    { url: "/uploads/official-style-seed.webp", provenance: "platform_owned", note: "owned seed" },
    "owner"
  );
  characterId = await stageApprovedWolfgangDraft(store, DRAFT, BATCH);
});

after(() => {
  globalThis.fetch = originalFetch;
  if (originalBlobToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = originalBlobToken;
  uninstallIsolatedTestDatabase();
  delete process.env.OPENROUTER_API_KEY;
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(egressAttempts, [], "operator tests made network calls");
});

describe("approved asset operator (isolated DB)", () => {
  it("1. refuses a non-admin, another character and a manifest whose file SHA or tag differs", () => {
    assert.throws(() => open({ adminEmail: STRANGER.email }), expectGate("operator_admin_required"));
    assert.throws(() => open({ adminEmail: "nobody@test.local" }), expectGate("operator_admin_required"));
    assert.throws(() => open({ characterId: characterId + 1 }), expectGate("operator_target_mismatch"));
    const shaChanged = tamperedManifest((c) => {
      c[1]!.rawSha256 = REP.rawSha256;
    });
    assert.throws(() => open({ manifestPath: shaChanged }), expectGate("operator_manifest_sha"));
    const tagChanged = tamperedManifest((c) => {
      c.find((x) => x.slot === "emo5")!.tag = "진지함";
    });
    assert.throws(() => open({ manifestPath: tagChanged }), expectGate("operator_manifest_tag"));
    target = open();
    assert.equal(target.candidates.length, 14);
  });

  it("2. status, intake, moderation, review and apply write nothing without --execute", async () => {
    const before = dbState();
    const status = approvedAssetStatus(target);
    assert.equal(status.writes, 0);
    assert.equal(status.stage, "staged_private");
    assert.deepEqual(new Set(status.slots.map((s) => s.next)), new Set(["intake"]));
    const intake = await runApprovedAssetIntake(target, ports, false);
    assert.equal(intake.planned.length, 14);
    assert.deepEqual(intake.registered, []);
    const plan = await runApprovedAssetModeration(target, visionMeter, null, false);
    assert.equal(plan.status, "planned");
    assert.deepEqual(plan.plan.pending, []);
    assert.throws(() => runApprovedAssetApply(target, false), expectGate("operator_apply_not_ready"));
    assert.deepEqual(dbState(), before);
    assert.deepEqual(ports.storedFiles, []);
    assert.deepEqual(providerPosts, []);
  });

  it("3. a failed store stops intake with its slot; the same intake resumes it, guards a live lease and reclaims an expired one", async () => {
    const now = Date.now();
    const failing = failingStorage("sig2");
    const first = await runApprovedAssetIntake(target, { storage: failing.storage, imageOps: ports.imageOps, nowMs: now }, true);
    assert.equal(first.status, "stopped");
    assert.deepEqual(first.registered.map((r) => r.slot), ["rep", "sig1"]);
    assert.deepEqual({ slot: first.failed?.slot, code: first.failed?.code }, { slot: "sig2", code: "intake_error" });
    assert.match(first.failed!.message, /disk full/);
    assert.ok(!first.skipped.some((s) => s.slot === "sig2"));
    assert.equal(failing.failures.length, 1);
    const left = store.getReplacement(DRAFT, "sig2");
    assert.deepEqual([left.status, left.leaseOwner, left.candidateResultUrl], ["planned", null, null]);
    const sig2 = approvedAssetStatus(target).slots.find((s) => s.slot === "sig2")!;
    assert.deepEqual([sig2.next, sig2.reason], ["intake", "previous intake stopped before registration"]);

    store.claimExternalReplacementIntake(ADMIN, DRAFT, "sig3", "another-live-intake", now);
    const leaseMs = store.getBatch(BATCH).config.leaseMs;
    const guarded = await runApprovedAssetIntake(target, { ...ports, nowMs: now + 1 }, true);
    assert.equal(guarded.status, "completed");
    assert.equal(guarded.registered[0]!.slot, "sig2");
    assert.equal(guarded.registered[0]!.resumed, "previous intake stopped before registration");
    assert.ok(!guarded.registered.some((r) => ["rep", "sig1", "sig3"].includes(r.slot)));
    assert.equal(guarded.registered.length, 11);
    const held = guarded.skipped.find((s) => s.slot === "sig3")!;
    assert.equal(held.next, "blocked");
    assert.match(held.reason!, /another intake holds the lease/);
    assert.equal(store.getReplacement(DRAFT, "sig3").leaseOwner, "another-live-intake");

    const expired = await runApprovedAssetIntake(target, { ...ports, nowMs: now + leaseMs + 1 }, true);
    assert.equal(expired.status, "completed");
    assert.deepEqual(
      expired.registered.map((r) => [r.slot, r.resumed]),
      [["sig3", "previous intake lease expired before registration"]]
    );

    const again = await runApprovedAssetIntake(target, ports, true);
    assert.equal(again.status, "completed");
    assert.deepEqual(again.registered, []);
    assert.deepEqual(new Set(again.skipped.map((s) => s.next)), new Set(["moderate"]));
    assert.equal(ports.storedFiles.length, 14);
    assert.deepEqual(new Set(ports.storedFiles.map((f) => f.split("__")[1]!.split("-ext-")[0])).size, 14);

    const db = store.database;
    const row = db.prepare("SELECT status FROM official_supply_asset_replacements WHERE draft_key=? AND slot_key='emo1'").get(DRAFT) as { status: string };
    db.prepare("UPDATE official_supply_asset_replacements SET status='generating' WHERE draft_key=? AND slot_key='emo1'").run(DRAFT);
    const generating = await runApprovedAssetIntake(target, ports, true);
    assert.deepEqual(generating.registered, []);
    assert.deepEqual(generating.skipped.find((s) => s.slot === "emo1"), { slot: "emo1", next: "blocked", reason: "replacement is generating" });
    db.prepare("UPDATE official_supply_asset_replacements SET status=? WHERE draft_key=? AND slot_key='emo1'").run(row.status, DRAFT);
    assert.equal(ports.storedFiles.length, 14);
  });

  it("4. paid moderation: caps per run, POSTs checked before primary and fallback, confirmed and unknown cost kept apart", async () => {
    const caps = { maxCalls: 28, maxCostUsd: 0.28, perCallReserveUsd: 0.01 };
    const before = dbState();
    const plan = await runApprovedAssetModeration(target, visionMeter, caps, false);
    assert.deepEqual(plan.plan, {
      scope: "this command run",
      pending: CANDIDATES.map((c) => c.slot),
      attemptsPerCall: 2,
      worstCaseCalls: 28,
      worstCaseCostUsd: 0.28,
    });
    await assert.rejects(() => runApprovedAssetModeration(target, visionMeter, null, true), expectGate("operator_moderation_budget_required"));
    await assert.rejects(
      () => runApprovedAssetModeration(target, visionMeter, { ...caps, maxCalls: 27, maxCostUsd: 1 }, true),
      expectGate("operator_moderation_budget_exceeded")
    );
    await assert.rejects(
      () => runApprovedAssetModeration(target, visionMeter, { ...caps, maxCostUsd: 0.27 }, true),
      expectGate("operator_moderation_budget_exceeded")
    );
    assert.deepEqual(dbState(), before);
    assert.deepEqual(providerPosts, []);

    delete process.env.OPENROUTER_API_KEY;
    const noKey = await runApprovedAssetModeration(target, visionMeter, caps, true);
    assert.equal(noKey.status, "stopped");
    assert.equal(noKey.stopReason, "rep moderation unavailable");
    assert.deepEqual(noKey.accounting, {
      scope: "this command run",
      providerPosts: 0,
      postsWithConfirmedCost: 0,
      confirmedCostUsd: 0,
      postsWithUnknownCost: 0,
      unknownCostReserveHeldUsd: 0,
      budgetUsedUsd: 0,
      reservedUsd: 0.28,
      unusedReserveUsd: 0.28,
      chargesAboveReserve: [],
    });
    assert.deepEqual(providerPosts, []);

    process.env.OPENROUTER_API_KEY = DUMMY_KEY;
    const moderationBeforeParseFailure = store.getReplacement(DRAFT, "rep").moderation;
    providerReplies = [{ broken: "truncated_json" }];
    const truncated = await runApprovedAssetModeration(target, visionMeter, caps, true);
    assert.equal(truncated.status, "stopped");
    assert.equal(truncated.error?.code, "moderation_error");
    assert.match(truncated.error?.message ?? "", /JSON/);
    assert.deepEqual(providerPosts, [PRIMARY]);
    assert.equal(truncated.accounting.providerPosts, 1);
    assert.equal(truncated.accounting.postsWithConfirmedCost, 0);
    assert.equal(truncated.accounting.confirmedCostUsd, 0);
    assert.equal(truncated.accounting.postsWithUnknownCost, 1);
    assert.equal(truncated.accounting.unknownCostReserveHeldUsd, 0.01);
    assert.deepEqual(truncated.posts.map((post) => [post.slot, post.model, post.outcome, post.confirmedCostUsd]), [
      ["rep", PRIMARY, "unparsed", null],
    ]);
    assert.deepEqual(store.getReplacement(DRAFT, "rep").moderation, moderationBeforeParseFailure);

    providerPosts = [];
    providerReplies = [{ broken: "unreadable_body" }];
    const unreadable = await runApprovedAssetModeration(target, visionMeter, caps, true);
    assert.equal(unreadable.status, "stopped");
    assert.match(unreadable.error?.message ?? "", /body read failed/);
    assert.deepEqual(providerPosts, [PRIMARY]);
    assert.equal(unreadable.accounting.providerPosts, 1);
    assert.equal(unreadable.accounting.confirmedCostUsd, 0);
    assert.equal(unreadable.accounting.postsWithUnknownCost, 1);
    assert.equal(unreadable.accounting.unknownCostReserveHeldUsd, 0.01);
    assert.deepEqual(store.getReplacement(DRAFT, "rep").moderation, moderationBeforeParseFailure);

    providerPosts = [];
    providerReplies = [http500, { broken: "truncated_json" }];
    const kept = await runApprovedAssetModeration(target, visionMeter, caps, true);
    assert.equal(kept.status, "stopped");
    assert.equal(kept.error?.code, "moderation_error");
    assert.deepEqual(providerPosts, [PRIMARY, FALLBACK]);
    assert.deepEqual(
      kept.posts.map((post) => [post.model, post.outcome, post.confirmedCostUsd]),
      [
        [PRIMARY, "http_error", null],
        [FALLBACK, "unparsed", null],
      ]
    );
    assert.equal(kept.accounting.providerPosts, 2);
    assert.equal(kept.accounting.postsWithConfirmedCost, 0);
    assert.equal(kept.accounting.postsWithUnknownCost, 2);
    assert.equal(kept.accounting.unknownCostReserveHeldUsd, 0.02);
    assert.deepEqual(store.getReplacement(DRAFT, "rep").moderation, moderationBeforeParseFailure);

    providerPosts = [];
    providerReplies = [unparsed(0.02)];
    const overReserve = await runApprovedAssetModeration(target, visionMeter, caps, true);
    assert.equal(overReserve.status, "stopped");
    assert.match(overReserve.stopReason!, /^rep: rep qwen\/qwen3\.8-flash was billed 0\.02 USD, above the 0\.01 USD per-call reserve; the next provider POST was not sent$/);
    assert.deepEqual(providerPosts, [PRIMARY]);
    assert.deepEqual(overReserve.accounting.chargesAboveReserve, [
      { slot: "rep", model: PRIMARY, confirmedCostUsd: 0.02, reserveUsd: 0.01 },
    ]);
    assert.equal(overReserve.accounting.providerPosts, 1);
    assert.equal(overReserve.accounting.confirmedCostUsd, 0.02);
    assert.equal(overReserve.accounting.postsWithUnknownCost, 0);
    assert.equal(store.getReplacement(DRAFT, "rep").moderation?.status, "unavailable");

    providerPosts = [];
    providerReplies = [parsed(0.0004), http500, parsed(0.0006), noUsage, http500, http500];
    const mixed = await runApprovedAssetModeration(target, visionMeter, caps, true);
    assert.equal(mixed.status, "stopped");
    assert.equal(mixed.stopReason, "sig3 moderation unavailable");
    assert.deepEqual(providerPosts, [PRIMARY, PRIMARY, FALLBACK, PRIMARY, PRIMARY, FALLBACK]);
    assert.deepEqual(
      mixed.posts.map((p) => [p.slot, p.model, p.outcome, p.confirmedCostUsd]),
      [
        ["rep", PRIMARY, "parsed", 0.0004],
        ["sig1", PRIMARY, "http_error", null],
        ["sig1", FALLBACK, "parsed", 0.0006],
        ["sig2", PRIMARY, "parsed", null],
        ["sig3", PRIMARY, "http_error", null],
        ["sig3", FALLBACK, "http_error", null],
      ]
    );
    assert.deepEqual(mixed.accounting, {
      scope: "this command run",
      providerPosts: 6,
      postsWithConfirmedCost: 2,
      confirmedCostUsd: 0.001,
      postsWithUnknownCost: 4,
      unknownCostReserveHeldUsd: 0.04,
      budgetUsedUsd: 0.041,
      reservedUsd: 0.28,
      unusedReserveUsd: 0.239,
      chargesAboveReserve: [],
    });
    assert.deepEqual(mixed.results.map((r) => r.verdict), ["clean", "clean", "clean", "unavailable"]);

    providerPosts = [];
    providerReplies = Array.from({ length: 11 }, () => parsed(0.0005));
    const resumed = await runApprovedAssetModeration(target, visionMeter, { maxCalls: 22, maxCostUsd: 0.22, perCallReserveUsd: 0.01 }, true);
    assert.equal(resumed.status, "completed");
    assert.equal(resumed.plan.pending[0], "sig3");
    assert.equal(resumed.plan.pending.length, 11);
    assert.equal(providerPosts.length, 11);
    assert.ok(providerPosts.every((model) => model === PRIMARY));
    assert.equal(resumed.accounting.providerPosts, 11);
    assert.equal(resumed.accounting.confirmedCostUsd, 0.0055);
    assert.equal(resumed.accounting.postsWithUnknownCost, 0);
    assert.equal(resumed.accounting.unusedReserveUsd, 0.2145);

    providerPosts = [];
    const noop = await runApprovedAssetModeration(target, visionMeter, { maxCalls: 1, maxCostUsd: 0.01, perCallReserveUsd: 0.01 }, true);
    assert.equal(noop.status, "completed");
    assert.equal(noop.accounting.providerPosts, 0);
    assert.deepEqual(providerPosts, []);
    assert.deepEqual(new Set(approvedAssetStatus(target).slots.map((s) => s.next)), new Set(["review"]));
  });

  it("4b. only provider-billed vision attempts count as known cost", () => {
    assert.equal(knownVisionAttemptCostUsd({ model: "m", usageEstimated: true, upstreamCostUsd: 0.5, outcome: "success" }), null);
    assert.equal(
      knownVisionAttemptCostUsd({
        model: "m",
        usageEstimated: false,
        upstreamCostUsd: 0.5,
        cheaperInferenceBilledCostUsd: 0.2,
        outcome: "success",
      }),
      0.2
    );
    assert.equal(knownVisionAttemptCostUsd({ model: "m", usageEstimated: false, outcome: "failed_with_usage" }), null);
  });

  it("5. review evidence is bound to the stored URL and SHA; fixtures, isolated proof in production and gaps are refused", () => {
    const template = approvedAssetReviewTemplate(target);
    assert.equal(template.slots.length, 14);
    assert.ok(template.slots.every((slot) => Object.values(slot.qa).every((check) => check.ok === null)));
    const review = (value: unknown, production = false, execute = false) =>
      runApprovedAssetReview(target, bytes(value), { execute, productionDatabase: production });
    const refused = (value: unknown, production = false) =>
      assert.throws(() => review(value, production), expectGate("operator_review_evidence"));

    refused(template);
    refused(evidence({ reviewer: TEST_ONLY_REVIEWER }));
    refused(evidence(), true);
    const valid = evidence();
    refused({ ...valid, slots: [{ ...valid.slots[1]!, candidateUrl: valid.slots[2]!.candidateUrl }] });
    refused({ ...valid, slots: [{ ...valid.slots[1]!, candidateSha256: REP.rawSha256 }] });
    refused({
      ...valid,
      slots: [{ ...valid.slots[1]!, qa: { ...valid.slots[1]!.qa, artStyle: { ok: true, note: "" } } }],
    });
    refused({ ...valid, slots: [{ ...valid.slots[1]!, qa: { ...valid.slots[1]!.qa, face: { ok: true, note: "x" } } }] });

    const before = dbState();
    const dry = review(valid);
    assert.equal(dry.planned.length, 14);
    assert.deepEqual(dry.recorded, []);
    assert.deepEqual(dbState(), before);

    const recorded = review(valid, false, true);
    assert.equal(recorded.recorded.length, 14);
    assert.ok(recorded.recorded.every((r) => r.approved));
    assert.equal(store.getReplacement(DRAFT, "rep").reviewedBy, ISOLATED_REVIEWER);
    assert.match(recorded.evidenceSha256, /^[0-9a-f]{64}$/);
    const again = review(valid, false, true);
    assert.deepEqual(again.recorded, []);
    assert.equal(again.alreadyReviewed.length, 14);
  });

  it("6. apply defaults to a dry run, records an applyId once, and rollback restores the previous state", async () => {
    const before = dbState();
    const dry = runApprovedAssetApply(target, false);
    assert.equal(dry.status, "dry_run");
    assert.equal(dry.applyId, null);
    assert.deepEqual(dbState(), before);

    const applied = runApprovedAssetApply(target, true);
    assert.equal(applied.status, "applied");
    assert.ok(applied.applyId);
    const assets = parseAssets((dbState().character as { assets: string }).assets);
    assert.equal(assets[0]!.url, store.getReplacement(DRAFT, "rep").candidateResultUrl);
    assert.equal(assets[0]!.tag, "기본 초상");
    assert.deepEqual(new Set(approvedAssetStatus(target).slots.map((s) => s.next)), new Set(["applied"]));

    const repeat = runApprovedAssetApply(target, true);
    assert.equal(repeat.status, "already_applied");
    assert.equal(repeat.applyId, applied.applyId);
    assert.equal(approvedAssetStatus(target).applies.length, 1);
    const intakeAfterApply = await runApprovedAssetIntake(target, ports, true);
    assert.equal(intakeAfterApply.status, "completed");
    assert.deepEqual(intakeAfterApply.registered, []);
    assert.deepEqual(new Set(intakeAfterApply.skipped.map((s) => s.next)), new Set(["applied"]));
    assert.equal(ports.storedFiles.length, 14);

    const appliedState = dbState();
    const dryRollback = runApprovedAssetRollback(target, applied.applyId!, false);
    assert.equal(dryRollback.status, "dry_run");
    assert.deepEqual(dbState(), appliedState);

    const rolledBack = runApprovedAssetRollback(target, applied.applyId!, true);
    assert.equal(rolledBack.status, "rolled_back");
    const restored = dbState();
    assert.deepEqual(restored.character, before.character);
    assert.deepEqual(restored.supply, before.supply);
    assert.deepEqual(new Set(approvedAssetStatus(target).slots.map((s) => s.next)), new Set(["apply"]));
    assert.deepEqual(approvedAssetStatus(target).applies.map((row) => row.status), ["rolled_back"]);
    assert.deepEqual(egressAttempts, []);
  });
});
