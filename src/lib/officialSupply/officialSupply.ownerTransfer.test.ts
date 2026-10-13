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

import { canAccessCharacter } from "@/lib/characterVisibility";
import { CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL } from "@/lib/chatModels";
import { getCreatorTierInfo, getCreatorPointsBalance, maybeCreditCreatorReward } from "@/lib/creatorPoints";
import {
  insertCreatorLorebookForOwner,
  listCharacterCreatorLorebookAttachmentIds,
  loadAttachedCreatorLorebooksPromptBlockFromActivation,
  replaceCharacterCreatorLorebookAttachments,
  validateCreatorLorebookAttachmentIds,
} from "@/lib/creatorLorebook";
import { getDb } from "@/lib/db";
import { deleteUserCharacter } from "@/lib/deleteCharacter";
import {
  CHAT_ROOM_IMAGE_CREATOR_REWARD_CP,
  creditChatRoomImageCreatorReward,
} from "@/lib/imageGenerationEconomics";
import {
  OFFICIAL_OWNER_TRANSFER_ENV,
  transferOfficialCharacterOwnerToAdmin,
  type OfficialOwnerTransferActor,
} from "@/lib/officialSupply/ownerTransfer";
import { OfficialSupplyGateError, OfficialSupplyStore } from "@/lib/officialSupply/store";
import { createSiteManagedStudioAccount } from "@/lib/siteManagedAccounts";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { buildContext } from "@/services/contextBuilder";
import {
  assemblePersistedNextTurnInputs,
  loadPersistedNextTurnSource,
  resolvePersistedNextTurnPromptSections,
} from "@/services/nextTurnAssemblyPreparation";

const SUPPLY_KEY = "pilot-rf-v4-02";

type Seed = {
  studioId: number;
  adminId: number;
  admin: OfficialOwnerTransferActor;
  consumerId: number;
  characterId: number;
  siblingId: number;
  lorebookIds: number[];
};

