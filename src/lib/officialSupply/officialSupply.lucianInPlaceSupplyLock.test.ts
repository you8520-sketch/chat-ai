import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { getDb } from "@/lib/db";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { createSiteManagedStudioAccount } from "@/lib/siteManagedAccounts";
import { computeTextLockHash } from "@/lib/officialSupply/characterText";
import { loadCompiledOfficialCharacterSource } from "@/lib/officialSupply/compiledOfficialSource";
import {
  OFFICIAL_IN_PLACE_APPLY_ENV,
  syncOfficialCharacterInPlace,
} from "@/lib/officialSupply/inPlaceSync";
import {
  LUCIAN_DRAFT_KEY,
  LUCIAN_PUBLISHED_PREDECESSOR_DRAFT_KEY,
} from "@/lib/officialSupply/officialDraftIdentity";
import { OfficialSupplyGateError, OfficialSupplyStore } from "@/lib/officialSupply/store";
import type { SessionUser } from "@/lib/characterFormSave";
import { LUCIAN_CANONICAL_NAME } from "@/lib/officialDisplayCreatorName";
import type { OfficialCharacterDraft } from "@/lib/officialSupply/types";

const ADMIN: SessionUser = {
  id: 0,
  nickname: "운영관리자",
  is_adult: 1,
  email: "admin@test.local",
  is_admin: 1,
};

function insertAdmin(): number {
  const info = getDb()
    .prepare(
      `INSERT INTO users (email, nickname, pw_hash, points, is_adult, is_admin, site_managed)
       VALUES (?, ?, 'x', 0, 1, 1, 0)`
    )
    .run(ADMIN.email!, ADMIN.nickname);
  return Number(info.lastInsertRowid);
}

function insertMinimalLucian(creatorId: number): number {
  const source = loadCompiledOfficialCharacterSource(LUCIAN_DRAFT_KEY);
  const info = getDb()
    .prepare(
      `INSERT INTO characters
        (name, tagline, description, greeting, system_prompt, world, creator_id, creator_name,
         official, visibility, moderation_status, assets)
       VALUES (?, 't', 'd', 'g', 's', 'w', ?, 'studio', 1, 'public', 'approved', ?)`
    )
    .run(
      LUCIAN_CANONICAL_NAME,
      creatorId,
      JSON.stringify([{ url: "/u/rep.webp", tag: "rep", width: 1024, height: 1536, representativeRank: 1 }])
    );
  return Number(info.lastInsertRowid);
}

function linkLiveShapedSupply(characterId: number): { predecessorDraftJson: string } {
  const source = loadCompiledOfficialCharacterSource(LUCIAN_DRAFT_KEY);
  const predecessorDraftJson = JSON.stringify({
    draftKey: LUCIAN_PUBLISHED_PREDECESSOR_DRAFT_KEY,
    history: "published-predecessor",
  });
  const db = getDb();
  db.prepare(
    `INSERT INTO official_supply_characters
      (draft_key, batch_key, world_key, style_key, stage, draft_json, staged_character_id)
     VALUES (?, 'legacy', ?, 'legacy', 'published', ?, ?)`
  ).run(LUCIAN_PUBLISHED_PREDECESSOR_DRAFT_KEY, source.worldKey, predecessorDraftJson, characterId);
  db.prepare(
    `INSERT INTO official_supply_characters
      (draft_key, batch_key, world_key, style_key, stage, draft_json, text_lock_hash, staged_character_id)
     VALUES (?, 'approved', ?, 'approved', 'asset_plan_locked', '{}', 'stale-lock-column', NULL)`
  ).run(LUCIAN_DRAFT_KEY, source.worldKey);
  return { predecessorDraftJson };
}

function supplyRow() {
  return getDb()
    .prepare(
      `SELECT draft_key, stage, staged_character_id, draft_json, text_lock_hash
       FROM official_supply_characters WHERE draft_key=?`
    )
    .get(LUCIAN_DRAFT_KEY) as {
    draft_key: string;
    stage: string;
    staged_character_id: number | null;
    draft_json: string;
    text_lock_hash: string | null;
  };
}

