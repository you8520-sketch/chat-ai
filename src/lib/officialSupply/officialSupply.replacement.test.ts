import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { parseAssets } from "@/lib/characterAssets";
import { getDb } from "@/lib/db";
import {
  applyApprovedOfficialAssetReplacements,
  registerExternalOfficialAssetReplacement,
} from "@/lib/officialSupply/replacement";
import { resolveOfficialGenerationReferencePlan } from "@/lib/officialSupply/generationReferences";
import { officialImageProfileForSlot, resolveOfficialAssetImageModel } from "@/lib/officialSupply/imageProfile";
import { stagedAssetTag } from "@/lib/officialSupply/moderation";
import {
  HWANG_VOCAB,
  testAppearance,
  testAssetPlan,
  testBatchConfig,
  testDraft,
  testStyleCandidate,
} from "@/lib/officialSupply/officialSupply.fixtures";
import { mapOfficialPublicAssetSlots, officialStagedAssetOrder } from "@/lib/officialSupply/publicAssetMap";
import {
  moderateOfficialAssetReplacement,
  OfficialImageTransportError,
  composeOfficialSlotGeneration,
  runOfficialAssetReplacement,
  runOfficialAssetSlot,
  type OfficialAssetModerator,
  type OfficialAssetRunnerDeps,
  type OfficialImageTransport,
} from "@/lib/officialSupply/runner";
import { stageOfficialCharacterPrivately } from "@/lib/officialSupply/staging";
import { OfficialSupplyGateError, OfficialSupplyStore } from "@/lib/officialSupply/store";
import type { SessionUser } from "@/lib/characterFormSave";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { buildClusterBRofanStyleSeed } from "@/lib/officialSupply/userOwnedRofanStyleRefs";
import type {
  OfficialAnchorQaReport,
  OfficialAssetModeration,
  OfficialCharacterDraft,
  OfficialVariationQaReport,
} from "@/lib/officialSupply/types";
import type { OfficialSupplyBatchConfig } from "@/lib/officialSupply/store";

const STAGING_USER: SessionUser = { id: 8101, nickname: "official-replacement-staging", is_adult: 1 };
const ADMIN = { id: 8103, email: "official-admin@test.local", is_admin: 1 as const };
const STRANGER = { id: 8104, email: "stranger@test.local", is_admin: 0 as const };
const FOLLOWER_ID = 8102;
const SEED = { url: "/uploads/official-style-seed.webp", provenance: "platform_owned" as const, note: "owned seed" };
const IMAGE_ENV = { OPENAI_IMAGE_MODEL: "gpt-image-2.5-flare" } as NodeJS.ProcessEnv;
const TARGETS = ["sig4", "scene1", "scene2", "scene3"] as const;

type FakeCall = {
  model: string;
  size: string;
  references: string[];
  primaryPrompt: string;
  strictFallbackPrompt: string;
  idempotencyKey: string;
};

function encodeImage(width: number, height: number, mark = ""): Buffer {
  return Buffer.from(`${width}x${height}${mark}`);
}

const inspectMarkedImage: OfficialAssetRunnerDeps["imageOps"] = {
  inspect: async (buffer) => {
    const match = /^(\d+)x(\d+)/.exec(buffer.toString());
    return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
  },
};

class FakeWorld {
  calls: FakeCall[] = [];
  stored = new Map<string, Buffer>();
  spool = new Map<string, Buffer>();
  deleted = new Set<string>();
  nextDims: Array<[number, number]> = [];
  failNextProvider: Array<{ message: string; costUsd: number | null }> = [];
  failNextUploads = 0;
  nextModeration: OfficialAssetModeration[] = [];
  moderatedUrls: string[] = [];
  costPerImage = 0.1;
  now = 1_000_000;

  moderator: OfficialAssetModerator = {
    moderate: async (url) => {
      this.moderatedUrls.push(url);
      return this.nextModeration.shift() ?? { status: "checked", adultFlagged: false, moderationReject: false, reason: "" };
    },
  };

  transport: OfficialImageTransport = {
    generate: async (input) => {
      this.calls.push({
        model: input.model,
        size: input.size,
        references: input.references,
        primaryPrompt: input.primaryPrompt,
        strictFallbackPrompt: input.strictFallbackPrompt,
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
        remove: async (key) => {
          this.deleted.add(key);
          this.spool.delete(key);
        },
      },
      workerId,
      now: () => this.now,
      env: IMAGE_ENV,
    };
  }
}

const PASS = { ok: true };
const NOTED_PASS = { ok: true, note: "checked against the candidate image" };
const anchorQa = (overrides: Partial<OfficialAnchorQaReport> = {}): OfficialAnchorQaReport => ({
  gender: NOTED_PASS, ageAppearance: NOTED_PASS, face: NOTED_PASS, hair: NOTED_PASS, eyes: NOTED_PASS, body: NOTED_PASS,
  identifyingFeatures: NOTED_PASS, artStyle: NOTED_PASS, outfit: NOTED_PASS, cardCrop: NOTED_PASS, compositionIndependence: PASS, ...overrides,
});
const variationQa = (overrides: Partial<OfficialVariationQaReport> = {}): OfficialVariationQaReport => ({
  identityMatchesAnchor: PASS, expressionMatchesPlan: PASS, characterPresent: PASS, artStyle: PASS, compositionIndependence: PASS, ...overrides,
});

let batchSeq = 0;
let store: OfficialSupplyStore;
const originalFetch = globalThis.fetch;
const egressAttempts: string[] = [];

function uniqueDraft(key: string): OfficialCharacterDraft {
  return testDraft({ draftKey: key, name: "레온하르트", vocabulary: HWANG_VOCAB });
}

async function freshBatch(
  config: Partial<OfficialSupplyBatchConfig> = {},
  styleSeed: typeof SEED = SEED
) {
  batchSeq += 1;
  const batchKey = `rep-batch-${batchSeq}`;
  const styleKey = `romance_fantasy_v${20000 + batchSeq}`;
  store.createBatch(batchKey, testBatchConfig({ ...config, budgetUsd: { batch: 100 } }));
  store.proposeStyle({ styleKey, genre: "로맨스 판타지", candidates: ["c1", "c2", "c3"].map(testStyleCandidate) });
  store.approveStyleCandidate(styleKey, "c2", styleSeed, "owner");
  const proofKey = `rep-proof-${batchSeq}`;
  lockThroughPlan({ batchKey, styleKey, worldKey: `rep-proof-world-${batchSeq}` }, uniqueDraft(proofKey), true);
  await runOfficialAssetSlot(new FakeWorld().deps(store), proofKey, "rep");
  store.decideStyleProof(styleKey, "approve", "owner");
  const full = testBatchConfig(config);
  store.database.prepare("UPDATE official_supply_batches SET config_json=? WHERE batch_key=?").run(JSON.stringify(full), batchKey);
  return { batchKey, styleKey, worldKey: `rep-world-${batchSeq}` };
}

function lockThroughPlan(
  batch: { batchKey: string; styleKey: string; worldKey: string },
  draft: OfficialCharacterDraft,
  isStyleProof = false
) {
  store.addCharacterDraft(batch.batchKey, { ...draft, styleKey: batch.styleKey, worldKey: batch.worldKey }, { isStyleProof });
  assert.equal(store.lockText(draft.draftKey, { stagingUser: STAGING_USER }).ok, true);
  assert.equal(store.lockAppearance(draft.draftKey, testAppearance()).ok, true);
  assert.equal(store.lockAssetPlan(draft.draftKey, testAssetPlan()).ok, true);
}

function seedApprovedAssets(draftKey: string): void {
  const character = store.getCharacter(draftKey);
  assert.ok(character.assetPlan && character.appearanceLockHash);
  const clean: OfficialAssetModeration = { status: "checked", adultFlagged: false, moderationReject: false, reason: "" };
  for (const slot of character.assetPlan.slots) {
    const profile = officialImageProfileForSlot(slot.kind);
    const url = `/uploads/official-${draftKey}__${slot.slotKey}-a1.webp`;
    store.database
      .prepare(
        `UPDATE official_supply_assets
         SET status='approved', result_url=?, width=?, height=?, attempts=1,
             appearance_lock_hash=?, moderation_json=?, qa_json=?
         WHERE draft_key=? AND slot_key=?`
      )
      .run(
        url,
        profile.width,
        profile.height,
        character.appearanceLockHash,
        JSON.stringify(clean),
        JSON.stringify(slot.kind === "representative" ? anchorQa() : variationQa()),
        draftKey,
        slot.slotKey
      );
  }
  store.database
    .prepare("UPDATE official_supply_characters SET stage='qa_passed', updated_at=datetime('now') WHERE draft_key=?")
    .run(draftKey);
}

async function publishFixture(draftKey: string): Promise<{ characterId: number; images: string; assets: string }> {
  const staged = await stageOfficialCharacterPrivately({ store, draftKey, stagingUser: STAGING_USER });
  store.database
    .prepare("UPDATE characters SET official=1, visibility='public', moderation_status='approved' WHERE id=?")
    .run(staged.characterId);
  store.markPublished(draftKey, staged.characterId);
  const row = store.database
    .prepare("SELECT assets, images FROM characters WHERE id=?")
    .get(staged.characterId) as { assets: string; images: string };
  return { characterId: staged.characterId, images: row.images, assets: row.assets };
}

async function publishedOfficial(draftKey: string, config: Partial<OfficialSupplyBatchConfig> = {}, styleSeed: typeof SEED = SEED) {
  const batch = await freshBatch(config, styleSeed);
  lockThroughPlan(batch, uniqueDraft(draftKey));
  seedApprovedAssets(draftKey);
  const published = await publishFixture(draftKey);
  return { batch, ...published };
}

function snapshotCharacter(characterId: number) {
  return store.database
    .prepare(
      `SELECT id, official, visibility, moderation_status, nsfw, name, tagline, description, greeting, images, assets
       FROM characters WHERE id=?`
    )
    .get(characterId) as Record<string, unknown>;
}

function notificationCount(characterId: number): number {
  return (
    store.database
      .prepare("SELECT COUNT(*) AS n FROM user_notifications WHERE type='creator_character' AND ref_id=?")
      .get(characterId) as { n: number }
  ).n;
}

function characterCount(): number {
  return (store.database.prepare("SELECT COUNT(*) AS n FROM characters").get() as { n: number }).n;
}

function currentCandidateUrl(draftKey: string, slotKey: string): string {
  const url = store.getReplacement(draftKey, slotKey).candidateResultUrl;
  assert.ok(url);
  return url;
}

function reviewCurrent(draftKey: string, slotKey: string, qa: OfficialVariationQaReport = variationQa()) {
  return store.reviewReplacement(ADMIN, draftKey, slotKey, qa, currentCandidateUrl(draftKey, slotKey));
}

async function generateApproveReplacement(world: FakeWorld, draftKey: string, slotKey: string) {
  store.createReplacementCandidate(ADMIN, draftKey, slotKey);
  const generated = await runOfficialAssetReplacement(world.deps(store), draftKey, slotKey);
  assert.equal(generated.status, "generated");
  await moderateOfficialAssetReplacement({ store, moderator: world.moderator }, draftKey, slotKey);
  assert.equal(reviewCurrent(draftKey, slotKey).approved, true);
}

before(() => {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    egressAttempts.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    throw new Error("network egress is not allowed in official supply replacement tests");
  }) as typeof fetch;
  installIsolatedTestDatabase();
  const db = getDb();
  for (const user of [STAGING_USER, { id: FOLLOWER_ID, nickname: "follower", is_adult: 1 }]) {
    db.prepare("INSERT OR IGNORE INTO users (id, email, nickname, pw_hash, points, is_adult) VALUES (?,?,?,?,1000,1)")
      .run(user.id, `u${user.id}@test.local`, user.nickname, "hash");
  }
  db.prepare(
    "INSERT OR IGNORE INTO users (id, email, nickname, pw_hash, points, is_adult, is_admin) VALUES (?,?,?,?,1000,1,?)"
  ).run(ADMIN.id, ADMIN.email, "official-admin", "hash", 1);
  db.prepare(
    "INSERT OR IGNORE INTO users (id, email, nickname, pw_hash, points, is_adult, is_admin) VALUES (?,?,?,?,1000,1,?)"
  ).run(STRANGER.id, STRANGER.email, "stranger", "hash", 0);
  db.prepare("UPDATE users SET site_managed=1, is_admin=0 WHERE id=?").run(STAGING_USER.id);
  store = new OfficialSupplyStore(db);
});

