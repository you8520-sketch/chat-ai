import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import { getDb } from "@/lib/db";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { parseCharacterFormBody, updateCharacterFromForm, type SessionUser } from "@/lib/characterFormSave";
import { isCreatorMonetizationEligible } from "@/lib/creatorMonetization";
import { listCharacterCreatorLorebookAttachmentIds } from "@/lib/creatorLorebook";
import {
  canAdminManageOfficialCharacter,
  isOfficialAdminActor,
  listOfficialCharactersForAdmin,
  resolveCanonicalOfficialOwner,
  updateOfficialDisplayCreatorNameAsAdmin,
} from "@/lib/officialAdminAccess";
import {
  LUCIAN_CANONICAL_NAME,
  LUCIAN_DEFAULT_DISPLAY_CREATOR_NAME,
  rejectClientOfficialDisplayCreatorAssignment,
} from "@/lib/officialDisplayCreatorName";
import { loadCompiledOfficialCharacterSource } from "@/lib/officialSupply/compiledOfficialSource";
import { syncOfficialCharacterInPlace } from "@/lib/officialSupply/inPlaceSync";
import { OfficialSupplyGateError, OfficialSupplyStore } from "@/lib/officialSupply/store";
import { createSiteManagedStudioAccount } from "@/lib/siteManagedAccounts";
import { canAccessCharacter } from "@/lib/characterVisibility";

const ADMIN: SessionUser = {
  id: 0,
  nickname: "운영관리자",
  is_adult: 1,
  email: "admin@test.local",
  is_admin: 1,
};

