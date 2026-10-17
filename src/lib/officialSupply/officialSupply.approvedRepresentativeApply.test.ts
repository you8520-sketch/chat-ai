import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import sharp from "sharp";

import { GET as getPublicMedia } from "@/app/media/public/[filename]/route";
import {
  chatAssets,
  getCharacterRepresentativeImageUrl,
  getCharacterRepresentativePublicUrls,
  getDefaultChatAsset,
  parseAssets,
  safeLockedPreviewUrl,
  type CharacterAsset,
} from "@/lib/characterAssets";
import { assetModerationSummary } from "@/lib/characterListingModeration";
import { getDb } from "@/lib/db";
import type { OfficialAdminActor } from "@/lib/officialAdminAccess";
import { resolveInlineAsset } from "@/lib/inlineTaggedAssets";
import { projectAssetsForViewer } from "@/lib/mediaAccess";
import {
  officialApprovedAssetReference,
  resolveOfficialGenerationReferencePlan,
} from "@/lib/officialSupply/generationReferences";
import {
  ADMIN,
  anchorQa,
  APPROVED_PLAN,
  CANDIDATES,
  candidateBytes,
  REP,
  seedApprovedApplyUsers,
  sha256,
  stageApprovedWolfgangDraft as stageWolfgang,
  stageDefaultPathDraft as stageDefault,
  STAGING_USER,
  STRANGER,
  TEST_ONLY_MODERATION,
  TEST_ONLY_REVIEWER,
  TestPorts,
  variationQa,
  type ManifestCandidate,
} from "@/lib/officialSupply/officialSupply.approvedApplyFixtures";
import { testBatchConfig, testStyleCandidate } from "@/lib/officialSupply/officialSupply.fixtures";
import { PILOT_STYLE_PROOF_CANDIDATE_ID } from "@/lib/officialSupply/pilotStyleProof";
import { prepareOfficialImageReferences } from "@/lib/officialSupply/referencePreparation";
import {
  applyApprovedOfficialAssetReplacements,
  registerExternalOfficialAssetReplacement,
  rollbackOfficialAssetReplacementApply,
  type OfficialRepresentativeApplySet,
} from "@/lib/officialSupply/replacement";
import { composeOfficialSlotGeneration, moderateOfficialAssetReplacement } from "@/lib/officialSupply/runner";
import { ROFAN_CLUSTER_B_VISUAL_STYLE_DNA } from "@/lib/officialSupply/style";
import { OfficialSupplyGateError, OfficialSupplyStore } from "@/lib/officialSupply/store";
import type { OfficialAssetModeration, OfficialAssetPlan, OfficialGenreStyle } from "@/lib/officialSupply/types";
import { buildClusterBRofanStyleSeed } from "@/lib/officialSupply/userOwnedRofanStyleRefs";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";

/**
 * Isolated-DB verification of the approved fourteen-slot private apply path.
 * Moderation, anchor QA and variation QA below are gate fixtures only. They
 * are not an image-quality approval of these files, and no row written here
 * leaves the temporary database.
 */
const IMAGE_ENV = { OPENAI_IMAGE_MODEL: "gpt-image-2.5-sunburst" } as unknown as NodeJS.ProcessEnv;
const REPRESENTATIVE_SET: OfficialRepresentativeApplySet = {
  nextAssetPlan: APPROVED_PLAN,
  generationReference: "representative_identity_and_style",
};
const OLD_TITLE_TAGS = ["흑철 늑대공", "절제된 온기", "경계의 완화", "귀환의 안도"];

function approvedAssemblyStyle(): OfficialGenreStyle {
  return {
    styleKey: "romance_fantasy_v4",
    genre: "로맨스 판타지",
    stage: "style_locked",
    candidates: [{ ...testStyleCandidate(PILOT_STYLE_PROOF_CANDIDATE_ID), dna: ROFAN_CLUSTER_B_VISUAL_STYLE_DNA }],
    approvedCandidateId: PILOT_STYLE_PROOF_CANDIDATE_ID,
    styleSeed: buildClusterBRofanStyleSeed({ NEXTAUTH_URL: "https://hav.chat" } as unknown as NodeJS.ProcessEnv),
    proofAssetLimit: 3,
  };
}

let store: OfficialSupplyStore;
let ports: TestPorts;
const originalFetch = globalThis.fetch;
const originalBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
const egressAttempts: string[] = [];

function withoutUpdatedAt(row: unknown): Record<string, unknown> {
  const { updated_at: _updatedAt, ...rest } = (row ?? {}) as Record<string, unknown>;
  return rest;
}

function draftState(draftKey: string) {
  const db = store.database;
  const supply = db.prepare("SELECT * FROM official_supply_characters WHERE draft_key=?").get(draftKey) as {
    staged_character_id: number;
  };
  const characterId = supply.staged_character_id;
  return {
    character: withoutUpdatedAt(db.prepare("SELECT * FROM characters WHERE id=?").get(characterId)),
    supply: withoutUpdatedAt(supply),
    assets: db
      .prepare("SELECT * FROM official_supply_assets WHERE draft_key=? ORDER BY slot_key")
      .all(draftKey)
      .map(withoutUpdatedAt),
    replacements: db
      .prepare("SELECT * FROM official_supply_asset_replacements WHERE draft_key=? ORDER BY slot_key")
      .all(draftKey)
      .map(withoutUpdatedAt),
    applies: db
      .prepare("SELECT * FROM official_supply_replacement_applies WHERE draft_key=? ORDER BY applied_at, apply_id")
      .all(draftKey),
    lore: db
      .prepare("SELECT * FROM character_lorebook_attachments WHERE character_id=? ORDER BY position")
      .all(characterId),
  };
}