after(() => {
  globalThis.fetch = originalFetch;
  uninstallIsolatedTestDatabase();
  assert.deepEqual(egressAttempts, [], "official supply replacement tests made network calls");
});

describe("public slot mapping owner", () => {
  it("maps draftKey+slotKey by assetPlan order and exact active URLs", async () => {
    const draftKey = "map-1";
    await publishedOfficial(draftKey);
    const record = store.getCharacter(draftKey);
    const publicAssets = parseAssets(
      (store.database.prepare("SELECT assets FROM characters WHERE id=?").get(record.stagedCharacterId) as { assets: string }).assets
    );
    const activeUrlBySlot = new Map(store.listAssets(draftKey).map((asset) => [asset.slotKey, asset.resultUrl ?? ""]));
    const mapped = mapOfficialPublicAssetSlots({
      plan: record.assetPlan!,
      publicAssets,
      activeUrlBySlot,
    });
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    const ordered = officialStagedAssetOrder(record.assetPlan!);
    assert.equal(ordered[0]?.kind, "representative");
    assert.equal(publicAssets.length, 14);
    for (const [index, slot] of ordered.entries()) {
      assert.equal(mapped.indexes.get(slot.slotKey), index);
      assert.equal(publicAssets[index]?.url, activeUrlBySlot.get(slot.slotKey));
    }
    const mismatch = mapOfficialPublicAssetSlots({
      plan: record.assetPlan!,
      publicAssets: publicAssets.map((asset, index) =>
        index === 1 ? { ...asset, url: "/uploads/wrong.webp" } : asset
      ),
      activeUrlBySlot,
    });
    assert.equal(mismatch.ok, false);
  });
});

describe("A. candidate isolation", () => {
  it("create/generate/moderate/approve/reject never mutate the live approved URL", async () => {
    const draftKey = "iso-1";
    await publishedOfficial(draftKey);
    const before = store.getAsset(draftKey, "sig4");
    assert.equal(before.status, "approved");
    const oldUrl = before.resultUrl;
    assert.ok(oldUrl);

    const created = store.createReplacementCandidate(ADMIN, draftKey, "sig4");
    assert.equal(created.status, "planned");
    assert.equal(created.baseResultUrl, oldUrl);
    assert.equal(store.getAsset(draftKey, "sig4").status, "approved");
    assert.equal(store.getAsset(draftKey, "sig4").resultUrl, oldUrl);

    const world = new FakeWorld();
    const generated = await runOfficialAssetReplacement(world.deps(store), draftKey, "sig4");
    assert.equal(generated.status, "generated");
    if (generated.status === "generated") assert.notEqual(generated.url, oldUrl);
    assert.equal(store.getAsset(draftKey, "sig4").status, "approved");
    assert.equal(store.getAsset(draftKey, "sig4").resultUrl, oldUrl);
    assert.match(store.getReplacement(draftKey, "sig4").candidateResultUrl ?? "", /-r1\.webp$/);

    await moderateOfficialAssetReplacement({ store, moderator: world.moderator }, draftKey, "sig4");
    assert.equal(store.getAsset(draftKey, "sig4").moderation?.status, "checked");
    assert.equal(store.getReplacement(draftKey, "sig4").moderation?.status, "checked");
    assert.equal(store.getAsset(draftKey, "sig4").resultUrl, oldUrl);

    assert.equal(reviewCurrent(draftKey, "sig4").approved, true);
    assert.equal(store.getReplacement(draftKey, "sig4").status, "approved");
    assert.equal(store.getAsset(draftKey, "sig4").status, "approved");
    assert.equal(store.getAsset(draftKey, "sig4").resultUrl, oldUrl);

    store.createReplacementCandidate(ADMIN, draftKey, "scene1");
    const rejectWorld = new FakeWorld();
    assert.equal((await runOfficialAssetReplacement(rejectWorld.deps(store), draftKey, "scene1")).status, "generated");
    await moderateOfficialAssetReplacement({ store, moderator: rejectWorld.moderator }, draftKey, "scene1");
    const { compositionIndependence: _omitted, ...withoutComposition } = variationQa();
    assert.throws(
      () => reviewCurrent(draftKey, "scene1", withoutComposition as OfficialVariationQaReport),
      (error: unknown) => error instanceof OfficialSupplyGateError && error.code === "composition_review_required"
    );
    assert.equal(store.getReplacement(draftKey, "scene1").status, "generated");
    assert.equal(
      reviewCurrent(draftKey, "scene1", variationQa({ compositionIndependence: { ok: false, note: "cloned pose" } })).approved,
      false
    );
    assert.equal(store.getReplacement(draftKey, "scene1").status, "rejected");
    assert.equal(store.getAsset(draftKey, "scene1").status, "approved");
    assert.equal(store.getAsset(draftKey, "scene1").resultUrl, `/uploads/official-${draftKey}__scene1-a1.webp`);
  });
});

