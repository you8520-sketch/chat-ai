import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import { getDb } from "@/lib/db";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { parseCharacterFormBody, updateCharacterFromForm, type SessionUser } from "@/lib/characterFormSave";
import { isCreatorMonetizationEligible } from "@/lib/creatorMonetization";
import {
  insertCreatorLorebookForOwner,
  listCharacterCreatorLorebookAttachmentIds,
  replaceCharacterCreatorLorebookAttachments,
} from "@/lib/creatorLorebook";
import {
  canAdminManageOfficialCharacter,
  isOfficialAdminActor,
  listOfficialCharactersForAdmin,
  resolveCanonicalOfficialOwner,
  resolveOfficialCharacterEditorAccess,
  updateOfficialDisplayCreatorNameAsAdmin,
} from "@/lib/officialAdminAccess";
import {
  LUCIAN_CANONICAL_NAME,
  LUCIAN_DEFAULT_DISPLAY_CREATOR_NAME,
  rejectClientOfficialDisplayCreatorAssignment,
} from "@/lib/officialDisplayCreatorName";
import {
  renderAppearanceBlock,
  renderRuntimeAppearanceBlock,
} from "@/lib/officialSupply/appearance";
import { buildOfficialCharacterReviewReport } from "@/lib/officialSupply/characterReview";
import { buildOfficialCharacterFormBody, composeOfficialSystemPrompt } from "@/lib/officialSupply/characterText";
import { loadCompiledOfficialCharacterSource } from "@/lib/officialSupply/compiledOfficialSource";
import {
  OFFICIAL_IN_PLACE_APPLY_ENV,
  syncOfficialCharacterInPlace,
} from "@/lib/officialSupply/inPlaceSync";
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

  function richOfficialAssets() {
    return Array.from({ length: 14 }, (_, index) => ({
      url: `/uploads/official-pilot-rf-v4-03__${index === 0 ? "rep-a1" : `scene-${String(index).padStart(2, "0")}`}.webp`,
      tag: index === 0 ? "대표" : `장면${index}`,
      width: 1024 + index,
      height: 1536 + index,
      representativeRank: index === 0 ? 1 : index < 5 ? index + 1 : undefined,
      viewerBlur: index === 5,
      adultFlagged: index === 3,
      moderationReject: index === 7,
      moderationReason: index === 7 ? "keep-moderation-reason" : undefined,
    }));
  }

  function insertOfficialLucian(
    creatorId: number,
    creatorName: string,
    opts?: { rich?: boolean }
  ): number {
    const db = getDb();
    const assets = opts?.rich
      ? richOfficialAssets()
      : [
          {
            url: "/uploads/official-pilot-rf-v4-03__rep-a1.webp",
            tag: "대표",
            width: 1024,
            height: 1536,
            adultFlagged: false,
            moderationReject: false,
          },
        ];
    const info = db
      .prepare(
        `INSERT INTO characters
          (name, tagline, description, greeting, system_prompt, world, genre, genres, tags, nsfw, official,
           emoji, hue, creator_id, creator_name, visibility, moderation_status, assets,
           status_widget_json, jsx_components_json, recommended_writing_style,
           narration_style_instructions, comments_enabled, appearance_raw, appearance_compiled,
           likes, chats_count, example_dialog, creator_comment)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        LUCIAN_CANONICAL_NAME,
        "금고털이 경보 속, 당신의 손목을 잡고 달아난 브로커.",
        "구버전 공개 설명",
        "구버전 인사",
        "구버전 시스템",
        "구버전 세계",
        "로맨스 판타지",
        '["로맨스 판타지"]',
        '["협상가"]',
        0,
        1,
        opts?.rich ? "🔮" : "✨",
        opts?.rich ? 111 : 260,
        creatorId,
        creatorName,
        "public",
        "approved",
        JSON.stringify(assets),
        opts?.rich ? '{"kind":"custom","label":"keep-status-widget"}' : "",
        opts?.rich ? '[{"id":"keep-jsx"}]' : "",
        opts?.rich ? "literary-keep" : "",
        opts?.rich ? "기존 나레이션을 유지" : "",
        opts?.rich ? 0 : 1,
        opts?.rich ? "기존외형raw" : "",
        opts?.rich ? "기존외형compiled" : "",
        opts?.rich ? 42 : 0,
        opts?.rich ? 17 : 0,
        "구버전 예시대사",
        "구버전 제작자 코멘트"
      );
    const characterId = Number(info.lastInsertRowid);
    if (opts?.rich) {
      db.prepare(
        `INSERT INTO status_widget_triggers
          (character_id, trigger_id, status_key, operator, value, event_key, effect_text)
         VALUES (?, 'keep-trigger', 'hp', 'lte', '3', 'keep-event', 'keep-effect')`
      ).run(characterId);
      const liker = insertUser({
        email: `liker-${characterId}@test.local`,
        nickname: "좋아요유저",
      });
      db.prepare("INSERT INTO likes (user_id, character_id) VALUES (?, ?)").run(liker, characterId);
    }
    return characterId;
  }

  function linkLucianSupply(characterId: number, stage = "published"): void {
    const source = loadCompiledOfficialCharacterSource("pilot-rf-03");
    getDb()
      .prepare(
        `INSERT INTO official_supply_characters
          (draft_key, batch_key, world_key, style_key, stage, draft_json, staged_character_id)
         VALUES ('pilot-rf-03', 'test-batch', ?, 'test-style', ?, '{}', ?)`
      )
      .run(source.worldKey, stage, characterId);
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
    linkLucianSupply(characterId);
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

    const applied = await withApplyEnabled(() =>
      syncOfficialCharacterInPlace({
        admin,
        characterId,
        draftKey: "pilot-rf-03",
        mode: "apply",
        preflightSnapshot: preview.preflightSnapshot,
      })
    );
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

    const againPreview = await syncOfficialCharacterInPlace({
      admin,
      characterId,
      draftKey: "pilot-rf-03",
      mode: "dry_run",
    });
    const again = await withApplyEnabled(() =>
      syncOfficialCharacterInPlace({
        admin,
        characterId,
        draftKey: "pilot-rf-03",
        mode: "apply",
        preflightSnapshot: againPreview.preflightSnapshot,
      })
    );
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

  it("MUST FIX 1 before: sparse form save wipes unrelated Lucian settings", async () => {
    const studio = createSiteManagedStudioAccount({
      nickname: "로맨스 공식 스튜디오",
      email: "romance-sparse@site-managed.invalid",
    });
    const characterId = insertOfficialLucian(studio.id, "로맨스 공식 스튜디오", { rich: true });
    const adminId = insertUser({ email: ADMIN.email!, nickname: ADMIN.nickname, isAdmin: 1 });
    const source = loadCompiledOfficialCharacterSource("pilot-rf-03");
    const owner: SessionUser = {
      id: studio.id,
      nickname: studio.nickname,
      is_adult: 1,
      email: studio.email,
      is_admin: 0,
    };
    const before = snapshotPreserved(characterId);
    const saved = await updateCharacterFromForm(
      owner,
      characterId,
      buildOfficialCharacterFormBody({
        draft: source.draft,
        appearanceBlock: source.appearanceBlock,
        assets: richOfficialAssets().map((asset) => ({
          url: asset.url,
          tag: asset.tag,
          width: asset.width,
          height: asset.height,
          viewerBlur: asset.viewerBlur === true,
          representativeRank: asset.representativeRank,
          adultFlagged: asset.adultFlagged,
          moderationReject: asset.moderationReject,
          moderationReason: asset.moderationReason,
        })),
      }),
      {
        actor: "official_admin",
        adminUser: { ...ADMIN, id: adminId },
        preserveListingState: true,
        preserveAdultFlags: true,
        skipFollowerNotify: true,
      }
    );
    assert.equal(saved.ok, true);
    const after = snapshotPreserved(characterId);
    assert.notEqual(after.statusWidgetJson, before.statusWidgetJson);
    assert.notEqual(after.jsxComponentsJson, before.jsxComponentsJson);
    assert.notEqual(after.recommendedWritingStyle, before.recommendedWritingStyle);
    assert.notEqual(after.narrationStyle, before.narrationStyle);
    assert.notEqual(after.commentsEnabled, before.commentsEnabled);
  });

  it("MUST FIX 1 after: dedicated in-place sync preserves settings, 14 assets, likes, chats, same id", async () => {
    const studio = createSiteManagedStudioAccount({
      nickname: "로맨스 공식 스튜디오",
      email: "romance-preserve@site-managed.invalid",
    });
    const characterId = insertOfficialLucian(studio.id, "로맨스 공식 스튜디오", { rich: true });
    linkLucianSupply(characterId);
    const adminId = insertUser({ email: ADMIN.email!, nickname: ADMIN.nickname, isAdmin: 1 });
    const before = snapshotPreserved(characterId);
    assert.equal(before.assetCount, 14);
    const preview = await syncOfficialCharacterInPlace({
      admin: { ...ADMIN, id: adminId },
      characterId,
      draftKey: "pilot-rf-03",
      mode: "dry_run",
    });
    const applied = await withApplyEnabled(() =>
      syncOfficialCharacterInPlace({
        admin: { ...ADMIN, id: adminId },
        characterId,
        draftKey: "pilot-rf-03",
        mode: "apply",
        preflightSnapshot: preview.preflightSnapshot,
      })
    );
    assert.equal(applied.applied, true);
    assert.equal(applied.characterId, characterId);
    const after = snapshotPreserved(characterId);
    assert.equal(after.id, before.id);
    assert.notEqual(after.tagline, before.tagline);
    assert.equal(after.assetsJson, before.assetsJson);
    assert.equal(after.statusWidgetJson, '{"kind":"custom","label":"keep-status-widget"}');
    assert.equal(after.jsxComponentsJson, '[{"id":"keep-jsx"}]');
    assert.equal(after.recommendedWritingStyle, "literary-keep");
    assert.equal(after.narrationStyle, "기존 나레이션을 유지");
    assert.equal(after.commentsEnabled, 0);
    assert.equal(after.appearanceRaw, "기존외형raw");
    assert.equal(after.appearanceCompiled, "기존외형compiled");
    assert.equal(after.likes, 42);
    assert.equal(after.chatsCount, 17);
    assert.equal(after.likeRows, 1);
    assert.equal(after.triggerCount, 1);
    assert.equal(after.official, 1);
    assert.equal(after.visibility, "public");
    assert.equal(after.moderationStatus, "approved");
    assert.equal(after.nsfw, 0);
    assert.equal(after.creatorId, studio.id);
    assert.equal(after.emoji, "🔮");
    assert.equal(after.hue, 111);
    const parsedAssets = JSON.parse(after.assetsJson) as Array<{
      url: string;
      representativeRank?: number;
      moderationReason?: string;
    }>;
    assert.equal(parsedAssets.length, 14);
    assert.equal(parsedAssets[0]?.representativeRank, 1);
    assert.equal(parsedAssets[7]?.moderationReason, "keep-moderation-reason");
    assert.ok(parsedAssets.every((asset, index) => asset.url.includes(index === 0 ? "rep-a1" : `scene-${String(index).padStart(2, "0")}`)));
  });

  it("MUST FIX 2 before/after: compact runtime appearance matches #1196 review compiler", () => {
    const source = loadCompiledOfficialCharacterSource("pilot-rf-03");
    const full = renderAppearanceBlock(source.appearanceLock);
    const runtime = renderRuntimeAppearanceBlock(source.appearanceLock);
    assert.notEqual(full, runtime);
    assert.equal(source.appearanceBlock, runtime);
    assert.notEqual(source.appearanceBlock, full);
    const expected = composeOfficialSystemPrompt(source.draft, runtime);
    assert.equal(source.systemPrompt, expected);
    assert.notEqual(composeOfficialSystemPrompt(source.draft, full), expected);
    const report = buildOfficialCharacterReviewReport("pilot-rf-03");
    assert.ok(report.includes(expected));
    assert.match(report, /RUNTIME APPEARANCE — COMPACT/);
  });

  it("MUST FIX 2 after apply: saved system_prompt equals compact compiler hash", async () => {
    const studio = createSiteManagedStudioAccount({
      nickname: "로맨스 공식 스튜디오",
      email: "romance-appearance@site-managed.invalid",
    });
    const characterId = insertOfficialLucian(studio.id, "로맨스 공식 스튜디오");
    linkLucianSupply(characterId);
    const adminId = insertUser({ email: ADMIN.email!, nickname: ADMIN.nickname, isAdmin: 1 });
    const source = loadCompiledOfficialCharacterSource("pilot-rf-03");
    const preview = await syncOfficialCharacterInPlace({
      admin: { ...ADMIN, id: adminId },
      characterId,
      draftKey: "pilot-rf-03",
      mode: "dry_run",
    });
    assert.equal(preview.appearanceKind, "runtime_compact");
    assert.equal(preview.systemPromptHash, sha256(source.systemPrompt));
    await withApplyEnabled(() =>
      syncOfficialCharacterInPlace({
        admin: { ...ADMIN, id: adminId },
        characterId,
        draftKey: "pilot-rf-03",
        mode: "apply",
        preflightSnapshot: preview.preflightSnapshot,
      })
    );
    const row = getDb()
      .prepare("SELECT system_prompt FROM characters WHERE id=?")
      .get(characterId) as { system_prompt: string };
    assert.equal(row.system_prompt, source.systemPrompt);
    assert.equal(sha256(row.system_prompt), preview.systemPromptHash);
  });

  it("MUST FIX 3 before/after: lorebook failure rolls back and identical shared siblings stay put", async () => {
    const studio = createSiteManagedStudioAccount({
      nickname: "로맨스 공식 스튜디오",
      email: "romance-lore@site-managed.invalid",
    });
    const characterId = insertOfficialLucian(studio.id, "로맨스 공식 스튜디오");
    linkLucianSupply(characterId);
    const adminId = insertUser({ email: ADMIN.email!, nickname: ADMIN.nickname, isAdmin: 1 });
    const source = loadCompiledOfficialCharacterSource("pilot-rf-03");
    const shared = source.sharedLorebook[0];
    assert.ok(shared);
    const stale = insertCreatorLorebookForOwner(getDb(), {
      creatorId: studio.id,
      name: shared.name,
      summary: "",
      keywords: shared.keywords,
      content: "구버전 공유 로어북 본문",
    });
    assert.equal(stale.ok, true);
    if (!stale.ok) return;
    getDb()
      .prepare(
        `INSERT INTO official_supply_world_lorebooks (world_key, entry_key, creator_id, lorebook_id)
         VALUES (?, ?, ?, ?)`
      )
      .run(source.worldKey, shared.entryKey, studio.id, stale.id);
    const siblingId = Number(
      getDb()
        .prepare(
          `INSERT INTO characters
            (name, tagline, description, greeting, system_prompt, world, genre, tags, nsfw, official,
             creator_id, creator_name, visibility, moderation_status, assets)
           VALUES ('형제캐','한줄','설명','인사','설정','세계','로맨스 판타지','[]',0,1,?,?, 'public','approved','[]')`
        )
        .run(studio.id, "로맨스 공식 스튜디오").lastInsertRowid
    );
    replaceCharacterCreatorLorebookAttachments(getDb(), characterId, [stale.id]);
    replaceCharacterCreatorLorebookAttachments(getDb(), siblingId, [stale.id]);

    const preview = await syncOfficialCharacterInPlace({
      admin: { ...ADMIN, id: adminId },
      characterId,
      draftKey: "pilot-rf-03",
      mode: "dry_run",
    });
    const updatePlan = preview.lorebookPlan.find((item) => item.entryKey === shared.entryKey);
    assert.equal(updatePlan?.action, "update");
    assert.deepEqual(updatePlan?.linkedCharacterIds, [siblingId]);

    await assert.rejects(
      () =>
        withApplyEnabled(() =>
          syncOfficialCharacterInPlace({
            admin: { ...ADMIN, id: adminId },
            characterId,
            draftKey: "pilot-rf-03",
            mode: "apply",
            preflightSnapshot: preview.preflightSnapshot,
            testInjectFailure: "after_lorebook_write",
          })
        ),
      (error: unknown) => error instanceof OfficialSupplyGateError && error.code === "test_injected_failure"
    );
    const rolled = getDb()
      .prepare("SELECT tagline, system_prompt FROM characters WHERE id=?")
      .get(characterId) as { tagline: string; system_prompt: string };
    assert.match(rolled.tagline, /손목을 잡고/);
    assert.equal(rolled.system_prompt, "구버전 시스템");
    const lore = getDb()
      .prepare("SELECT entries_json FROM keyword_lorebooks WHERE id=?")
      .get(stale.id) as { entries_json: string };
    assert.match(lore.entries_json, /구버전 공유 로어북 본문/);
    assert.deepEqual(listCharacterCreatorLorebookAttachmentIds(getDb(), siblingId), [stale.id]);
    assert.equal(
      (getDb().prepare("SELECT COUNT(*) AS n FROM official_supply_world_lorebooks").get() as { n: number }).n,
      1
    );

    const identical = insertCreatorLorebookForOwner(getDb(), {
      creatorId: studio.id,
      name: shared.name,
      summary: "",
      keywords: shared.keywords,
      content: shared.content,
    });
    assert.equal(identical.ok, true);
    if (!identical.ok) return;
    getDb().prepare("UPDATE official_supply_world_lorebooks SET lorebook_id=? WHERE lorebook_id=?").run(identical.id, stale.id);
    replaceCharacterCreatorLorebookAttachments(getDb(), characterId, [identical.id]);
    replaceCharacterCreatorLorebookAttachments(getDb(), siblingId, [identical.id]);
    const beforeStamp = getDb()
      .prepare("SELECT updated_at, entries_json FROM keyword_lorebooks WHERE id=?")
      .get(identical.id) as { updated_at: string; entries_json: string };
    const skipPreview = await syncOfficialCharacterInPlace({
      admin: { ...ADMIN, id: adminId },
      characterId,
      draftKey: "pilot-rf-03",
      mode: "dry_run",
    });
    assert.equal(
      skipPreview.lorebookPlan.find((item) => item.entryKey === shared.entryKey)?.action,
      "skip_identical"
    );
    await withApplyEnabled(() =>
      syncOfficialCharacterInPlace({
        admin: { ...ADMIN, id: adminId },
        characterId,
        draftKey: "pilot-rf-03",
        mode: "apply",
        preflightSnapshot: skipPreview.preflightSnapshot,
      })
    );
    const afterStamp = getDb()
      .prepare("SELECT updated_at, entries_json FROM keyword_lorebooks WHERE id=?")
      .get(identical.id) as { updated_at: string; entries_json: string };
    assert.equal(afterStamp.updated_at, beforeStamp.updated_at);
    assert.equal(afterStamp.entries_json, beforeStamp.entries_json);
    assert.deepEqual(listCharacterCreatorLorebookAttachmentIds(getDb(), siblingId), [identical.id]);
  });

  it("MUST FIX 4: Lucian apply is fail-closed; dry-run stays query-only", async () => {
    const studio = createSiteManagedStudioAccount({
      nickname: "로맨스 공식 스튜디오",
      email: "romance-gate@site-managed.invalid",
    });
    const characterId = insertOfficialLucian(studio.id, "로맨스 공식 스튜디오");
    const adminId = insertUser({ email: ADMIN.email!, nickname: ADMIN.nickname, isAdmin: 1 });
    const admin = { ...ADMIN, id: adminId };

    await assert.rejects(
      () =>
        syncOfficialCharacterInPlace({
          admin,
          characterId,
          draftKey: "pilot-rf-03",
          mode: "dry_run",
        }),
      (error: unknown) => error instanceof OfficialSupplyGateError && error.code === "supply_mapping_required"
    );

    linkLucianSupply(characterId);
    const preview = await syncOfficialCharacterInPlace({
      admin,
      characterId,
      draftKey: "pilot-rf-03",
      mode: "dry_run",
    });
    assert.equal(preview.applied, false);
    getDb().prepare("UPDATE characters SET tagline=? WHERE id=?").run("쿼리온리 복구 확인", characterId);
    const afterDry = getDb()
      .prepare("SELECT tagline FROM characters WHERE id=?")
      .get(characterId) as { tagline: string };
    assert.equal(afterDry.tagline, "쿼리온리 복구 확인");
    getDb()
      .prepare("UPDATE characters SET tagline=? WHERE id=?")
      .run("금고털이 경보 속, 당신의 손목을 잡고 달아난 브로커.", characterId);

    await assert.rejects(
      () =>
        syncOfficialCharacterInPlace({
          admin,
          characterId,
          draftKey: "pilot-rf-03",
          mode: "apply",
          preflightSnapshot: preview.preflightSnapshot,
        }),
      (error: unknown) => error instanceof OfficialSupplyGateError && error.code === "apply_disabled"
    );
    await assert.rejects(
      () =>
        withApplyEnabled(() =>
          syncOfficialCharacterInPlace({
            admin,
            characterId,
            draftKey: "pilot-rf-03",
            mode: "apply",
          })
        ),
      (error: unknown) => error instanceof OfficialSupplyGateError && error.code === "preflight_required"
    );
    const stillOld = getDb()
      .prepare("SELECT tagline FROM characters WHERE id=?")
      .get(characterId) as { tagline: string };
    assert.match(stillOld.tagline, /손목을 잡고/);

    const syncSrc = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/inPlaceSync.ts"), "utf8");
    const adminSrc = fs.readFileSync(path.join(process.cwd(), "src/lib/officialAdminAccess.ts"), "utf8");
    assert.doesNotMatch(syncSrc, /new OfficialSupplyStore/);
    assert.doesNotMatch(adminSrc, /new OfficialSupplyStore/);
    assert.match(syncSrc, /query_only/);
    assert.match(syncSrc, /OFFICIAL_IN_PLACE_APPLY_ENABLED/);
  });

  it("MUST FIX 5: admin reuses the existing character editor owners", async () => {
    const studio = createSiteManagedStudioAccount({
      nickname: "로맨스 공식 스튜디오",
      email: "romance-editor@site-managed.invalid",
    });
    const characterId = insertOfficialLucian(studio.id, "로맨스 공식 스튜디오", { rich: true });
    const adminId = insertUser({ email: ADMIN.email!, nickname: ADMIN.nickname, isAdmin: 1 });
    const admin = { ...ADMIN, id: adminId };
    const owner: SessionUser = {
      id: studio.id,
      nickname: studio.nickname,
      is_adult: 1,
      email: studio.email,
      is_admin: 0,
    };
    const row = { official: 1 as const, creator_id: studio.id };
    assert.equal(resolveOfficialCharacterEditorAccess(admin, row), "official_admin");
    assert.equal(resolveOfficialCharacterEditorAccess(owner, row), "forbidden");
    assert.equal(resolveOfficialCharacterEditorAccess(admin, { official: 0, creator_id: studio.id }), "official_admin");

    const ordinary = await updateCharacterFromForm(owner, characterId, {
      name: LUCIAN_CANONICAL_NAME,
      tagline: "편집기 일반 거부",
      description: "설명",
      greeting: "인사",
      system_prompt: "설정",
      genres: ["로맨스 판타지"],
      assets: richOfficialAssets(),
    });
    assert.equal(ordinary.ok, false);
    if (!ordinary.ok) assert.equal(ordinary.status, 403);

    const before = snapshotPreserved(characterId);
    const source = loadCompiledOfficialCharacterSource("pilot-rf-03");
    const edited = await updateCharacterFromForm(
      owner,
      characterId,
      {
        name: LUCIAN_CANONICAL_NAME,
        gender: source.draft.gender,
        tagline: "관리자 직접 수정 한줄",
        description: source.draft.description,
        greeting: source.draft.greeting,
        system_prompt: source.systemPrompt,
        world: source.draft.sections.worldAndSituation,
        genres: source.draft.genres,
        tags: source.draft.tags.join(","),
        speech_personality: source.draft.speech.personality,
        speech_traits: source.draft.speech.traits,
        speech_examples: source.draft.speech.examples,
        speech_forbidden: source.draft.speech.forbidden,
        status_widget_json: before.statusWidgetJson,
        jsx_components_json: before.jsxComponentsJson,
        recommended_writing_style: before.recommendedWritingStyle,
        narration_style_instructions: before.narrationStyle,
        comments_enabled: false,
        appearance_raw: before.appearanceRaw,
        assets: [
          {
            url: "/uploads/official-pilot-rf-v4-03__rep-a1.webp",
            tag: "대표",
            width: 1024,
            height: 1536,
            representativeRank: 1,
          },
        ],
        visibility: "public",
      },
      {
        actor: "official_admin",
        adminUser: admin,
        preserveListingState: true,
        preserveAdultFlags: true,
        skipFollowerNotify: true,
      }
    );
    assert.equal(edited.ok, true, edited.ok ? "" : `${edited.status}: ${edited.error}`);
    const after = snapshotPreserved(characterId);
    assert.equal(after.tagline, "관리자 직접 수정 한줄");
    assert.equal(after.official, 1);
    assert.equal(after.visibility, "public");
    assert.equal(after.moderationStatus, "approved");
    assert.equal(after.nsfw, 0);
    assert.equal(after.creatorId, studio.id);
    assert.equal(after.likes, 42);
    assert.equal(after.chatsCount, 17);

    const route = fs.readFileSync(path.join(process.cwd(), "src/app/api/characters/[id]/route.ts"), "utf8");
    const adminUi = fs.readFileSync(
      path.join(process.cwd(), "src/app/admin/official-characters/AdminOfficialCharactersClient.tsx"),
      "utf8"
    );
    const page = fs.readFileSync(path.join(process.cwd(), "src/app/character/[id]/page.tsx"), "utf8");
    const create = fs.readFileSync(path.join(process.cwd(), "src/components/CreateCharacter.tsx"), "utf8");
    assert.match(route, /resolveOfficialCharacterEditorAccess/);
    assert.match(route, /actor: "official_admin"/);
    assert.match(route, /visual_subjects/);
    assert.match(adminUi, /\/create\?edit=\$\{row\.id\}/);
    assert.match(page, /전체 설정 수정/);
    assert.match(create, /\/api\/characters\/\$\{editCharacterId\}/);
  });
});

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function snapshotPreserved(characterId: number) {
  const row = getDb()
    .prepare(
      `SELECT id, tagline, description, creator_id, official, visibility, moderation_status, nsfw,
              assets, status_widget_json, jsx_components_json, recommended_writing_style,
              narration_style_instructions, comments_enabled, appearance_raw, appearance_compiled,
              likes, chats_count, emoji, hue
       FROM characters WHERE id=?`
    )
    .get(characterId) as {
    id: number;
    tagline: string;
    description: string;
    creator_id: number;
    official: number;
    visibility: string;
    moderation_status: string;
    nsfw: number;
    assets: string;
    status_widget_json: string;
    jsx_components_json: string;
    recommended_writing_style: string;
    narration_style_instructions: string;
    comments_enabled: number;
    appearance_raw: string;
    appearance_compiled: string;
    likes: number;
    chats_count: number;
    emoji: string;
    hue: number;
  };
  const likeRows = getDb().prepare("SELECT COUNT(*) AS n FROM likes WHERE character_id=?").get(characterId) as {
    n: number;
  };
  const triggerCount = getDb()
    .prepare("SELECT COUNT(*) AS n FROM status_widget_triggers WHERE character_id=?")
    .get(characterId) as { n: number };
  return {
    id: row.id,
    tagline: row.tagline,
    description: row.description,
    creatorId: row.creator_id,
    official: row.official,
    visibility: row.visibility,
    moderationStatus: row.moderation_status,
    nsfw: row.nsfw,
    assetsJson: row.assets,
    assetCount: JSON.parse(row.assets).length,
    statusWidgetJson: row.status_widget_json,
    jsxComponentsJson: row.jsx_components_json,
    recommendedWritingStyle: row.recommended_writing_style,
    narrationStyle: row.narration_style_instructions,
    commentsEnabled: row.comments_enabled,
    appearanceRaw: row.appearance_raw,
    appearanceCompiled: row.appearance_compiled,
    likes: row.likes,
    chatsCount: row.chats_count,
    emoji: row.emoji,
    hue: row.hue,
    likeRows: likeRows.n,
    triggerCount: triggerCount.n,
  };
}
