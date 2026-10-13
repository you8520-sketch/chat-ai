import Module from "module";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import {
  updateCharacterFromForm,
  updateCharacterPublicProfileFromForm,
  type SessionUser,
} from "@/lib/characterFormSave";
import { parseAssets } from "@/lib/characterAssets";
import {
  getCreatorPointsBalance,
  getCreatorTierInfo,
  maybeCreditCreatorReward,
} from "@/lib/creatorPoints";
import {
  insertCreatorLorebookForOwner,
  listAttachedCreatorLorebookSummaries,
  listCharacterCreatorLorebookAttachmentIds,
  replaceCharacterCreatorLorebookAttachments,
} from "@/lib/creatorLorebook";
import { getDb } from "@/lib/db";
import { creditChatRoomImageCreatorReward } from "@/lib/imageGenerationEconomics";
import {
  canAdminManageOfficialCharacter,
  listOfficialCharactersForAdmin,
  resolveOfficialCharacterEditorAccess,
} from "@/lib/officialAdminAccess";
import { publishOfficialSupplyCharacter } from "@/lib/officialSupply/publish";
import {
  OFFICIAL_OWNER_TRANSFER_ENV,
  transferOfficialCharacterOwnerToAdmin,
  type OfficialOwnerTransferActor,
} from "@/lib/officialSupply/ownerTransfer";
import { OfficialSupplyGateError, OfficialSupplyStore } from "@/lib/officialSupply/store";
import { createSiteManagedStudioAccount } from "@/lib/siteManagedAccounts";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { loadTrpgCharacterRoyaltyTargets, splitTrpgCreatorRewards } from "@/lib/trpg/creatorRewards";

const SUPPLY_KEY = "pilot-rf-v4-02";
const DISPLAY_CREATOR = "로맨스 공식계정";

type Seed = {
  studioId: number;
  adminId: number;
  admin: OfficialOwnerTransferActor;
  adminSession: SessionUser;
  consumerId: number;
  characterId: number;
  luciusId: number;
  lorebookIds: number[];
};

function rep14() {
  return Array.from({ length: 14 }, (_, index) => ({
    url: `/uploads/official-${SUPPLY_KEY}__${index === 0 ? "rep-a1" : `scene-${String(index).padStart(2, "0")}`}.webp`,
    tag: index === 0 ? "대표" : `장면${index}`,
    width: 1024,
    height: 1536,
    ...(index === 0 ? { representativeRank: 1 } : {}),
    viewerBlur: index === 5,
  }));
}