function withApplyEnabled<T>(fn: () => T): T {
  const prev = process.env[OFFICIAL_IN_PLACE_APPLY_ENV];
  process.env[OFFICIAL_IN_PLACE_APPLY_ENV] = "1";
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env[OFFICIAL_IN_PLACE_APPLY_ENV];
    else process.env[OFFICIAL_IN_PLACE_APPLY_ENV] = prev;
  }
}

describe("Lucian #50 supply draft_json / Text Lock coupling", () => {
  it("pins the current main compile Text Lock for pilot-rf-03", () => {
    assert.equal(
      computeTextLockHash(loadCompiledOfficialCharacterSource(LUCIAN_DRAFT_KEY).draft),
      "c3fda3e51f981b31066f3707ac8b580235092632a85a5d543d935093ca0b742f"
    );
  });
  before(() => {
    installIsolatedTestDatabase();
  });
  after(() => {
    uninstallIsolatedTestDatabase();
  });
  beforeEach(() => {
    const db = getDb();
    new OfficialSupplyStore(db);
    db.exec(`
      DELETE FROM character_lorebook_attachments;
      DELETE FROM keyword_lorebooks;
      DELETE FROM official_supply_world_lorebooks;
      DELETE FROM official_supply_characters;
      DELETE FROM official_supply_batches;
      DELETE FROM characters;
      DELETE FROM users WHERE email LIKE '%@site-managed.invalid' OR email LIKE '%@test.local';
    `);
  });

  it("BEFORE: legacy column Text Lock drift is visible on dry-run without writing", async () => {
    const studio = createSiteManagedStudioAccount({
      nickname: "로맨스 공식 스튜디오",
      email: "lucian-lock-dry@site-managed.invalid",
    });
    const characterId = insertMinimalLucian(studio.id);
    linkLiveShapedSupply(characterId);
    const adminId = insertAdmin();
    const source = loadCompiledOfficialCharacterSource(LUCIAN_DRAFT_KEY);
    const candidateLock = computeTextLockHash(source.draft);
    const before = supplyRow();

    const preview = await syncOfficialCharacterInPlace({
      admin: { ...ADMIN, id: adminId },
      characterId,
      draftKey: LUCIAN_DRAFT_KEY,
      mode: "dry_run",
    });

    assert.equal(preview.applied, false);
    assert.equal(preview.supplyTextLock?.consistent, false);
    assert.equal(preview.supplyTextLock?.state, "legacy_lock_drift");
    assert.equal(preview.supplyTextLock?.supplyTextLockHash, "stale-lock-column");
    assert.equal(preview.supplyTextLock?.storedComputedTextLockHash, computeTextLockHash({} as OfficialCharacterDraft));
    assert.equal(preview.supplyTextLock?.targetTextLockHash, candidateLock);
    assert.ok(preview.changedFields.includes("supply_text_lock"));
    assert.deepEqual(supplyRow(), before);
  });

  it("AFTER: apply moves draft_json and text_lock_hash together and leaves predecessor untouched", async () => {
    const studio = createSiteManagedStudioAccount({
      nickname: "로맨스 공식 스튜디오",
      email: "lucian-lock-apply@site-managed.invalid",
    });
    const characterId = insertMinimalLucian(studio.id);
    const { predecessorDraftJson } = linkLiveShapedSupply(characterId);
    const adminId = insertAdmin();
    const source = loadCompiledOfficialCharacterSource(LUCIAN_DRAFT_KEY);
    const candidateLock = computeTextLockHash(source.draft);

    const preview = await syncOfficialCharacterInPlace({
      admin: { ...ADMIN, id: adminId },
      characterId,
      draftKey: LUCIAN_DRAFT_KEY,
      mode: "dry_run",
    });

    await withApplyEnabled(() =>
      syncOfficialCharacterInPlace({
        admin: { ...ADMIN, id: adminId },
        characterId,
        draftKey: LUCIAN_DRAFT_KEY,
        mode: "apply",
        preflightSnapshot: preview.preflightSnapshot,
      })
    );

    const approved = supplyRow();
    assert.equal(approved.staged_character_id, characterId);
    assert.equal(approved.text_lock_hash, candidateLock);
    const stored = JSON.parse(approved.draft_json) as OfficialCharacterDraft;
    assert.equal(computeTextLockHash(stored), approved.text_lock_hash);
    assert.equal(stored.draftKey, LUCIAN_DRAFT_KEY);

    const predecessor = getDb()
      .prepare(`SELECT draft_json FROM official_supply_characters WHERE draft_key=?`)
      .get(LUCIAN_PUBLISHED_PREDECESSOR_DRAFT_KEY) as { draft_json: string };
    assert.equal(predecessor.draft_json, predecessorDraftJson);
  });

  it("reproduces the partial writer bug class: draft-only mutation stays inconsistent until paired apply", async () => {
    const studio = createSiteManagedStudioAccount({
      nickname: "로맨스 공식 스튜디오",
      email: "lucian-lock-partial@site-managed.invalid",
    });
    const characterId = insertMinimalLucian(studio.id);
    linkLiveShapedSupply(characterId);
    const adminId = insertAdmin();
    const source = loadCompiledOfficialCharacterSource(LUCIAN_DRAFT_KEY);
    const nextDraft = { ...source.draft, draftKey: LUCIAN_DRAFT_KEY, styleKey: "romance_fantasy_v4" };
    const draftOnlyHash = computeTextLockHash(nextDraft);
    getDb()
      .prepare(`UPDATE official_supply_characters SET draft_json=?, text_lock_hash=? WHERE draft_key=?`)
      .run(JSON.stringify(nextDraft), "stale-lock-column", LUCIAN_DRAFT_KEY);

    const row = supplyRow();
    assert.notEqual(row.text_lock_hash, draftOnlyHash);

    const preview = await syncOfficialCharacterInPlace({
      admin: { ...ADMIN, id: adminId },
      characterId,
      draftKey: LUCIAN_DRAFT_KEY,
      mode: "dry_run",
    });
    assert.equal(preview.supplyTextLock?.consistent, false);

    await withApplyEnabled(() =>
      syncOfficialCharacterInPlace({
        admin: { ...ADMIN, id: adminId },
        characterId,
        draftKey: LUCIAN_DRAFT_KEY,
        mode: "apply",
        preflightSnapshot: preview.preflightSnapshot,
      })
    );

    const after = supplyRow();
    assert.equal(after.text_lock_hash, draftOnlyHash);
    assert.equal(computeTextLockHash(JSON.parse(after.draft_json) as OfficialCharacterDraft), after.text_lock_hash);
  });

  it("refuses apply when the supply row changes after dry-run preflight", async () => {
    const studio = createSiteManagedStudioAccount({
      nickname: "로맨스 공식 스튜디오",
      email: "lucian-lock-drift@site-managed.invalid",
    });
    const characterId = insertMinimalLucian(studio.id);
    linkLiveShapedSupply(characterId);
    const adminId = insertAdmin();
    const preview = await syncOfficialCharacterInPlace({
      admin: { ...ADMIN, id: adminId },
      characterId,
      draftKey: LUCIAN_DRAFT_KEY,
      mode: "dry_run",
    });
    getDb()
      .prepare(`UPDATE official_supply_characters SET draft_json='{"draftKey":"pilot-rf-03","history":"drift"}' WHERE draft_key=?`)
      .run(LUCIAN_DRAFT_KEY);

    await withApplyEnabled(() =>
      assert.rejects(
        () =>
          syncOfficialCharacterInPlace({
            admin: { ...ADMIN, id: adminId },
            characterId,
            draftKey: LUCIAN_DRAFT_KEY,
            mode: "apply",
            preflightSnapshot: preview.preflightSnapshot,
          }),
        (error: unknown) =>
          error instanceof OfficialSupplyGateError &&
          (error.code === "preflight_mismatch" || error.code === "supply_write_mismatch")
      )
    );
  });
});