function sharedState() {
  const db = store.database;
  return {
    keywordLorebooks: db.prepare("SELECT * FROM keyword_lorebooks ORDER BY id").all(),
    worldLorebooks: db.prepare("SELECT * FROM official_supply_world_lorebooks ORDER BY lorebook_id").all(),
    worlds: db.prepare("SELECT * FROM worlds ORDER BY id").all(),
  };
}

function characterRow(characterId: number) {
  return store.database.prepare("SELECT assets, images FROM characters WHERE id=?").get(characterId) as {
    assets: string;
    images: string;
  };
}

function expectGate(code: string) {
  return (error: unknown) => {
    assert.ok(error instanceof OfficialSupplyGateError, String(error));
    assert.equal(error.code, code, error.message);
    return true;
  };
}

let batchKey = "";
const stageApprovedWolfgangDraft = (draftKey: string, inBatch = batchKey) =>
  stageWolfgang(store, draftKey, inBatch);
const stageDefaultPathDraft = (draftKey: string, inBatch = batchKey) => stageDefault(store, draftKey, inBatch);

async function register(draftKey: string, slotKey: string, bytes: Buffer, approvedTag: string, actor: OfficialAdminActor = ADMIN) {
  return registerExternalOfficialAssetReplacement({
    store,
    storage: ports.storage,
    imageOps: ports.imageOps,
    actor,
    draftKey,
    slotKey,
    bytes,
    approvedTag,
  });
}

async function moderate(draftKey: string, slotKey: string, moderation: OfficialAssetModeration = TEST_ONLY_MODERATION) {
  ports.nextModeration.push(moderation);
  await moderateOfficialAssetReplacement({ store, moderator: ports.moderator }, draftKey, slotKey);
}

function review(draftKey: string, candidate: ManifestCandidate, url: string, qa = anchorQa()) {
  if (candidate.slot === "rep") {
    return store.reviewRepresentativeReplacement(
      ADMIN,
      draftKey,
      qa,
      { candidateUrl: url, candidateSha256: candidate.rawSha256 },
      TEST_ONLY_REVIEWER
    );
  }
  return store.reviewReplacement(ADMIN, draftKey, candidate.slot, variationQa(), url);
}

async function prepareFourteen(draftKey: string): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  for (const candidate of CANDIDATES) {
    const registered = await register(draftKey, candidate.slot, candidateBytes(candidate), candidate.tag);
    assert.equal(registered.candidateSha256, candidate.rawSha256);
    await moderate(draftKey, candidate.slot);
    assert.equal(review(draftKey, candidate, registered.candidateResultUrl!).approved, true);
    urls.set(candidate.slot, registered.candidateResultUrl!);
  }
  return urls;
}

const MAIN = "pilot-rf-v4-02";
const GATES = "approved-apply-gates";
const DEFAULT_PATH = "approved-apply-default-path";
const PUBLISHED = "approved-apply-published";
let mainCharacterId = 0;
let defaultPathCharacterId = 0;
let candidateUrls = new Map<string, string>();
let beforeApply: ReturnType<typeof draftState>;
let defaultPathBefore: ReturnType<typeof draftState>;
let sharedBefore: ReturnType<typeof sharedState>;
let firstApplyId = "";

before(async () => {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    egressAttempts.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    throw new Error("network egress is not allowed in approved apply tests");
  }) as typeof fetch;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  installIsolatedTestDatabase();
  const db = getDb();
  seedApprovedApplyUsers(db);
  store = new OfficialSupplyStore(db);
  ports = new TestPorts();
  batchKey = "approved-apply-batch";
  store.createBatch(batchKey, testBatchConfig({ budgetUsd: { batch: 100 } }));
  store.proposeStyle({ styleKey: "romance_fantasy_v4", genre: "로맨스 판타지", candidates: ["c1", "c2", "c3"].map(testStyleCandidate) });
  store.approveStyleCandidate(
    "romance_fantasy_v4",
    "c2",
    { url: "/uploads/official-style-seed.webp", provenance: "platform_owned", note: "owned seed" },
    "owner"
  );
  mainCharacterId = await stageApprovedWolfgangDraft(MAIN);
  store.createBatch("approved-apply-gate-batch", testBatchConfig({ budgetUsd: { batch: 100 } }));
  await stageApprovedWolfgangDraft(GATES, "approved-apply-gate-batch");
  defaultPathCharacterId = await stageDefaultPathDraft(DEFAULT_PATH);
  defaultPathBefore = draftState(DEFAULT_PATH);
  sharedBefore = sharedState();
});