describe("official character owner transfer to the acting admin", () => {
  before(() => installIsolatedTestDatabase());
  after(() => uninstallIsolatedTestDatabase());
  beforeEach(() => {
    const db = getDb();
    new OfficialSupplyStore(db);
    db.exec(`
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

  function insertUser(email: string, opts?: { isAdmin?: number; adult?: number }): number {
    return Number(
      getDb()
        .prepare(
          `INSERT INTO users (email, nickname, pw_hash, points, is_adult, is_admin, site_managed, creator_points)
           VALUES (?,?,'x',10000,?,?,0,0)`
        )
        .run(email, email.split("@")[0], opts?.adult ?? 1, opts?.isAdmin ?? 0).lastInsertRowid
    );
  }

  function insertCharacter(input: {
    ownerId: number;
    name: string;
    official: number;
    visibility: string;
    nsfw?: number;
  }): number {
    return Number(
      getDb()
        .prepare(
          `INSERT INTO characters
            (name, tagline, description, greeting, system_prompt, world, genre, genres, tags, nsfw, official,
             emoji, hue, creator_id, creator_name, visibility, moderation_status, assets, images, chats_count)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`
        )
        .run(
          input.name,
          "한줄",
          "설명",
          "인사 장면",
          "너는 승인된 캐릭터다. APPROVED_MANUSCRIPT",
          "세계관",
          "로맨스 판타지",
          '["로맨스 판타지"]',
          "[]",
          input.nsfw ?? 0,
          input.official,
          "🐺",
          210,
          input.ownerId,
          "로맨스 공식계정",
          input.visibility,
          "approved",
          JSON.stringify([{ url: "/uploads/rep.webp", tag: "대표", width: 1024, height: 1536 }]),
          JSON.stringify(["/uploads/rep.webp"])
        ).lastInsertRowid
    );
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
    const siblingId = insertCharacter({
      ownerId: studio.id,
      name: "루시안 바스케스",
      official: 1,
      visibility: "public",
    });
    const lorebookIds: number[] = [];
    for (const name of ["에테르", "태양의 옥좌"]) {
      const created = insertCreatorLorebookForOwner(db, {
        creatorId: studio.id,
        name,
        summary: "",
        keywords: [name],
        content: `${name} 설정 본문`,
      });
      assert.equal(created.ok, true);
      if (created.ok) lorebookIds.push(created.id);
    }
    replaceCharacterCreatorLorebookAttachments(db, characterId, lorebookIds);
    replaceCharacterCreatorLorebookAttachments(db, siblingId, lorebookIds);
    db.prepare(
      `INSERT INTO official_supply_characters
        (draft_key, batch_key, world_key, style_key, stage, draft_json, text_lock_hash,
         appearance_json, appearance_lock_hash, asset_plan_json, is_style_proof, staging_claim, staged_character_id)
       VALUES (?, 'b', 'w', 'romance_fantasy_v4', 'staged_private', '{}', 'tl', '{}', 'al', '{"slots":[]}', 1, 'claim', ?)`
    ).run(SUPPLY_KEY, characterId);
    return {
      studioId: studio.id,
      adminId,
      admin: { id: adminId, email: "admin@test.local", is_admin: 1 },
      consumerId,
      characterId,
      siblingId,
      lorebookIds,
    };
  }

  const characterRow = (id: number) =>
    getDb().prepare("SELECT * FROM characters WHERE id=?").get(id) as Record<string, unknown>;
  const withoutOwner = (row: Record<string, unknown>) => {
    const copy = { ...row };
    delete copy.creator_id;
    delete copy._metadata;
    return copy;
  };
  const tableDump = (table: string, order: string) =>
    JSON.stringify(getDb().prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all());

  function applyTransfer(s: Seed) {
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

  function assertGate(fn: () => unknown, code: string) {
    assert.throws(fn, (error: unknown) => {
      assert.ok(error instanceof OfficialSupplyGateError, String(error));
      assert.equal(error.code, code);
      return true;
    });
  }

  it("dry-run reports only creator_id, shared lorebooks, and writes nothing", () => {
    const s = seed();
    const before = characterRow(s.characterId);
    const lorebooksBefore = tableDump("keyword_lorebooks", "id");
    const preview = transferOfficialCharacterOwnerToAdmin({
      admin: s.admin,
      characterId: s.characterId,
      mode: "dry_run",
    });
    assert.equal(preview.applied, false);
    assert.deepEqual(preview.changedFields, ["creator_id"]);
    assert.equal(preview.fromOwnerId, s.studioId);
    assert.equal(preview.toOwnerId, s.adminId);
    assert.equal(preview.createdNewCharacter, false);
    assert.equal(preview.notifiedFollowers, false);
    assert.equal(preview.displayCreatorName, "로맨스 공식계정");
    assert.deepEqual(
      preview.lorebooks.map((item) => ({ id: item.id, shared: item.sharedWithCharacterIds })),
      s.lorebookIds.map((id) => ({ id, shared: [s.siblingId] }))
    );
    assert.deepEqual(characterRow(s.characterId), before);
    assert.equal(tableDump("keyword_lorebooks", "id"), lorebooksBefore);
  });

  it("apply is closed by default and requires a matching preflight token", () => {
    const s = seed();
    const preview = transferOfficialCharacterOwnerToAdmin({ admin: s.admin, characterId: s.characterId, mode: "dry_run" });
    assertGate(
      () =>
        transferOfficialCharacterOwnerToAdmin({
          admin: s.admin,
          characterId: s.characterId,
          mode: "apply",
          preflightSnapshot: preview.preflightSnapshot,
        }),
      "apply_disabled"
    );
    process.env[OFFICIAL_OWNER_TRANSFER_ENV] = "1";
    assertGate(
      () => transferOfficialCharacterOwnerToAdmin({ admin: s.admin, characterId: s.characterId, mode: "apply" }),
      "preflight_required"
    );
    assertGate(
      () =>
        transferOfficialCharacterOwnerToAdmin({
          admin: s.admin,
          characterId: s.characterId,
          mode: "apply",
          preflightSnapshot: { ...preview.preflightSnapshot, token: "stale" },
        }),
      "preflight_mismatch"
    );
    assert.equal(characterRow(s.characterId).creator_id, s.studioId);
  });

  it("apply changes creator_id only and keeps manuscript, images, lorebooks, supply, visibility and sibling", () => {
    const s = seed();
    const before = characterRow(s.characterId);
    const siblingBefore = characterRow(s.siblingId);
    const supplyBefore = tableDump("official_supply_characters", "draft_key");
    const lorebooksBefore = tableDump("keyword_lorebooks", "id");
    const attachmentsBefore = tableDump("character_lorebook_attachments", "character_id, position");
    const characterCount = (getDb().prepare("SELECT COUNT(*) n FROM characters").get() as { n: number }).n;

    const result = applyTransfer(s);
    assert.equal(result.applied, true);
    assert.deepEqual(result.changedFields, ["creator_id"]);

    const after = characterRow(s.characterId);
    assert.equal(after.creator_id, s.adminId);
    assert.deepEqual(withoutOwner(after), withoutOwner(before));
    assert.equal(after.updated_at, before.updated_at);
    assert.equal(after.official, 0);
    assert.equal(after.visibility, "private");
    assert.equal(after.creator_name, "로맨스 공식계정");
    assert.deepEqual(characterRow(s.siblingId), siblingBefore);
    assert.equal(tableDump("official_supply_characters", "draft_key"), supplyBefore);
    assert.equal(tableDump("keyword_lorebooks", "id"), lorebooksBefore);
    assert.equal(tableDump("character_lorebook_attachments", "character_id, position"), attachmentsBefore);
    assert.equal((getDb().prepare("SELECT COUNT(*) n FROM characters").get() as { n: number }).n, characterCount);
    assert.equal((getDb().prepare("SELECT COUNT(*) n FROM user_notifications").get() as { n: number }).n, 0);
  });

  it("the admin can open the private character and the former studio owner no longer owns it", () => {
    const s = seed();
    const row = () => {
      const r = characterRow(s.characterId);
      return {
        id: s.characterId,
        creator_id: r.creator_id as number,
        visibility: r.visibility as "private",
        moderation_status: r.moderation_status as "approved",
        share_slug: null,
        official: 0,
      };
    };
    assert.equal(canAccessCharacter(row(), s.adminId).ok, false);
    applyTransfer(s);
    assert.equal(canAccessCharacter(row(), s.adminId).ok, true);
    assert.equal(canAccessCharacter(row(), s.consumerId).ok, false);
    assert.equal(canAccessCharacter(row(), null).ok, false);
  });

  it("is idempotent and never targets anyone but the acting admin", () => {
    const s = seed();
    applyTransfer(s);
    const again = transferOfficialCharacterOwnerToAdmin({ admin: s.admin, characterId: s.characterId, mode: "dry_run" });
    assert.deepEqual(again.changedFields, []);
    process.env[OFFICIAL_OWNER_TRANSFER_ENV] = "1";
    const second = transferOfficialCharacterOwnerToAdmin({
      admin: s.admin,
      characterId: s.characterId,
      mode: "apply",
      preflightSnapshot: again.preflightSnapshot,
    });
    assert.equal(second.applied, false);
    assert.equal(characterRow(s.characterId).creator_id, s.adminId);
  });

  it("STOPs for non-admins, public/official rows, unlinked rows, non-studio owners and site-managed targets", () => {
    const s = seed();
    assertGate(
      () =>
        transferOfficialCharacterOwnerToAdmin({
          admin: { id: s.consumerId, email: "consumer@test.local", is_admin: 0 },
          characterId: s.characterId,
          mode: "dry_run",
        }),
      "admin_required"
    );
    assertGate(
      () => transferOfficialCharacterOwnerToAdmin({ admin: s.admin, characterId: s.siblingId, mode: "dry_run" }),
      "transfer_requires_private_unlisted"
    );
    const plain = insertCharacter({ ownerId: s.consumerId, name: "일반", official: 0, visibility: "private" });
    assertGate(
      () => transferOfficialCharacterOwnerToAdmin({ admin: s.admin, characterId: plain, mode: "dry_run" }),
      "supply_link_required"
    );
    getDb()
      .prepare(
        `INSERT INTO official_supply_characters
          (draft_key, batch_key, world_key, style_key, stage, draft_json, text_lock_hash,
           appearance_json, appearance_lock_hash, asset_plan_json, is_style_proof, staging_claim, staged_character_id)
         VALUES ('other', 'b', 'w', 's', 'staged_private', '{}', 'tl', '{}', 'al', '{"slots":[]}', 0, 'c2', ?)`
      )
      .run(plain);
    assertGate(
      () => transferOfficialCharacterOwnerToAdmin({ admin: s.admin, characterId: plain, mode: "dry_run" }),
      "not_official_manageable"
    );
    assertGate(
      () => transferOfficialCharacterOwnerToAdmin({ admin: s.admin, characterId: 999999, mode: "dry_run" }),
      "character_missing"
    );
    const adultless = insertUser("minor-admin@test.local", { isAdmin: 1, adult: 0 });
    assertGate(
      () =>
        transferOfficialCharacterOwnerToAdmin({
          admin: { id: adultless, email: "minor-admin@test.local", is_admin: 1 },
          characterId: s.characterId,
          mode: "dry_run",
        }),
      "owner_not_adult"
    );
    getDb().prepare("UPDATE users SET site_managed=1 WHERE id=?").run(s.adminId);
    assertGate(
      () => transferOfficialCharacterOwnerToAdmin({ admin: s.admin, characterId: s.characterId, mode: "dry_run" }),
      "admin_account_site_managed"
    );
  });

  it("rolls back when anything besides creator_id would change", () => {
    const s = seed();
    const preview = transferOfficialCharacterOwnerToAdmin({ admin: s.admin, characterId: s.characterId, mode: "dry_run" });
    getDb().exec(`
      CREATE TRIGGER test_touch_prompt AFTER UPDATE OF creator_id ON characters
      BEGIN UPDATE characters SET tagline='mutated' WHERE id=NEW.id; END;
    `);
    process.env[OFFICIAL_OWNER_TRANSFER_ENV] = "1";
    try {
      assertGate(
        () =>
          transferOfficialCharacterOwnerToAdmin({
            admin: s.admin,
            characterId: s.characterId,
            mode: "apply",
            preflightSnapshot: preview.preflightSnapshot,
          }),
        "transfer_side_effect"
      );
    } finally {
      getDb().exec("DROP TRIGGER IF EXISTS test_touch_prompt");
    }
    assert.equal(characterRow(s.characterId).creator_id, s.studioId);
    assert.equal(characterRow(s.characterId).tagline, "한줄");
  });

  it("keeps the RP prompt and lorebook injection byte-identical across the transfer", async () => {
    const s = seed();
    const db = getDb();
    const chatId = Number(
      db
        .prepare(
          `INSERT INTO chats (user_id, character_id, mode, user_note, adult_handoff_enabled)
           VALUES (?,?,'safe','',0)`
        )
        .run(s.adminId, s.characterId).lastInsertRowid
    );
    db.prepare("INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)").run(
      chatId,
      "assistant",
      "인사 장면",
      "greeting"
    );
    const user = {
      id: s.adminId,
      email: "admin@test.local",
      nickname: "admin",
      is_adult: 1,
      nsfw_on: 0,
      points: 10000,
      sub_until: null,
      google_id: null,
      pref: null,
      sub_plan: null,
      sub_auto_renew: 0,
      notice_last_read_id: 0,
    } as Parameters<typeof loadPersistedNextTurnSource>[0]["user"];

    async function assembled(): Promise<string> {
      const source = loadPersistedNextTurnSource({ chatId, user });
      assert.ok(source);
      const sections = await resolvePersistedNextTurnPromptSections(source, { currentUserMessage: "" });
      const input = await assemblePersistedNextTurnInputs({
        source,
        sections,
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
        currentUserMessage: "",
      });
      return buildContext(input).systemPrompt;
    }
    const loreBlock = () =>
      loadAttachedCreatorLorebooksPromptBlockFromActivation(
        db,
        s.characterId,
        { currentUserText: "에테르 태양의 옥좌" },
        { persistActiveMatches: false }
      );

    const promptBefore = await assembled();
    const loreBefore = loreBlock();
    assert.ok(loreBefore.includes("에테르 설정 본문"));
    applyTransfer(s);
    assert.equal(await assembled(), promptBefore);
    assert.equal(loreBlock(), loreBefore);
    assert.deepEqual(listCharacterCreatorLorebookAttachmentIds(db, s.characterId), s.lorebookIds);
  });

  it("creates no CP, tier or withdrawal change for the admin; official rows never earn CP", () => {
    const s = seed();
    const tierBefore = getCreatorTierInfo(s.adminId);
    applyTransfer(s);
    assert.deepEqual(getCreatorTierInfo(s.adminId), { ...tierBefore, characterCount: tierBefore.characterCount + 1 });
    assert.equal(getCreatorTierInfo(s.adminId).rewardRate, tierBefore.rewardRate);
    assert.equal(getCreatorTierInfo(s.adminId).tierLevel, tierBefore.tierLevel);

    const selfUse = maybeCreditCreatorReward({
      creatorId: s.adminId,
      official: 0,
      characterId: s.characterId,
      messageId: 1,
      consumerUserId: s.adminId,
      pointsSpent: 100,
    });
    assert.equal(selfUse, 0);
    assert.equal(getCreatorPointsBalance(s.adminId), 0);

    insertCharacter({ ownerId: s.adminId, name: "관리자 일반 1", official: 0, visibility: "public" });
    insertCharacter({ ownerId: s.adminId, name: "관리자 일반 2", official: 0, visibility: "public" });
    assert.ok(getCreatorTierInfo(s.adminId).rewardRate > 0);
    const adminOwnedOfficial = insertCharacter({ ownerId: s.adminId, name: "공개된 공식", official: 1, visibility: "public" });
    assert.equal(
      maybeCreditCreatorReward({
        creatorId: s.adminId,
        official: 1,
        characterId: adminOwnedOfficial,
        messageId: 2,
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
        characterId: adminOwnedOfficial,
      }),
      0
    );
    assert.equal(getCreatorPointsBalance(s.adminId), 0);
    assert.equal((getDb().prepare("SELECT COUNT(*) n FROM image_generation_creator_earnings").get() as { n: number }).n, 0);
  });

  it("still pays image CP for an ordinary non-official creator character", () => {
    const s = seed();
    const ordinary = insertUser("creator@test.local");
    const ordinaryChar = insertCharacter({ ownerId: ordinary, name: "일반 공개", official: 0, visibility: "public" });
    insertCharacter({ ownerId: ordinary, name: "일반 공개 2", official: 0, visibility: "public" });
    const paid = creditChatRoomImageCreatorReward(getDb(), {
      generationId: 7,
      creatorId: ordinary,
      consumerUserId: s.consumerId,
      source: "character",
      characterId: ordinaryChar,
    });
    assert.equal(paid, CHAT_ROOM_IMAGE_CREATOR_REWARD_CP);
  });

  it("owner delete is refused for characters still linked to the official supply", () => {
    const s = seed();
    applyTransfer(s);
    const result = deleteUserCharacter(s.characterId, s.adminId);
    assert.equal(result.ok, false);
    assert.ok(characterRow(s.characterId));
    assert.equal(listCharacterCreatorLorebookAttachmentIds(getDb(), s.characterId).length, 2);
  });

  it("known follow-up: shared lorebooks stay studio-owned, so the generic editor cannot re-attach them as admin", () => {
    const s = seed();
    applyTransfer(s);
    const validation = validateCreatorLorebookAttachmentIds(getDb(), s.adminId, s.lorebookIds);
    assert.equal(validation.ok, false);
    assert.equal(validateCreatorLorebookAttachmentIds(getDb(), s.studioId, s.lorebookIds).ok, true);
  });
});
