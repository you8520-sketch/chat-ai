import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import { getDb } from "@/lib/db";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { isCreatorMonetizationEligible } from "@/lib/creatorMonetization";
import {
  getCreatorPointsBalance,
  getCreatorTierInfo,
  maybeCreditCreatorReward,
} from "@/lib/creatorPoints";
import {
  CHAT_ROOM_IMAGE_CREATOR_REWARD_CP,
  creditChatRoomImageCreatorReward,
} from "@/lib/imageGenerationEconomics";
import { getWithdrawalEligibility } from "@/lib/withdrawalEligibility";
import {
  createSiteManagedStudioAccount,
  isSiteManagedUser,
  rejectClientSiteManagedAssignment,
} from "@/lib/siteManagedAccounts";
import { isAdminUser } from "@/lib/isAdminUser";
import { canAccessCharacter, listableWhere } from "@/lib/characterVisibility";
import { OfficialSupplyGateError, OfficialSupplyStore } from "@/lib/officialSupply/store";
import { publishOfficialSupplyCharacter } from "@/lib/officialSupply/publish";
import { testBatchConfig } from "@/lib/officialSupply/officialSupply.fixtures";
import { splitTrpgCreatorRewards } from "@/lib/trpg/creatorRewards";

describe("site-managed official studio foundation", () => {
  before(() => installIsolatedTestDatabase());
  after(() => uninstallIsolatedTestDatabase());
  beforeEach(() => {
    const db = getDb();
    // Ensure official-supply tables exist before cleanup.
    new OfficialSupplyStore(db);
    db.exec(`
      DELETE FROM creator_earnings;
      DELETE FROM creator_point_logs;
      DELETE FROM image_generation_creator_earnings;
      DELETE FROM user_notifications;
      DELETE FROM official_supply_assets;
      DELETE FROM official_supply_characters;
      DELETE FROM official_supply_batches;
      DELETE FROM characters;
      DELETE FROM users WHERE email LIKE '%@site-managed.invalid' OR email LIKE '%@test.local';
    `);
  });

  function insertOrdinaryCreator(opts?: { email?: string; isAdmin?: boolean }): number {
    const db = getDb();
    const email = opts?.email ?? `creator-${Math.random().toString(16).slice(2)}@test.local`;
    const info = db
      .prepare(
        `INSERT INTO users (email, nickname, pw_hash, points, is_adult, is_admin, site_managed, creator_points, real_name)
         VALUES (?,?, 'x', 0, 1, ?, 0, 0, '홍길동')`
      )
      .run(email, "일반크리에이터", opts?.isAdmin ? 1 : 0);
    return Number(info.lastInsertRowid);
  }

  function insertConsumer(): number {
    const db = getDb();
    const info = db
      .prepare(
        `INSERT INTO users (email, nickname, pw_hash, points, is_adult, site_managed)
         VALUES (?, '소비자', 'x', 10000, 1, 0)`
      )
      .run(`consumer-${Math.random().toString(16).slice(2)}@test.local`);
    return Number(info.lastInsertRowid);
  }

  function insertCharacter(opts: {
    creatorId: number;
    official?: number;
    visibility?: string;
    moderation?: string;
    nsfw?: number;
    participantMinAge?: number | null;
    assets?: string;
    name?: string;
  }): number {
    const db = getDb();
    const info = db
      .prepare(
        `INSERT INTO characters
          (name, tagline, description, greeting, system_prompt, genre, tags, nsfw, official,
           emoji, hue, creator_id, creator_name, visibility, moderation_status, assets, participant_min_age)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        opts.name ?? "테스트캐",
        "tag",
        "desc",
        "hi",
        "sys",
        "로맨스",
        "[]",
        opts.nsfw ?? 0,
        opts.official ?? 0,
        "✨",
        260,
        opts.creatorId,
        "스튜디오",
        opts.visibility ?? "public",
        opts.moderation ?? "approved",
        opts.assets ??
          JSON.stringify([
            {
              url: "/uploads/rep.webp",
              tag: "대표",
              width: 1024,
              height: 1536,
              moderationStatus: "checked",
            },
          ]),
        opts.participantMinAge ?? null
      );
    return Number(info.lastInsertRowid);
  }

  it("ordinary creator is monetization-eligible; site-managed is not", () => {
    const ordinary = insertOrdinaryCreator();
    const studio = createSiteManagedStudioAccount({
      nickname: "로맨스 공식 스튜디오",
      email: "romance@site-managed.invalid",
    });
    assert.equal(isCreatorMonetizationEligible(ordinary), true);
    assert.equal(isCreatorMonetizationEligible(studio.id), false);
    assert.equal(isSiteManagedUser(studio.id), true);
    assert.equal(isSiteManagedUser(ordinary), false);
  });

  it("admin ordinary creator remains monetization-eligible; site_managed never grants admin", () => {
    const adminCreator = insertOrdinaryCreator({ email: "admin-creator@test.local", isAdmin: true });
    const studio = createSiteManagedStudioAccount({
      nickname: "BL 공식 스튜디오",
      email: "bl@site-managed.invalid",
    });
    assert.equal(isCreatorMonetizationEligible(adminCreator), true);
    assert.equal(isAdminUser({ email: studio.email, is_admin: studio.is_admin }), false);
    assert.equal(studio.is_admin, 0);
    const row = getDb()
      .prepare("SELECT is_admin, site_managed FROM users WHERE id=?")
      .get(studio.id) as { is_admin: number; site_managed: number };
    assert.equal(row.is_admin, 0);
    assert.equal(row.site_managed, 1);
  });

  it("characters.official alone does not change account monetization eligibility", () => {
    const ordinary = insertOrdinaryCreator();
    insertCharacter({ creatorId: ordinary, official: 1 });
    assert.equal(isCreatorMonetizationEligible(ordinary), true);
    assert.equal(isSiteManagedUser(ordinary), false);
  });

  it("chat creator reward credits ordinary creators and zeroes site-managed", () => {
    const ordinary = insertOrdinaryCreator();
    const studio = createSiteManagedStudioAccount({
      nickname: "판타지 공식 스튜디오",
      email: "fantasy@site-managed.invalid",
    });
    const consumer = insertConsumer();
    // Seed enough public chars for sprout rate
    for (let i = 0; i < 2; i++) {
      insertCharacter({ creatorId: ordinary, name: `c${i}` });
    }
    const ordinaryChar = insertCharacter({ creatorId: ordinary, official: 0 });
    const studioChar = insertCharacter({ creatorId: studio.id, official: 0 });

    const r1 = maybeCreditCreatorReward({
      creatorId: ordinary,
      official: 0,
      characterId: ordinaryChar,
      messageId: 9001,
      consumerUserId: consumer,
      pointsSpent: 100,
    });
    assert.ok(r1 > 0);
    assert.ok(getCreatorPointsBalance(ordinary) > 0);

    const r2 = maybeCreditCreatorReward({
      creatorId: studio.id,
      official: 0,
      characterId: studioChar,
      messageId: 9002,
      consumerUserId: consumer,
      pointsSpent: 100,
    });
    assert.equal(r2, 0);
    assert.equal(getCreatorPointsBalance(studio.id), 0);
    const earnings = getDb()
      .prepare("SELECT COUNT(*) AS c FROM creator_earnings WHERE creator_id=?")
      .get(studio.id) as { c: number };
    assert.equal(earnings.c, 0);
  });

  it("self-use still yields zero for ordinary creators", () => {
    const ordinary = insertOrdinaryCreator();
    for (let i = 0; i < 2; i++) insertCharacter({ creatorId: ordinary });
    const charId = insertCharacter({ creatorId: ordinary });
    const reward = maybeCreditCreatorReward({
      creatorId: ordinary,
      official: 0,
      characterId: charId,
      messageId: 9100,
      consumerUserId: ordinary,
      pointsSpent: 100,
    });
    assert.equal(reward, 0);
  });

  it("image creator reward credits ordinary creators and zeroes site-managed", () => {
    const ordinary = insertOrdinaryCreator();
    const studio = createSiteManagedStudioAccount({
      nickname: "현대판타지 공식 스튜디오",
      email: "modern@site-managed.invalid",
    });
    for (let i = 0; i < 2; i++) insertCharacter({ creatorId: ordinary });
    const consumer = insertConsumer();
    const db = getDb();

    const a = creditChatRoomImageCreatorReward(db, {
      generationId: 1,
      creatorId: ordinary,
      consumerUserId: consumer,
      source: "character",
    });
    assert.equal(a, CHAT_ROOM_IMAGE_CREATOR_REWARD_CP);
    assert.equal(getCreatorPointsBalance(ordinary), CHAT_ROOM_IMAGE_CREATOR_REWARD_CP);

    const b = creditChatRoomImageCreatorReward(db, {
      generationId: 2,
      creatorId: studio.id,
      consumerUserId: consumer,
      source: "character",
    });
    assert.equal(b, 0);
    assert.equal(getCreatorPointsBalance(studio.id), 0);
  });

  it("TRPG character royalty split excludes site-managed creators", () => {
    const ordinary = insertOrdinaryCreator();
    const studio = createSiteManagedStudioAccount({
      nickname: "센티넬버스 공식 스튜디오",
      email: "sentinel@site-managed.invalid",
    });
    const consumer = insertConsumer();
    for (let i = 0; i < 2; i++) insertCharacter({ creatorId: ordinary });

    const shares = splitTrpgCreatorRewards({
      paidSpend: 100,
      consumerUserId: consumer,
      authorUserId: ordinary,
      authorRate: 0.1,
      characterCreators: [
        { creatorId: studio.id, characterId: 1, official: 0 },
        { creatorId: ordinary, characterId: 2, official: 0 },
      ],
    });
    assert.ok(shares.every((s) => s.creatorId !== studio.id));
    assert.ok(shares.some((s) => s.creatorId === ordinary));
  });

  it("site-managed has no creator tier and cannot withdraw", () => {
    const studio = createSiteManagedStudioAccount({
      nickname: "로맨스 공식 스튜디오2",
      email: "romance2@site-managed.invalid",
    });
    for (let i = 0; i < 5; i++) {
      insertCharacter({ creatorId: studio.id, official: 0 });
    }
    const tier = getCreatorTierInfo(studio.id);
    assert.equal(tier.rewardRate, 0);
    assert.equal(tier.characterCount, 0);

    const eligibility = getWithdrawalEligibility(studio.id);
    assert.equal(eligibility.canWithdraw, false);
    assert.match(String(eligibility.blockReason), /공식 스튜디오/);
  });

  it("ordinary creator withdrawal eligibility still depends on adult/real_name", () => {
    const ordinary = insertOrdinaryCreator();
    const eligibility = getWithdrawalEligibility(ordinary);
    assert.equal(eligibility.canWithdraw, true);
  });

  it("client body cannot assign site_managed", () => {
    assert.throws(() => rejectClientSiteManagedAssignment({ site_managed: true }), /site_managed/);
    assert.throws(() => rejectClientSiteManagedAssignment({ siteManaged: 1 }), /site_managed/);
    assert.doesNotThrow(() => rejectClientSiteManagedAssignment({ nickname: "ok" }));
  });

  function seedStagedDraft(opts: {
    draftKey: string;
    batchKey: string;
    characterId: number;
  }): OfficialSupplyStore {
    const db = getDb();
    const store = new OfficialSupplyStore(db);
    db.prepare(
      `INSERT OR IGNORE INTO official_supply_batches (batch_key, config_json) VALUES (?, ?)`
    ).run(opts.batchKey, JSON.stringify(testBatchConfig()));
    db.prepare(
      `INSERT INTO official_supply_characters
        (draft_key, batch_key, world_key, style_key, stage, draft_json, staged_character_id)
       VALUES (?, ?, 'w', 's', 'staged_private', ?, ?)`
    ).run(
      opts.draftKey,
      opts.batchKey,
      JSON.stringify({ draftKey: opts.draftKey, name: "seed" }),
      opts.characterId
    );
    return store;
  }

  it("canonical publish: staged_private site-managed → public/listable/official; idempotent", () => {
    const studio = createSiteManagedStudioAccount({
      nickname: "로맨스 공식 스튜디오",
      email: "publish-romance@site-managed.invalid",
    });
    const db = getDb();
    const stagedId = insertCharacter({
      creatorId: studio.id,
      official: 0,
      visibility: "private",
      moderation: "pending",
      nsfw: 1,
      participantMinAge: 27,
      name: "공식공개캐",
    });
    const store = seedStagedDraft({
      draftKey: "pub-1",
      batchKey: "b1",
      characterId: stagedId,
    });

    const beforeListed = db
      .prepare(`SELECT 1 AS ok FROM characters WHERE id=? AND ${listableWhere()}`)
      .get(stagedId);
    assert.equal(beforeListed, undefined);

    const first = publishOfficialSupplyCharacter({ store, draftKey: "pub-1" });
    assert.equal(first.status, "published");
    assert.equal(first.official, 1);

    const row = db
      .prepare("SELECT official, visibility, moderation_status FROM characters WHERE id=?")
      .get(stagedId) as { official: number; visibility: string; moderation_status: string };
    assert.equal(row.official, 1);
    assert.equal(row.visibility, "public");
    assert.equal(row.moderation_status, "approved");
    assert.equal(store.getCharacter("pub-1").stage, "published");

    const listed = db
      .prepare(`SELECT 1 AS ok FROM characters WHERE id=? AND ${listableWhere()}`)
      .get(stagedId) as { ok: number };
    assert.equal(listed.ok, 1);

    const access = canAccessCharacter(
      {
        id: stagedId,
        creator_id: studio.id,
        visibility: "public",
        moderation_status: "approved",
        share_slug: null,
        official: 1,
      },
      null
    );
    assert.equal(access.ok, true);

    const second = publishOfficialSupplyCharacter({ store, draftKey: "pub-1" });
    assert.equal(second.status, "already_published");
    const notifCount = db
      .prepare("SELECT COUNT(*) AS c FROM user_notifications WHERE type='creator_character' AND ref_id=?")
      .get(stagedId) as { c: number };
    assert.equal(notifCount.c, 0); // no followers → zero rows, and still idempotent
  });

  it("publish blocks non-site-managed owner and hard-moderation reject", () => {
    const ordinary = insertOrdinaryCreator();
    const charId = insertCharacter({
      creatorId: ordinary,
      official: 0,
      visibility: "private",
      moderation: "pending",
    });
    const store = seedStagedDraft({
      draftKey: "pub-block",
      batchKey: "b2",
      characterId: charId,
    });

    assert.throws(
      () => publishOfficialSupplyCharacter({ store, draftKey: "pub-block" }),
      (err: unknown) => err instanceof OfficialSupplyGateError && err.code === "owner_not_site_managed"
    );

    const studio = createSiteManagedStudioAccount({
      nickname: "검수 스튜디오",
      email: "mod@site-managed.invalid",
    });
    const badId = insertCharacter({
      creatorId: studio.id,
      official: 0,
      visibility: "private",
      moderation: "pending",
      assets: JSON.stringify([
        { url: "/uploads/bad.webp", tag: "대표", moderationStatus: "hard_reject" },
      ]),
    });
    const store2 = seedStagedDraft({
      draftKey: "pub-mod",
      batchKey: "b2b",
      characterId: badId,
    });
    assert.throws(
      () => publishOfficialSupplyCharacter({ store: store2, draftKey: "pub-mod" }),
      (err: unknown) => err instanceof OfficialSupplyGateError && err.code === "publish_moderation_reject"
    );
  });

  it("publish blocks stale official-supply assets", () => {
    const studio = createSiteManagedStudioAccount({
      nickname: "stale studio",
      email: "stale@site-managed.invalid",
    });
    const db = getDb();
    const charId = insertCharacter({
      creatorId: studio.id,
      official: 0,
      visibility: "private",
      moderation: "pending",
    });
    const store = seedStagedDraft({
      draftKey: "pub-stale",
      batchKey: "b3",
      characterId: charId,
    });
    db.prepare(
      `INSERT INTO official_supply_assets (draft_key, slot_key, kind, status, attempts, spent_usd, has_unknown_cost)
       VALUES (?, 'rep', 'representative', 'stale', 1, 0, 0)`
    ).run("pub-stale");

    assert.throws(
      () => publishOfficialSupplyCharacter({ store, draftKey: "pub-stale" }),
      (err: unknown) => err instanceof OfficialSupplyGateError && err.code === "publish_stale_assets"
    );
  });

  it("19+ viewer gate source still ignores site_managed / official for adult check", () => {
    const page = fs.readFileSync(path.join(process.cwd(), "src/app/character/[id]/page.tsx"), "utf8");
    const route = fs.readFileSync(path.join(process.cwd(), "src/app/api/chat/route.ts"), "utf8");
    assert.match(page, /if \(c\.nsfw === 1 && !user\.is_adult\) \{/);
    assert.match(route, /if \(ch\.nsfw && !user\.is_adult\) \{/);
    assert.doesNotMatch(page, /site_managed.*is_adult|is_adult.*site_managed/);
  });

  it("OfficialStudioBadge is distinct from partner OfficialCreatorBadge", () => {
    const studioBadge = fs.readFileSync(
      path.join(process.cwd(), "src/components/OfficialStudioBadge.tsx"),
      "utf8"
    );
    const partnerBadge = fs.readFileSync(
      path.join(process.cwd(), "src/components/OfficialCreatorBadge.tsx"),
      "utf8"
    );
    assert.match(studioBadge, /공식 스튜디오/);
    assert.match(partnerBadge, /공식 크리에이터/);
    assert.doesNotMatch(studioBadge, /OfficialCreatorBadge/);
  });

  it("creator profile labels site-managed as 공식 스튜디오 and hides gift/dashboard", () => {
    const page = fs.readFileSync(path.join(process.cwd(), "src/app/creator/[id]/page.tsx"), "utf8");
    assert.match(page, /siteManaged \? "공식 스튜디오" : "크리에이터"/);
    assert.match(page, /!isOwner && !siteManaged &&/);
    assert.match(page, /isOwner && !siteManaged &&/);
    assert.match(page, /OfficialStudioBadge/);
  });
});
