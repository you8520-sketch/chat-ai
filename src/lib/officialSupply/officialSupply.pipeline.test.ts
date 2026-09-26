import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import { getDb } from "@/lib/db";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { createCharacterFromForm, parseCharacterFormBody, type SessionUser } from "@/lib/characterFormSave";
import { canAccessCharacter, listableWhere, type CharacterAccessRow } from "@/lib/characterVisibility";
import { getCharacterRepresentativeImageUrl, isWideInlineAsset, parseAssets } from "@/lib/characterAssets";
import { OfficialSupplyGateError, OfficialSupplyStore } from "@/lib/officialSupply/store";
import {
  OfficialImageTransportError,
  OfficialSupplyBudgetError,
  runOfficialAssetSlot,
  type OfficialAssetRunnerDeps,
  type OfficialImageTransport,
} from "@/lib/officialSupply/runner";
import { stageOfficialCharacterPrivately } from "@/lib/officialSupply/staging";
import { buildOfficialCharacterFormBody } from "@/lib/officialSupply/characterText";
import type {
  OfficialAnchorQaReport,
  OfficialCharacterDraft,
  OfficialVariationQaReport,
  OfficialWorldLorebookEntry,
} from "@/lib/officialSupply/types";
import {
  HWANG_VOCAB,
  KNIGHT_VOCAB,
  MAGE_VOCAB,
  testAppearance,
  testAssetPlan,
  testBatchConfig,
  testDraft,
  testNpc,
  testStyleCandidate,
} from "@/lib/officialSupply/officialSupply.fixtures";
import type { OfficialSupplyBatchConfig } from "@/lib/officialSupply/store";

const STAGING_USER: SessionUser = { id: 7001, nickname: "official-staging", is_adult: 1 };
const OTHER_VIEWER = 7002;
const SEED = { url: "/uploads/official-style-seed.webp", provenance: "platform_owned" as const, note: "owned seed" };
const IMAGE_ENV = { OPENAI_IMAGE_MODEL: "gpt-image-2.5-flare" } as NodeJS.ProcessEnv;

type FakeCall = { model: string; size: string; references: string[]; primaryPrompt: string; idempotencyKey: string };

function encodeImage(width: number, height: number): Buffer {
  return Buffer.from(`${width}x${height}`);
}

class FakeWorld {
  calls: FakeCall[] = [];
  stored = new Map<string, Buffer>();
  spool = new Map<string, Buffer>();
  nextDims: Array<[number, number]> = [];
  failNextProvider: Array<{ message: string; costUsd: number | null }> = [];
  failNextUploads = 0;
  costPerImage = 0.1;
  now = 1_000_000;

  transport: OfficialImageTransport = {
    generate: async (input) => {
      this.calls.push({
        model: input.model,
        size: input.size,
        references: input.references,
        primaryPrompt: input.primaryPrompt,
        idempotencyKey: input.idempotencyKey,
      });
      await Promise.resolve();
      const failure = this.failNextProvider.shift();
      if (failure) throw new OfficialImageTransportError(failure.message, failure.costUsd, failure.costUsd == null);
      const [w, h] = this.nextDims.shift() ?? (input.size.split("x").map(Number) as [number, number]);
      return { buffer: encodeImage(w, h), costUsd: this.costPerImage, hasUnknownAttemptCost: false, providerRequestId: `req-${this.calls.length}` };
    },
  };

  deps(store: OfficialSupplyStore, workerId = "worker-1"): OfficialAssetRunnerDeps {
    return {
      store,
      transport: this.transport,
      imageOps: {
        inspect: async (buffer) => {
          const match = /^(\d+)x(\d+)$/.exec(buffer.toString());
          return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
        },
        normalize: async (_buffer, profile) => encodeImage(profile.width, profile.height),
      },
      storage: {
        store: async (filename, buffer) => {
          if (this.failNextUploads > 0) {
            this.failNextUploads -= 1;
            throw new Error("blob unavailable");
          }
          this.stored.set(filename, buffer);
          return { url: `/uploads/${filename}` };
        },
      },
      spool: {
        save: async (key, buffer) => void this.spool.set(key, buffer),
        load: async (key) => this.spool.get(key) ?? null,
        remove: async (key) => void this.spool.delete(key),
      },
      workerId,
      now: () => this.now,
      env: IMAGE_ENV,
    };
  }
}