describe("admin-owned official supply character management (#1589)", () => {
  before(() => installIsolatedTestDatabase());
  after(() => uninstallIsolatedTestDatabase());
  beforeEach(() => {
    const db = getDb();
    new OfficialSupplyStore(db);
    db.exec(`
      DELETE FROM trpg_participants;
      DELETE FROM trpg_campaigns;
      DELETE FROM creator_earnings;
      DELETE FROM creator_point_logs;
      DELETE FROM image_generation_creator_earnings;
      DELETE FROM user_notifications;
      DELETE FROM character_lorebook_attachments;
      DELETE FROM keyword_lorebooks;
      DELETE FROM official_supply_assets;
      DELETE FROM official_supply_characters;
      DELETE FROM official_supply_batches;
      DELETE FROM messages;
      DELETE FROM chats;
      DELETE FROM characters;
      DELETE FROM users WHERE email LIKE '%@site-managed.invalid' OR email LIKE '%@test.local';
    `);
    delete process.env[OFFICIAL_OWNER_TRANSFER_ENV];
  });

  function insertUser(email: string, opts?: { isAdmin?: number }): number {
    return Number(
      getDb()
        .prepare(
          `INSERT INTO users (email, nickname, pw_hash, points, is_adult, is_admin, site_managed, creator_points)
           VALUES (?,?,'x',10000,1,?,0,0)`
        )
        .run(email, email.split("@")[0], opts?.isAdmin ?? 0).lastInsertRowid
    );
  }

  function insertCharacter(input: {
    ownerId: number;
    name: string;
    official: number;
    visibility: string;
    nsfw?: number;
    assets?: unknown[];
  }): number {
    const assets = input.assets ?? rep14();
    return Number(
      getDb()
        .prepare(
          `INSERT INTO characters
            (name, tagline, description, greeting, system_prompt, world, genre, genres, tags, nsfw, official,
             emoji, hue, creator_id, creator_name, visibility, moderation_status, assets, images,
             participant_min_age, chats_count)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`
        )
        .run(
          input.name,
          "한줄",
          "설명",
          "인사 장면",
          `너는 승인된 캐릭터다. APPROVED_MANUSCRIPT ${"북부 대공의 서약과 규율을 지킨다. ".repeat(80)}`,
          `세계관 ${"태양의 옥좌와 에테르의 질서가 북부를 지배한다. ".repeat(40)}`,
          "로맨스 판타지",
          '["로맨스 판타지"]',
          '["북부대공"]',
          input.nsfw ?? 0,
          input.official,
          "🐺",
          210,
          input.ownerId,
          DISPLAY_CREATOR,
          input.visibility,
          "approved",
          JSON.stringify(assets),
          JSON.stringify([(assets[0] as { url: string }).url]),
          input.nsfw ? 19 : null
        ).lastInsertRowid
    );
  }

  function linkSupply(characterId: number, draftKey: string, stage = "staged_private") {
    getDb()
      .prepare(
        `INSERT INTO official_supply_characters
          (draft_key, batch_key, world_key, style_key, stage, draft_json, text_lock_hash,
           appearance_json, appearance_lock_hash, asset_plan_json, is_style_proof, staging_claim, staged_character_id)
         VALUES (?, 'b', 'w', 'romance_fantasy_v4', ?, '{}', 'tl', '{}', 'al', '{"slots":[]}', 1, ?, ?)`
      )
      .run(draftKey, stage, `claim-${draftKey}`, characterId);
  }

  function seed(): Seed {
    const db = getDb();
    const studio = createSiteManagedStudioAccount({
      nickname: "로맨스 공식 스튜디오",
      email: "romance@site-managed.invalid",
    });
    const adminId = insertUser("admin@test.local", { isAdmin: 1 });
    const consumerId = insertUser("consumer@test.local");
    const characterId = insertCharacter({
      ownerId: studio.id,
      name: "볼프강 폰 발켄하임",
      official: 0,
      visibility: "private",
      nsfw: 1,
    });
    const luciusId = insertCharacter({
      ownerId: studio.id,
      name: "루시안 바스케스",
      official: 1,
      visibility: "public",
    });
    const lorebookIds: number[] = [];
    for (const name of ["에테르", "태양의 옥좌", "북부 전선"]) {
      const created = insertCreatorLorebookForOwner(db, {
        creatorId: studio.id,
        name,
        summary: `${name} 요약`,
        keywords: [name, `${name}-별칭`],
        content: `${name} 설정 본문`,
      });
      assert.equal(created.ok, true);
      if (created.ok) lorebookIds.push(created.id);
    }
    replaceCharacterCreatorLorebookAttachments(db, characterId, lorebookIds);
    replaceCharacterCreatorLorebookAttachments(db, luciusId, lorebookIds);
    linkSupply(characterId, SUPPLY_KEY);
    return {
      studioId: studio.id,
      adminId,
      admin: { id: adminId, email: "admin@test.local", is_admin: 1 },
      adminSession: {
        id: adminId,
        nickname: "공식계정",
        is_adult: 1,
        email: "admin@test.local",
        is_admin: 1,
      },
      consumerId,
      characterId,
      luciusId,
      lorebookIds,
    };
  }

  function transfer(s: Seed) {
    const preview = transferOfficialCharacterOwnerToAdmin({
      admin: s.admin,
      characterId: s.characterId,
      mode: "dry_run",
    });
    process.env[OFFICIAL_OWNER_TRANSFER_ENV] = "1";
    try {
      return transferOfficialCharacterOwnerToAdmin({
        admin: s.admin,
        characterId: s.characterId,
        mode: "apply",
        preflightSnapshot: preview.preflightSnapshot,
      });
    } finally {
      delete process.env[OFFICIAL_OWNER_TRANSFER_ENV];
    }
  }

  const row = (id: number) =>
    getDb().prepare("SELECT * FROM characters WHERE id=?").get(id) as Record<string, unknown>;
  const dump = (table: string, order: string) =>
    JSON.stringify(getDb().prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all());
  const editorRow = (id: number) =>
    getDb().prepare("SELECT id, official, creator_id FROM characters WHERE id=?").get(id) as {
      id: number;
      official: number;
      creator_id: number;
    };

  const OFFICIAL_ADMIN_OPTIONS = (adminUser: SessionUser) =>
    ({
      actor: "official_admin",
      adminUser,
      preserveListingState: true,
      preserveAdultFlags: true,
      skipFollowerNotify: true,
    }) as const;

  it("keeps an admin-owned, supply-linked character on the official management path", () => {
    const s = seed();
    assert.equal(canAdminManageOfficialCharacter(s.admin, editorRow(s.characterId)), true);
    const applied = transfer(s);
    assert.equal(applied.applied, true);
    assert.equal(row(s.characterId).creator_id, s.adminId);

    const owned = editorRow(s.characterId);
    assert.equal(canAdminManageOfficialCharacter(s.admin, owned), true);
    assert.equal(resolveOfficialCharacterEditorAccess(s.adminSession, owned), "official_admin");

    const listed = listOfficialCharactersForAdmin().find((item) => item.id === s.characterId);
    assert.ok(listed, "transferred #51 stays in the admin official list");
    assert.equal(listed.draft_key, SUPPLY_KEY);
    assert.equal(listed.supply_stage, "staged_private");
    assert.equal(listed.visibility, "private");
    assert.ok(listOfficialCharactersForAdmin().some((item) => item.id === s.luciusId));
  });

  it("does not turn ordinary admin-owned or foreign supply-linked characters into official rows", () => {
    const s = seed();
    transfer(s);
    const regular = insertCharacter({ ownerId: s.adminId, name: "관리자 일반", official: 0, visibility: "public" });
    const consumerOwnedLinked = insertCharacter({
      ownerId: s.consumerId,
      name: "일반 유저 공급연결",
      official: 0,
      visibility: "private",
    });
    linkSupply(consumerOwnedLinked, "other-draft");
    const wrongStage = insertCharacter({
      ownerId: s.adminId,
      name: "스테이지 불일치",
      official: 0,
      visibility: "private",
    });
    linkSupply(wrongStage, "wrong-stage-draft", "qa_passed");
    const doubleLinked = insertCharacter({
      ownerId: s.adminId,
      name: "이중 연결",
      official: 0,
      visibility: "private",
    });
    linkSupply(doubleLinked, "double-a");
    linkSupply(doubleLinked, "double-b");

    for (const id of [regular, consumerOwnedLinked, wrongStage, doubleLinked]) {
      assert.equal(canAdminManageOfficialCharacter(s.admin, editorRow(id)), false, `character ${id}`);
    }
    assert.equal(resolveOfficialCharacterEditorAccess(s.adminSession, editorRow(regular)), "owner");
    assert.equal(resolveOfficialCharacterEditorAccess(s.adminSession, editorRow(consumerOwnedLinked)), "forbidden");
    const listedIds = new Set(listOfficialCharactersForAdmin().map((item) => item.id));
    for (const id of [regular, consumerOwnedLinked, wrongStage, doubleLinked]) {
      assert.equal(listedIds.has(id), false, `character ${id} must not be listed`);
    }
    const consumer: SessionUser = {
      id: s.consumerId,
      nickname: "consumer",
      is_adult: 1,
      email: "consumer@test.local",
      is_admin: 0,
    };
    assert.equal(resolveOfficialCharacterEditorAccess(consumer, editorRow(s.characterId)), "forbidden");
    assert.equal(canAdminManageOfficialCharacter(consumer, editorRow(s.characterId)), false);
  });

  it("PATCH public profile persists per-image blur and tags, and preserves listing, adult flags and creator name", async () => {
    const s = seed();
    transfer(s);
    const before = row(s.characterId);
    const beforeAssets = parseAssets(before.assets as string);
    assert.equal(beforeAssets.length, 14);

    assert.equal(beforeAssets[5]!.viewerBlur, true);
    assert.equal(beforeAssets[2]!.viewerBlur, false);
    const nextAssets = rep14().map((asset, index) => ({
      ...asset,
      viewerBlur: index === 2,
    }));
    const result = await updateCharacterPublicProfileFromForm(
      s.adminSession,
      s.characterId,
      {
        scope: "public_profile",
        tagline: "한줄",
        description: "설명",
        genres: ["로맨스 판타지"],
        tags: ["북부대공", "새태그"],
        assets: nextAssets,
        visibility: "public",
        nsfw: false,
        creator_comment: "",
      },
      OFFICIAL_ADMIN_OPTIONS(s.adminSession)
    );
    assert.equal(result.ok, true, result.ok ? "" : `${result.status}: ${result.error}`);

    const after = row(s.characterId);
    const afterAssets = parseAssets(after.assets as string);
    assert.deepEqual(
      afterAssets.map((asset) => asset.url),
      beforeAssets.map((asset) => asset.url),
      "14 image URLs and order unchanged"
    );
    assert.equal(afterAssets.length, 14);
    assert.equal(afterAssets[0]!.viewerBlur, false, "representative image stays unblurred");
    assert.equal(afterAssets[2]!.viewerBlur, true, "blur ON persisted");
    assert.equal(afterAssets[5]!.viewerBlur, false, "blur OFF persisted");
    assert.equal(afterAssets[0]!.representativeRank, 1);
    assert.deepEqual(JSON.parse(after.tags as string), ["북부대공", "새태그"]);
    assert.equal(after.visibility, "private");
    assert.equal(after.moderation_status, "approved");
    assert.equal(after.official, 0);
    assert.equal(after.nsfw, 1);
    assert.equal(after.participant_min_age, 19);
    assert.equal(after.creator_name, DISPLAY_CREATOR);
    assert.equal(after.creator_id, s.adminId);
    assert.equal(after.system_prompt, before.system_prompt);
    assert.equal(after.greeting, before.greeting);
    assert.equal((getDb().prepare("SELECT COUNT(*) n FROM user_notifications").get() as { n: number }).n, 0);

    const reread = row(s.characterId);
    assert.equal(reread.assets, after.assets);
  });

  it("PATCH without the official admin option still rejects an admin editing someone else's official row", async () => {
    const s = seed();
    const officialRow = await updateCharacterPublicProfileFromForm(s.adminSession, s.luciusId, {
      tagline: "x",
      description: "x",
      genres: ["로맨스 판타지"],
      assets: rep14(),
    });
    assert.equal(officialRow.ok, false);
    const regular = insertCharacter({ ownerId: s.adminId, name: "관리자 일반", official: 0, visibility: "public" });
    const denied = await updateCharacterPublicProfileFromForm(
      s.adminSession,
      regular,
      { tagline: "x", description: "x", genres: ["로맨스 판타지"], assets: rep14() },
      OFFICIAL_ADMIN_OPTIONS(s.adminSession)
    );
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.status, 403);
  });

  function fullForm(s: Seed, overrides: Record<string, unknown> = {}) {
    const stored = row(s.characterId);
    return {
      name: stored.name,
      gender: "male",
      tagline: stored.tagline,
      description: stored.description,
      greeting: stored.greeting,
      system_prompt: stored.system_prompt,
      world: stored.world,
      genres: ["로맨스 판타지"],
      tags: "북부대공",
      speech_personality: "냉정하다",
      speech_traits: "짧게 말한다",
      speech_examples: "\"...가라.\"",
      speech_forbidden: "",
      comments_enabled: true,
      assets: rep14(),
      visibility: "private",
      lorebook_ids: s.lorebookIds,
      ...overrides,
    };
  }

  it("PUT keeps every shared studio lorebook attached when saved by the admin owner", async () => {
    const s = seed();
    transfer(s);
    const lorebooksBefore = dump("keyword_lorebooks", "id");
    const luciusAttachmentsBefore = listCharacterCreatorLorebookAttachmentIds(getDb(), s.luciusId);

    const saved = await updateCharacterFromForm(
      s.adminSession,
      s.characterId,
      fullForm(s, {
        assets: rep14().map((asset, index) => ({ ...asset, viewerBlur: index === 3 })),
        tags: "북부대공, 새태그",
      }),
      OFFICIAL_ADMIN_OPTIONS(s.adminSession)
    );
    assert.equal(saved.ok, true, saved.ok ? "" : `${saved.status}: ${saved.error}`);

    assert.deepEqual(listCharacterCreatorLorebookAttachmentIds(getDb(), s.characterId), s.lorebookIds);
    assert.equal(dump("keyword_lorebooks", "id"), lorebooksBefore, "shared lorebook rows are not edited or cloned");
    assert.deepEqual(listCharacterCreatorLorebookAttachmentIds(getDb(), s.luciusId), luciusAttachmentsBefore);

    const after = row(s.characterId);
    const assets = parseAssets(after.assets as string);
    assert.equal(assets.length, 14);
    assert.equal(assets[3]!.viewerBlur, true);
    assert.equal(assets[5]!.viewerBlur, false);
    assert.equal(assets[0]!.viewerBlur, false);
    assert.equal(assets[0]!.representativeRank, 1);
    assert.deepEqual(JSON.parse(after.tags as string), ["북부대공", "새태그"]);
    assert.equal(after.visibility, "private");
    assert.equal(after.official, 0);
    assert.equal(after.creator_id, s.adminId);
    assert.equal(after.creator_name, DISPLAY_CREATOR);
    assert.equal(after.nsfw, 1);
  });

  it("PUT rejects attaching a lorebook the admin does not own, and a foreign lorebook that was never attached", async () => {
    const s = seed();
    transfer(s);
    const foreign = insertCreatorLorebookForOwner(getDb(), {
      creatorId: s.consumerId,
      name: "남의 로어북",
      summary: "",
      keywords: ["남"],
      content: "남의 본문",
    });
    assert.equal(foreign.ok, true);
    if (!foreign.ok) return;
    const studioOnly = insertCreatorLorebookForOwner(getDb(), {
      creatorId: s.studioId,
      name: "미부착 스튜디오 로어북",
      summary: "",
      keywords: ["미부착"],
      content: "미부착 본문",
    });
    assert.equal(studioOnly.ok, true);
    if (!studioOnly.ok) return;

    for (const extra of [foreign.id, studioOnly.id]) {
      const denied = await updateCharacterFromForm(
        s.adminSession,
        s.characterId,
        fullForm(s, { lorebook_ids: [...s.lorebookIds, extra] }),
        OFFICIAL_ADMIN_OPTIONS(s.adminSession)
      );
      assert.equal(denied.ok, false, `lorebook ${extra} must be rejected`);
      if (!denied.ok) assert.equal(denied.status, 400);
    }
    assert.deepEqual(listCharacterCreatorLorebookAttachmentIds(getDb(), s.characterId), s.lorebookIds);
  });

  it("an ordinary creator still cannot attach someone else's lorebook", async () => {
    const s = seed();
    const own = insertCharacter({ ownerId: s.consumerId, name: "일반 캐릭터", official: 0, visibility: "private" });
    const consumer: SessionUser = {
      id: s.consumerId,
      nickname: "consumer",
      is_adult: 1,
      email: "consumer@test.local",
      is_admin: 0,
    };
    const denied = await updateCharacterFromForm(consumer, own, {
      ...fullForm(s),
      name: "일반 캐릭터",
      lorebook_ids: s.lorebookIds,
    });
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.status, 400);
    const officialDenied = await updateCharacterFromForm(
      consumer,
      s.characterId,
      fullForm(s),
      OFFICIAL_ADMIN_OPTIONS(consumer)
    );
    assert.equal(officialDenied.ok, false);
  });

  it("lists the attached shared lorebooks with id, title, keywords, link status and read-only flag", () => {
    const s = seed();
    transfer(s);
    const asAdmin = listAttachedCreatorLorebookSummaries(getDb(), s.characterId, s.adminId);
    assert.deepEqual(
      asAdmin.map((item) => ({ id: item.id, name: item.name, readOnly: item.readOnly, linked: item.linked })),
      s.lorebookIds.map((id, index) => ({
        id,
        name: ["에테르", "태양의 옥좌", "북부 전선"][index],
        readOnly: true,
        linked: true,
      }))
    );
    assert.deepEqual(asAdmin[0]!.keywords, ["에테르", "에테르-별칭"]);
    assert.equal(asAdmin.every((item) => item.ownerId === s.studioId), true);
    assert.equal(
      listAttachedCreatorLorebookSummaries(getDb(), s.characterId, s.studioId).every((item) => !item.readOnly),
      true
    );
  });

  it("official supply characters are excluded from regular-creator CP, tier, chat, image and TRPG rewards", () => {
    const s = seed();
    insertCharacter({ ownerId: s.adminId, name: "관리자 일반 1", official: 0, visibility: "public" });
    insertCharacter({ ownerId: s.adminId, name: "관리자 일반 2", official: 0, visibility: "public" });
    const tierBefore = getCreatorTierInfo(s.adminId);
    transfer(s);
    assert.deepEqual(getCreatorTierInfo(s.adminId), tierBefore, "tier, character count and chats are unchanged");

    const regular = insertCharacter({ ownerId: s.adminId, name: "관리자 일반 3", official: 0, visibility: "public" });
    assert.equal(getCreatorTierInfo(s.adminId).characterCount, tierBefore.characterCount + 1);
    const regularReward = maybeCreditCreatorReward({
      creatorId: s.adminId,
      official: 0,
      characterId: regular,
      messageId: 101,
      consumerUserId: s.consumerId,
      pointsSpent: 100,
    });
    assert.ok(regularReward > 0, "ordinary admin characters keep earning");
    const balanceAfterRegular = getCreatorPointsBalance(s.adminId);

    assert.equal(
      maybeCreditCreatorReward({
        creatorId: s.adminId,
        official: 0,
        characterId: s.characterId,
        messageId: 102,
        consumerUserId: s.consumerId,
        pointsSpent: 100,
      }),
      0
    );
    assert.equal(
      creditChatRoomImageCreatorReward(getDb(), {
        generationId: 1,
        creatorId: s.adminId,
        consumerUserId: s.consumerId,
        source: "character",
        characterId: s.characterId,
      }),
      0
    );
    assert.equal(
      creditChatRoomImageCreatorReward(getDb(), {
        generationId: 2,
        creatorId: s.adminId,
        consumerUserId: s.consumerId,
        source: "character",
        characterId: regular,
      }) > 0,
      true
    );

    const db = getDb();
    const campaignId = Number(
      db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title) VALUES (?, '공식 공급 TRPG')`).run(s.consumerId)
        .lastInsertRowid
    );
    db.prepare(
      `INSERT INTO trpg_participants (campaign_id, slot_index, kind, character_id, display_name) VALUES (?,?,?,?,?)`
    ).run(campaignId, 0, "character", s.characterId, "볼프강");
    db.prepare(
      `INSERT INTO trpg_participants (campaign_id, slot_index, kind, character_id, display_name) VALUES (?,?,?,?,?)`
    ).run(campaignId, 1, "character", regular, "일반");
    const targets = loadTrpgCharacterRoyaltyTargets(db, campaignId);
    const shares = splitTrpgCreatorRewards({
      paidSpend: 100,
      consumerUserId: s.consumerId,
      authorUserId: null,
      authorRate: 0,
      characterCreators: targets,
    });
    assert.deepEqual(
      shares.map((share) => share.characterId),
      [regular],
      "only the ordinary character earns a TRPG royalty"
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) n FROM creator_earnings WHERE message_id=102").get() as { n: number }).n,
      0
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) n FROM image_generation_creator_earnings").get() as { n: number }).n,
      1
    );
    assert.ok(getCreatorPointsBalance(s.adminId) >= balanceAfterRegular);
  });

  it("the existing publish owner accepts the admin-owned staged character (isolated test DB only)", () => {
    const s = seed();
    transfer(s);
    const db = getDb();
    const store = new OfficialSupplyStore(db);
    const result = publishOfficialSupplyCharacter({ store, draftKey: SUPPLY_KEY });
    assert.equal(result.status, "published");
    assert.equal(result.characterId, s.characterId);
    const published = row(s.characterId);
    assert.equal(published.creator_id, s.adminId, "publish keeps the admin owner");
    assert.equal(published.official, 1);
    assert.equal(published.visibility, "public");
    assert.equal(canAdminManageOfficialCharacter(s.admin, editorRow(s.characterId)), true);
    assert.equal(
      (db.prepare("SELECT stage FROM official_supply_characters WHERE draft_key=?").get(SUPPLY_KEY) as { stage: string })
        .stage,
      "published"
    );
  });

  it("publish still refuses an owner that is neither a studio nor an admin", () => {
    const s = seed();
    getDb().prepare("UPDATE characters SET creator_id=? WHERE id=?").run(s.consumerId, s.characterId);
    const store = new OfficialSupplyStore(getDb());
    assert.throws(
      () => publishOfficialSupplyCharacter({ store, draftKey: SUPPLY_KEY }),
      (error: unknown) => error instanceof OfficialSupplyGateError && error.code === "owner_not_site_managed"
    );
  });
});
