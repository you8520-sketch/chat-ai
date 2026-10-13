import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import { getDb } from "@/lib/db";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import {
  buildCanonPlanJsonForSave,
  buildCompiledCreatorDescriptionForSave,
  type SessionUser,
} from "@/lib/characterFormSave";
import { buildAndSaveCharacterChunks, loadCharacterChunks } from "@/lib/characterChunks";
import { hashAppearanceRaw } from "@/lib/appearanceCompiler";
import { parseCanonPlanV1 } from "@/lib/canonPlan/serialize";
import {
  insertCreatorLorebookForOwner,
  listCharacterCreatorLorebookAttachmentIds,
  replaceCharacterCreatorLorebookAttachments,
} from "@/lib/creatorLorebook";
import { createSiteManagedStudioAccount } from "@/lib/siteManagedAccounts";
import {
  classifyStoredAppearanceAgainstApprovedLock,
  computeAppearanceLockHash,
  renderAppearanceBlock,
} from "@/lib/officialSupply/appearance";
import { computeTextLockHash } from "@/lib/officialSupply/characterText";
import { loadCompiledOfficialCharacterSource } from "@/lib/officialSupply/compiledOfficialSource";
import {
  OFFICIAL_IN_PLACE_APPLY_ENV,
  syncOfficialCharacterInPlace,
} from "@/lib/officialSupply/inPlaceSync";
import { WOLFGANG_IN_PLACE_TARGET } from "@/lib/officialSupply/inPlaceWolfgang";
import {
  OFFICIAL_OWNER_TRANSFER_ENV,
  transferOfficialCharacterOwnerToAdmin,
} from "@/lib/officialSupply/ownerTransfer";
import { OfficialSupplyGateError, OfficialSupplyStore } from "@/lib/officialSupply/store";
import type { OfficialCharacterDraft } from "@/lib/officialSupply/types";

const ADMIN: SessionUser = {
  id: 0,
  nickname: "운영관리자",
  is_adult: 1,
  email: "admin@test.local",
  is_admin: 1,
};

const SUPPLY_KEY = WOLFGANG_IN_PLACE_TARGET.supplyDraftKey;
const SOURCE_KEY = WOLFGANG_IN_PLACE_TARGET.sourceDraftKey;
const FIXTURE_DIR = path.join(process.cwd(), "src/lib/officialSupply/pilot/fixtures");
const PILOT_SOURCE_DIR = path.join(process.cwd(), "src/lib/officialSupply/pilot");
const APPROVED_SOURCE_FIXTURE = path.join(FIXTURE_DIR, "pilot-rf-02-approved-c91ba66a.source.json");
const BEFORE_RP = path.join(process.cwd(), "docs/official-supply/reviews/pilot-rf-02-before-rp.txt");

function previousLockDraft(): OfficialCharacterDraft {
  return (
    JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, "pilot-rf-02-approved-text-lock-draft.json"), "utf8")) as {
      draft: OfficialCharacterDraft;
    }
  ).draft;
}

function firstSentence(text: string): string {
  return text.split(/(?<=[.!?。])\s+/)[0] ?? text;
}

/**
 * The pinned approved Text Lock (c91ba66a…) belongs to the manuscript approved before the
 * shared-world migration. The live `pilot-rf-02` source has moved on and needs a new approved
 * Text Lock, so the sync mechanics are exercised against the frozen approved source.
 */
function installFrozenApprovedPilotDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wolfgang-approved-pilot-"));
  fs.cpSync(PILOT_SOURCE_DIR, dir, { recursive: true, filter: (src) => !src.includes(`${path.sep}fixtures`) });
  fs.copyFileSync(APPROVED_SOURCE_FIXTURE, path.join(dir, "characters", `${SOURCE_KEY}.json`));
  process.env.OFFICIAL_SUPPLY_PILOT_DIR = dir;
  return dir;
}