const PASS = { ok: true };
const anchorQa = (overrides: Partial<OfficialAnchorQaReport> = {}): OfficialAnchorQaReport => ({
  gender: PASS, ageAppearance: PASS, face: PASS, hair: PASS, eyes: PASS, body: PASS,
  identifyingFeatures: PASS, artStyle: PASS, outfit: PASS, cardCrop: PASS, ...overrides,
});
const variationQa = (overrides: Partial<OfficialVariationQaReport> = {}): OfficialVariationQaReport => ({
  identityMatchesAnchor: PASS, expressionMatchesPlan: PASS, characterPresent: PASS, artStyle: PASS,
  moderation: { adultFlagged: false, moderationReject: false, reason: "" }, ...overrides,
});

let batchSeq = 0;
/** Returns a batch whose genre style is at the requested gate. "locked" goes through a real proof + approval. */
async function freshBatch(store: OfficialSupplyStore, config: Partial<OfficialSupplyBatchConfig> = {}, styleStage: "proposed" | "candidate" | "locked" = "locked") {
  batchSeq += 1;
  const batchKey = `batch-${batchSeq}`;
  const styleKey = `romance_fantasy_v${batchSeq}`;
  const batch = { batchKey, styleKey, worldKey: `world-${batchSeq}` };
  store.createBatch(batchKey, testBatchConfig({ ...config, budgetUsd: { batch: 100 } }));
  store.proposeStyle({ styleKey, genre: "로맨스 판타지", candidates: ["c1", "c2", "c3"].map(testStyleCandidate) });
  if (styleStage !== "proposed") store.approveStyleCandidate(styleKey, "c2", SEED, "owner");
  if (styleStage === "locked") {
    const proofKey = `proof-of-${batchSeq}`;
    lockThroughPlan(store, { ...batch, worldKey: `proof-world-${batchSeq}` }, uniqueDraft(proofKey, HWANG_VOCAB, "레온하르트"), { isStyleProof: true });
    await runOfficialAssetSlot(new FakeWorld().deps(store), proofKey, "rep");
    store.decideStyleProof(styleKey, "approve", "owner");
  }
  const full = testBatchConfig(config);
  store.database.prepare("UPDATE official_supply_batches SET config_json=? WHERE batch_key=?").run(JSON.stringify(full), batchKey);
  return batch;
}

function lockThroughPlan(
  store: OfficialSupplyStore,
  batch: { batchKey: string; styleKey: string; worldKey: string },
  draft: OfficialCharacterDraft,
  opts: { isStyleProof?: boolean; adultScene?: boolean } = {}
) {
  store.addCharacterDraft(batch.batchKey, { ...draft, styleKey: batch.styleKey, worldKey: batch.worldKey }, { isStyleProof: opts.isStyleProof });
  const text = store.lockText(draft.draftKey, { stagingUser: STAGING_USER });
  assert.deepEqual(text.errors, [], `text lock ${draft.draftKey}`);
  assert.equal(store.lockAppearance(draft.draftKey, testAppearance()).ok, true);
  const plan = store.lockAssetPlan(draft.draftKey, testAssetPlan({ adultScene: opts.adultScene }));
  assert.deepEqual(plan.errors, []);
}

async function generateAndApproveAll(store: OfficialSupplyStore, world: FakeWorld, draftKey: string) {
  const deps = world.deps(store);
  assert.equal((await runOfficialAssetSlot(deps, draftKey, "rep")).status, "generated");
  assert.equal(store.reviewAnchor(draftKey, anchorQa(), "owner").approved, true);
  for (const asset of store.listAssets(draftKey)) {
    if (asset.kind === "representative") continue;
    assert.equal((await runOfficialAssetSlot(deps, draftKey, asset.slotKey)).status, "generated");
    store.reviewVariation(draftKey, asset.slotKey, variationQa());
  }
  assert.equal(store.getCharacter(draftKey).stage, "assets_complete");
  assert.equal(store.markQaPassed(draftKey).ok, true);
}

function uniqueDraft(key: string, vocab: readonly string[], name: string, extra: Partial<Parameters<typeof testDraft>[0]> = {}) {
  return testDraft({ draftKey: key, name, vocabulary: vocab, ...extra });
}

let store: OfficialSupplyStore;

before(() => {
  installIsolatedTestDatabase();
  const db = getDb();
  for (const user of [STAGING_USER, { id: OTHER_VIEWER, nickname: "viewer", is_adult: 1 }]) {
    db.prepare("INSERT OR IGNORE INTO users (id, email, nickname, pw_hash, points, is_adult) VALUES (?,?,?,?,1000,1)")
      .run(user.id, `u${user.id}@test.local`, user.nickname, "hash");
  }
  store = new OfficialSupplyStore(db);
});

after(() => uninstallIsolatedTestDatabase());