describe("B. atomic apply", () => {
  it("swaps only the selected four URLs and leaves listing/text/rep/id unchanged", async () => {
    const draftKey = "apply-1";
    const published = await publishedOfficial(draftKey);
    store.database
      .prepare("INSERT OR IGNORE INTO follows (user_id, creator_id) VALUES (?, ?)")
      .run(FOLLOWER_ID, STAGING_USER.id);
    const before = snapshotCharacter(published.characterId);
    const beforeAssets = parseAssets(String(before.assets));
    const beforeNotify = notificationCount(published.characterId);
    const beforeCharacters = characterCount();
    const world = new FakeWorld();
    for (const slotKey of TARGETS) {
      await generateApproveReplacement(world, draftKey, slotKey);
    }

    const applied = applyApprovedOfficialAssetReplacements({ store, draftKey, actor: ADMIN,  slotKeys: [...TARGETS] });
    assert.deepEqual(applied.swapped, [...TARGETS]);
    assert.equal(applied.characterId, published.characterId);

    const after = snapshotCharacter(published.characterId);
    const afterAssets = parseAssets(String(after.assets));
    assert.equal(after.id, before.id);
    assert.equal(after.official, before.official);
    assert.equal(after.visibility, before.visibility);
    assert.equal(after.moderation_status, before.moderation_status);
    assert.equal(after.nsfw, before.nsfw);
    assert.equal(after.name, before.name);
    assert.equal(after.tagline, before.tagline);
    assert.equal(after.description, before.description);
    assert.equal(after.greeting, before.greeting);
    assert.equal(after.images, before.images);
    assert.equal(after.images, published.images);
    assert.equal(afterAssets.length, 14);
    assert.equal(afterAssets[0]!.url, beforeAssets[0]!.url);

    const record = store.getCharacter(draftKey);
    const mapped = mapOfficialPublicAssetSlots({
      plan: record.assetPlan!,
      publicAssets: afterAssets,
      activeUrlBySlot: new Map(store.listAssets(draftKey).map((asset) => [asset.slotKey, asset.resultUrl ?? ""])),
    });
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    for (const slotKey of TARGETS) {
      const index = mapped.indexes.get(slotKey)!;
      const candidate = store.getReplacement(draftKey, slotKey);
      assert.equal(candidate.status, "applied");
      assert.ok(candidate.appliedAt);
      assert.equal(candidate.baseResultUrl, beforeAssets[index]!.url);
      assert.equal(afterAssets[index]!.url, candidate.candidateResultUrl);
      assert.notEqual(afterAssets[index]!.url, beforeAssets[index]!.url);
      assert.equal(store.getAsset(draftKey, slotKey).resultUrl, candidate.candidateResultUrl);
      assert.equal(store.getAsset(draftKey, slotKey).status, "approved");
      assert.equal(afterAssets[index]!.tag, beforeAssets[index]!.tag);
      assert.equal(afterAssets[index]!.representativeRank, beforeAssets[index]!.representativeRank);
    }
    const unchanged = afterAssets.filter((_, index) => {
      const slotKey = [...mapped.indexes.entries()].find((entry) => entry[1] === index)?.[0];
      return slotKey != null && !TARGETS.includes(slotKey as (typeof TARGETS)[number]);
    });
    assert.equal(unchanged.length, 10);
    for (const asset of unchanged) {
      const index = afterAssets.indexOf(asset);
      assert.equal(asset.url, beforeAssets[index]!.url);
    }
    assert.equal(notificationCount(published.characterId), beforeNotify);
    assert.equal(characterCount(), beforeCharacters);
    assert.equal(store.getCharacter(draftKey).stagedCharacterId, published.characterId);
    assert.equal(store.getCharacter(draftKey).stage, "published");
  });
});

describe("C. CAS / stale protection", () => {
  it("fails closed and applies none when any invariant is stale", async () => {
    const draftKey = "cas-1";
    const published = await publishedOfficial(draftKey);
    const world = new FakeWorld();
    for (const slotKey of TARGETS) {
      await generateApproveReplacement(world, draftKey, slotKey);
    }
    const beforeAssets = (
      store.database.prepare("SELECT assets FROM characters WHERE id=?").get(published.characterId) as { assets: string }
    ).assets;

    const staleBase = store.getReplacement(draftKey, "sig4").baseResultUrl;
    store.database
      .prepare("UPDATE official_supply_asset_replacements SET base_result_url=? WHERE draft_key=? AND slot_key=?")
      .run("/uploads/stale-base.webp", draftKey, "sig4");
    assert.throws(
      () => applyApprovedOfficialAssetReplacements({ store, draftKey, actor: ADMIN,  slotKeys: [...TARGETS] }),
      (error: OfficialSupplyGateError) => error.code === "replacement_base_stale"
    );
    store.database
      .prepare("UPDATE official_supply_asset_replacements SET base_result_url=? WHERE draft_key=? AND slot_key=?")
      .run(staleBase, draftKey, "sig4");

    const live = parseAssets(beforeAssets);
    const scene1Index = officialStagedAssetOrder(store.getCharacter(draftKey).assetPlan!).findIndex(
      (slot) => slot.slotKey === "scene1"
    );
    live[scene1Index] = { ...live[scene1Index]!, url: "/uploads/concurrent.webp" };
    store.database.prepare("UPDATE characters SET assets=? WHERE id=?").run(JSON.stringify(live), published.characterId);
    assert.throws(
      () => applyApprovedOfficialAssetReplacements({ store, draftKey, actor: ADMIN,  slotKeys: [...TARGETS] }),
      (error: OfficialSupplyGateError) =>
        error.code === "public_asset_map_mismatch" || error.code === "replacement_public_stale"
    );
    store.database.prepare("UPDATE characters SET assets=? WHERE id=?").run(beforeAssets, published.characterId);

    store.database
      .prepare("UPDATE official_supply_asset_replacements SET status='generated' WHERE draft_key=? AND slot_key=?")
      .run(draftKey, "scene2");
    assert.throws(
      () => applyApprovedOfficialAssetReplacements({ store, draftKey, actor: ADMIN,  slotKeys: [...TARGETS] }),
      (error: OfficialSupplyGateError) => error.code === "replacement_not_approved"
    );
    store.database
      .prepare("UPDATE official_supply_asset_replacements SET status='approved' WHERE draft_key=? AND slot_key=?")
      .run(draftKey, "scene2");

    store.database
      .prepare("UPDATE official_supply_asset_replacements SET moderation_json=? WHERE draft_key=? AND slot_key=?")
      .run(
        JSON.stringify({ status: "checked", adultFlagged: true, moderationReject: true, reason: "노출" }),
        draftKey,
        "scene3"
      );
    assert.throws(
      () => applyApprovedOfficialAssetReplacements({ store, draftKey, actor: ADMIN,  slotKeys: [...TARGETS] }),
      (error: OfficialSupplyGateError) => error.code === "replacement_moderation_rejected"
    );

    const after = store.database
      .prepare("SELECT assets FROM characters WHERE id=?")
      .get(published.characterId) as { assets: string };
    assert.equal(after.assets, beforeAssets);
    for (const slotKey of TARGETS) {
      assert.equal(store.getAsset(draftKey, slotKey).resultUrl, `/uploads/official-${draftKey}__${slotKey}-a1.webp`);
      assert.notEqual(store.getReplacement(draftKey, slotKey).status, "applied");
    }
  });
});

describe("D. lifecycle isolation", () => {
  it("apply source does not publish, form-save, notify, or recreate the public row", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/replacement.ts"), "utf8");
    assert.doesNotMatch(source, /publishOfficialSupplyCharacter/);
    assert.doesNotMatch(source, /updateCharacterFromForm/);
    assert.doesNotMatch(source, /createCharacterFromForm/);
    assert.doesNotMatch(source, /notifyFollowersOfNewCharacter/);
    assert.doesNotMatch(source, /stageOfficialCharacterPrivately/);
    assert.doesNotMatch(source, /unlink|rmSync|mediaStorage/);
  });
});

describe("E. generation parity", () => {
  it("replacement generation reuses the #1410 Cluster B identity-then-style owner", async () => {
    const draftKey = "parity-1";
    const clusterSeed = buildClusterBRofanStyleSeed({ NEXTAUTH_URL: "https://example.test" });
    await publishedOfficial(draftKey, {}, clusterSeed);
    const world = new FakeWorld();
    store.createReplacementCandidate(ADMIN, draftKey, "sig4");
    const generated = await runOfficialAssetReplacement(world.deps(store), draftKey, "sig4");
    assert.equal(generated.status, "generated");
    assert.equal(world.calls.length, 1);
    const expected = resolveOfficialGenerationReferencePlan({
      kind: "signature",
      styleSeed: clusterSeed,
      representativeUrl: store.representativeAsset(draftKey).resultUrl,
    });
    assert.equal(expected.ok, true);
    if (!expected.ok) return;
    assert.equal(expected.plan.mode, "variation_identity_then_style");
    assert.deepEqual(world.calls[0]!.references, [...expected.plan.references]);
    assert.equal(world.calls[0]!.model, resolveOfficialAssetImageModel(IMAGE_ENV));
    assert.equal(world.calls[0]!.size, officialImageProfileForSlot("signature").size);
    assert.match(world.calls[0]!.primaryPrompt, /Image 1 IDENTITY ONLY/);
    assert.match(world.calls[0]!.primaryPrompt, /Image 2 STYLE ONLY/);
    assert.match(world.calls[0]!.idempotencyKey, /:r1$/);
    const composed = composeOfficialSlotGeneration({
      character: store.getCharacter(draftKey),
      style: store.getStyle(store.getCharacter(draftKey).styleKey),
      slotKey: "sig4",
      representativeUrl: store.representativeAsset(draftKey).resultUrl,
      env: IMAGE_ENV,
    });
    assert.equal(composed.ok, true);
    if (!composed.ok) return;
    assert.equal(composed.referenceRoleLayout, "identity_then_style");
    assert.equal(world.calls[0]!.primaryPrompt, composed.primaryPrompt);
    assert.equal(store.getAsset(draftKey, "sig4").resultUrl, `/uploads/official-${draftKey}__sig4-a1.webp`);
  });
});