describe("Wolfgang #51 approved manuscript in-place sync", () => {
  let frozenPilotDir = "";
  before(() => {
    frozenPilotDir = installFrozenApprovedPilotDir();
    installIsolatedTestDatabase();
  });
  after(() => {
    uninstallIsolatedTestDatabase();
    delete process.env.OFFICIAL_SUPPLY_PILOT_DIR;
    fs.rmSync(frozenPilotDir, { recursive: true, force: true });
  });
  beforeEach(() => {
    const db = getDb();
    new OfficialSupplyStore(db);
    db.exec(`
      DROP TRIGGER IF EXISTS test_block_supply_update;
      DELETE FROM derived_cache_jobs;
      DELETE FROM character_lorebook_attachments;
      DELETE FROM keyword_lorebooks;
      DELETE FROM user_notifications;
      DELETE FROM official_supply_world_lorebooks;
      DELETE FROM official_supply_assets;
      DELETE FROM official_supply_characters;
      DELETE FROM official_supply_batches;
      DELETE FROM characters;
      DELETE FROM users WHERE email LIKE '%@site-managed.invalid' OR email LIKE '%@test.local';
    `);
  });

  const source = () => loadCompiledOfficialCharacterSource(SOURCE_KEY);

  function removedSecrets(): string[] {
    const next = new Set(source().draft.secrets);
    return previousLockDraft().secrets.filter((secret) => !next.has(secret));
  }

  function insertAdmin(): number {
    const info = getDb()
      .prepare(
        `INSERT INTO users (email, nickname, pw_hash, points, is_adult, is_admin, site_managed)
         VALUES (?, ?, 'x', 0, 1, 1, 0)`
      )
      .run(ADMIN.email!, ADMIN.nickname);
    return Number(info.lastInsertRowid);
  }

  function wolfgangAssets() {
    return Array.from({ length: 14 }, (_, index) => ({
      url: `/uploads/official-${SUPPLY_KEY}__${index === 0 ? "rep-a1" : `scene-${String(index).padStart(2, "0")}`}.webp`,
      tag: index === 0 ? "흑철 늑대공" : `장면${index}`,
      width: 1024,
      height: 1536,
      representativeRank: index === 0 ? 1 : undefined,
      viewerBlur: index === 5,
      adultFlagged: index === 3,
    }));
  }

  type Seed = {
    characterId: number;
    ownerId: number;
    siblingId: number;
    lorebookIds: number[];
    oldSystemPrompt: string;
  };

  function seedProductionShapedWolfgang(opts?: { appearanceRaw?: string }): Seed {
    const db = getDb();
    const src = source();
    const old = previousLockDraft();
    const studio = createSiteManagedStudioAccount({
      nickname: "로맨스 공식 스튜디오",
      email: "wolfgang-owner@site-managed.invalid",
    });
    const oldSystemPrompt = fs.readFileSync(BEFORE_RP, "utf8").trimEnd();
    const fullLock = opts?.appearanceRaw ?? renderAppearanceBlock(src.appearanceLock);
    const assets = wolfgangAssets();
    const info = db
      .prepare(
        `INSERT INTO characters
          (name, tagline, description, greeting, system_prompt, world, genre, genres, tags, nsfw, official,
           emoji, hue, creator_id, creator_name, visibility, moderation_status, assets, images,
           status_widget_json, jsx_components_json, recommended_writing_style,
           narration_style_instructions, comments_enabled, appearance_raw, appearance_compiled,
           likes, chats_count, example_dialog, creator_comment)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        old.name,
        old.tagline,
        old.description,
        old.greeting,
        oldSystemPrompt,
        old.sections.worldAndSituation,
        "로맨스 판타지",
        '["로맨스 판타지"]',
        '["북부대공"]',
        1,
        0,
        "🐺",
        210,
        studio.id,
        "로맨스 공식계정",
        "private",
        "approved",
        JSON.stringify(assets),
        JSON.stringify([assets[0]!.url]),
        "",
        "",
        "",
        "",
        1,
        fullLock,
        "",
        0,
        0,
        "구버전 예시대사",
        "구버전 제작자 코멘트"
      );
    const characterId = Number(info.lastInsertRowid);
    db.prepare(
      `UPDATE characters
       SET appearance_compiled=?, appearance_compiled_source_hash=?, appearance_compiled_version=?
       WHERE id=?`
    ).run(
      JSON.stringify({
        body: "188cm, 넓은 어깨와 단단한 허리, 창백한 피부",
        hair: "짙은 흑회색 울프컷",
        eyes: "회청색",
        face: "각진 턱선",
        lips_makeup: "",
        clothing: "흑철 갑옷",
        impression: "냉정한 위엄",
        compiled_text: fullLock,
      }),
      hashAppearanceRaw(fullLock),
      1,
      characterId
    );
    const compiled = buildCompiledCreatorDescriptionForSave({
      description: old.description,
      world: old.sections.worldAndSituation,
      systemPrompt: oldSystemPrompt,
      statusWidgetJson: "",
      statusWidgetTriggers: [],
    });
    const plan = buildCanonPlanJsonForSave({
      description: old.description,
      world: old.sections.worldAndSituation,
      systemPrompt: oldSystemPrompt,
    });
    db.prepare(
      `UPDATE characters SET creator_raw_description=?, creator_compiled_description_json=?, creator_canon_plan_json=?
       WHERE id=?`
    ).run(compiled.creatorRawDescription, compiled.compiledDescriptionJson, plan.planJson, characterId);
    buildAndSaveCharacterChunks(characterId, {
      name: old.name,
      gender: "male",
      systemPrompt: oldSystemPrompt,
      world: old.sections.worldAndSituation,
      exampleDialog: "구버전 예시대사",
      speechInput: {
        speech_personality: old.speech.personality,
        speech_traits: old.speech.traits,
        speech_examples: old.speech.examples,
        speech_forbidden: old.speech.forbidden,
      },
      safeRuntimeCanon: compiled.safeRuntimeCanon,
    });

    const lorebookIds: number[] = [];
    for (const entry of src.resolvedLorebook) {
      const created = insertCreatorLorebookForOwner(db, {
        creatorId: studio.id,
        name: entry.name,
        summary: "",
        keywords: entry.keywords,
        content: entry.content,
      });
      assert.equal(created.ok, true);
      if (!created.ok) continue;
      db.prepare(
        `INSERT INTO official_supply_world_lorebooks (world_key, entry_key, creator_id, lorebook_id)
         VALUES (?, ?, ?, ?)`
      ).run(src.worldKey, entry.entryKey, studio.id, created.id);
      lorebookIds.push(created.id);
    }
    replaceCharacterCreatorLorebookAttachments(db, characterId, lorebookIds);

    const sibling = db
      .prepare(
        `INSERT INTO characters
          (name, tagline, description, greeting, system_prompt, world, genre, genres, tags, nsfw, official,
           emoji, hue, creator_id, creator_name, visibility, moderation_status, assets)
         VALUES ('루시안 바스케스','한줄','설명','인사','시스템','세계','로맨스 판타지','["로맨스 판타지"]','[]',0,1,'✨',260,?,'로맨스 공식계정','public','approved','[]')`
      )
      .run(studio.id);
    const siblingId = Number(sibling.lastInsertRowid);
    replaceCharacterCreatorLorebookAttachments(db, siblingId, lorebookIds);

    db.prepare(
      `INSERT INTO official_supply_characters
        (draft_key, batch_key, world_key, style_key, stage, draft_json, text_lock_hash,
         appearance_json, appearance_lock_hash, asset_plan_json, is_style_proof,
         anchor_approved_by, staging_claim, staged_character_id)
       VALUES (?, 'pilot-romance-fantasy-04-cluster-b', ?, 'romance_fantasy_v4', 'staged_private', ?, ?, ?, ?, '{"slots":[]}', 1,
               'gpt-visual-review', 'claim-1', ?)`
    ).run(
      SUPPLY_KEY,
      src.worldKey,
      JSON.stringify(old),
      computeTextLockHash(old),
      JSON.stringify(src.appearanceLock),
      computeAppearanceLockHash(src.appearanceLock),
      characterId
    );
    for (const slot of ["rep", "sig1", "sig2"]) {
      db.prepare(
        `INSERT INTO official_supply_assets
          (draft_key, slot_key, kind, status, attempts, result_url, appearance_lock_hash)
         VALUES (?, ?, ?, 'approved', 1, ?, ?)`
      ).run(
        SUPPLY_KEY,
        slot,
        slot === "rep" ? "representative" : "signature",
        `/uploads/official-${SUPPLY_KEY}__${slot}-a1.webp`,
        computeAppearanceLockHash(src.appearanceLock)
      );
    }
    return { characterId, ownerId: studio.id, siblingId, lorebookIds, oldSystemPrompt };
  }

  function characterRow(id: number) {
    return getDb().prepare("SELECT * FROM characters WHERE id=?").get(id) as Record<string, unknown>;
  }

  function rowWithout(row: Record<string, unknown>, omit: readonly string[]): Record<string, unknown> {
    const copy = { ...row };
    for (const key of omit) delete copy[key];
    return copy;
  }

  const SYNC_WRITTEN_COLUMNS = [
    "tagline",
    "description",
    "greeting",
    "system_prompt",
    "world",
    "creator_comment",
    "example_dialog",
    "tags",
    "genre",
    "genres",
    "creator_name",
    "creator_raw_description",
    "creator_compiled_description_json",
    "creator_canon_plan_json",
    "setting_chunks",
    "setting_chunks_en",
    "prompt_translation_hash",
    "updated_at",
  ] as const;

  function supplyRow() {
    return getDb()
      .prepare("SELECT * FROM official_supply_characters WHERE draft_key=?")
      .get(SUPPLY_KEY) as Record<string, unknown>;
  }

  function assetRows() {
    return getDb().prepare("SELECT * FROM official_supply_assets ORDER BY id").all();
  }

  function lorebookRows() {
    return getDb().prepare("SELECT * FROM keyword_lorebooks ORDER BY id").all();
  }

  function derivedJobCount(characterId: number): number {
    return (
      getDb()
        .prepare("SELECT COUNT(*) AS n FROM derived_cache_jobs WHERE entity_type='character' AND entity_id=?")
        .get(characterId) as { n: number }
    ).n;
  }

  async function withApplyEnabled<T>(fn: () => Promise<T>): Promise<T> {
    const previous = process.env[OFFICIAL_IN_PLACE_APPLY_ENV];
    process.env[OFFICIAL_IN_PLACE_APPLY_ENV] = "1";
    try {
      return await fn();
    } finally {
      if (previous == null) delete process.env[OFFICIAL_IN_PLACE_APPLY_ENV];
      else process.env[OFFICIAL_IN_PLACE_APPLY_ENV] = previous;
    }
  }

  async function dryRun(characterId: number, adminId: number, draftKey = SUPPLY_KEY) {
    return syncOfficialCharacterInPlace({
      admin: { ...ADMIN, id: adminId },
      characterId,
      draftKey,
      mode: "dry_run",
    });
  }

  async function apply(characterId: number, adminId: number, draftKey = SUPPLY_KEY) {
    const preview = await dryRun(characterId, adminId, draftKey);
    return withApplyEnabled(() =>
      syncOfficialCharacterInPlace({
        admin: { ...ADMIN, id: adminId },
        characterId,
        draftKey,
        mode: "apply",
        preflightSnapshot: preview.preflightSnapshot,
      })
    );
  }

  async function assertGateCode(promise: Promise<unknown>, code: string): Promise<void> {
    await assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof OfficialSupplyGateError, `expected OfficialSupplyGateError, got ${String(error)}`);
      assert.equal(error.code, code);
      return true;
    });
  }

  it("fixture matches the production pre-change state (previous Text Lock, full-lock appearance)", () => {
    const src = source();
    const old = previousLockDraft();
    assert.equal(computeTextLockHash(old), WOLFGANG_IN_PLACE_TARGET.previousTextLockHash);
    assert.equal(computeTextLockHash(src.draft), WOLFGANG_IN_PLACE_TARGET.approvedTextLockHash);
    assert.equal(computeAppearanceLockHash(src.appearanceLock), WOLFGANG_IN_PLACE_TARGET.appearanceLockHash);
    assert.equal(
      classifyStoredAppearanceAgainstApprovedLock(
        renderAppearanceBlock(src.appearanceLock),
        src.appearanceLock,
        src.appearanceBlock
      ),
      "identity_same_full_lock"
    );
    assert.equal(old.secrets.length, 8);
    assert.equal(src.draft.secrets.length, 2);
    assert.equal(removedSecrets().length, 6);
    assert.equal(src.systemPrompt.length, 5445);
  });

  it("dry-run reports the old to approved transition without writing", async () => {
    const seed = seedProductionShapedWolfgang();
    const adminId = insertAdmin();
    const beforeCharacter = characterRow(seed.characterId);
    const beforeSupply = supplyRow();

    const preview = await dryRun(seed.characterId, adminId);

    assert.equal(preview.mode, "dry_run");
    assert.equal(preview.applied, false);
    assert.equal(preview.draftKey, SOURCE_KEY);
    assert.equal(preview.sameCharacterId, true);
    assert.equal(preview.createdNewCharacter, false);
    assert.equal(preview.notifiedFollowers, false);
    assert.deepEqual(preview.changedFields, ["system_prompt", "supply_text_lock"]);
    assert.equal(preview.preflightSnapshot.supplyDraftKey, SUPPLY_KEY);
    assert.equal(preview.preflightSnapshot.supplyTextLockHash, WOLFGANG_IN_PLACE_TARGET.previousTextLockHash);
    assert.equal(preview.preflightSnapshot.targetTextLockHash, WOLFGANG_IN_PLACE_TARGET.approvedTextLockHash);
    assert.deepEqual(
      preview.lorebookPlan.map((item) => item.action),
      Array(8).fill("skip_identical")
    );
    assert.deepEqual(characterRow(seed.characterId), beforeCharacter);
    assert.deepEqual(supplyRow(), beforeSupply);
    assert.equal(derivedJobCount(seed.characterId), 0);
  });

  it("both the supply key and the source key resolve to the same preflight", async () => {
    const seed = seedProductionShapedWolfgang();
    const adminId = insertAdmin();
    const bySupplyKey = await dryRun(seed.characterId, adminId, SUPPLY_KEY);
    const bySourceKey = await dryRun(seed.characterId, adminId, SOURCE_KEY);
    assert.equal(bySupplyKey.preflightSnapshot.token, bySourceKey.preflightSnapshot.token);
    assert.equal(bySupplyKey.draftKey, SOURCE_KEY);
  });

  it("apply moves manuscript, draft_json and Text Lock together and preserves everything else", async () => {
    const seed = seedProductionShapedWolfgang();
    const adminId = insertAdmin();
    const src = source();
    const before = characterRow(seed.characterId);
    const siblingBefore = characterRow(seed.siblingId);
    const beforeAssetRows = assetRows();
    const beforeLorebooks = lorebookRows();
    const beforeSupply = supplyRow();
    const beforeCharacterCount = (getDb().prepare("SELECT COUNT(*) AS n FROM characters").get() as { n: number }).n;

    const result = await apply(seed.characterId, adminId);
    assert.equal(result.applied, true);
    assert.equal(result.sameCharacterId, true);
    assert.equal(result.createdNewCharacter, false);
    assert.equal(result.notifiedFollowers, false);

    const after = characterRow(seed.characterId);
    assert.equal(after.system_prompt, src.systemPrompt);
    assert.equal((after.system_prompt as string).length, 5445);
    assert.notEqual(after.system_prompt, seed.oldSystemPrompt);

    const supply = supplyRow();
    assert.equal(supply.text_lock_hash, WOLFGANG_IN_PLACE_TARGET.approvedTextLockHash);
    const storedDraft = JSON.parse(supply.draft_json as string) as OfficialCharacterDraft;
    assert.equal(computeTextLockHash(storedDraft), supply.text_lock_hash);
    assert.equal(storedDraft.draftKey, SUPPLY_KEY);
    assert.equal(storedDraft.styleKey, "romance_fantasy_v4");
    assert.deepEqual(storedDraft.secrets, src.draft.secrets);
    assert.equal(supply.stage, "staged_private");
    assert.equal(supply.staged_character_id, seed.characterId);
    for (const key of [
      "batch_key",
      "world_key",
      "style_key",
      "appearance_json",
      "appearance_lock_hash",
      "asset_plan_json",
      "is_style_proof",
      "anchor_approved_by",
      "staging_claim",
    ]) {
      assert.equal(supply[key], beforeSupply[key], key);
    }

    assert.deepEqual(
      rowWithout(after, SYNC_WRITTEN_COLUMNS),
      rowWithout(before, SYNC_WRITTEN_COLUMNS),
      "only manuscript-owned columns may change"
    );
    assert.equal(after.id, seed.characterId);
    assert.equal(after.official, 0);
    assert.equal(after.visibility, "private");
    assert.equal(after.assets, before.assets);
    assert.equal(after.images, before.images);
    assert.equal(after.appearance_raw, before.appearance_raw);
    assert.equal(after.appearance_compiled, before.appearance_compiled);
    assert.equal(after.appearance_compiled_source_hash, before.appearance_compiled_source_hash);
    assert.equal(after.appearance_compiled_version, before.appearance_compiled_version);
    assert.equal(JSON.parse(after.assets as string).length, 14);

    assert.deepEqual(assetRows(), beforeAssetRows);
    assert.deepEqual(lorebookRows(), beforeLorebooks);
    assert.deepEqual(listCharacterCreatorLorebookAttachmentIds(getDb(), seed.characterId), seed.lorebookIds);
    assert.equal(listCharacterCreatorLorebookAttachmentIds(getDb(), seed.characterId).length, 8);

    assert.deepEqual(characterRow(seed.siblingId), siblingBefore);
    assert.deepEqual(listCharacterCreatorLorebookAttachmentIds(getDb(), seed.siblingId), seed.lorebookIds);
    assert.equal(
      (getDb().prepare("SELECT COUNT(*) AS n FROM characters").get() as { n: number }).n,
      beforeCharacterCount
    );
    assert.equal(
      (getDb().prepare("SELECT COUNT(*) AS n FROM user_notifications").get() as { n: number }).n,
      0
    );
    assert.equal(derivedJobCount(seed.characterId), 1);
    assert.equal(derivedJobCount(seed.siblingId), 0);
  });

  it("keeps the 2 approved secrets and no removed secret in prompt, canon and chunks", async () => {
    const seed = seedProductionShapedWolfgang();
    const adminId = insertAdmin();
    const src = source();
    const removed = removedSecrets();
    assert.ok(
      removed.every((secret) => seed.oldSystemPrompt.includes(secret)),
      "the old production prompt carries every removed secret"
    );

    await apply(seed.characterId, adminId);

    const row = characterRow(seed.characterId) as {
      system_prompt: string;
      creator_compiled_description_json: string;
      creator_canon_plan_json: string;
      setting_chunks: string;
      setting_chunks_en: string;
      prompt_translation_hash: string;
      gender: string | null;
      name: string;
      example_dialog: string;
      appearance_raw: string;
      appearance_compiled: string;
      appearance_compiled_source_hash: string | null;
      appearance_compiled_version: number | null;
      content_kind: string | null;
    };
    const persistedChunks = loadCharacterChunks(row)
      .map((chunk) => chunk.content)
      .join("\n");
    const plan = parseCanonPlanV1(row.creator_canon_plan_json);
    assert.ok(plan);
    const lockedSecretCanon = plan.chunks
      .filter((chunk) => chunk.visibility === "LOCKED_SECRET")
      .map((chunk) => chunk.text)
      .join("\n");
    assert.ok(lockedSecretCanon.length > 0);
    const surfaces = {
      system_prompt: row.system_prompt,
      compiled: row.creator_compiled_description_json,
      plan: row.creator_canon_plan_json,
      chunks: row.setting_chunks,
      persistedChunks,
    };
    for (const secret of src.draft.secrets) {
      assert.ok(row.system_prompt.includes(secret));
      assert.ok(
        lockedSecretCanon.includes(firstSentence(secret)),
        "approved secret must stay LOCKED_SECRET canon"
      );
    }
    for (const [surface, text] of Object.entries(surfaces)) {
      for (const secret of removed) {
        assert.ok(!text.includes(secret), `${surface} still contains a removed secret`);
        assert.ok(!text.includes(secret.slice(0, 24)), `${surface} still contains a removed secret prefix`);
        assert.ok(!text.includes(firstSentence(secret)), `${surface} still contains a removed secret sentence`);
      }
    }
    assert.ok(
      !row.setting_chunks_en.includes("독자적인 손실 장부") || row.prompt_translation_hash === "",
      "a stale English layer must not be addressable by the new Korean fingerprint"
    );
    for (const retiredName of ["카엘룸", "율리우스", "바스티안", "세라피나", "이노센트"]) {
      assert.ok(!row.system_prompt.includes(retiredName), `${retiredName} must not remain in the prompt`);
      assert.ok(!persistedChunks.includes(retiredName), `${retiredName} must not remain in chunks`);
    }
  });

  it("is idempotent: a second run finds nothing to change and adds no rows or jobs", async () => {
    const seed = seedProductionShapedWolfgang();
    const adminId = insertAdmin();
    await apply(seed.characterId, adminId);
    const afterFirst = characterRow(seed.characterId);
    const supplyFirst = supplyRow();
    const lorebooksFirst = lorebookRows();
    const jobsFirst = derivedJobCount(seed.characterId);

    const again = await dryRun(seed.characterId, adminId);
    assert.deepEqual(again.changedFields, []);
    assert.equal(again.preflightSnapshot.supplyTextLockHash, WOLFGANG_IN_PLACE_TARGET.approvedTextLockHash);

    await apply(seed.characterId, adminId);
    assert.deepEqual(
      rowWithout(characterRow(seed.characterId), ["updated_at"]),
      rowWithout(afterFirst, ["updated_at"])
    );
    assert.deepEqual(
      rowWithout(supplyRow(), ["updated_at"]),
      rowWithout(supplyFirst, ["updated_at"])
    );
    assert.deepEqual(lorebookRows(), lorebooksFirst);
    assert.equal(derivedJobCount(seed.characterId), jobsFirst);
    assert.equal((getDb().prepare("SELECT COUNT(*) AS n FROM characters").get() as { n: number }).n, 2);
    assert.equal(
      (getDb().prepare("SELECT COUNT(*) AS n FROM official_supply_characters").get() as { n: number }).n,
      1
    );
  });

  it("rolls back the character write when the supply write fails mid-transaction", async () => {
    const seed = seedProductionShapedWolfgang();
    const adminId = insertAdmin();
    const beforeCharacter = characterRow(seed.characterId);
    const beforeSupply = supplyRow();
    const beforeLorebooks = lorebookRows();
    const preview = await dryRun(seed.characterId, adminId);
    getDb().exec(`
      CREATE TRIGGER test_block_supply_update BEFORE UPDATE ON official_supply_characters
      BEGIN SELECT RAISE(ABORT, 'injected supply failure'); END;
    `);
    try {
      await withApplyEnabled(() =>
        assert.rejects(
          syncOfficialCharacterInPlace({
            admin: { ...ADMIN, id: adminId },
            characterId: seed.characterId,
            draftKey: SUPPLY_KEY,
            mode: "apply",
            preflightSnapshot: preview.preflightSnapshot,
          }),
          /injected supply failure/
        )
      );
    } finally {
      getDb().exec("DROP TRIGGER IF EXISTS test_block_supply_update");
    }
    assert.deepEqual(characterRow(seed.characterId), beforeCharacter);
    assert.deepEqual(supplyRow(), beforeSupply);
    assert.deepEqual(lorebookRows(), beforeLorebooks);
    assert.equal(derivedJobCount(seed.characterId), 0);
  });

  it("rolls back on an injected failure after the lorebook step", async () => {
    const seed = seedProductionShapedWolfgang();
    const adminId = insertAdmin();
    const beforeCharacter = characterRow(seed.characterId);
    const beforeSupply = supplyRow();
    const preview = await dryRun(seed.characterId, adminId);
    await withApplyEnabled(() =>
      assertGateCode(
        syncOfficialCharacterInPlace({
          admin: { ...ADMIN, id: adminId },
          characterId: seed.characterId,
          draftKey: SUPPLY_KEY,
          mode: "apply",
          preflightSnapshot: preview.preflightSnapshot,
          testInjectFailure: "after_lorebook_write",
        }),
        "test_injected_failure"
      )
    );
    assert.deepEqual(characterRow(seed.characterId), beforeCharacter);
    assert.deepEqual(supplyRow(), beforeSupply);
  });

  it("refuses apply when the supply draft changes after the dry-run preflight", async () => {
    const seed = seedProductionShapedWolfgang();
    const adminId = insertAdmin();
    const preview = await dryRun(seed.characterId, adminId);
    const drifted = previousLockDraft();
    drifted.secrets = [...drifted.secrets, "새로 끼어든 비밀"];
    getDb()
      .prepare("UPDATE official_supply_characters SET draft_json=?, text_lock_hash=? WHERE draft_key=?")
      .run(JSON.stringify(drifted), computeTextLockHash(drifted), SUPPLY_KEY);
    await withApplyEnabled(() =>
      assertGateCode(
        syncOfficialCharacterInPlace({
          admin: { ...ADMIN, id: adminId },
          characterId: seed.characterId,
          draftKey: SUPPLY_KEY,
          mode: "apply",
          preflightSnapshot: preview.preflightSnapshot,
        }),
        "supply_text_lock_mismatch"
      )
    );
    assert.equal(characterRow(seed.characterId).system_prompt, seed.oldSystemPrompt);
  });

  it("STOPs on supply link, stage and lock mismatches without writing", async () => {
    const seed = seedProductionShapedWolfgang();
    const adminId = insertAdmin();
    const db = getDb();
    const beforeCharacter = characterRow(seed.characterId);

    db.prepare("UPDATE official_supply_characters SET staged_character_id=? WHERE draft_key=?").run(
      seed.siblingId,
      SUPPLY_KEY
    );
    await assertGateCode(dryRun(seed.characterId, adminId), "supply_draft_mismatch");
    db.prepare("UPDATE official_supply_characters SET staged_character_id=? WHERE draft_key=?").run(
      seed.characterId,
      SUPPLY_KEY
    );

    db.prepare("UPDATE official_supply_characters SET stage='published' WHERE draft_key=?").run(SUPPLY_KEY);
    await assertGateCode(dryRun(seed.characterId, adminId), "supply_stage_required");
    db.prepare("UPDATE official_supply_characters SET stage='staged_private' WHERE draft_key=?").run(SUPPLY_KEY);

    db.prepare("UPDATE official_supply_characters SET text_lock_hash='deadbeef' WHERE draft_key=?").run(SUPPLY_KEY);
    await assertGateCode(dryRun(seed.characterId, adminId), "supply_text_lock_inconsistent");
    db.prepare("UPDATE official_supply_characters SET text_lock_hash=? WHERE draft_key=?").run(
      WOLFGANG_IN_PLACE_TARGET.previousTextLockHash,
      SUPPLY_KEY
    );

    db.prepare("UPDATE official_supply_characters SET appearance_lock_hash='stale' WHERE draft_key=?").run(SUPPLY_KEY);
    await assertGateCode(dryRun(seed.characterId, adminId), "appearance_lock_stale");
    db.prepare("UPDATE official_supply_characters SET appearance_lock_hash=? WHERE draft_key=?").run(
      WOLFGANG_IN_PLACE_TARGET.appearanceLockHash,
      SUPPLY_KEY
    );

    db.prepare("DELETE FROM official_supply_characters WHERE draft_key=?").run(SUPPLY_KEY);
    await assertGateCode(dryRun(seed.characterId, adminId), "supply_mapping_required");

    assert.deepEqual(characterRow(seed.characterId), beforeCharacter);
  });

  it("STOPs when the stored draft drifted outside the Text Lock fields", async () => {
    const seed = seedProductionShapedWolfgang();
    const adminId = insertAdmin();
    const drifted = { ...previousLockDraft(), audience: "male" as const };
    getDb()
      .prepare("UPDATE official_supply_characters SET draft_json=? WHERE draft_key=?")
      .run(JSON.stringify(drifted), SUPPLY_KEY);
    await assertGateCode(dryRun(seed.characterId, adminId), "supply_draft_identity_drift");
  });

  it("STOPs on a character that is not Wolfgang", async () => {
    const seed = seedProductionShapedWolfgang();
    const adminId = insertAdmin();
    getDb().prepare("UPDATE characters SET name='다른 인물' WHERE id=?").run(seed.characterId);
    await assertGateCode(dryRun(seed.characterId, adminId), "character_identity_mismatch");
  });

  it("STOPs when the stored appearance contradicts the Appearance Lock", async () => {
    const seed = seedProductionShapedWolfgang({
      appearanceRaw: "키/체형: 160cm, 왜소한 체격\n머리: 금발\n눈: 푸른 눈\n식별 특징: 얼굴 화상",
    });
    const adminId = insertAdmin();
    const before = characterRow(seed.characterId);
    await assertGateCode(dryRun(seed.characterId, adminId), "appearance_conflict");
    assert.deepEqual(characterRow(seed.characterId), before);
  });

  it("keeps the stored full-lock appearance and the approved images untouched across sync", async () => {
    const seed = seedProductionShapedWolfgang();
    const adminId = insertAdmin();
    const before = characterRow(seed.characterId);
    const preview = await dryRun(seed.characterId, adminId);
    assert.ok(!preview.changedFields.includes("appearance"));
    await apply(seed.characterId, adminId);
    const after = characterRow(seed.characterId);
    for (const column of [
      "appearance_raw",
      "appearance_compiled",
      "appearance_compiled_source_hash",
      "appearance_compiled_version",
      "assets",
      "images",
    ]) {
      assert.equal(after[column], before[column], column);
    }
  });
  describe("after the admin owner transfer (#1589)", () => {
    function transferToAdmin(characterId: number, adminId: number) {
      const admin = { id: adminId, email: ADMIN.email!, is_admin: 1 };
      const preview = transferOfficialCharacterOwnerToAdmin({ admin, characterId, mode: "dry_run" });
      process.env[OFFICIAL_OWNER_TRANSFER_ENV] = "1";
      try {
        return transferOfficialCharacterOwnerToAdmin({
          admin,
          characterId,
          mode: "apply",
          preflightSnapshot: preview.preflightSnapshot,
        });
      } finally {
        delete process.env[OFFICIAL_OWNER_TRANSFER_ENV];
      }
    }

    it("dry-run reports the same manuscript transition and apply reuses the studio lorebooks without duplicates", async () => {
      const seed = seedProductionShapedWolfgang();
      const adminId = insertAdmin();
      const beforeTransfer = await dryRun(seed.characterId, adminId);
      transferToAdmin(seed.characterId, adminId);
      assert.equal(characterRow(seed.characterId).creator_id, adminId);

      const preview = await dryRun(seed.characterId, adminId);
      assert.deepEqual(preview.changedFields, beforeTransfer.changedFields);
      assert.deepEqual(
        preview.lorebookPlan.map((item) => item.action),
        Array(8).fill("skip_identical")
      );
      const lorebooksBefore = lorebookRows();
      const worldLorebooksBefore = JSON.stringify(
        getDb().prepare("SELECT * FROM official_supply_world_lorebooks ORDER BY world_key, entry_key").all()
      );
      const siblingBefore = characterRow(seed.siblingId);

      const result = await apply(seed.characterId, adminId);
      assert.equal(result.applied, true);
      const after = characterRow(seed.characterId);
      assert.equal(after.creator_id, adminId, "owner stays the admin");
      assert.equal(after.system_prompt, source().systemPrompt);
      assert.equal(after.official, 0);
      assert.equal(after.visibility, "private");
      assert.equal(supplyRow().text_lock_hash, WOLFGANG_IN_PLACE_TARGET.approvedTextLockHash);
      assert.deepEqual(lorebookRows(), lorebooksBefore, "no lorebook rows created or edited");
      assert.equal(
        JSON.stringify(getDb().prepare("SELECT * FROM official_supply_world_lorebooks ORDER BY world_key, entry_key").all()),
        worldLorebooksBefore
      );
      assert.deepEqual(listCharacterCreatorLorebookAttachmentIds(getDb(), seed.characterId), seed.lorebookIds);
      assert.deepEqual(characterRow(seed.siblingId), siblingBefore);
      assert.equal(JSON.parse(after.assets as string).length, 14);
    });

    it("STOPs when an admin-owned row is not linked to the supply or its lorebooks have mixed owners", async () => {
      const seed = seedProductionShapedWolfgang();
      const adminId = insertAdmin();
      transferToAdmin(seed.characterId, adminId);

      const other = createSiteManagedStudioAccount({
        nickname: "다른 스튜디오",
        email: "other-owner@site-managed.invalid",
      });
      const mixed = insertCreatorLorebookForOwner(getDb(), {
        creatorId: other.id,
        name: "다른 소유 로어북",
        summary: "",
        keywords: ["다른"],
        content: "다른 소유 본문",
      });
      assert.equal(mixed.ok, true);
      if (!mixed.ok) return;
      replaceCharacterCreatorLorebookAttachments(getDb(), seed.characterId, [...seed.lorebookIds, mixed.id]);
      await assertGateCode(dryRun(seed.characterId, adminId), "owner_not_site_managed");

      replaceCharacterCreatorLorebookAttachments(getDb(), seed.characterId, seed.lorebookIds);
      getDb().prepare("UPDATE official_supply_characters SET staged_character_id=NULL WHERE draft_key=?").run(SUPPLY_KEY);
      await assertGateCode(dryRun(seed.characterId, adminId), "not_official_manageable");
    });
  });
});