describe("user approval gates block paid calls", () => {
  let world: FakeWorld;
  beforeEach(() => {
    world = new FakeWorld();
  });

  it("STYLE_CANDIDATE_APPROVAL: nothing generates before a candidate + owned seed is approved", async () => {
    const batch = await freshBatch(store, {}, "proposed");
    lockThroughPlan(store, batch, uniqueDraft("gate-a", HWANG_VOCAB, "레온하르트"), { isStyleProof: true });
    await assert.rejects(runOfficialAssetSlot(world.deps(store), "gate-a", "rep"), (e: OfficialSupplyGateError) => e.code === "style_candidate_not_approved");
    assert.throws(
      () => store.approveStyleCandidate(batch.styleKey, "c1", { url: "https://competitor/x.png", provenance: "external_public_observation", note: "" }, "owner"),
      (e: OfficialSupplyGateError) => e.code === "style_seed_invalid"
    );
    assert.throws(() => store.approveStyleCandidate(batch.styleKey, "nope", SEED, "owner"), (e: OfficialSupplyGateError) => e.code === "style_candidate_unknown");
    assert.equal(world.calls.length, 0);
  });

  it("TEXT_LOCK / APPEARANCE_LOCK: generation is refused until both locks and the plan exist", async () => {
    const batch = await freshBatch(store);
    const draft = uniqueDraft("gate-b", HWANG_VOCAB, "레온하르트");
    store.addCharacterDraft(batch.batchKey, { ...draft, styleKey: batch.styleKey, worldKey: batch.worldKey });
    await assert.rejects(runOfficialAssetSlot(world.deps(store), "gate-b", "rep"), (e: OfficialSupplyGateError) => e.code === "character_stage");
    assert.throws(() => store.lockAppearance("gate-b", testAppearance()), (e: OfficialSupplyGateError) => e.code === "character_stage");
    store.lockText("gate-b", { stagingUser: STAGING_USER });
    await assert.rejects(runOfficialAssetSlot(world.deps(store), "gate-b", "rep"), (e: OfficialSupplyGateError) => e.code === "character_stage");
    assert.throws(() => store.lockAssetPlan("gate-b", testAssetPlan()), (e: OfficialSupplyGateError) => e.code === "character_stage");
    assert.equal(world.calls.length, 0);
  });

  it("TEXT_LOCK refuses a sheet the canonical form parser would reject", async () => {
    const batch = await freshBatch(store);
    const draft = uniqueDraft("gate-c", HWANG_VOCAB, "레온하르트");
    draft.greeting = "가".repeat(2500);
    store.addCharacterDraft(batch.batchKey, { ...draft, styleKey: batch.styleKey, worldKey: batch.worldKey });
    const qa = store.lockText("gate-c", { stagingUser: STAGING_USER });
    assert.equal(qa.ok, false);
    assert.ok(qa.errors.some((e) => e.code === "canonical_form_rejected"));
    assert.equal(store.getCharacter("gate-c").stage, "draft");
  });

  it("STYLE_PROOF_APPROVAL: only proof characters generate, within the proof quota, and anchor comes first", async () => {
    const batch = await freshBatch(store, {}, "candidate");
    lockThroughPlan(store, batch, uniqueDraft("proof-1", HWANG_VOCAB, "레온하르트"), { isStyleProof: true });
    lockThroughPlan(store, batch, uniqueDraft("bulk-1", KNIGHT_VOCAB, "세라핀", { gender: "female", hook: { archetype: "강철 기사", occupation: "기사단장", relationshipTrope: "호위" } }));
    const deps = world.deps(store);

    await assert.rejects(runOfficialAssetSlot(deps, "bulk-1", "rep"), (e: OfficialSupplyGateError) => e.code === "style_not_locked");
    await assert.rejects(runOfficialAssetSlot(deps, "proof-1", "emo1"), (e: OfficialSupplyGateError) => e.code === "anchor_not_approved");
    assert.equal(world.calls.length, 0);

    assert.equal((await runOfficialAssetSlot(deps, "proof-1", "rep")).status, "generated");
    assert.throws(() => store.decideStyleProof(batch.styleKey, "approve", ""), (e: OfficialSupplyGateError) => e.code === "reviewer_required");
    store.reviewAnchor("proof-1", anchorQa(), "owner");
    assert.equal((await runOfficialAssetSlot(deps, "proof-1", "emo5")).status, "generated");
    assert.equal((await runOfficialAssetSlot(deps, "proof-1", "scene2")).status, "generated");
    await assert.rejects(runOfficialAssetSlot(deps, "proof-1", "sig1"), (e: OfficialSupplyGateError) => e.code === "style_proof_quota");
    assert.equal(world.calls.length, 3);

    store.decideStyleProof(batch.styleKey, "approve", "owner");
    assert.equal(store.getStyle(batch.styleKey).stage, "style_locked");
    assert.equal((await runOfficialAssetSlot(deps, "bulk-1", "rep")).status, "generated");
    assert.equal((await runOfficialAssetSlot(deps, "proof-1", "sig1")).status, "generated");
  });

  it("rejected style proof costs only the proof and blocks everything after", async () => {
    const batch = await freshBatch(store, {}, "candidate");
    lockThroughPlan(store, batch, uniqueDraft("proof-r", HWANG_VOCAB, "레온하르트"), { isStyleProof: true });
    await runOfficialAssetSlot(world.deps(store), "proof-r", "rep");
    store.decideStyleProof(batch.styleKey, "reject", "owner");
    await assert.rejects(runOfficialAssetSlot(world.deps(store), "proof-r", "rep"), (e: OfficialSupplyGateError) => e.code === "style_rejected");
    assert.equal(world.calls.length, 1);
  });
});