describe("F. failure leaves the live URL untouched", () => {
  it("provider, upload, moderation unavailable, and review reject do not swap the active slot", async () => {
    const draftKey = "fail-1";
    await publishedOfficial(draftKey);
    const oldUrl = store.getAsset(draftKey, "sig4").resultUrl;
    const world = new FakeWorld();
    store.createReplacementCandidate(ADMIN, draftKey, "sig4");

    world.failNextProvider.push({ message: "provider failed", costUsd: 0.01 });
    assert.equal((await runOfficialAssetReplacement(world.deps(store), draftKey, "sig4")).status, "failed");
    assert.equal(store.getAsset(draftKey, "sig4").resultUrl, oldUrl);
    assert.equal(store.getAsset(draftKey, "sig4").status, "approved");

    world.failNextUploads = 1;
    const pending = await runOfficialAssetReplacement(world.deps(store), draftKey, "sig4");
    assert.equal(pending.status, "upload_pending");
    assert.equal(store.getAsset(draftKey, "sig4").resultUrl, oldUrl);
    assert.equal(store.getReplacement(draftKey, "sig4").status, "upload_pending");

    const uploaded = await runOfficialAssetReplacement(world.deps(store), draftKey, "sig4");
    assert.equal(uploaded.status, "generated");
    assert.equal(store.getAsset(draftKey, "sig4").resultUrl, oldUrl);

    world.nextModeration.push({ status: "unavailable", reason: "vision down" });
    await moderateOfficialAssetReplacement({ store, moderator: world.moderator }, draftKey, "sig4");
    await assert.rejects(
      async () => reviewCurrent(draftKey, "sig4"),
      (error: OfficialSupplyGateError) => error.code === "moderation_unavailable"
    );
    assert.equal(store.getReplacement(draftKey, "sig4").status, "generated");
    assert.equal(store.getAsset(draftKey, "sig4").resultUrl, oldUrl);

    world.nextModeration.push({ status: "checked", adultFlagged: false, moderationReject: false, reason: "" });
    await moderateOfficialAssetReplacement({ store, moderator: world.moderator }, draftKey, "sig4");
    assert.equal(reviewCurrent(draftKey, "sig4", variationQa({ identityMatchesAnchor: { ok: false } })).approved, false);
    assert.equal(store.getReplacement(draftKey, "sig4").status, "rejected");
    assert.equal(store.getAsset(draftKey, "sig4").resultUrl, oldUrl);
    assert.equal(store.getAsset(draftKey, "sig4").status, "approved");
  });
});

describe("replacement spend and review gates", () => {
  it("counts replacement spend on the same character budget and refuses unpublished review", async () => {
    const draftKey = "budget-1";
    await publishedOfficial(draftKey, { budgetUsd: { batch: 100, perCharacter: 2.5 }, reservePerImageUsd: 0.25 });
    const before = store.spendSnapshot(draftKey, 0.25);
    const world = new FakeWorld();
    store.createReplacementCandidate(ADMIN, draftKey, "sig4");
    assert.equal((await runOfficialAssetReplacement(world.deps(store), draftKey, "sig4")).status, "generated");
    const after = store.spendSnapshot(draftKey, 0.25);
    assert.equal(Number(after.character.toFixed(4)), Number((before.character + 0.1).toFixed(4)));
    assert.equal(store.getAsset(draftKey, "sig4").spentUsd, 0);

    store.database
      .prepare("UPDATE official_supply_characters SET stage='staged_private' WHERE draft_key=?")
      .run(draftKey);
    await assert.rejects(
      async () => reviewCurrent(draftKey, "sig4"),
      (error: OfficialSupplyGateError) => error.code === "replacement_target_mismatch"
    );
  });
});