describe("issue 1367 official admin + in-place Lucian sync", () => {
  before(() => installIsolatedTestDatabase());
  after(() => uninstallIsolatedTestDatabase());
  beforeEach(() => {
    const db = getDb();
    new OfficialSupplyStore(db);
    db.exec(`
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

  function insertUser(opts: {
    email: string;
    nickname: string;
    isAdmin?: number;
    siteManaged?: number;
    isAdult?: number;
  }): number {
    const db = getDb();
    const info = db
      .prepare(
        `INSERT INTO users (email, nickname, pw_hash, points, is_adult, is_admin, site_managed)
         VALUES (?, ?, 'x', 0, ?, ?, ?)`
      )
      .run(opts.email, opts.nickname, opts.isAdult ?? 1, opts.isAdmin ?? 0, opts.siteManaged ?? 0);
    return Number(info.lastInsertRowid);
  }

  function insertOfficialLucian(creatorId: number, creatorName: string): number {
    const db = getDb();
    const info = db
      .prepare(
        `INSERT INTO characters
          (name, tagline, description, greeting, system_prompt, world, genre, tags, nsfw, official,
           emoji, hue, creator_id, creator_name, visibility, moderation_status, assets)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        LUCIAN_CANONICAL_NAME,
        "금고털이 경보 속, 당신의 손목을 잡고 달아난 브로커.",
        "구버전 공개 설명",
        "구버전 인사",
        "구버전 시스템",
        "구버전 세계",
        "로맨스 판타지",
        '["협상가"]',
        0,
        1,
        "✨",
        260,
        creatorId,
        creatorName,
        "public",
        "approved",
        JSON.stringify([
          {
            url: "/uploads/official-pilot-rf-v4-03__rep-a1.webp",
            tag: "대표",
            width: 1024,
            height: 1536,
            adultFlagged: false,
            moderationReject: false,
          },
        ])
      );
    return Number(info.lastInsertRowid);
  }

  it("rejects ordinary client bodies that try to set the official display alias", () => {
    assert.throws(
      () => rejectClientOfficialDisplayCreatorAssignment({ creator_name: "로맨스 공식계정" }),
      /관리자만/
    );
    const parsed = parseCharacterFormBody(
      {
        name: "일반캐",
        tagline: "한줄",
        description: "설명",
        greeting: "안녕",
        system_prompt: "설정",
        genres: ["로맨스"],
        creator_name: "내가정한이름",
        assets: [{ url: "/uploads/a.webp", tag: "대표", width: 1024, height: 1536 }],
      },
      { id: 9, nickname: "일반", is_adult: 1 }
    );
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.match(parsed.error, /관리자만/);
  });

  it("ordinary owner still cannot edit official rows; admin official mode can", async () => {
    const studio = createSiteManagedStudioAccount({
      nickname: "로맨스 공식 스튜디오",
      email: "romance@site-managed.invalid",
    });
    const owner: SessionUser = {
      id: studio.id,
      nickname: studio.nickname,
      is_adult: 1,
      email: studio.email,
      is_admin: 0,
    };
    const characterId = insertOfficialLucian(studio.id, "로맨스 공식 스튜디오");
    const ordinary = await updateCharacterFromForm(owner, characterId, {
      name: LUCIAN_CANONICAL_NAME,
      tagline: "바꾸기",
      description: "설명",
      greeting: "인사",
      system_prompt: "설정",
      genres: ["로맨스 판타지"],
      assets: [
        {
          url: "/uploads/official-pilot-rf-v4-03__rep-a1.webp",
          tag: "대표",
          width: 1024,
          height: 1536,
        },
      ],
    });
    assert.equal(ordinary.ok, false);
    if (!ordinary.ok) assert.equal(ordinary.status, 403);

    const adminId = insertUser({
      email: ADMIN.email!,
      nickname: ADMIN.nickname,
      isAdmin: 1,
    });
    const admin = { ...ADMIN, id: adminId };
    assert.equal(isOfficialAdminActor(admin), true);
    assert.equal(canAdminManageOfficialCharacter(admin, { official: 1, creator_id: studio.id }), true);
    assert.equal(canAdminManageOfficialCharacter(owner, { official: 1, creator_id: studio.id }), false);
  });

  it("admin can set the Lucian alias without changing ownership or monetization", () => {
    const studio = createSiteManagedStudioAccount({
      nickname: "로맨스 공식 스튜디오",
      email: "romance-alias@site-managed.invalid",
    });
    const characterId = insertOfficialLucian(studio.id, "로맨스 공식 스튜디오");
    const adminId = insertUser({ email: ADMIN.email!, nickname: ADMIN.nickname, isAdmin: 1 });
    const result = updateOfficialDisplayCreatorNameAsAdmin({
      admin: { ...ADMIN, id: adminId },
      characterId,
      displayCreatorName: LUCIAN_DEFAULT_DISPLAY_CREATOR_NAME,
    });
    assert.equal(result.ok, true);
    const row = getDb()
      .prepare("SELECT creator_id, creator_name, official FROM characters WHERE id=?")
      .get(characterId) as { creator_id: number; creator_name: string; official: number };
    assert.equal(row.creator_id, studio.id);
    assert.equal(row.creator_name, LUCIAN_DEFAULT_DISPLAY_CREATOR_NAME);
    assert.equal(row.official, 1);
    assert.equal(isCreatorMonetizationEligible(studio.id), false);
    assert.equal(isCreatorMonetizationEligible(adminId), true);
  });

  it("guest cannot use admin official GET helpers", () => {
    assert.equal(isOfficialAdminActor({ email: "user@test.local", is_admin: 0 }), false);
    assert.equal(
      updateOfficialDisplayCreatorNameAsAdmin({
        admin: { email: "user@test.local", is_admin: 0 },
        characterId: 1,
        displayCreatorName: "로맨스 공식계정",
      }).ok,
      false
    );
  });

  it("in-place Lucian sync updates the same id, attaches 8+4 lorebooks, and does not notify", async () => {
    const studio = createSiteManagedStudioAccount({
      nickname: "로맨스 공식 스튜디오",
      email: "romance-sync@site-managed.invalid",
    });
    const characterId = insertOfficialLucian(studio.id, "로맨스 공식 스튜디오");
    const chatCountBefore = getDb().prepare("SELECT COUNT(*) AS n FROM characters").get() as { n: number };
    const notifyBefore = getDb().prepare("SELECT COUNT(*) AS n FROM user_notifications").get() as { n: number };
    const adminId = insertUser({ email: ADMIN.email!, nickname: ADMIN.nickname, isAdmin: 1 });
    const admin = { ...ADMIN, id: adminId };
    const source = loadCompiledOfficialCharacterSource("pilot-rf-03");
    assert.equal(source.resolvedLorebook.length, 12);
    assert.match(source.draft.tagline, /비밀 장부를 든 브로커/);
    assert.doesNotMatch(source.draft.tagline, /손목을 잡고/);

    const preview = await syncOfficialCharacterInPlace({
      admin,
      characterId,
      draftKey: "pilot-rf-03",
      mode: "dry_run",
    });
    assert.equal(preview.applied, false);
    assert.equal(preview.characterId, characterId);
    assert.ok(preview.changedFields.includes("tagline"));
    const stillOld = getDb()
      .prepare("SELECT tagline FROM characters WHERE id=?")
      .get(characterId) as { tagline: string };
    assert.match(stillOld.tagline, /손목을 잡고/);

    const applied = await syncOfficialCharacterInPlace({
      admin,
      characterId,
      draftKey: "pilot-rf-03",
      mode: "apply",
    });
    assert.equal(applied.applied, true);
    assert.equal(applied.characterId, characterId);
    assert.equal(applied.createdNewCharacter, false);
    assert.equal(applied.notifiedFollowers, false);
    assert.equal(applied.displayCreatorName, LUCIAN_DEFAULT_DISPLAY_CREATOR_NAME);
    assert.equal(applied.after.lorebookCount, 12);

    const after = getDb()
      .prepare("SELECT id, tagline, creator_id, creator_name, official, visibility, assets FROM characters WHERE id=?")
      .get(characterId) as {
      id: number;
      tagline: string;
      creator_id: number;
      creator_name: string;
      official: number;
      visibility: string;
      assets: string;
    };
    assert.equal(after.id, characterId);
    assert.equal(after.tagline, source.draft.tagline);
    assert.equal(after.creator_id, studio.id);
    assert.equal(after.creator_name, LUCIAN_DEFAULT_DISPLAY_CREATOR_NAME);
    assert.equal(after.official, 1);
    assert.equal(after.visibility, "public");
    assert.match(after.assets, /official-pilot-rf-v4-03__rep-a1/);
    assert.deepEqual(listCharacterCreatorLorebookAttachmentIds(getDb(), characterId).length, 12);
    const lorebookOwners = getDb()
      .prepare(
        `SELECT DISTINCT k.creator_id AS creator_id
         FROM keyword_lorebooks k
         JOIN character_lorebook_attachments a ON a.lorebook_id=k.id
         WHERE a.character_id=?`
      )
      .all(characterId) as Array<{ creator_id: number }>;
    assert.deepEqual(lorebookOwners, [{ creator_id: studio.id }]);
    assert.equal(
      (getDb().prepare("SELECT COUNT(*) AS n FROM characters").get() as { n: number }).n,
      chatCountBefore.n
    );
    assert.equal(
      (getDb().prepare("SELECT COUNT(*) AS n FROM user_notifications").get() as { n: number }).n,
      notifyBefore.n
    );

    const again = await syncOfficialCharacterInPlace({
      admin,
      characterId,
      draftKey: "pilot-rf-03",
      mode: "apply",
    });
    assert.equal(again.characterId, characterId);
    assert.equal(again.after.lorebookCount, 12);
    assert.equal(
      (getDb().prepare("SELECT COUNT(*) AS n FROM characters").get() as { n: number }).n,
      chatCountBefore.n
    );
  });

  it("refuses to sync Lucian onto a differently named official row", async () => {
    const studio = createSiteManagedStudioAccount({
      nickname: "로맨스 공식 스튜디오",
      email: "romance-wrong@site-managed.invalid",
    });
    const adminId = insertUser({ email: ADMIN.email!, nickname: ADMIN.nickname, isAdmin: 1 });
    const otherId = insertOfficialLucian(studio.id, "로맨스 공식 스튜디오");
    getDb().prepare("UPDATE characters SET name=? WHERE id=?").run("다른 공식캐", otherId);
    await assert.rejects(
      () =>
        syncOfficialCharacterInPlace({
          admin: { ...ADMIN, id: adminId },
          characterId: otherId,
          draftKey: "pilot-rf-03",
          mode: "dry_run",
        }),
      (error: unknown) => error instanceof OfficialSupplyGateError && error.code === "character_identity_mismatch"
    );
  });

  it("lists official rows for admin and keeps a single site-managed owner", () => {
    const studio = createSiteManagedStudioAccount({
      nickname: "로맨스 공식 스튜디오",
      email: "romance-list@site-managed.invalid",
    });
    insertOfficialLucian(studio.id, "로맨스 공식 스튜디오");
    const owner = resolveCanonicalOfficialOwner();
    assert.equal(owner.status, "ok");
    if (owner.status === "ok") assert.equal(owner.id, studio.id);
    const listed = listOfficialCharactersForAdmin();
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.name, LUCIAN_CANONICAL_NAME);
  });

  it("adult access still ignores official/site_managed; my-characters still owner-only", () => {
    const page = fs.readFileSync(path.join(process.cwd(), "src/app/character/[id]/page.tsx"), "utf8");
    const my = fs.readFileSync(path.join(process.cwd(), "src/app/my-characters/page.tsx"), "utf8");
    const card = fs.readFileSync(path.join(process.cwd(), "src/components/CharacterCard.tsx"), "utf8");
    const route = fs.readFileSync(path.join(process.cwd(), "src/app/api/characters/[id]/route.ts"), "utf8");
    assert.match(page, /if \(c\.nsfw === 1 && !canAccessAdultContent\(user\)\) \{/);
    assert.match(my, /WHERE creator_id = \?/);
    assert.doesNotMatch(my, /site_managed|official=1/);
    assert.doesNotMatch(card, /studioSuffix|· 공식 스튜디오/);
    assert.match(card, /공식/);
    assert.match(route, /공식 캐릭터는 수정할 수 없습니다/);
    const studio = createSiteManagedStudioAccount({
      nickname: "로맨스 공식 스튜디오",
      email: "romance-access@site-managed.invalid",
    });
    const characterId = insertOfficialLucian(studio.id, "로맨스 공식 스튜디오");
    const row = getDb()
      .prepare(
        "SELECT id, visibility, moderation_status, official, creator_id, nsfw FROM characters WHERE id=?"
      )
      .get(characterId) as {
      id: number;
      visibility: string;
      moderation_status: string;
      official: number;
      creator_id: number;
      nsfw: number;
    };
    assert.equal(canAccessCharacter(row, null).ok, true);
  });
});