after(() => {
  globalThis.fetch = originalFetch;
  if (originalBlobToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = originalBlobToken;
  uninstallIsolatedTestDatabase();
  assert.deepEqual(egressAttempts, [], "approved apply tests made network calls");
});

describe("approved fourteen-slot private apply (isolated DB, test-only review fixtures)", () => {
  it("1a. intake, moderation and review of the 14 real files leave the live rows unchanged; dry-run changes nothing", async () => {
    const staged = draftState(MAIN);
    assert.equal(store.getCharacter(MAIN).stage, "staged_private");
    assert.deepEqual(
      parseAssets(characterRow(mainCharacterId).assets).map((asset) => asset.tag).slice(0, 5),
      ["흑철 늑대공", "철혈의 지휘관", "흉터의 맹세", "봉인고의 열쇠", "절제된 온기"]
    );
    candidateUrls = await prepareFourteen(MAIN);
    assert.equal(candidateUrls.size, 14);
    assert.equal(ports.storedFiles.length, 14);
    for (const url of candidateUrls.values()) assert.match(url, /^\/uploads\/official-pilot-rf-v4-02__[a-z0-9]+-ext-/);
    beforeApply = draftState(MAIN);
    assert.deepEqual(beforeApply.character, staged.character);
    assert.deepEqual(beforeApply.supply, staged.supply);
    assert.deepEqual(beforeApply.assets, staged.assets);

    const dry = applyApprovedOfficialAssetReplacements({
      store,
      draftKey: MAIN,
      actor: ADMIN,
      slotKeys: CANDIDATES.map((c) => c.slot),
      representative: REPRESENTATIVE_SET,
      dryRun: true,
    });
    assert.equal(dry.status, "dry_run");
    assert.equal(dry.applyId, null);
    assert.deepEqual(dry.swapped, CANDIDATES.map((c) => c.slot));
    assert.deepEqual(draftState(MAIN), beforeApply);
  });

  it("4. a failure at the last write inside the transaction restores all 14 slots, anchor and reference state", () => {
    store.database.exec(
      `CREATE TEMP TRIGGER approved_apply_fail_ledger BEFORE INSERT ON official_supply_replacement_applies
       BEGIN SELECT RAISE(ABORT, 'injected ledger failure'); END;`
    );
    try {
      assert.throws(
        () =>
          applyApprovedOfficialAssetReplacements({
            store,
            draftKey: MAIN,
            actor: ADMIN,
            slotKeys: CANDIDATES.map((c) => c.slot),
            representative: REPRESENTATIVE_SET,
          }),
        /injected ledger failure/
      );
    } finally {
      store.database.exec("DROP TRIGGER approved_apply_fail_ledger");
    }
    assert.deepEqual(draftState(MAIN), beforeApply);
    assert.equal(store.getCharacter(MAIN).generationReferencePolicy, null);
  });

  it("1b. one apply swaps all 14 slots and syncs tags, representative, supply, QA, anchor and reference policy", () => {
    const applied = applyApprovedOfficialAssetReplacements({
      store,
      draftKey: MAIN,
      actor: ADMIN,
      slotKeys: CANDIDATES.map((c) => c.slot),
      representative: REPRESENTATIVE_SET,
    });
    assert.equal(applied.status, "applied");
    assert.equal(applied.characterId, mainCharacterId);
    assert.ok(applied.applyId);
    firstApplyId = applied.applyId;

    const row = characterRow(mainCharacterId);
    const assets = parseAssets(row.assets);
    assert.equal(assets.length, 14);
    assert.deepEqual(
      assets.map((asset) => [asset.url, asset.tag]),
      APPROVED_PLAN.slots.map((slot) => [candidateUrls.get(slot.slotKey), slot.tag])
    );
    assert.equal(assets[0]!.tag, "기본 초상");
    assert.equal(assets[0]!.representativeRank, 1);
    assert.equal(assets.filter((asset) => asset.representativeRank != null).length, 1);
    assert.deepEqual(JSON.parse(row.images), [candidateUrls.get("rep")]);
    assert.ok(assets.every((asset) => asset.tag !== "앉음" && !OLD_TITLE_TAGS.includes(asset.tag)));

    for (const candidate of CANDIDATES) {
      const active = store.getAsset(MAIN, candidate.slot);
      assert.equal(active.resultUrl, candidateUrls.get(candidate.slot));
      assert.equal(active.approvedTag, candidate.tag);
      assert.equal(active.status, "approved");
      assert.equal(store.getReplacement(MAIN, candidate.slot).status, "applied");
    }
    assert.deepEqual(store.getAsset(MAIN, "rep").qa, anchorQa());
    const character = store.getCharacter(MAIN);
    assert.deepEqual(character.assetPlan, APPROVED_PLAN);
    assert.deepEqual(
      character.assetPlan!.slots
        .filter((slot) => slot.slotKey === "emo5" || slot.slotKey === "emo6")
        .map((slot) => [slot.tag, slot.personTag]),
      [
        ["편안함", null],
        ["안도", null],
      ]
    );
    assert.equal(draftState(MAIN).supply.anchor_approved_by, TEST_ONLY_REVIEWER);
    assert.deepEqual(character.generationReferencePolicy, {
      mode: "representative_identity_and_style",
      url: candidateUrls.get("rep"),
      sha256: REP.rawSha256,
    });
    const ledger = draftState(MAIN).applies;
    assert.equal(ledger.length, 1);
    assert.equal((ledger[0] as { status: string }).status, "applied");
  });

  it("5. re-apply is refused without duplicates or state change", () => {
    const appliedState = draftState(MAIN);
    assert.throws(
      () =>
        applyApprovedOfficialAssetReplacements({
          store,
          draftKey: MAIN,
          actor: ADMIN,
          slotKeys: CANDIDATES.map((c) => c.slot),
          representative: REPRESENTATIVE_SET,
        }),
      expectGate("replacement_not_approved")
    );
    assert.deepEqual(draftState(MAIN), appliedState);
  });

  it("7. after re-fetch the next assembly uses the approved representative as identity+style plus the 14-slot plan", async () => {
    const character = store.getCharacter(MAIN);
    const representativeUrl = store.representativeAsset(MAIN).resultUrl;
    assert.equal(representativeUrl, candidateUrls.get("rep"));
    assert.ok(!character.generationReferencePolicy!.url.includes("docs/"));
    const expectedReference = officialApprovedAssetReference(candidateUrls.get("rep")!, REP.rawSha256);
    for (const candidate of CANDIDATES) {
      const composed = composeOfficialSlotGeneration({
        character,
        style: approvedAssemblyStyle(),
        slotKey: candidate.slot,
        representativeUrl,
        env: IMAGE_ENV,
      });
      if (candidate.slot === "rep") {
        assert.equal(composed.ok, false);
        continue;
      }
      assert.equal(composed.ok, true, composed.ok ? "" : composed.error);
      if (!composed.ok) continue;
      assert.equal(composed.referenceRoleLayout, "identity_and_style");
      assert.deepEqual([...composed.references], [expectedReference]);
      assert.equal(
        sha256(composed.primaryPrompt),
        candidate.laterOwnerAssemblyPromptSha256 ?? candidate.sentPromptSha256,
        `${candidate.slot} prompt differs from the recorded approved prompt`
      );
      assert.doesNotMatch(composed.primaryPrompt, /식사|식당|수프/);
    }
    const prepared = await prepareOfficialImageReferences([expectedReference], IMAGE_ENV);
    assert.equal(prepared.length, 1);
    assert.match(prepared[0]!, /^data:image\/webp;base64,/);
    await assert.rejects(
      () =>
        prepareOfficialImageReferences(
          [officialApprovedAssetReference(candidateUrls.get("rep")!, CANDIDATES[1]!.rawSha256)],
          IMAGE_ENV
        ),
      /approved asset hash mismatch/
    );

    const defaultCharacter = store.getCharacter(DEFAULT_PATH);
    assert.equal(defaultCharacter.generationReferencePolicy, null);
    const variation = defaultCharacter.assetPlan!.slots.find((slot) => slot.kind !== "representative")!;
    const defaultComposed = composeOfficialSlotGeneration({
      character: defaultCharacter,
      style: approvedAssemblyStyle(),
      slotKey: variation.slotKey,
      representativeUrl: store.representativeAsset(DEFAULT_PATH).resultUrl,
      env: IMAGE_ENV,
    });
    assert.equal(defaultComposed.ok, true);
    if (defaultComposed.ok) {
      assert.equal(defaultComposed.referenceRoleLayout, "identity_then_style");
      assert.equal(defaultComposed.references[0], store.representativeAsset(DEFAULT_PATH).resultUrl);
    }
    assert.deepEqual(egressAttempts, []);
  });

  it("8. card, detail and chat readers and the RP asset list read the new URLs and tags", () => {
    const row = characterRow(mainCharacterId);
    const repUrl = candidateUrls.get("rep");
    assert.equal(getCharacterRepresentativeImageUrl(row.assets, row.images), repUrl);
    assert.deepEqual(getCharacterRepresentativePublicUrls(row.assets, row.images), [repUrl]);
    const assets = parseAssets(row.assets);
    assert.equal(getDefaultChatAsset(assets)?.url, repUrl);
    assert.deepEqual(
      [...new Set(chatAssets(assets).map((asset) => asset.tag))],
      CANDIDATES.map((c) => c.tag)
    );
    assert.equal(resolveInlineAsset(assets, "옅은 미소", "any")?.url, candidateUrls.get("sig4"));
    assert.equal(resolveInlineAsset(assets, "편안함", "any")?.url, candidateUrls.get("emo5"));
    assert.equal(resolveInlineAsset(assets, "절제된 온기", "any"), null);
  });

  it("6. a stale rollback is refused; rollback restores the previous tags, QA, anchor and reference state", () => {
    const appliedState = draftState(MAIN);
    const edited = parseAssets(characterRow(mainCharacterId).assets);
    edited[3] = { ...edited[3]!, tag: "편집된 태그" };
    const editedJson = JSON.stringify(edited);
    store.database.prepare("UPDATE characters SET assets=? WHERE id=?").run(editedJson, mainCharacterId);
    assert.throws(
      () => rollbackOfficialAssetReplacementApply({ store, draftKey: MAIN, applyId: firstApplyId, actor: ADMIN }),
      expectGate("rollback_stale")
    );
    assert.equal(characterRow(mainCharacterId).assets, editedJson);
    store.database
      .prepare("UPDATE characters SET assets=? WHERE id=?")
      .run(appliedState.character.assets, mainCharacterId);

    assert.throws(
      () => rollbackOfficialAssetReplacementApply({ store, draftKey: MAIN, applyId: firstApplyId, actor: STRANGER }),
      expectGate("replacement_forbidden")
    );
    const dry = rollbackOfficialAssetReplacementApply({
      store,
      draftKey: MAIN,
      applyId: firstApplyId,
      actor: ADMIN,
      dryRun: true,
    });
    assert.equal(dry.status, "dry_run");
    assert.deepEqual(draftState(MAIN), appliedState);

    const rolledBack = rollbackOfficialAssetReplacementApply({
      store,
      draftKey: MAIN,
      applyId: firstApplyId,
      actor: ADMIN,
    });
    assert.equal(rolledBack.status, "rolled_back");
    const restored = draftState(MAIN);
    assert.deepEqual({ ...restored, applies: [] }, { ...beforeApply, applies: [] });
    assert.equal(restored.applies.length, 1);
    assert.equal((restored.applies[0] as { status: string }).status, "rolled_back");
    assert.equal((restored.applies[0] as { rolled_back_by_id: number }).rolled_back_by_id, ADMIN.id);
    const restoredAssets = parseAssets(characterRow(mainCharacterId).assets);
    assert.equal(restoredAssets[0]!.tag, "흑철 늑대공");
    assert.equal(restoredAssets[4]!.tag, "절제된 온기");
    assert.deepEqual(store.getAsset(MAIN, "rep").qa, anchorQa());
    assert.equal(restored.supply.anchor_approved_by, "seed-reviewer");
    assert.equal(store.getCharacter(MAIN).generationReferencePolicy, null);
    for (const url of candidateUrls.values()) {
      assert.ok(fs.existsSync(path.join(process.env.DATA_DIR!, "uploads", path.basename(url))), `${url} was deleted`);
    }

    assert.throws(
      () => rollbackOfficialAssetReplacementApply({ store, draftKey: MAIN, applyId: firstApplyId, actor: ADMIN }),
      expectGate("rollback_not_applied")
    );

    const again = applyApprovedOfficialAssetReplacements({
      store,
      draftKey: MAIN,
      actor: ADMIN,
      slotKeys: CANDIDATES.map((c) => c.slot),
      representative: REPRESENTATIVE_SET,
    });
    assert.notEqual(again.applyId, firstApplyId);
    const reapplied = draftState(MAIN);
    assert.deepEqual(reapplied.character, appliedState.character);
    assert.deepEqual(reapplied.supply, appliedState.supply);
    assert.deepEqual(reapplied.assets, appliedState.assets);
    assert.equal(parseAssets(characterRow(mainCharacterId).assets).length, 14);
    assert.deepEqual(
      reapplied.applies.map((row) => (row as { status: string }).status).sort(),
      ["applied", "rolled_back"]
    );
  });

  it("9. manuscript, both Locks, ownership, visibility, official, lorebooks and the default-path character are preserved", () => {
    const now = draftState(MAIN);
    const keep = (state: ReturnType<typeof draftState>) => {
      const { assets: _assets, images: _images, ...character } = state.character;
      const { asset_plan_json: _plan, anchor_approved_by: _anchor, generation_reference_json: _ref, ...supply } =
        state.supply;
      return { character, supply, lore: state.lore };
    };
    assert.deepEqual(keep(now), keep(beforeApply));
    assert.equal(now.character.official, 0);
    assert.equal(now.character.visibility, "private");
    assert.equal(now.character.creator_id, STAGING_USER.id);
    assert.equal(now.supply.stage, "staged_private");
    assert.ok(now.lore.length > 0);
    assert.deepEqual(draftState(DEFAULT_PATH), defaultPathBefore);
    assert.deepEqual(sharedState(), sharedBefore);
  });
});

describe("approved representative reference policy owner", () => {
  const policy = {
    mode: "representative_identity_and_style" as const,
    url: "/uploads/official-approved-rep.webp",
    sha256: REP.rawSha256,
  };
  const styleSeed = approvedAssemblyStyle().styleSeed;

  it("refuses a second identity image, representative regeneration and a policy for another representative", () => {
    const base = { kind: "signature" as const, styleSeed, representativeUrl: policy.url, representativeIdentityStyle: policy };
    const ok = resolveOfficialGenerationReferencePlan(base);
    assert.equal(ok.ok, true);
    if (ok.ok) assert.deepEqual([...ok.plan.references], [officialApprovedAssetReference(policy.url, policy.sha256)]);
    const conflict = resolveOfficialGenerationReferencePlan({ ...base, samePersonIdentityStyleUrl: "/uploads/other.webp" });
    assert.equal(conflict.ok ? "" : conflict.code, "role_conflict");
    const representative = resolveOfficialGenerationReferencePlan({ ...base, kind: "representative" });
    assert.equal(representative.ok ? "" : representative.code, "role_conflict");
    const stale = resolveOfficialGenerationReferencePlan({ ...base, representativeUrl: "/uploads/old-rep.webp" });
    assert.equal(stale.ok ? "" : stale.code, "reference_policy_stale");
    const docsPath = resolveOfficialGenerationReferencePlan({
      ...base,
      representativeUrl: "docs/official-supply/reviews/assets/rep.webp",
      representativeIdentityStyle: { ...policy, url: "docs/official-supply/reviews/assets/rep.webp" },
    });
    assert.equal(docsPath.ok ? "" : docsPath.code, "reference_policy_stale");
  });
});

describe("approved representative gates (isolated DB)", () => {
  it("2. unauthorized actor, published target, link mismatch and the default representative refusal stop before any file write", async () => {
    const before = draftState(GATES);
    const filesBefore = ports.storedFiles.length;
    const repBytes = candidateBytes(REP);

    await assert.rejects(() => register(GATES, "rep", repBytes, REP.tag, STRANGER), expectGate("replacement_forbidden"));

    const linked = store.getCharacter(GATES).stagedCharacterId;
    store.database
      .prepare("UPDATE official_supply_characters SET staged_character_id=? WHERE draft_key=?")
      .run(defaultPathCharacterId, GATES);
    await assert.rejects(() => register(GATES, "rep", repBytes, REP.tag), expectGate("staged_character_mismatch"));
    store.database
      .prepare("UPDATE official_supply_characters SET staged_character_id=? WHERE draft_key=?")
      .run(linked, GATES);

    assert.throws(() => store.createReplacementCandidate(ADMIN, GATES, "rep"), expectGate("replacement_representative_forbidden"));

    const publishedId = await stageDefaultPathDraft(PUBLISHED, "approved-apply-gate-batch");
    store.database
      .prepare("UPDATE characters SET official=1, visibility='public', moderation_status='approved' WHERE id=?")
      .run(publishedId);
    store.markPublished(PUBLISHED, publishedId);
    await assert.rejects(
      () => register(PUBLISHED, "rep", repBytes, "기본 초상"),
      expectGate("replacement_representative_forbidden")
    );

    assert.equal(ports.storedFiles.length, filesBefore);
    assert.deepEqual(draftState(GATES), before);
  });

  it("3. wrong size, missing or rejected review, changed candidate, stale QA and changed base block apply", async () => {
    const live = characterRow(store.getCharacter(GATES).stagedCharacterId!);
    const filesBefore = ports.storedFiles.length;
    const wrongSize = await sharp({ create: { width: 512, height: 512, channels: 3, background: "#222" } })
      .webp()
      .toBuffer();
    await assert.rejects(() => register(GATES, "rep", wrongSize, REP.tag), expectGate("asset_dimensions"));
    assert.equal(ports.storedFiles.length, filesBefore);

    const sig1 = CANDIDATES.find((c) => c.slot === "sig1")!;
    const sig1Url = (await register(GATES, "sig1", candidateBytes(sig1), sig1.tag)).candidateResultUrl!;
    assert.throws(() => review(GATES, sig1, sig1Url), expectGate("moderation_missing"));
    await moderate(GATES, "sig1", { status: "unavailable", reason: "test-fixture" });
    assert.throws(() => review(GATES, sig1, sig1Url), expectGate("moderation_unavailable"));
    assert.throws(
      () => applyApprovedOfficialAssetReplacements({ store, draftKey: GATES, actor: ADMIN, slotKeys: ["sig1"] }),
      expectGate("replacement_not_approved")
    );
    await moderate(GATES, "sig1", { ...TEST_ONLY_MODERATION, moderationReject: true });
    assert.equal(review(GATES, sig1, sig1Url).approved, false);
    assert.throws(
      () => applyApprovedOfficialAssetReplacements({ store, draftKey: GATES, actor: ADMIN, slotKeys: ["sig1"] }),
      expectGate("replacement_not_approved")
    );

    const firstRep = await register(GATES, "rep", candidateBytes(REP), REP.tag);
    await moderate(GATES, "rep");
    const otherPortrait = await sharp({ create: { width: 1024, height: 1536, channels: 3, background: "#333" } })
      .webp()
      .toBuffer();
    const changed = await register(GATES, "rep", otherPortrait, REP.tag);
    assert.notEqual(changed.candidateResultUrl, firstRep.candidateResultUrl);
    assert.equal(changed.moderation, null);
    await moderate(GATES, "rep");
    assert.throws(() => review(GATES, REP, firstRep.candidateResultUrl!), expectGate("replacement_review_stale"));
    assert.throws(() => review(GATES, REP, changed.candidateResultUrl!), expectGate("replacement_review_stale"));
    const changedFile = { candidateUrl: changed.candidateResultUrl!, candidateSha256: sha256(otherPortrait) };
    assert.equal(changed.candidateSha256, changedFile.candidateSha256);
    assert.equal(
      store.reviewRepresentativeReplacement(ADMIN, GATES, anchorQa({ face: { ok: false } }), changedFile, TEST_ONLY_REVIEWER)
        .approved,
      false
    );
    assert.equal(store.getReplacement(GATES, "rep").reviewedBy, null);

    const rep = await register(GATES, "rep", candidateBytes(REP), REP.tag);
    await moderate(GATES, "rep");
    assert.equal(review(GATES, REP, rep.candidateResultUrl!).approved, true);
    assert.throws(
      () => applyApprovedOfficialAssetReplacements({ store, draftKey: GATES, actor: ADMIN, slotKeys: ["rep"] }),
      expectGate("representative_apply_set_required")
    );
    assert.throws(
      () =>
        applyApprovedOfficialAssetReplacements({
          store,
          draftKey: GATES,
          actor: ADMIN,
          slotKeys: ["sig1"],
          representative: REPRESENTATIVE_SET,
        }),
      expectGate("representative_apply_set_unexpected")
    );
    assert.throws(
      () =>
        applyApprovedOfficialAssetReplacements({
          store,
          draftKey: GATES,
          actor: ADMIN,
          slotKeys: ["rep"],
          representative: REPRESENTATIVE_SET,
        }),
      expectGate("asset_plan_untargeted_change")
    );
    const repOnlyPlan: OfficialAssetPlan = {
      slots: store.getCharacter(GATES).assetPlan!.slots.map((slot) =>
        slot.kind === "representative" ? { ...slot, tag: "기본 초상" } : slot
      ),
    };
    const repOnly: OfficialRepresentativeApplySet = { ...REPRESENTATIVE_SET, nextAssetPlan: repOnlyPlan };
    const applyRep = () =>
      applyApprovedOfficialAssetReplacements({ store, draftKey: GATES, actor: ADMIN, slotKeys: ["rep"], representative: repOnly });

    const db = store.database;
    const tamper = (sql: string, ...args: unknown[]) => db.prepare(sql).run(...args, GATES);
    tamper("UPDATE official_supply_asset_replacements SET reviewed_text_lock_hash='stale' WHERE slot_key='rep' AND draft_key=?");
    assert.throws(applyRep, expectGate("representative_review_stale"));
    tamper(
      "UPDATE official_supply_asset_replacements SET reviewed_text_lock_hash=? WHERE slot_key='rep' AND draft_key=?",
      store.getCharacter(GATES).textLockHash
    );
    tamper(
      "UPDATE official_supply_asset_replacements SET qa_json=? WHERE slot_key='rep' AND draft_key=?",
      JSON.stringify({ ...anchorQa(), cardCrop: undefined })
    );
    assert.throws(applyRep, expectGate("representative_review_missing"));
    tamper("UPDATE official_supply_asset_replacements SET qa_json=? WHERE slot_key='rep' AND draft_key=?", JSON.stringify(anchorQa()));
    tamper("UPDATE official_supply_asset_replacements SET appearance_lock_hash='stale' WHERE slot_key='rep' AND draft_key=?");
    assert.throws(applyRep, expectGate("appearance_lock_stale"));
    tamper(
      "UPDATE official_supply_asset_replacements SET appearance_lock_hash=? WHERE slot_key='rep' AND draft_key=?",
      store.getCharacter(GATES).appearanceLockHash
    );
    const base = store.getReplacement(GATES, "rep").baseResultUrl;
    tamper("UPDATE official_supply_asset_replacements SET base_result_url='/uploads/other.webp' WHERE slot_key='rep' AND draft_key=?");
    assert.throws(applyRep, expectGate("replacement_base_stale"));
    tamper("UPDATE official_supply_asset_replacements SET base_result_url=? WHERE slot_key='rep' AND draft_key=?", base);
    assert.throws(
      () =>
        applyApprovedOfficialAssetReplacements({
          store,
          draftKey: GATES,
          actor: ADMIN,
          slotKeys: ["rep"],
          representative: {
            ...repOnly,
            nextAssetPlan: {
              slots: repOnlyPlan.slots.map((slot) => (slot.kind === "representative" ? { ...slot, tag: "다른 태그" } : slot)),
            },
          },
        }),
      expectGate("asset_plan_tag_mismatch")
    );

    assert.deepEqual(characterRow(store.getCharacter(GATES).stagedCharacterId!), live);
    assert.equal(store.getCharacter(GATES).generationReferencePolicy, null);

    const applied = applyRep();
    assert.equal(applied.status, "applied");
    assert.equal(parseAssets(characterRow(applied.characterId).assets)[0]!.tag, "기본 초상");
    assert.deepEqual(egressAttempts, []);
  });
});

describe("applied images carry no metadata of the replaced file (isolated DB)", () => {
  const MEDIA = "approved-apply-media";
  const OLD_REP_MEDIA_ID = "0b6f7f3e-5d1c-4c2a-9e8f-1a2b3c4d5e6f";
  const OLD_SIG1_MEDIA_ID = "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
  let mediaCharacterId = 0;
  let repUrl = "";
  let sig1Url = "";
  let repOnly: OfficialRepresentativeApplySet;

  const legacyBlurOf = (url: string) =>
    `/media/public/legacy-blur-${path.basename(url).replace(/\.[a-zA-Z0-9]+$/, "")}.webp`;

  function seedSlot(index: number, fields: Partial<CharacterAsset>): string {
    const assets = parseAssets(characterRow(mediaCharacterId).assets);
    const { mediaId: _m, publicRenditionUrl: _p, blurPreviewUrl: _b, moderationStatus: _s, nippleExposure: _n, ...base } =
      assets[index]!;
    assets[index] = { ...base, ...fields };
    const json = JSON.stringify(assets);
    store.database.prepare("UPDATE characters SET assets=? WHERE id=?").run(json, mediaCharacterId);
    return characterRow(mediaCharacterId).assets;
  }

  function strangerView(assets: CharacterAsset[]) {
    return projectAssetsForViewer(assets, { canSeeOriginals: false, nsfw: false, viewer: STRANGER });
  }

  function assertRepresentativeIsNewFile() {
    const row = characterRow(mediaCharacterId);
    const assets = parseAssets(row.assets);
    const rep = assets[0]!;
    assert.equal(rep.url, repUrl);
    assert.equal(rep.representativeRank, 1);
    assert.equal(rep.viewerBlur, false);
    for (const field of ["mediaId", "publicRenditionUrl", "blurPreviewUrl", "moderationStatus", "nippleExposure"] as const) {
      assert.equal(rep[field], undefined, `representative kept the replaced file's ${field}`);
    }
    assert.equal(rep.adultFlagged, false);
    assert.deepEqual(JSON.parse(row.images), [repUrl]);
    assert.equal(getCharacterRepresentativeImageUrl(row.assets, row.images), repUrl);
    assert.deepEqual(getCharacterRepresentativePublicUrls(row.assets, row.images), [repUrl]);
    assert.equal(getDefaultChatAsset(assets)?.url, repUrl);
    assert.equal(strangerView(assets)[0]!.url, repUrl);
    assert.equal(safeLockedPreviewUrl(rep), legacyBlurOf(repUrl));
  }

  function applyRepresentative() {
    return applyApprovedOfficialAssetReplacements({
      store,
      draftKey: MEDIA,
      actor: ADMIN,
      slotKeys: ["rep"],
      representative: repOnly,
    });
  }

  before(async () => {
    store.createBatch("approved-apply-media-batch", testBatchConfig({ budgetUsd: { batch: 100 } }));
    mediaCharacterId = await stageApprovedWolfgangDraft(MEDIA, "approved-apply-media-batch");
    repOnly = {
      ...REPRESENTATIVE_SET,
      nextAssetPlan: {
        slots: store.getCharacter(MEDIA).assetPlan!.slots.map((slot) =>
          slot.kind === "representative" ? { ...slot, tag: "기본 초상" } : slot
        ),
      },
    };
    const rep = await register(MEDIA, "rep", candidateBytes(REP), "기본 초상");
    await moderate(MEDIA, "rep");
    assert.equal(review(MEDIA, REP, rep.candidateResultUrl!).approved, true);
    repUrl = rep.candidateResultUrl!;
    const sig1 = CANDIDATES.find((c) => c.slot === "sig1")!;
    const sig1Registered = await register(MEDIA, "sig1", candidateBytes(sig1), sig1.tag);
    await moderate(MEDIA, "sig1");
    assert.equal(review(MEDIA, sig1, sig1Registered.candidateResultUrl!).approved, true);
    sig1Url = sig1Registered.candidateResultUrl!;
  });

  it("10a. old representative with mediaId: card, detail, chat and blur read the new file; rollback restores the old metadata", () => {
    const seeded = seedSlot(0, {
      mediaId: OLD_REP_MEDIA_ID,
      blurPreviewUrl: `/media/public/${OLD_REP_MEDIA_ID}-blur.webp`,
      moderationStatus: "checked",
      nippleExposure: "none",
    });
    assert.equal(
      getCharacterRepresentativeImageUrl(seeded, characterRow(mediaCharacterId).images),
      `/media/public/${OLD_REP_MEDIA_ID}-public.webp`
    );
    const applied = applyRepresentative();
    assert.equal(applied.status, "applied");
    assertRepresentativeIsNewFile();

    rollbackOfficialAssetReplacementApply({ store, draftKey: MEDIA, applyId: applied.applyId!, actor: ADMIN });
    assert.equal(characterRow(mediaCharacterId).assets, seeded);
    assert.equal(parseAssets(seeded)[0]!.mediaId, OLD_REP_MEDIA_ID);
  });

  it("10b. old representative with publicRenditionUrl: card, detail, chat and blur read the new file; rollback restores the old metadata", () => {
    const seeded = seedSlot(0, {
      publicRenditionUrl: "/media/public/old-representative-public.webp",
      blurPreviewUrl: "/media/public/old-representative-blur.webp",
    });
    assert.equal(
      getCharacterRepresentativeImageUrl(seeded, characterRow(mediaCharacterId).images),
      "/media/public/old-representative-public.webp"
    );
    const applied = applyRepresentative();
    assert.equal(applied.status, "applied");
    assertRepresentativeIsNewFile();

    rollbackOfficialAssetReplacementApply({ store, draftKey: MEDIA, applyId: applied.applyId!, actor: ADMIN });
    assert.equal(characterRow(mediaCharacterId).assets, seeded);
    assert.equal(parseAssets(seeded)[0]!.publicRenditionUrl, "/media/public/old-representative-public.webp");
  });

  it("10c. a blurred RP slot keeps the user's blur and previews the new file; rollback restores the old metadata", async () => {
    const index = parseAssets(characterRow(mediaCharacterId).assets).findIndex(
      (asset) => asset.url === store.getAsset(MEDIA, "sig1").resultUrl
    );
    const seeded = seedSlot(index, {
      viewerBlur: true,
      mediaId: OLD_SIG1_MEDIA_ID,
      blurPreviewUrl: `/media/public/${OLD_SIG1_MEDIA_ID}-blur.webp`,
      moderationStatus: "pending",
      nippleExposure: "uncertain",
    });
    const others = parseAssets(seeded).filter((_, i) => i !== index);

    const applied = applyApprovedOfficialAssetReplacements({ store, draftKey: MEDIA, actor: ADMIN, slotKeys: ["sig1"] });
    assert.equal(applied.status, "applied");
    const assets = parseAssets(characterRow(mediaCharacterId).assets);
    const sig1 = assets[index]!;
    assert.equal(sig1.url, sig1Url);
    assert.equal(sig1.viewerBlur, true);
    for (const field of ["mediaId", "publicRenditionUrl", "blurPreviewUrl", "moderationStatus", "nippleExposure"] as const) {
      assert.equal(sig1[field], undefined, `RP slot kept the replaced file's ${field}`);
    }
    assert.equal(sig1.adultFlagged, false);
    assert.deepEqual(
      assets.filter((_, i) => i !== index),
      others
    );
    assert.equal(assetModerationSummary(assets).adultFlagged, false);

    const preview = strangerView(assets)[index]!;
    assert.equal(preview.viewerBlur, true);
    assert.equal(preview.url, legacyBlurOf(sig1Url));
    assert.equal(safeLockedPreviewUrl(sig1), legacyBlurOf(sig1Url));
    const response = await getPublicMedia(new Request(`http://local${preview.url}`), {
      params: Promise.resolve({ filename: path.basename(preview.url) }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/webp");
    const blurred = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    assert.equal(blurred.format, "webp");

    rollbackOfficialAssetReplacementApply({ store, draftKey: MEDIA, applyId: applied.applyId!, actor: ADMIN });
    assert.equal(characterRow(mediaCharacterId).assets, seeded);
    assert.deepEqual(egressAttempts, []);
  });
});
