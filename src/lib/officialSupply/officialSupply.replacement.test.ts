import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { parseAssets } from "@/lib/characterAssets";
import { getDb } from "@/lib/db";
import { applyApprovedOfficialAssetReplacements } from "@/lib/officialSupply/replacement";
import { resolveOfficialGenerationReferencePlan } from "@/lib/officialSupply/generationReferences";
import { officialImageProfileForSlot, resolveOfficialAssetImageModel } from "@/lib/officialSupply/imageProfile";
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

function encodeImage(width: number, height: number): Buffer {
  return Buffer.from(`${width}x${height}`);
}

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
const anchorQa = (overrides: Partial<OfficialAnchorQaReport> = {}): OfficialAnchorQaReport => ({
  gender: PASS, ageAppearance: PASS, face: PASS, hair: PASS, eyes: PASS, body: PASS,
  identifyingFeatures: PASS, artStyle: PASS, outfit: PASS, cardCrop: PASS, ...overrides,
});
const variationQa = (overrides: Partial<OfficialVariationQaReport> = {}): OfficialVariationQaReport => ({
  identityMatchesAnchor: PASS, expressionMatchesPlan: PASS, characterPresent: PASS, artStyle: PASS, ...overrides,
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

async function generateApproveReplacement(world: FakeWorld, draftKey: string, slotKey: string) {
  store.createReplacementCandidate(draftKey, slotKey);
  const generated = await runOfficialAssetReplacement(world.deps(store), draftKey, slotKey);
  assert.equal(generated.status, "generated");
  await moderateOfficialAssetReplacement({ store, moderator: world.moderator }, draftKey, slotKey);
  assert.equal(store.reviewReplacement(draftKey, slotKey, variationQa()).approved, true);
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

    const created = store.createReplacementCandidate(draftKey, "sig4");
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

    assert.equal(store.reviewReplacement(draftKey, "sig4", variationQa()).approved, true);
    assert.equal(store.getReplacement(draftKey, "sig4").status, "approved");
    assert.equal(store.getAsset(draftKey, "sig4").status, "approved");
    assert.equal(store.getAsset(draftKey, "sig4").resultUrl, oldUrl);

    store.createReplacementCandidate(draftKey, "scene1");
    const rejectWorld = new FakeWorld();
    assert.equal((await runOfficialAssetReplacement(rejectWorld.deps(store), draftKey, "scene1")).status, "generated");
    await moderateOfficialAssetReplacement({ store, moderator: rejectWorld.moderator }, draftKey, "scene1");
    assert.equal(store.reviewReplacement(draftKey, "scene1", variationQa({ artStyle: { ok: false } })).approved, false);
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

    const applied = applyApprovedOfficialAssetReplacements({ store, draftKey, slotKeys: [...TARGETS] });
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
      () => applyApprovedOfficialAssetReplacements({ store, draftKey, slotKeys: [...TARGETS] }),
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
      () => applyApprovedOfficialAssetReplacements({ store, draftKey, slotKeys: [...TARGETS] }),
      (error: OfficialSupplyGateError) =>
        error.code === "public_asset_map_mismatch" || error.code === "replacement_public_stale"
    );
    store.database.prepare("UPDATE characters SET assets=? WHERE id=?").run(beforeAssets, published.characterId);

    store.database
      .prepare("UPDATE official_supply_asset_replacements SET status='generated' WHERE draft_key=? AND slot_key=?")
      .run(draftKey, "scene2");
    assert.throws(
      () => applyApprovedOfficialAssetReplacements({ store, draftKey, slotKeys: [...TARGETS] }),
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
      () => applyApprovedOfficialAssetReplacements({ store, draftKey, slotKeys: [...TARGETS] }),
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
    store.createReplacementCandidate(draftKey, "sig4");
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
    store.createReplacementCandidate(draftKey, "sig4");

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
      async () => store.reviewReplacement(draftKey, "sig4", variationQa()),
      (error: OfficialSupplyGateError) => error.code === "moderation_unavailable"
    );
    assert.equal(store.getReplacement(draftKey, "sig4").status, "generated");
    assert.equal(store.getAsset(draftKey, "sig4").resultUrl, oldUrl);

    world.nextModeration.push({ status: "checked", adultFlagged: false, moderationReject: false, reason: "" });
    await moderateOfficialAssetReplacement({ store, moderator: world.moderator }, draftKey, "sig4");
    assert.equal(store.reviewReplacement(draftKey, "sig4", variationQa({ identityMatchesAnchor: { ok: false } })).approved, false);
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
    store.createReplacementCandidate(draftKey, "sig4");
    assert.equal((await runOfficialAssetReplacement(world.deps(store), draftKey, "sig4")).status, "generated");
    const after = store.spendSnapshot(draftKey, 0.25);
    assert.equal(Number(after.character.toFixed(4)), Number((before.character + 0.1).toFixed(4)));
    assert.equal(store.getAsset(draftKey, "sig4").spentUsd, 0);

    store.database
      .prepare("UPDATE official_supply_characters SET stage='staged_private' WHERE draft_key=?")
      .run(draftKey);
    await assert.rejects(
      async () => store.reviewReplacement(draftKey, "sig4", variationQa()),
      (error: OfficialSupplyGateError) => error.code === "character_stage"
    );
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