function injectApprovedReplacement(draftKey: string, slotKey: string): void {
  const active = store.getAsset(draftKey, slotKey);
  const character = store.getCharacter(draftKey);
  const profile = officialImageProfileForSlot(active.kind);
  const candidateUrl = `/uploads/official-${draftKey}__${slotKey}-injected-r1.webp`;
  store.database
    .prepare(
      `INSERT INTO official_supply_asset_replacements (
         draft_key, slot_key, kind, status, base_result_url, candidate_result_url,
         width, height, appearance_lock_hash, moderation_json, qa_json
       ) VALUES (?, ?, ?, 'approved', ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      draftKey,
      slotKey,
      active.kind,
      active.resultUrl,
      candidateUrl,
      profile.width,
      profile.height,
      character.appearanceLockHash,
      JSON.stringify({ status: "checked", adultFlagged: false, moderationReject: false, reason: "" }),
      JSON.stringify(variationQa())
    );
}

describe("A. representative create/apply fail closed", () => {
  it("refuses representative create and injected representative apply without touching live rows", async () => {
    const draftKey = "rep-block-1";
    const published = await publishedOfficial(draftKey);
    const world = new FakeWorld();
    const before = snapshotCharacter(published.characterId);
    const beforeActive = store.getAsset(draftKey, "rep");

    assert.throws(
      () => store.createReplacementCandidate(ADMIN, draftKey, "rep"),
      (error: OfficialSupplyGateError) => error.code === "replacement_representative_forbidden"
    );
    assert.equal(world.calls.length, 0);
    assert.equal(store.getAsset(draftKey, "rep").resultUrl, beforeActive.resultUrl);
    assert.equal(store.getAsset(draftKey, "rep").status, "approved");
    assert.deepEqual(snapshotCharacter(published.characterId).assets, before.assets);
    assert.deepEqual(snapshotCharacter(published.characterId).images, before.images);

    injectApprovedReplacement(draftKey, "rep");
    assert.throws(
      () => applyApprovedOfficialAssetReplacements({ store, draftKey, actor: ADMIN,  slotKeys: ["rep"] }),
      (error: OfficialSupplyGateError) => error.code === "replacement_representative_forbidden"
    );
    assert.equal(world.calls.length, 0);
    assert.equal(store.getAsset(draftKey, "rep").resultUrl, beforeActive.resultUrl);
    assert.equal(store.getAsset(draftKey, "rep").status, "approved");
    const after = snapshotCharacter(published.characterId);
    assert.equal(after.assets, before.assets);
    assert.equal(after.images, before.images);
    assert.equal(store.getReplacement(draftKey, "rep").status, "approved");
  });
});

describe("B. published official moderation_status must be approved", () => {
  it("fails create/review/apply when public moderation_status is pending or rejected", async () => {
    const draftKey = "mod-gate-1";
    const published = await publishedOfficial(draftKey);
    const world = new FakeWorld();
    await generateApproveReplacement(world, draftKey, "sig4");
    const beforeAssets = (
      store.database.prepare("SELECT assets FROM characters WHERE id=?").get(published.characterId) as { assets: string }
    ).assets;

    for (const status of ["pending", "rejected"] as const) {
      store.database.prepare("UPDATE characters SET moderation_status=? WHERE id=?").run(status, published.characterId);
      assert.throws(
        () => store.createReplacementCandidate(ADMIN, draftKey, "scene1"),
        (error: OfficialSupplyGateError) => error.code === "character_not_published"
      );
      assert.throws(
        () => reviewCurrent(draftKey, "sig4"),
        (error: OfficialSupplyGateError) => error.code === "character_not_published"
      );
      assert.throws(
        () => applyApprovedOfficialAssetReplacements({ store, draftKey, actor: ADMIN,  slotKeys: ["sig4"] }),
        (error: OfficialSupplyGateError) => error.code === "character_not_published"
      );
    }

    store.database
      .prepare("UPDATE characters SET moderation_status='approved' WHERE id=?")
      .run(published.characterId);
    const created = store.createReplacementCandidate(ADMIN, draftKey, "scene1");
    assert.equal(created.status, "planned");
    const applied = applyApprovedOfficialAssetReplacements({ store, draftKey, actor: ADMIN,  slotKeys: ["sig4"] });
    assert.equal(applied.status, "applied");
    const afterAssets = parseAssets(
      (store.database.prepare("SELECT assets FROM characters WHERE id=?").get(published.characterId) as { assets: string }).assets
    );
    assert.notEqual(JSON.stringify(afterAssets), beforeAssets);
    assert.equal(store.getReplacement(draftKey, "sig4").status, "applied");
  });
});

describe("C. applied replacement cannot be reopened", () => {
  it("keeps rollback provenance after a second create attempt", async () => {
    const draftKey = "applied-term-1";
    await publishedOfficial(draftKey);
    const world = new FakeWorld();
    await generateApproveReplacement(world, draftKey, "sig4");
    applyApprovedOfficialAssetReplacements({ store, draftKey, actor: ADMIN,  slotKeys: ["sig4"] });
    const snapshot = store.getReplacement(draftKey, "sig4");
    assert.equal(snapshot.status, "applied");
    assert.ok(snapshot.baseResultUrl);
    assert.ok(snapshot.candidateResultUrl);
    assert.ok(snapshot.appliedAt);

    assert.throws(
      () => store.createReplacementCandidate(ADMIN, draftKey, "sig4"),
      (error: OfficialSupplyGateError) => error.code === "replacement_already_applied"
    );
    const after = store.getReplacement(draftKey, "sig4");
    assert.equal(after.status, "applied");
    assert.equal(after.baseResultUrl, snapshot.baseResultUrl);
    assert.equal(after.candidateResultUrl, snapshot.candidateResultUrl);
    assert.equal(after.appliedAt, snapshot.appliedAt);
  });
});

/**
 * Test moderation and QA below are fixtures for the gate. They are not an
 * image-quality approval of the b7 or b13 candidates, and this file does not
 * read those images.
 */
const TEST_MODERATION: OfficialAssetModeration = {
  status: "checked",
  adultFlagged: false,
  moderationReject: false,
  reason: "test-fixture-not-quality-approval",
  visionTag: "앉음",
};
const MANUAL_TAG = "수프 그릇을 내미는 손";

async function stagePrivateOfficial(draftKey: string): Promise<number> {
  const batch = await freshBatch();
  lockThroughPlan(batch, uniqueDraft(draftKey));
  seedApprovedAssets(draftKey);
  const staged = await stageOfficialCharacterPrivately({ store, draftKey, stagingUser: STAGING_USER });
  const row = store.database
    .prepare("SELECT official, visibility, creator_id FROM characters WHERE id=?")
    .get(staged.characterId) as { official: number; visibility: string; creator_id: number };
  assert.equal(row.official, 0);
  assert.equal(row.visibility, "private");
  assert.equal(row.creator_id, STAGING_USER.id);
  assert.equal(store.getCharacter(draftKey).stage, "staged_private");
  assert.equal(store.getCharacter(draftKey).stagedCharacterId, staged.characterId);
  return staged.characterId;
}

function characterAssets(characterId: number) {
  return parseAssets(
    (store.database.prepare("SELECT assets FROM characters WHERE id=?").get(characterId) as { assets: string }).assets
  );
}

describe("external file replacement", () => {
  it("keeps a manual action tag ahead of vision auto-classification", () => {
    assert.equal(
      stagedAssetTag("절제된 온기", TEST_MODERATION, "signature", MANUAL_TAG),
      MANUAL_TAG
    );
    assert.equal(stagedAssetTag("절제된 온기", TEST_MODERATION, "representative", MANUAL_TAG), "절제된 온기");
    assert.equal(stagedAssetTag("계획 태그", TEST_MODERATION, "signature", null), "앉음");
  });

  it("replaces only the staged_private target slot and the next replacement still maps", async () => {
    const draftKey = "ext-staged";
    const characterId = await stagePrivateOfficial(draftKey);
    const assets = characterAssets(characterId);
    assets[1] = { ...assets[1]!, viewerBlur: true };
    assets[4] = { ...assets[4]!, viewerBlur: true };
    store.database.prepare("UPDATE characters SET assets=? WHERE id=?").run(JSON.stringify(assets), characterId);
    const beforeAssetsJson = (
      store.database.prepare("SELECT assets FROM characters WHERE id=?").get(characterId) as { assets: string }
    ).assets;
    const beforeAssets = parseAssets(beforeAssetsJson);
    const beforeRow = store.database
      .prepare(
        `SELECT creator_id, official, visibility, moderation_status, system_prompt, greeting, world, images
         FROM characters WHERE id=?`
      )
      .get(characterId) as Record<string, unknown>;
    const beforeLore = store.database
      .prepare("SELECT lorebook_id, position FROM character_lorebook_attachments WHERE character_id=? ORDER BY position")
      .all(characterId);
    const beforeLock = store.getCharacter(draftKey).appearanceLockHash;
    const world = new FakeWorld();
    const deps = world.deps(store);

    const registered = await registerExternalOfficialAssetReplacement({
      store,
      storage: deps.storage,
      imageOps: deps.imageOps,
      actor: ADMIN,
      draftKey,
      slotKey: "sig4",
      bytes: encodeImage(1536, 1024),
      approvedTag: `  [${MANUAL_TAG}]\n`,
    });
    assert.equal(registered.status, "generated");
    assert.equal(registered.approvedTag, MANUAL_TAG);
    assert.equal(registered.model, null);
    assert.equal(registered.providerRequestId, null);
    assert.equal(registered.spentUsd, 0);
    assert.equal(registered.hasUnknownCost, false);
    assert.equal(world.calls.length, 0);
    assert.equal(store.getAsset(draftKey, "sig4").resultUrl, beforeAssets[4]!.url);

    assert.throws(
      () => reviewCurrent(draftKey, "sig4"),
      (error: OfficialSupplyGateError) => error.code === "moderation_missing"
    );
    world.nextModeration.push(TEST_MODERATION);
    await moderateOfficialAssetReplacement({ store, moderator: world.moderator }, draftKey, "sig4");
    assert.equal(reviewCurrent(draftKey, "sig4").approved, true);
    assert.equal(world.calls.length, 0);

    const dry = applyApprovedOfficialAssetReplacements({
      store,
      draftKey,
      actor: ADMIN,
      slotKeys: ["sig4"],
      dryRun: true,
    });
    assert.equal(dry.status, "dry_run");
    assert.equal(store.getReplacement(draftKey, "sig4").status, "approved");
    assert.equal(store.getAsset(draftKey, "sig4").resultUrl, beforeAssets[4]!.url);
    assert.equal(
      (store.database.prepare("SELECT assets FROM characters WHERE id=?").get(characterId) as { assets: string }).assets,
      beforeAssetsJson
    );

    const applied = applyApprovedOfficialAssetReplacements({
      store,
      draftKey,
      actor: ADMIN,
      slotKeys: ["sig4"],
    });
    assert.equal(applied.status, "applied");
    const afterAssets = characterAssets(characterId);
    const supply = store.getAsset(draftKey, "sig4");
    assert.equal(afterAssets[4]!.url, registered.candidateResultUrl);
    assert.equal(supply.resultUrl, afterAssets[4]!.url);
    assert.equal(afterAssets[4]!.tag, MANUAL_TAG);
    assert.equal(supply.approvedTag, MANUAL_TAG);
    assert.notEqual(afterAssets[4]!.tag, "앉음");
    assert.equal(afterAssets[4]!.viewerBlur, true);
    assert.equal(supply.model, null);
    assert.equal(supply.providerRequestId, null);
    for (const [index, before] of beforeAssets.entries()) {
      if (index === 4) continue;
      assert.deepEqual(afterAssets[index], before);
    }
    const afterRow = store.database
      .prepare(
        `SELECT creator_id, official, visibility, moderation_status, system_prompt, greeting, world, images
         FROM characters WHERE id=?`
      )
      .get(characterId) as Record<string, unknown>;
    assert.deepEqual(afterRow, beforeRow);
    assert.deepEqual(
      store.database
        .prepare("SELECT lorebook_id, position FROM character_lorebook_attachments WHERE character_id=? ORDER BY position")
        .all(characterId),
      beforeLore
    );
    assert.equal(store.getCharacter(draftKey).appearanceLockHash, beforeLock);
    assert.equal(store.getCharacter(draftKey).stage, "staged_private");
    const mapped = mapOfficialPublicAssetSlots({
      plan: store.getCharacter(draftKey).assetPlan!,
      publicAssets: afterAssets,
      activeUrlBySlot: new Map(store.listAssets(draftKey).map((asset) => [asset.slotKey, asset.resultUrl ?? ""])),
    });
    assert.equal(mapped.ok, true);

    const second = await registerExternalOfficialAssetReplacement({
      store,
      storage: deps.storage,
      imageOps: deps.imageOps,
      actor: ADMIN,
      draftKey,
      slotKey: "scene1",
      bytes: encodeImage(1536, 1024),
      approvedTag: "골목에서 돌아보는 옆모습",
    });
    world.nextModeration.push({ ...TEST_MODERATION, visionTag: "무표정" });
    await moderateOfficialAssetReplacement({ store, moderator: world.moderator }, draftKey, "scene1");
    assert.equal(reviewCurrent(draftKey, "scene1").approved, true);
    const secondApply = applyApprovedOfficialAssetReplacements({
      store,
      draftKey,
      actor: ADMIN,
      slotKeys: ["scene1"],
    });
    assert.equal(secondApply.status, "applied");
    assert.equal(store.getAsset(draftKey, "scene1").resultUrl, second.candidateResultUrl);
    assert.equal(characterAssets(characterId)[mapped.ok ? mapped.indexes.get("scene1")! : -1]!.tag, "골목에서 돌아보는 옆모습");
    const remapped = mapOfficialPublicAssetSlots({
      plan: store.getCharacter(draftKey).assetPlan!,
      publicAssets: characterAssets(characterId),
      activeUrlBySlot: new Map(store.listAssets(draftKey).map((asset) => [asset.slotKey, asset.resultUrl ?? ""])),
    });
    assert.equal(remapped.ok, true);
    assert.equal(world.calls.length, 0);
    assert.deepEqual(egressAttempts, []);
  });

  it("keeps the published predicate and accepts an external file with no provider identity", async () => {
    const draftKey = "ext-published";
    const published = await publishedOfficial(draftKey);
    const world = new FakeWorld();
    const deps = world.deps(store);
    store.database.prepare("UPDATE characters SET visibility='private' WHERE id=?").run(published.characterId);
    await assert.rejects(
      () =>
        registerExternalOfficialAssetReplacement({
          store,
          storage: deps.storage,
          imageOps: deps.imageOps,
          actor: ADMIN,
          draftKey,
          slotKey: "sig4",
          bytes: encodeImage(1536, 1024),
          approvedTag: MANUAL_TAG,
        }),
      (error: OfficialSupplyGateError) => error.code === "character_not_published"
    );
    assert.equal(world.stored.size, 0);
    store.database.prepare("UPDATE characters SET visibility='public' WHERE id=?").run(published.characterId);

    const registered = await registerExternalOfficialAssetReplacement({
      store,
      storage: deps.storage,
      imageOps: deps.imageOps,
      actor: ADMIN,
      draftKey,
      slotKey: "sig4",
      bytes: encodeImage(1536, 1024),
      approvedTag: MANUAL_TAG,
    });
    world.nextModeration.push(TEST_MODERATION);
    await moderateOfficialAssetReplacement({ store, moderator: world.moderator }, draftKey, "sig4");
    assert.equal(reviewCurrent(draftKey, "sig4").approved, true);
    const applied = applyApprovedOfficialAssetReplacements({
      store,
      draftKey,
      actor: ADMIN,
      slotKeys: ["sig4"],
    });
    assert.equal(applied.status, "applied");
    assert.equal(store.getAsset(draftKey, "sig4").resultUrl, registered.candidateResultUrl);
    assert.equal(store.getAsset(draftKey, "sig4").model, null);
    assert.equal(store.getAsset(draftKey, "sig4").providerRequestId, null);
    assert.equal(characterAssets(published.characterId)[4]!.tag, MANUAL_TAG);
    assert.equal(world.calls.length, 0);
    assert.equal(store.getCharacter(draftKey).stage, "published");
    const row = store.database
      .prepare("SELECT official, visibility FROM characters WHERE id=?")
      .get(published.characterId) as { official: number; visibility: string };
    assert.equal(row.official, 1);
    assert.equal(row.visibility, "public");
  });

  it("refuses unauthorized, mismatched, stale, incomplete moderation, and rolls back a mid-apply failure", async () => {
    const draftKey = "ext-gates";
    const characterId = await stagePrivateOfficial(draftKey);
    const world = new FakeWorld();
    const deps = world.deps(store);
    const beforeUrl = store.getAsset(draftKey, "sig4").resultUrl;
    const beforeAssets = (
      store.database.prepare("SELECT assets FROM characters WHERE id=?").get(characterId) as { assets: string }
    ).assets;

    await assert.rejects(
      () =>
        registerExternalOfficialAssetReplacement({
          store,
          storage: deps.storage,
          imageOps: deps.imageOps,
          actor: STRANGER,
          draftKey,
          slotKey: "sig4",
          bytes: encodeImage(1536, 1024),
          approvedTag: MANUAL_TAG,
        }),
      (error: OfficialSupplyGateError) => error.code === "replacement_forbidden"
    );
    store.database.prepare("UPDATE users SET site_managed=0 WHERE id=?").run(STAGING_USER.id);
    try {
      await assert.rejects(
        () =>
          registerExternalOfficialAssetReplacement({
            store,
            storage: deps.storage,
            imageOps: deps.imageOps,
            actor: ADMIN,
            draftKey,
            slotKey: "sig4",
            bytes: encodeImage(1536, 1024),
            approvedTag: MANUAL_TAG,
          }),
        (error: OfficialSupplyGateError) => error.code === "replacement_forbidden"
      );
    } finally {
      store.database.prepare("UPDATE users SET site_managed=1 WHERE id=?").run(STAGING_USER.id);
    }
    await assert.rejects(
      () =>
        registerExternalOfficialAssetReplacement({
          store,
          storage: deps.storage,
          imageOps: deps.imageOps,
          actor: ADMIN,
          draftKey,
          slotKey: "sig4",
          bytes: encodeImage(10, 10),
          approvedTag: MANUAL_TAG,
        }),
      (error: OfficialSupplyGateError) => error.code === "asset_dimensions"
    );
    await assert.rejects(
      () =>
        registerExternalOfficialAssetReplacement({
          store,
          storage: deps.storage,
          imageOps: deps.imageOps,
          actor: ADMIN,
          draftKey,
          slotKey: "sig4",
          bytes: encodeImage(1536, 1024),
          approvedTag: "   [\n]  ",
        }),
      (error: OfficialSupplyGateError) => error.code === "replacement_tag_invalid"
    );
    assert.equal(world.stored.size, 0);
    assert.equal(world.calls.length, 0);

    const linkedId = store.getCharacter(draftKey).stagedCharacterId;
    store.database.prepare("UPDATE official_supply_characters SET staged_character_id=NULL WHERE draft_key=?").run(draftKey);
    await assert.rejects(
      () =>
        registerExternalOfficialAssetReplacement({
          store,
          storage: deps.storage,
          imageOps: deps.imageOps,
          actor: ADMIN,
          draftKey,
          slotKey: "sig4",
          bytes: encodeImage(1536, 1024),
          approvedTag: MANUAL_TAG,
        }),
      (error: OfficialSupplyGateError) => error.code === "not_staged"
    );
    store.database.prepare("UPDATE official_supply_characters SET staged_character_id=? WHERE draft_key=?").run(999999, draftKey);
    await assert.rejects(
      () =>
        registerExternalOfficialAssetReplacement({
          store,
          storage: deps.storage,
          imageOps: deps.imageOps,
          actor: ADMIN,
          draftKey,
          slotKey: "sig4",
          bytes: encodeImage(1536, 1024),
          approvedTag: MANUAL_TAG,
        }),
      (error: OfficialSupplyGateError) => error.code === "character_missing"
    );
    store.database.prepare("UPDATE characters SET official=1, visibility='public' WHERE id=?").run(characterId);
    store.database
      .prepare("UPDATE official_supply_characters SET staged_character_id=? WHERE draft_key=?")
      .run(linkedId, draftKey);
    await assert.rejects(
      () =>
        registerExternalOfficialAssetReplacement({
          store,
          storage: deps.storage,
          imageOps: deps.imageOps,
          actor: ADMIN,
          draftKey,
          slotKey: "sig4",
          bytes: encodeImage(1536, 1024),
          approvedTag: MANUAL_TAG,
        }),
      (error: OfficialSupplyGateError) => error.code === "replacement_target_mismatch"
    );
    store.database.prepare("UPDATE characters SET official=0, visibility='private' WHERE id=?").run(characterId);
    assert.equal(world.stored.size, 0);

    await registerExternalOfficialAssetReplacement({
      store,
      storage: deps.storage,
      imageOps: deps.imageOps,
      actor: ADMIN,
      draftKey,
      slotKey: "sig4",
      bytes: encodeImage(1536, 1024),
      approvedTag: MANUAL_TAG,
    });
    world.nextModeration.push({ status: "unavailable", reason: "test-fixture-not-quality-approval" });
    await moderateOfficialAssetReplacement({ store, moderator: world.moderator }, draftKey, "sig4");
    assert.throws(
      () => reviewCurrent(draftKey, "sig4"),
      (error: OfficialSupplyGateError) => error.code === "moderation_unavailable"
    );
    world.nextModeration.push({ ...TEST_MODERATION, moderationReject: true, reason: "test-reject" });
    await registerExternalOfficialAssetReplacement({
      store,
      storage: deps.storage,
      imageOps: deps.imageOps,
      actor: ADMIN,
      draftKey,
      slotKey: "sig4",
      bytes: encodeImage(1536, 1024),
      approvedTag: MANUAL_TAG,
    });
    await moderateOfficialAssetReplacement({ store, moderator: world.moderator }, draftKey, "sig4");
    assert.equal(reviewCurrent(draftKey, "sig4").approved, false);
    assert.throws(
      () => applyApprovedOfficialAssetReplacements({ store, draftKey, actor: ADMIN, slotKeys: ["sig4"] }),
      (error: OfficialSupplyGateError) => error.code === "replacement_not_approved"
    );

    await registerExternalOfficialAssetReplacement({
      store,
      storage: deps.storage,
      imageOps: deps.imageOps,
      actor: ADMIN,
      draftKey,
      slotKey: "sig4",
      bytes: encodeImage(1536, 1024),
      approvedTag: MANUAL_TAG,
    });
    world.nextModeration.push(TEST_MODERATION);
    await moderateOfficialAssetReplacement({ store, moderator: world.moderator }, draftKey, "sig4");
    assert.equal(reviewCurrent(draftKey, "sig4").approved, true);
    store.database
      .prepare("UPDATE official_supply_assets SET result_url=? WHERE draft_key=? AND slot_key=?")
      .run("/uploads/moved-under-us.webp", draftKey, "sig4");
    assert.throws(
      () => applyApprovedOfficialAssetReplacements({ store, draftKey, actor: ADMIN, slotKeys: ["sig4"] }),
      (error: OfficialSupplyGateError) =>
        error.code === "replacement_base_stale" || error.code === "public_asset_map_mismatch"
    );
    store.database
      .prepare("UPDATE official_supply_assets SET result_url=? WHERE draft_key=? AND slot_key=?")
      .run(beforeUrl, draftKey, "sig4");

    store.database.exec(`
      CREATE TEMP TRIGGER ext_fail_mid
      BEFORE UPDATE ON official_supply_assets
      WHEN NEW.draft_key = 'ext-gates' AND NEW.slot_key = 'sig4'
      BEGIN
        SELECT RAISE(ABORT, 'injected mid-apply failure');
      END;
    `);
    try {
      assert.throws(() =>
        applyApprovedOfficialAssetReplacements({ store, draftKey, actor: ADMIN, slotKeys: ["sig4"] })
      );
    } finally {
      store.database.exec("DROP TRIGGER IF EXISTS ext_fail_mid");
    }
    assert.equal(store.getReplacement(draftKey, "sig4").status, "approved");
    assert.equal(store.getAsset(draftKey, "sig4").resultUrl, beforeUrl);
    assert.equal(
      (store.database.prepare("SELECT assets FROM characters WHERE id=?").get(characterId) as { assets: string }).assets,
      beforeAssets
    );

    const recovered = applyApprovedOfficialAssetReplacements({
      store,
      draftKey,
      actor: ADMIN,
      slotKeys: ["sig4"],
    });
    assert.equal(recovered.status, "applied");
    assert.equal(store.getAsset(draftKey, "sig4").resultUrl, store.getReplacement(draftKey, "sig4").candidateResultUrl);
    assert.equal(characterAssets(characterId)[4]!.tag, MANUAL_TAG);
    assert.equal(store.getAsset(draftKey, "sig4").approvedTag, MANUAL_TAG);
    const mapped = mapOfficialPublicAssetSlots({
      plan: store.getCharacter(draftKey).assetPlan!,
      publicAssets: characterAssets(characterId),
      activeUrlBySlot: new Map(store.listAssets(draftKey).map((asset) => [asset.slotKey, asset.resultUrl ?? ""])),
    });
    assert.equal(mapped.ok, true);
    assert.equal(world.calls.length, 0);
    assert.deepEqual(store.database.prepare("SELECT creator_id FROM characters WHERE id=?").get(characterId), {
      creator_id: STAGING_USER.id,
    });
  });

  it("does not send a staged_private slot to the paid generator", async () => {
    const draftKey = "ext-nogen";
    await stagePrivateOfficial(draftKey);
    const world = new FakeWorld();
    store.createReplacementCandidate(ADMIN, draftKey, "sig4");
    await assert.rejects(
      () => runOfficialAssetReplacement(world.deps(store), draftKey, "sig4"),
      (error: OfficialSupplyGateError) => error.code === "character_stage"
    );
    assert.equal(world.calls.length, 0);
    assert.equal(store.getAsset(draftKey, "sig4").resultUrl?.includes("sig4-a1"), true);
  });

  it("does not overwrite an approved or applied candidate file when re-intake is rejected", async () => {
    const draftKey = "ext-overwrite";
    await stagePrivateOfficial(draftKey);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sig4-ext-"));
    const storedNames: string[] = [];
    const disk = {
      store: async (filename: string, buffer: Buffer) => {
        storedNames.push(filename);
        const dest = path.join(dir, filename);
        await fs.promises.writeFile(dest, buffer, { flag: "wx" });
        return { url: `/uploads/${filename}` };
      },
    };
    const world = new FakeWorld();
    const firstBytes = encodeImage(1536, 1024, ":first");
    const secondBytes = encodeImage(1536, 1024, ":second-different");
    const first = await registerExternalOfficialAssetReplacement({
      store,
      storage: disk,
      imageOps: inspectMarkedImage,
      actor: ADMIN,
      draftKey,
      slotKey: "sig4",
      bytes: firstBytes,
      approvedTag: MANUAL_TAG,
    });
    const firstFile = path.join(dir, path.basename(first.candidateResultUrl!));
    const firstSha = createHash("sha256").update(fs.readFileSync(firstFile)).digest("hex");
    world.nextModeration.push(TEST_MODERATION);
    await moderateOfficialAssetReplacement({ store, moderator: world.moderator }, draftKey, "sig4");
    assert.equal(
      store.reviewReplacement(ADMIN, draftKey, "sig4", variationQa(), first.candidateResultUrl!).approved,
      true
    );
    const approvedRow = store.getReplacement(draftKey, "sig4");
    await assert.rejects(
      () =>
        registerExternalOfficialAssetReplacement({
          store,
          storage: disk,
          imageOps: inspectMarkedImage,
          actor: ADMIN,
          draftKey,
          slotKey: "sig4",
          bytes: secondBytes,
          approvedTag: "다른 행동 태그",
        }),
      (error: OfficialSupplyGateError) => error.code === "replacement_busy"
    );
    assert.equal(createHash("sha256").update(fs.readFileSync(firstFile)).digest("hex"), firstSha);
    assert.equal(fs.readFileSync(firstFile).equals(firstBytes), true);
    const afterBusy = store.getReplacement(draftKey, "sig4");
    assert.equal(afterBusy.status, "approved");
    assert.equal(afterBusy.candidateResultUrl, first.candidateResultUrl);
    assert.equal(afterBusy.approvedTag, approvedRow.approvedTag);
    assert.equal(afterBusy.moderation?.status, "checked");
    assert.equal(storedNames.length, 1);

    applyApprovedOfficialAssetReplacements({ store, draftKey, actor: ADMIN, slotKeys: ["sig4"] });
    const appliedUrl = store.getAsset(draftKey, "sig4").resultUrl;
    assert.equal(appliedUrl, first.candidateResultUrl);
    await assert.rejects(
      () =>
        registerExternalOfficialAssetReplacement({
          store,
          storage: disk,
          imageOps: inspectMarkedImage,
          actor: ADMIN,
          draftKey,
          slotKey: "sig4",
          bytes: secondBytes,
          approvedTag: "다른 행동 태그",
        }),
      (error: OfficialSupplyGateError) => error.code === "replacement_already_applied"
    );
    assert.equal(createHash("sha256").update(fs.readFileSync(firstFile)).digest("hex"), firstSha);
    assert.equal(store.getAsset(draftKey, "sig4").resultUrl, appliedUrl);
    assert.equal(store.getReplacement(draftKey, "sig4").status, "applied");
    assert.equal(storedNames.length, 1);
    assert.equal(world.calls.length, 0);
  });

  it("keeps concurrent external intakes on distinct files and preserves the first file after a failed store", async () => {
    const draftKey = "ext-race";
    await stagePrivateOfficial(draftKey);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sig4-ext-"));
    let failStore = false;
    const disk = {
      store: async (filename: string, buffer: Buffer) => {
        if (failStore) throw new Error("injected store failure");
        const dest = path.join(dir, filename);
        await fs.promises.writeFile(dest, buffer, { flag: "wx" });
        return { url: `/uploads/${filename}` };
      },
    };
    const ops = inspectMarkedImage;
    const aBytes = encodeImage(1536, 1024, ":concurrent-a");
    const bBytes = encodeImage(1536, 1024, ":concurrent-b");
    const first = await registerExternalOfficialAssetReplacement({
      store,
      storage: disk,
      imageOps: ops,
      actor: ADMIN,
      draftKey,
      slotKey: "sig4",
      bytes: aBytes,
      approvedTag: MANUAL_TAG,
    });
    const firstFile = path.join(dir, path.basename(first.candidateResultUrl!));
    const firstSha = createHash("sha256").update(fs.readFileSync(firstFile)).digest("hex");

    failStore = true;
    await assert.rejects(
      () =>
        registerExternalOfficialAssetReplacement({
          store,
          storage: disk,
          imageOps: ops,
          actor: ADMIN,
          draftKey,
          slotKey: "sig4",
          bytes: bBytes,
          approvedTag: "골목에서 돌아보는 옆모습",
        }),
      /injected store failure/
    );
    assert.equal(createHash("sha256").update(fs.readFileSync(firstFile)).digest("hex"), firstSha);
    assert.equal(store.getReplacement(draftKey, "sig4").candidateResultUrl, first.candidateResultUrl);
    assert.equal(store.getReplacement(draftKey, "sig4").status, "generated");
    assert.equal(store.getReplacement(draftKey, "sig4").moderation, null);

    failStore = false;
    const [left, right] = await Promise.allSettled([
      registerExternalOfficialAssetReplacement({
        store,
        storage: disk,
        imageOps: ops,
        actor: ADMIN,
        draftKey,
        slotKey: "sig4",
        bytes: bBytes,
        approvedTag: "골목에서 돌아보는 옆모습",
      }),
      registerExternalOfficialAssetReplacement({
        store,
        storage: disk,
        imageOps: ops,
        actor: ADMIN,
        draftKey,
        slotKey: "sig4",
        bytes: encodeImage(1536, 1024, ":concurrent-c"),
        approvedTag: "식탁에서 잔을 드는 손",
      }),
    ]);
    const accepted = [left, right].filter((result) => result.status === "fulfilled");
    const rejected = [left, right].filter((result) => result.status === "rejected");
    assert.equal(accepted.length, 1);
    assert.equal(rejected.length, 1);
    const winner = (accepted[0] as PromiseFulfilledResult<(typeof first)>).value;
    assert.notEqual(winner.candidateResultUrl, first.candidateResultUrl);
    const winnerFile = path.join(dir, path.basename(winner.candidateResultUrl!));
    const firstAfter = fs.readFileSync(firstFile);
    assert.equal(createHash("sha256").update(firstAfter).digest("hex"), firstSha);
    assert.equal(fs.existsSync(winnerFile), true);
    assert.notEqual(winnerFile, firstFile);
    const files = fs.readdirSync(dir);
    assert.equal(new Set(files).size, files.length);
    assert.equal(store.getReplacement(draftKey, "sig4").candidateResultUrl, winner.candidateResultUrl);
    assert.equal(store.getReplacement(draftKey, "sig4").status, "generated");
  });

  it("discards a stale moderation result when the candidate changes during await", async () => {
    const draftKey = "ext-stale-mod";
    await stagePrivateOfficial(draftKey);
    const world = new FakeWorld();
    const deps = world.deps(store);
    const first = await registerExternalOfficialAssetReplacement({
      store,
      storage: deps.storage,
      imageOps: inspectMarkedImage,
      actor: ADMIN,
      draftKey,
      slotKey: "sig4",
      bytes: encodeImage(1536, 1024, ":a"),
      approvedTag: MANUAL_TAG,
    });
    let releaseFirst!: () => void;
    const firstHold = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstStarted!: () => void;
    const firstBegan = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const delayed: OfficialAssetModerator = {
      moderate: async (url) => {
        if (url === first.candidateResultUrl) {
          firstStarted();
          await firstHold;
          return { ...TEST_MODERATION, reason: "stale-from-A", visionTag: "앉음" };
        }
        return { ...TEST_MODERATION, reason: "from-B", visionTag: "무표정" };
      },
    };
    const pending = moderateOfficialAssetReplacement({ store, moderator: delayed }, draftKey, "sig4");
    await firstBegan;
    const second = await registerExternalOfficialAssetReplacement({
      store,
      storage: deps.storage,
      imageOps: inspectMarkedImage,
      actor: ADMIN,
      draftKey,
      slotKey: "sig4",
      bytes: encodeImage(1536, 1024, ":b"),
      approvedTag: "골목에서 돌아보는 옆모습",
    });
    assert.notEqual(second.candidateResultUrl, first.candidateResultUrl);
    assert.equal(store.getReplacement(draftKey, "sig4").moderation, null);
    releaseFirst();
    await assert.rejects(
      pending,
      (error: OfficialSupplyGateError) => error.code === "replacement_moderation_stale"
    );
    const after = store.getReplacement(draftKey, "sig4");
    assert.equal(after.candidateResultUrl, second.candidateResultUrl);
    assert.equal(after.status, "generated");
    assert.equal(after.moderation, null);
    assert.throws(
      () => store.reviewReplacement(ADMIN, draftKey, "sig4", variationQa(), first.candidateResultUrl!),
      (error: OfficialSupplyGateError) => error.code === "replacement_review_stale"
    );
    assert.equal(store.getReplacement(draftKey, "sig4").status, "generated");
    assert.equal(store.getReplacement(draftKey, "sig4").moderation, null);
    assert.equal(world.calls.length, 0);
  });

  it("refuses candidate reset and paid runner entry while an external intake lease is live", async () => {
    const draftKey = "ext-lease-live";
    await publishedOfficial(draftKey);
    const now = 1_000_000;
    const held = store.claimExternalReplacementIntake(ADMIN, draftKey, "sig4", "intake-A", now);
    assert.equal(held.leaseOwner, "intake-A");
    assert.equal(held.status, "planned");
    assert.ok(held.leaseExpiresAt != null && held.leaseExpiresAt > now);

    assert.throws(
      () => store.createReplacementCandidate(ADMIN, draftKey, "sig4", now),
      (error: OfficialSupplyGateError) => error.code === "replacement_busy"
    );
    const afterCreate = store.getReplacement(draftKey, "sig4");
    assert.equal(afterCreate.leaseOwner, "intake-A");
    assert.equal(afterCreate.leaseExpiresAt, held.leaseExpiresAt);
    assert.equal(afterCreate.status, "planned");
    assert.equal(afterCreate.candidateResultUrl, null);

    assert.equal(store.claimReplacement(draftKey, "sig4", "paid-worker", now, 60_000, 3), false);
    const afterPaidClaim = store.getReplacement(draftKey, "sig4");
    assert.equal(afterPaidClaim.leaseOwner, "intake-A");
    assert.equal(afterPaidClaim.status, "planned");

    const world = new FakeWorld();
    world.now = now;
    const outcome = await runOfficialAssetReplacement(world.deps(store), draftKey, "sig4");
    assert.equal(outcome.status, "in_progress_elsewhere");
    assert.equal(world.calls.length, 0);
    assert.equal(store.getReplacement(draftKey, "sig4").leaseOwner, "intake-A");
  });

  it("reclaims only an expired external lease and ignores late work from the previous intake", async () => {
    const draftKey = "ext-lease-expire";
    await stagePrivateOfficial(draftKey);
    const now = 1_000_000;
    const first = store.claimExternalReplacementIntake(ADMIN, draftKey, "sig4", "intake-A", now);
    const leaseMs = store.getBatch(store.getCharacter(draftKey).batchKey).config.leaseMs;
    assert.equal(first.leaseExpiresAt, now + leaseMs);

    assert.throws(
      () => store.claimExternalReplacementIntake(ADMIN, draftKey, "sig4", "intake-B", now + leaseMs),
      (error: OfficialSupplyGateError) => error.code === "replacement_busy"
    );
    assert.equal(store.getReplacement(draftKey, "sig4").leaseOwner, "intake-A");

    const recoveredAt = now + leaseMs + 1;
    const recovered = store.claimExternalReplacementIntake(ADMIN, draftKey, "sig4", "intake-B", recoveredAt);
    assert.equal(recovered.leaseOwner, "intake-B");
    assert.equal(recovered.status, "planned");
    assert.equal(recovered.candidateResultUrl, first.candidateResultUrl);
    assert.equal(recovered.leaseExpiresAt, recoveredAt + leaseMs);

    assert.throws(
      () =>
        store.registerExternalReplacementCandidate(ADMIN, draftKey, "sig4", {
          url: "/uploads/late-a.webp",
          width: 1536,
          height: 1024,
          approvedTag: MANUAL_TAG,
          intakeId: "intake-A",
        }),
      (error: OfficialSupplyGateError) => error.code === "replacement_busy"
    );
    store.releaseExternalReplacementIntake(draftKey, "sig4", "intake-A");
    assert.equal(store.completeReplacement(draftKey, "sig4", "intake-A", {
      url: "/uploads/late-a.webp",
      width: 1536,
      height: 1024,
    }), false);
    const afterLate = store.getReplacement(draftKey, "sig4");
    assert.equal(afterLate.leaseOwner, "intake-B");
    assert.equal(afterLate.candidateResultUrl, null);
    assert.equal(afterLate.status, "planned");

    const finished = store.registerExternalReplacementCandidate(ADMIN, draftKey, "sig4", {
      url: "/uploads/official-ext-lease-expire__sig4-ext-intake-B.webp",
      width: 1536,
      height: 1024,
      approvedTag: MANUAL_TAG,
      intakeId: "intake-B",
    });
    assert.equal(finished.leaseOwner, null);
    assert.equal(finished.candidateResultUrl, "/uploads/official-ext-lease-expire__sig4-ext-intake-B.webp");
    assert.equal(store.getReplacement(draftKey, "sig4").status, "generated");
  });
});

describe("replacement tests never load production adapters", () => {
  it("stays offline and does not import production adapters or billing owners", () => {
    const dir = path.join(process.cwd(), "src/lib/officialSupply");
    const testSource = fs.readFileSync(path.join(dir, "officialSupply.replacement.test.ts"), "utf8");
    const implSource = fs.readFileSync(path.join(dir, "replacement.ts"), "utf8");
    assert.doesNotMatch(testSource, /from "@\/lib\/officialSupply\/productionAdapters"/);
    assert.doesNotMatch(implSource, /from "@\/lib\/officialSupply\/productionAdapters"/);
    assert.doesNotMatch(
      implSource,
      /chatImageGenerationPersistence|chatImagePricing|@\/lib\/points"|deductPoints/
    );
  });
});