describe("anchor-first generation, retries and idempotency", () => {
  it("ANCHOR_APPROVAL: failed anchor QA retries the anchor only; variations never start before approval", async () => {
    const world = new FakeWorld();
    const batch = await freshBatch(store);
    lockThroughPlan(store, batch, uniqueDraft("anchor-1", HWANG_VOCAB, "레온하르트"));
    const deps = world.deps(store);
    await runOfficialAssetSlot(deps, "anchor-1", "rep");
    assert.equal(store.reviewAnchor("anchor-1", anchorQa({ gender: { ok: false, note: "reads female" } }), "owner").approved, false);
    await assert.rejects(runOfficialAssetSlot(deps, "anchor-1", "sig1"), (e: OfficialSupplyGateError) => e.code === "anchor_not_approved");
    assert.equal((await runOfficialAssetSlot(deps, "anchor-1", "rep")).status, "generated");
    assert.equal(world.calls.length, 2);
    assert.ok(world.calls.every((c) => c.size === "1024x1536" && c.references[0] === SEED.url));
    store.reviewAnchor("anchor-1", anchorQa(), "owner");
    await runOfficialAssetSlot(deps, "anchor-1", "scene1");
    const last = world.calls.at(-1)!;
    assert.equal(last.size, "1536x1024");
    assert.equal(last.references[0], store.representativeAsset("anchor-1").resultUrl);
  });

  it("uses the canonical effective model (env override) and records it per asset", async () => {
    const world = new FakeWorld();
    const batch = await freshBatch(store);
    lockThroughPlan(store, batch, uniqueDraft("model-1", HWANG_VOCAB, "레온하르트"));
    await runOfficialAssetSlot(world.deps(store), "model-1", "rep");
    assert.equal(world.calls[0]!.model, "gpt-image-2.5-flare");
    assert.equal(store.representativeAsset("model-1").model, "gpt-image-2.5-flare");
  });

  it("a generated slot is never re-sent; concurrent/double starts converge on one provider call", async () => {
    const world = new FakeWorld();
    const batch = await freshBatch(store);
    lockThroughPlan(store, batch, uniqueDraft("idem-1", HWANG_VOCAB, "레온하르트"));
    const [a, b] = await Promise.all([
      runOfficialAssetSlot(world.deps(store, "w1"), "idem-1", "rep"),
      runOfficialAssetSlot(world.deps(store, "w2"), "idem-1", "rep"),
    ]);
    assert.deepEqual([a.status, b.status].sort(), ["generated", "in_progress_elsewhere"]);
    assert.equal((await runOfficialAssetSlot(world.deps(store), "idem-1", "rep")).status, "already_generated");
    assert.equal(world.calls.length, 1);
  });

  it("stale lease after a crash is reclaimed; a live lease is not", async () => {
    const world = new FakeWorld();
    const batch = await freshBatch(store);
    lockThroughPlan(store, batch, uniqueDraft("lease-1", HWANG_VOCAB, "레온하르트"));
    assert.equal(store.claimSlot("lease-1", "rep", "crashed-worker", world.now, 60_000, 3), true);
    assert.equal((await runOfficialAssetSlot(world.deps(store), "lease-1", "rep")).status, "in_progress_elsewhere");
    world.now += 61_000;
    assert.equal((await runOfficialAssetSlot(world.deps(store), "lease-1", "rep")).status, "generated");
    assert.equal(world.calls.length, 1);
  });

  it("provider timeout / malformed output fail that slot only and are retried alone", async () => {
    const world = new FakeWorld();
    const batch = await freshBatch(store);
    lockThroughPlan(store, batch, uniqueDraft("fail-1", HWANG_VOCAB, "레온하르트"));
    const deps = world.deps(store);
    world.failNextProvider.push({ message: "이미지 생성 시간이 초과되었습니다.", costUsd: null });
    assert.equal((await runOfficialAssetSlot(deps, "fail-1", "rep")).status, "failed");
    world.nextDims.push([1536, 1024]);
    assert.equal((await runOfficialAssetSlot(deps, "fail-1", "rep")).status, "failed");
    assert.match(store.representativeAsset("fail-1").error ?? "", /malformed output 1536x1024/);
    world.nextDims.push([1020, 1536]);
    assert.equal((await runOfficialAssetSlot(deps, "fail-1", "rep")).status, "generated");
    const rep = store.representativeAsset("fail-1");
    assert.equal(rep.width, 1024);
    assert.equal(rep.height, 1536);
    assert.equal(rep.attempts, 3);
    assert.equal(rep.hasUnknownCost, true);
    assert.equal((await runOfficialAssetSlot(deps, "fail-1", "rep")).status, "already_generated");
    store.reviewAnchor("fail-1", anchorQa(), "owner");
    world.failNextProvider.push({ message: "bad", costUsd: 0.05 });
    await runOfficialAssetSlot(deps, "fail-1", "emo1");
    assert.equal(store.getAsset("fail-1", "emo1").status, "failed");
    assert.equal(store.getAsset("fail-1", "emo2").status, "planned");
    assert.equal(store.getAsset("fail-1", "emo1").spentUsd, 0.05);
  });

  it("attempt cap stops retries", async () => {
    const world = new FakeWorld();
    const batch = await freshBatch(store, { maxAttemptsPerSlot: 2 });
    lockThroughPlan(store, batch, uniqueDraft("cap-1", HWANG_VOCAB, "레온하르트"));
    world.failNextProvider.push({ message: "x", costUsd: 0 }, { message: "x", costUsd: 0 });
    await runOfficialAssetSlot(world.deps(store), "cap-1", "rep");
    await runOfficialAssetSlot(world.deps(store), "cap-1", "rep");
    assert.equal((await runOfficialAssetSlot(world.deps(store), "cap-1", "rep")).status, "attempts_exhausted");
    assert.equal(world.calls.length, 2);
  });

  it("partial upload: paid result is spooled and re-uploaded without a second provider call", async () => {
    const world = new FakeWorld();
    const batch = await freshBatch(store);
    lockThroughPlan(store, batch, uniqueDraft("upload-1", HWANG_VOCAB, "레온하르트"));
    world.failNextUploads = 1;
    assert.equal((await runOfficialAssetSlot(world.deps(store), "upload-1", "rep")).status, "upload_pending");
    assert.equal(store.representativeAsset("upload-1").spentUsd, 0.1);
    assert.equal((await runOfficialAssetSlot(world.deps(store, "restarted"), "upload-1", "rep")).status, "generated");
    assert.equal(world.calls.length, 1);
    assert.equal(store.representativeAsset("upload-1").spentUsd, 0.1);
    assert.equal(world.spool.size, 0);
  });

  it("budget hard-stop pauses the batch before the call that would exceed a cap", async () => {
    const world = new FakeWorld();
    const batch = await freshBatch(store, { budgetUsd: { batch: 10, perCharacter: 0.4 }, reservePerImageUsd: 0.25 });
    lockThroughPlan(store, batch, uniqueDraft("budget-1", HWANG_VOCAB, "레온하르트"));
    const deps = world.deps(store);
    await runOfficialAssetSlot(deps, "budget-1", "rep");
    store.reviewAnchor("budget-1", anchorQa(), "owner");
    await runOfficialAssetSlot(deps, "budget-1", "sig1");
    await assert.rejects(runOfficialAssetSlot(deps, "budget-1", "sig2"), (e: unknown) => e instanceof OfficialSupplyBudgetError);
    assert.equal(store.getBatch(batch.batchKey).status, "paused");
    await assert.rejects(runOfficialAssetSlot(deps, "budget-1", "sig3"), (e: OfficialSupplyGateError) => e.code === "budget_exceeded" || e.code === "batch_paused");
    assert.equal(world.calls.length, 2);
  });

  it("text edits after lock make every asset stale; stale images can never be staged", async () => {
    const world = new FakeWorld();
    const batch = await freshBatch(store);
    const draft = uniqueDraft("stale-1", HWANG_VOCAB, "레온하르트");
    lockThroughPlan(store, batch, draft);
    await runOfficialAssetSlot(world.deps(store), "stale-1", "rep");
    const edited = { ...store.getCharacter("stale-1").draft, name: "레온하르트 2세" };
    store.updateDraft("stale-1", edited);
    assert.equal(store.getCharacter("stale-1").stage, "draft");
    assert.ok(store.listAssets("stale-1").every((a) => a.status === "stale"));
    await assert.rejects(runOfficialAssetSlot(world.deps(store), "stale-1", "rep"), (e: OfficialSupplyGateError) => e.code === "character_stage");
    await assert.rejects(stageOfficialCharacterPrivately({ store, draftKey: "stale-1", stagingUser: STAGING_USER }), (e: OfficialSupplyGateError) => e.code === "character_stage");
  });

  it("portfolio QA uses the batch policy across SFW and 19+ drafts", async () => {
    const batch = await freshBatch(store, { portfolio: { adultShareMin: 0.3, adultShareMax: 0.7, maxGenreShare: 1, minDistinctGenres: 1 } }, "candidate");
    const add = (d: OfficialCharacterDraft) => store.addCharacterDraft(batch.batchKey, { ...d, styleKey: batch.styleKey, worldKey: batch.worldKey });
    add(uniqueDraft("pf-a", HWANG_VOCAB, "레온"));
    add(uniqueDraft("pf-b", KNIGHT_VOCAB, "세라핀"));
    assert.ok(store.evaluateBatchPortfolio(batch.batchKey).errors.some((e) => e.code === "portfolio_adult_share"));
    add(uniqueDraft("pf-c", MAGE_VOCAB, "이안", { nsfw: true }));
    assert.equal(store.evaluateBatchPortfolio(batch.batchKey).ok, true);
  });

  it("rollout caps are configuration-driven", async () => {
    const batch = await freshBatch(store, { rollout: { maxWorlds: 1, maxCharacters: 1 } }, "candidate");
    store.addCharacterDraft(batch.batchKey, { ...uniqueDraft("cap-a", HWANG_VOCAB, "레온"), styleKey: batch.styleKey, worldKey: batch.worldKey });
    assert.throws(
      () => store.addCharacterDraft(batch.batchKey, { ...uniqueDraft("cap-b", KNIGHT_VOCAB, "세라핀"), styleKey: batch.styleKey, worldKey: batch.worldKey }),
      (e: OfficialSupplyGateError) => e.code === "rollout_character_cap"
    );
  });
});

describe("private staging through the canonical character save owner", () => {
  const sharedLorebook: OfficialWorldLorebookEntry[] = [
    { entryKey: "leon", name: "레온하르트", keywords: ["레온하르트", "황태자"], content: "제국의 황태자. 흑발 금안, 냉정한 인상. 기사단과 원로원을 총괄한다." },
    { entryKey: "serafin", name: "세라핀", keywords: ["세라핀", "기사단장"], content: "제국 기사단장. 은갑옷과 붉은 깃발로 알려져 있다." },
  ];

  it("SFW: staged private, official=0, 2:3 representative first, 3:2 RP inline, shared lorebook attached, no points moved", async () => {
    const world = new FakeWorld();
    const batch = await freshBatch(store);
    const db = getDb();
    const pointsBefore = (db.prepare("SELECT points FROM users WHERE id=?").get(STAGING_USER.id) as { points: number }).points;
    const pointLogsBefore = (db.prepare("SELECT COUNT(*) AS n FROM point_logs").get() as { n: number }).n;

    lockThroughPlan(store, batch, uniqueDraft("stage-leon", HWANG_VOCAB, "레온하르트"));
    lockThroughPlan(store, batch, uniqueDraft("stage-sera", KNIGHT_VOCAB, "세라핀", { gender: "female", hook: { archetype: "강철 기사", occupation: "기사단장", relationshipTrope: "호위" } }));
    await generateAndApproveAll(store, world, "stage-leon");
    await generateAndApproveAll(store, world, "stage-sera");
    assert.equal(world.calls.length, 28);

    const staged = await stageOfficialCharacterPrivately({ store, draftKey: "stage-leon", stagingUser: STAGING_USER, sharedLorebook });
    assert.equal(staged.status, "staged");
    const again = await stageOfficialCharacterPrivately({ store, draftKey: "stage-leon", stagingUser: STAGING_USER, sharedLorebook });
    assert.deepEqual(again, { status: "already_staged", characterId: staged.characterId });
    const sera = await stageOfficialCharacterPrivately({ store, draftKey: "stage-sera", stagingUser: STAGING_USER, sharedLorebook });

    const row = db.prepare("SELECT * FROM characters WHERE id=?").get(staged.characterId) as Record<string, unknown>;
    assert.equal(row.official, 0);
    assert.equal(row.visibility, "private");
    assert.equal(row.creator_id, STAGING_USER.id);
    assert.equal(row.nsfw, 0);
    assert.match(String(row.appearance_raw), /흑발/);
    const assets = parseAssets(String(row.assets));
    assert.equal(assets.length, 14);
    assert.equal(assets[0]!.width, 1024);
    assert.equal(assets[0]!.height, 1536);
    assert.equal(isWideInlineAsset(assets[0]!), false);
    assert.ok(assets.slice(1).every((a) => isWideInlineAsset(a) && a.width === 1536 && a.height === 1024));
    assert.ok(assets.every((a) => a.viewerBlur === false));
    assert.equal(getCharacterRepresentativeImageUrl(String(row.assets), String(row.images)), assets[0]!.url);
    assert.equal(assets.filter((a) => a.tag === "부끄러움").length, 2);
    assert.deepEqual(assets.filter((a) => ["무도회장", "침실", "정원회랑"].includes(a.tag)).length, 3);

    const listed = db.prepare(`SELECT id FROM characters WHERE ${listableWhere("id=?")}`).all(staged.characterId);
    assert.equal(listed.length, 0);
    assert.equal(canAccessCharacter(row as unknown as CharacterAccessRow, OTHER_VIEWER).ok, false);
    assert.equal(canAccessCharacter(row as unknown as CharacterAccessRow, STAGING_USER.id).ok, true);

    const attachments = (id: number) =>
      (db.prepare("SELECT lorebook_id FROM character_lorebook_attachments WHERE character_id=? ORDER BY position").all(id) as Array<{ lorebook_id: number }>).map((r) => r.lorebook_id);
    assert.equal(attachments(staged.characterId).length, 2);
    assert.deepEqual(attachments(staged.characterId), attachments(sera.characterId));

    assert.equal((db.prepare("SELECT points FROM users WHERE id=?").get(STAGING_USER.id) as { points: number }).points, pointsBefore);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM point_logs").get() as { n: number }).n, pointLogsBefore);
    const imageGenTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chat_image_generations'").get();
    if (imageGenTable) assert.equal((db.prepare("SELECT COUNT(*) AS n FROM chat_image_generations").get() as { n: number }).n, 0);
  });

  it("19+: adult metadata stored through canonical owners, adult scene asset blurred, still private", async () => {
    const world = new FakeWorld();
    const batch = await freshBatch(store);
    const draft = uniqueDraft("stage-adult", MAGE_VOCAB, "이안", { nsfw: true, npcs: [testNpc("서도윤", 31, true)], hook: { archetype: "괴짜 천재", occupation: "궁정 마법사", relationshipTrope: "사제" } });
    lockThroughPlan(store, batch, draft, { adultScene: true });
    await generateAndApproveAll(store, world, "stage-adult");
    const adultScenePrompt = world.calls.find((c) => c.primaryPrompt.includes("황궁 침실"))!.primaryPrompt;
    assert.match(adultScenePrompt, /non-explicit adult intimacy is allowed/);
    assert.match(adultScenePrompt, /no explicit sexual acts/);

    const staged = await stageOfficialCharacterPrivately({ store, draftKey: "stage-adult", stagingUser: STAGING_USER });
    const row = getDb().prepare("SELECT * FROM characters WHERE id=?").get(staged.characterId) as Record<string, unknown>;
    assert.equal(row.nsfw, 1);
    assert.equal(row.participant_min_age, 27);
    assert.equal(row.adult_status, "confirmed");
    assert.equal(row.adult_dialogue_profile, "explicit_rare");
    assert.deepEqual(JSON.parse(String(row.adult_consent_modes_json)), ["standard", "power_play"]);
    assert.equal(row.visibility, "private");
    assert.equal(row.official, 0);
    const assets = parseAssets(String(row.assets));
    assert.equal(assets.find((a) => a.tag === "침실")!.viewerBlur, true);
    assert.equal(assets[0]!.viewerBlur, false);
  });

  it("a shared lorebook that leaks a secret blocks staging", async () => {
    const world = new FakeWorld();
    const batch = await freshBatch(store);
    lockThroughPlan(store, batch, uniqueDraft("stage-leak", HWANG_VOCAB, "레온하르트"));
    await generateAndApproveAll(store, world, "stage-leak");
    await assert.rejects(
      stageOfficialCharacterPrivately({
        store,
        draftKey: "stage-leak",
        stagingUser: STAGING_USER,
        sharedLorebook: [{ entryKey: "x", name: "레온", keywords: ["레온"], content: "레온하르트는 선황의 사생아다." }],
      }),
      (e: OfficialSupplyGateError) => e.code === "lorebook_knowledge_boundary"
    );
    assert.equal(store.getCharacter("stage-leak").stage, "qa_passed");
  });

  it("moderation hard-reject blocks the variation; it is regenerated alone", async () => {
    const world = new FakeWorld();
    const batch = await freshBatch(store);
    lockThroughPlan(store, batch, uniqueDraft("mod-1", HWANG_VOCAB, "레온하르트"));
    const deps = world.deps(store);
    await runOfficialAssetSlot(deps, "mod-1", "rep");
    store.reviewAnchor("mod-1", anchorQa(), "owner");
    await runOfficialAssetSlot(deps, "mod-1", "scene2");
    const qa = variationQa({ moderation: { adultFlagged: true, moderationReject: true, reason: "노출" } });
    assert.equal(store.reviewVariation("mod-1", "scene2", qa).approved, false);
    assert.equal(store.getAsset("mod-1", "scene2").status, "rejected");
    assert.equal((await runOfficialAssetSlot(deps, "mod-1", "scene2")).status, "generated");
    assert.equal(store.reviewVariation("mod-1", "scene2", variationQa()).approved, true);
    assert.equal(world.calls.length, 3);
    assert.equal(store.getAsset("mod-1", "sig1").status, "planned");
  });
});

describe("adult validation stays canonical (no official bypass)", () => {
  const adultBody = (patch: (d: OfficialCharacterDraft) => void) => {
    const draft = uniqueDraft("adult-body", MAGE_VOCAB, "이안", { nsfw: true });
    patch(draft);
    return buildOfficialCharacterFormBody({
      draft,
      appearanceBlock: "흑발",
      assets: [{ url: "/uploads/a.webp", tag: "대표", width: 1024, height: 1536, viewerBlur: false }],
    });
  };

  it("general character (nsfw=false) saves exactly as before", async () => {
    const body = buildOfficialCharacterFormBody({
      draft: uniqueDraft("sfw-body", HWANG_VOCAB, "레온하르트"),
      appearanceBlock: "흑발",
      assets: [{ url: "/uploads/s.webp", tag: "대표", width: 1024, height: 1536, viewerBlur: false }],
    });
    const saved = await createCharacterFromForm(STAGING_USER, body);
    assert.equal(saved.ok, true);
  });

  it("valid 19+ saves; missing age and under-19 are rejected by the canonical owner", async () => {
    assert.equal((await createCharacterFromForm(STAGING_USER, adultBody(() => {}))).ok, true);
    const missing = await createCharacterFromForm(STAGING_USER, { ...adultBody(() => {}), participant_min_age: null });
    assert.equal(missing.ok, false);
    const minor = await createCharacterFromForm(STAGING_USER, { ...adultBody(() => {}), participant_min_age: 18 });
    assert.equal(minor.ok, false);
    if (!minor.ok) assert.match(minor.error, /만 19세 이상/);
  });

  it("official flag is not an input of the canonical adult contract, and site account must be adult-verified", () => {
    const body = adultBody(() => {});
    const asOfficial = parseCharacterFormBody({ ...body, official: 1, participant_min_age: 18 }, STAGING_USER);
    assert.equal(asOfficial.ok, false);
    const unverified = parseCharacterFormBody(body, { ...STAGING_USER, is_adult: 0 });
    assert.equal(unverified.ok, false);
  });

  it("viewer adult verification gates do not consult official/site-managed state", () => {
    const page = fs.readFileSync(path.join(process.cwd(), "src/app/character/[id]/page.tsx"), "utf8");
    const route = fs.readFileSync(path.join(process.cwd(), "src/app/api/chat/route.ts"), "utf8");
    assert.match(page, /if \(c\.nsfw === 1 && !user\.is_adult\) \{/);
    assert.match(route, /if \(ch\.nsfw && !user\.is_adult\) \{/);
  });

  it("official supply never imports user-paid billing, point or creator-reward owners", () => {
    const dir = path.join(process.cwd(), "src/lib/officialSupply");
    for (const file of fs.readdirSync(dir)) {
      if (file.endsWith(".test.ts")) continue;
      const source = fs.readFileSync(path.join(dir, file), "utf8");
      assert.doesNotMatch(
        source,
        /chatImageGenerationPersistence|chatImageGenerationJobs|chatImagePricing|imageGenerationEconomics|@\/lib\/points"|creatorPoints|deductPoints/,
        file
      );
    }
  });
});
