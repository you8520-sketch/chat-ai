import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { canUseWorldForTrpg, loadAccessibleTrpgCharacter, loadTrpgCatalog } from "./catalog";
import { EVEN_STATS, addTrpgCompanions, createTrpgCampaign, joinTrpgCampaign, saveTrpgSheet } from "./engineCreate";
import { deleteTrpgCampaign, renameTrpgCampaign } from "./engineDelete";
import { advanceTrpgCampaign, startTrpgCampaign, submitTrpgAction, type TrpgEngineDeps } from "./engineAdvance";
import { listTrpgCampaigns, loadTrpgSnapshot } from "./engineSnapshot";
import { parseHumanPersona } from "./hostPersona";
import { trpgInvitePath } from "./invite";
import { insertScenarioTemplate, updateScenarioTemplate } from "./scenarioTemplates";
import {
  TRPG_SCENARIO_BUNDLE_LIMIT,
  countScenarioBundleChars,
  normalizeScenarioTemplateInput,
  scenarioMobNpcGmNotes,
  scenarioMobNpcWorldBrief,
} from "./scenarioTypes";
import { loadCampaignLedger } from "./campaignLedger";
import { ensureTrpgTables } from "./schema";
import { loadCampaign, loadParticipants, loadScenario } from "./store";

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE worlds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      shared_from_nickname TEXT NOT NULL DEFAULT '',
      trpg_enabled INTEGER NOT NULL DEFAULT 0,
      trpg_visibility TEXT NOT NULL DEFAULT 'private',
      cover_url TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      tagline TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      greeting TEXT NOT NULL DEFAULT '',
      system_prompt TEXT NOT NULL DEFAULT '',
      world TEXT NOT NULL DEFAULT '',
      world_id INTEGER,
      creator_id INTEGER,
      visibility TEXT NOT NULL DEFAULT 'public',
      moderation_status TEXT NOT NULL DEFAULT 'approved',
      share_slug TEXT,
      official INTEGER NOT NULL DEFAULT 0,
      trpg_reuse_allowed INTEGER NOT NULL DEFAULT 0,
      emoji TEXT NOT NULL DEFAULT '✨',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  ensureTrpgTables(db);
  return db;
}

describe("TRPG scenarios and catalog", () => {
  it("creates a campaign from a public TRPG world", () => {
    const db = memoryDb();
    db.prepare(
      `INSERT INTO worlds (creator_id, name, summary, content, trpg_enabled, trpg_visibility)
       VALUES (2, '북부', '눈 덮인 공국', '얼음 마법이 흔하다.', 1, 'public')`
    ).run();
    const campaignId = createTrpgCampaign(db, {
      hostUserId: 1,
      hostNickname: "렌",
      viewerUserId: 1,
      worldId: 1,
    });
    const campaign = loadCampaign(db, campaignId);
    assert.equal(campaign?.source_world_id, 1);
    assert.equal(campaign?.author_user_id, 2);
    assert.match(campaign?.world_brief ?? "", /얼음 마법/);
    db.close();
  });

  it("refuses a private world that is not the viewer", () => {
    const db = memoryDb();
    db.prepare(
      `INSERT INTO worlds (creator_id, name, content, trpg_enabled, trpg_visibility)
       VALUES (2, '비밀', '비공개 설정', 1, 'private')`
    ).run();
    assert.throws(
      () =>
        createTrpgCampaign(db, {
          hostUserId: 1,
          hostNickname: "렌",
          viewerUserId: 1,
          worldId: 1,
        }),
      /공개되어 있지/
    );
    db.close();
  });

  it("lets the owner use their own world even when TRPG is off", () => {
    const db = memoryDb();
    db.prepare(
      `INSERT INTO worlds (creator_id, name, content, trpg_enabled, trpg_visibility)
       VALUES (1, '작업실', '아직 비공개 초안', 0, 'private')`
    ).run();
    assert.equal(canUseWorldForTrpg({ creator_id: 1, trpg_enabled: 0, trpg_visibility: "private" }, 1), true);
    const campaignId = createTrpgCampaign(db, {
      hostUserId: 1,
      hostNickname: "렌",
      viewerUserId: 1,
      worldId: 1,
    });
    assert.equal(loadCampaign(db, campaignId)?.author_user_id, 1);
    db.close();
  });

  it("keeps scenario NPCs as story mobs, not player-character seats", () => {
    const db = memoryDb();
    const templateId = insertScenarioTemplate(db, 7, {
      title: "폐역 탐험",
      summary: "유령 기차를 기다리는 공포 TRPG",
      content: "한밤의 역에서 유령 기차를 기다린다.",
      visibility: "public",
      startLocation: "대합실",
      startInventory: ["손전등"],
      defaultPcStats: { str: 5, dex: 7, int: 5, wis: 5, cha: 5, con: 5 },
      npcs: [
        {
          name: "역무원",
          description: "낡은 제복의 안내원",
          greeting: "표를 보여주시죠.",
          systemPrompt: "공손하고 비밀을 안다.",
        },
      ],
    });
    const campaignId = createTrpgCampaign(db, {
      hostUserId: 1,
      hostNickname: "렌",
      viewerUserId: 1,
      templateId,
    });
    const campaign = loadCampaign(db, campaignId);
    assert.equal(campaign?.template_id, templateId);
    assert.equal(campaign?.author_user_id, 7);
    const parts = loadParticipants(db, campaignId);
    assert.equal(parts.length, 1);
    assert.equal(parts[0]?.kind, "human");
    assert.equal(parts.some((p) => p.kind === "ai_character"), false);
    assert.match(campaign?.world_brief ?? "", /역무원/);
    assert.match(campaign?.world_brief ?? "", /낡은 제복의 안내원/);
    assert.doesNotMatch(campaign?.world_brief ?? "", /공손하고 비밀을 안다/);
    assert.match(campaign?.gm_secret ?? "", /공손하고 비밀을 안다/);
    assert.deepEqual(loadCampaignLedger(db, campaignId).npcs, ["역무원"]);
    const scenario = loadScenario(db, campaignId);
    assert.equal(scenario.startLocation, "대합실");
    assert.deepEqual(scenario.startInventory, ["손전등"]);
    assert.equal(scenario.defaultPcStats?.dex, 7);
    db.close();
  });

  it("stores the scenario author's chosen sheet stats on the campaign", () => {
    const db = memoryDb();
    const templateId = insertScenarioTemplate(db, 1, {
      title: "마법 결투",
      content: "탑 꼭대기에서 주문을 겨룬다.",
      statKeys: ["str", "mag", "wil"],
      defaultPcStats: { str: 5, mag: 8, wil: 5 },
    });
    const campaignId = createTrpgCampaign(db, {
      hostUserId: 1,
      hostNickname: "렌",
      viewerUserId: 1,
      templateId,
    });
    const scenario = loadScenario(db, campaignId);
    assert.deepEqual(
      scenario.statDefs.map((d) => d.key),
      ["str", "wil", "mag"]
    );
    assert.equal(scenario.pointPool, 30);
    assert.equal(scenario.defaultPcStats?.mag, 8);
    assert.equal(scenario.statDefs.some((d) => d.key === "dex"), false);
    db.close();
  });

  it("lists public opted-in worlds and own scenarios in the catalog", () => {
    const db = memoryDb();
    db.prepare(
      `INSERT INTO worlds (creator_id, name, summary, content, trpg_enabled, trpg_visibility, genres, cover_url)
       VALUES (2, '공개세계', '보임', '본문', 1, 'public', ?, '/uploads/north.webp')`
    ).run(JSON.stringify(["판타지"]));
    db.prepare(
      `INSERT INTO worlds (creator_id, name, content, trpg_enabled, trpg_visibility)
       VALUES (2, '숨김', '안 보임', 0, 'private')`
    ).run();
    db.prepare(
      `INSERT INTO worlds (creator_id, name, content, trpg_enabled, trpg_visibility)
       VALUES (1, '내것', '초안', 0, 'private')`
    ).run();
    insertScenarioTemplate(db, 1, {
      title: "내 시나리오",
      content: "비공개 초안 본문입니다.",
      visibility: "private",
    });
    insertScenarioTemplate(db, 2, {
      title: "공개 시나리오",
      summary: "공개 시나리오 소개",
      content: "누구나 캠페인으로 쓸 수 있다.",
      secretContent: "진범은 역무원SECRETTOKEN",
      visibility: "public",
      genres: ["공포/추리"],
    });
    const catalog = loadTrpgCatalog(db, 1);
    assert.equal(catalog.publicWorlds.some((w) => w.name === "공개세계"), true);
    assert.deepEqual(catalog.publicWorlds.find((w) => w.name === "공개세계")?.genres, ["판타지"]);
    assert.equal(catalog.publicWorlds.find((w) => w.name === "공개세계")?.coverUrl, "/uploads/north.webp");
    assert.equal(catalog.publicWorlds.find((w) => w.name === "공개세계")?.content, "본문");
    assert.equal(catalog.publicWorlds.some((w) => w.name === "숨김"), false);
    assert.equal(catalog.myWorlds.some((w) => w.name === "내것"), true);
    assert.equal(catalog.myScenarios.some((s) => s.title === "내 시나리오"), true);
    const pub = catalog.publicScenarios.find((s) => s.title === "공개 시나리오");
    assert.ok(pub);
    assert.equal(pub?.secretContent, "");
    assert.equal(JSON.stringify(catalog.publicScenarios).includes("SECRETTOKEN"), false);
    assert.equal(JSON.stringify(catalog).includes("SECRETTOKEN"), false);
    assert.deepEqual(pub?.genres, ["공포/추리"]);
    const ownerCatalog = loadTrpgCatalog(db, 2);
    assert.equal(ownerCatalog.myScenarios.find((s) => s.title === "공개 시나리오")?.secretContent, "진범은 역무원SECRETTOKEN");
    db.close();
  });

  it("keeps hidden GM notes off player snapshots and bot prompts", async () => {
    const db = memoryDb();
    const seen: string[] = [];
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 12,
      gmCall: async ({ user }) => {
        seen.push(`gm:${user}`);
        return {
          text: `<<<NARRATION>>>
낡은 역이 흔들린다. 당신은 다음 한 수를 고른다.
<<<DELTA>>>
{"players":[],"location":"대합실","next_round_context":"표를 살지","campaign_finished":false}`,
        };
      },
      botCall: async (_system, user) => {
        seen.push(`bot:${user}`);
        return { text: "모자를 고쳐 쓴다." };
      },
    };
    const templateId = insertScenarioTemplate(db, 7, {
      title: "폐역 탐험",
      summary: "유령 기차를 기다리는 공포 TRPG",
      content: "한밤의 역에서 유령 기차를 기다린다.",
      secretContent: "역무원은이미죽었다SECRETGM",
      visibility: "public",
      npcs: [{ name: "역무원", description: "안내원", greeting: "표", systemPrompt: "공손" }],
    });
    const campaignId = createTrpgCampaign(db, {
      hostUserId: 1,
      hostNickname: "렌",
      viewerUserId: 1,
      templateId,
    });
    const campaign = loadCampaign(db, campaignId);
    assert.match(campaign?.gm_secret ?? "", /SECRETGM/);
    assert.match(campaign?.gm_secret ?? "", /공손/);
    assert.doesNotMatch(campaign?.world_brief ?? "", /SECRETGM/);
    assert.match(campaign?.world_brief ?? "", /역무원/);
    const snap = loadTrpgSnapshot(db, campaignId, 1);
    assert.doesNotMatch(snap?.worldBrief ?? "", /SECRETGM/);
    assert.equal(JSON.stringify(snap).includes("SECRETGM"), false);
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    assert.equal(loadParticipants(db, campaignId).some((p) => p.kind === "ai_character"), false);
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    submitTrpgAction(db, { campaignId, userId: 1, body: "역무원에게 말을 건다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const gmBlocks = seen.filter((s) => s.startsWith("gm:"));
    const botBlocks = seen.filter((s) => s.startsWith("bot:"));
    assert.ok(gmBlocks.some((s) => s.includes("SECRETGM")));
    assert.equal(botBlocks.length, 0);
    db.close();
  });

  it("uses the host persona as the default PC and builds an invite join path", () => {
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, {
      hostUserId: 1,
      hostNickname: "닉네임",
      viewerUserId: 1,
      hostPersona: {
        personaId: 9,
        name: "렌",
        description: "조용한 탐정",
        gender: "male",
        speechExamples: "그래.",
      },
    });
    const host = loadParticipants(db, campaignId).find((p) => p.kind === "human");
    assert.equal(host?.display_name, "렌");
    const persona = parseHumanPersona(host?.persona_json);
    assert.equal(persona?.personaId, 9);
    assert.match(persona?.description ?? "", /탐정/);
    const campaign = loadCampaign(db, campaignId);
    assert.ok(campaign?.invite_code);
    const snap = loadTrpgSnapshot(db, campaignId, 1);
    assert.equal(snap?.invitePath, trpgInvitePath(campaign!.invite_code!));
    assert.match(snap?.invitePath ?? "", /\/trpg\/join\//);
    const joined = joinTrpgCampaign(db, {
      code: `https://habi.example/trpg/join/${campaign!.invite_code}`,
      userId: 2,
      nickname: "게스트",
      persona: {
        personaId: 3,
        name: "유나",
        description: "",
        gender: "female",
        speechExamples: "",
      },
    });
    assert.equal(joined, campaignId);
    const guest = loadParticipants(db, campaignId).find((p) => p.user_id === 2);
    assert.equal(guest?.display_name, "유나");
    db.close();
  });

  it("does not count scenario NPCs against the two player-character seats", () => {
    const db = memoryDb();
    db.prepare(
      `INSERT INTO characters (name, description, visibility, moderation_status, official)
       VALUES ('하나', '검사', 'public', 'approved', 1),
              ('두리', '도적', 'public', 'approved', 1)`
    ).run();
    const parsed = normalizeScenarioTemplateInput({
      title: "모브와 PC",
      content: "역에서 만난다.",
      npcs: [
        { name: "역무원", description: "안내원", greeting: "표", systemPrompt: "공손SECRETNPC" },
        { name: "행상인", description: "차 파는 사람", greeting: "", systemPrompt: "" },
        { name: "청소부", description: "빗자루", greeting: "", systemPrompt: "" },
      ],
      characterIds: [1],
    });
    assert.equal(parsed.npcs.length, 3);
    assert.deepEqual(parsed.characterIds, [1]);
    assert.match(scenarioMobNpcWorldBrief(parsed.npcs), /역무원 — 안내원/);
    assert.doesNotMatch(scenarioMobNpcWorldBrief(parsed.npcs), /SECRETNPC/);
    assert.match(scenarioMobNpcGmNotes(parsed.npcs), /SECRETNPC/);
    const templateId = insertScenarioTemplate(db, 1, {
      title: parsed.title,
      content: parsed.content,
      npcs: parsed.npcs,
      characterIds: parsed.characterIds,
    });
    const campaignId = createTrpgCampaign(db, {
      hostUserId: 1,
      hostNickname: "렌",
      viewerUserId: 1,
      templateId,
    });
    assert.deepEqual(
      loadParticipants(db, campaignId)
        .filter((p) => p.kind === "ai_character")
        .map((p) => p.display_name),
      ["하나"]
    );
    assert.deepEqual(loadCampaignLedger(db, campaignId).npcs, ["역무원", "행상인", "청소부"]);
    addTrpgCompanions(db, { campaignId, userId: 1, characterIds: [2] });
    assert.deepEqual(
      loadParticipants(db, campaignId)
        .filter((p) => p.kind === "ai_character")
        .map((p) => p.display_name),
      ["하나", "두리"]
    );
    assert.deepEqual(loadCampaignLedger(db, campaignId).npcs, ["역무원", "행상인", "청소부"]);
    db.close();
  });

  it("lets the host bring up to two player characters because each runs its own model", () => {
    const db = memoryDb();
    db.prepare(
      `INSERT INTO characters (name, description, visibility, moderation_status, official)
       VALUES ('하나', '검사', 'public', 'approved', 1),
              ('두리', '도적', 'public', 'approved', 1),
              ('세찌', '마법사', 'public', 'approved', 1)`
    ).run();
    const campaignId = createTrpgCampaign(db, {
      hostUserId: 1,
      hostNickname: "렌",
      viewerUserId: 1,
      characterIds: [1, 2],
    });
    const parts = loadParticipants(db, campaignId);
    assert.equal(parts.filter((p) => p.kind === "human").length, 1);
    assert.equal(parts.filter((p) => p.kind === "ai_character").length, 2);
    assert.deepEqual(
      parts.filter((p) => p.kind === "ai_character").map((p) => p.display_name),
      ["하나", "두리"]
    );
    assert.throws(
      () =>
        createTrpgCampaign(db, {
          hostUserId: 1,
          hostNickname: "렌",
          viewerUserId: 1,
          characterIds: [1, 2, 3],
        }),
      /최대 2명/
    );
    const extraId = createTrpgCampaign(db, {
      hostUserId: 1,
      hostNickname: "렌",
      viewerUserId: 1,
      characterIds: [1],
    });
    addTrpgCompanions(db, { campaignId: extraId, userId: 1, characterIds: [2] });
    assert.equal(loadParticipants(db, extraId).filter((p) => p.kind === "ai_character").length, 2);
    assert.throws(
      () => addTrpgCompanions(db, { campaignId: extraId, userId: 1, characterIds: [3] }),
      /최대 2명/
    );
    db.close();
  });

  it("deletes leftover solo drafts when starting or opening a setup campaign, not on lobby list", () => {
    const db = memoryDb();
    const first = createTrpgCampaign(db, {
      hostUserId: 1,
      hostNickname: "렌",
      viewerUserId: 1,
    });
    const second = createTrpgCampaign(db, {
      hostUserId: 1,
      hostNickname: "렌",
      viewerUserId: 1,
    });
    assert.equal(loadCampaign(db, first), null);
    assert.ok(loadCampaign(db, second));
    assert.equal(listTrpgCampaigns(db, 1).length, 0);
    assert.ok(loadCampaign(db, second));

    const keptId = createTrpgCampaign(db, {
      hostUserId: 1,
      hostNickname: "렌",
      viewerUserId: 1,
      title: "초안 제목",
    });
    const kept = loadCampaign(db, keptId)!;
    joinTrpgCampaign(db, { code: kept.invite_code!, userId: 2, nickname: "게스트" });
    const third = createTrpgCampaign(db, {
      hostUserId: 1,
      hostNickname: "렌",
      viewerUserId: 1,
    });
    assert.ok(loadCampaign(db, keptId));
    assert.ok(loadCampaign(db, third));
    const lobby = listTrpgCampaigns(db, 1);
    assert.equal(lobby.length, 1);
    assert.equal(lobby[0]?.id, keptId);
    assert.ok(loadCampaign(db, third));

    const current = createTrpgCampaign(db, {
      hostUserId: 1,
      hostNickname: "렌",
      viewerUserId: 1,
    });
    assert.equal(loadCampaign(db, third), null);
    const leftoverId = Number(
      db
        .prepare(
          `INSERT INTO trpg_campaigns (host_user_id, title, status, invite_code, world_brief, gm_secret)
           VALUES (1, '유령 초안', 'CHARACTER_SETUP', 'deadbeef', '', '')`
        )
        .run().lastInsertRowid
    );
    db.prepare(
      `INSERT INTO trpg_participants (campaign_id, slot_index, kind, user_id, display_name)
       VALUES (?, 0, 'human', 1, '렌')`
    ).run(leftoverId);
    loadTrpgSnapshot(db, current, 1);
    assert.equal(loadCampaign(db, leftoverId), null);
    assert.ok(loadCampaign(db, current));
    const afterRoom = listTrpgCampaigns(db, 1);
    assert.equal(afterRoom.length, 1);
    assert.equal(afterRoom[0]?.id, keptId);
    assert.ok(loadCampaign(db, current));

    assert.equal(renameTrpgCampaign(db, { campaignId: keptId, userId: 1, title: " 회색 생태권  " }), "회색 생태권");
    assert.equal(loadCampaign(db, keptId)?.title, "회색 생태권");
    assert.throws(
      () => renameTrpgCampaign(db, { campaignId: keptId, userId: 2, title: "해킹" }),
      /방장만 제목/
    );
    assert.throws(
      () => deleteTrpgCampaign(db, { campaignId: keptId, userId: 2 }),
      /방장만 캠페인/
    );
    deleteTrpgCampaign(db, { campaignId: keptId, userId: 1 });
    assert.equal(listTrpgCampaigns(db, 1).length, 0);
    db.close();
  });

  it("does not delete a setup draft when listing the lobby or polling a started room", () => {
    const db = memoryDb();
    const started = createTrpgCampaign(db, {
      hostUserId: 1,
      hostNickname: "렌",
      viewerUserId: 1,
      title: "진행 중",
    });
    saveTrpgSheet(db, { campaignId: started, userId: 1, name: "렌", stats: EVEN_STATS });
    db.prepare(
      `INSERT INTO trpg_rounds (campaign_id, round_number, phase) VALUES (?, 1, 'ERROR_RECOVERY')`
    ).run(started);
    db.prepare(`UPDATE trpg_campaigns SET status='ACTION_INPUT' WHERE id=?`).run(started);

    const draft = createTrpgCampaign(db, {
      hostUserId: 1,
      hostNickname: "렌",
      viewerUserId: 1,
      title: "새 세계관 초안",
    });
    assert.ok(loadCampaign(db, started));
    assert.ok(loadCampaign(db, draft));

    assert.ok(listTrpgCampaigns(db, 1).some((row) => row.id === started));
    assert.ok(loadCampaign(db, draft));

    assert.ok(loadTrpgSnapshot(db, started, 1));
    assert.ok(loadCampaign(db, draft), "started-room poll must not delete the setup draft");
    assert.ok(loadTrpgSnapshot(db, draft, 1));
    assert.ok(loadCampaign(db, draft));
    db.close();
  });

  it("lets the owner use their own character in TRPG even when reuse is off", () => {
    const db = memoryDb();
    db.prepare(
      `INSERT INTO characters (name, creator_id, visibility, moderation_status, official, trpg_reuse_allowed)
       VALUES ('내 검사', 1, 'private', 'pending', 0, 0)`
    ).run();
    const campaignId = createTrpgCampaign(db, {
      hostUserId: 1,
      hostNickname: "렌",
      viewerUserId: 1,
      characterIds: [1],
    });
    const bots = loadParticipants(db, campaignId).filter((p) => p.kind === "ai_character");
    assert.equal(bots.length, 1);
    assert.equal(bots[0]?.display_name, "내 검사");
    assert.ok(loadAccessibleTrpgCharacter(db, 1, 1));
    db.close();
  });

  it("refuses another user's public character unless TRPG reuse is allowed", () => {
    const db = memoryDb();
    db.prepare(
      `INSERT INTO characters (name, creator_id, visibility, moderation_status, official, trpg_reuse_allowed)
       VALUES ('남의 검사', 2, 'public', 'approved', 0, 0)`
    ).run();
    assert.equal(loadAccessibleTrpgCharacter(db, 1, 1), null);
    assert.throws(
      () =>
        createTrpgCampaign(db, {
          hostUserId: 1,
          hostNickname: "렌",
          viewerUserId: 1,
          characterIds: [1],
        }),
      /이 캐릭터로 TRPG/
    );
    assert.throws(
      () =>
        insertScenarioTemplate(db, 1, {
          title: "데려가기",
          content: "남의 캐릭터를 시나리오에 넣는다.",
          characterIds: [1],
        }),
      /시나리오에 데려올/
    );
    db.close();
  });

  it("lets another user bring a public opted-in character into TRPG", () => {
    const db = memoryDb();
    db.prepare(
      `INSERT INTO characters (name, creator_id, visibility, moderation_status, official, trpg_reuse_allowed)
       VALUES ('공유 검사', 2, 'public', 'approved', 0, 1)`
    ).run();
    assert.ok(loadAccessibleTrpgCharacter(db, 1, 1));
    const campaignId = createTrpgCampaign(db, {
      hostUserId: 1,
      hostNickname: "렌",
      viewerUserId: 1,
      characterIds: [1],
    });
    assert.equal(
      loadParticipants(db, campaignId).find((p) => p.kind === "ai_character")?.display_name,
      "공유 검사"
    );
    const templateId = insertScenarioTemplate(db, 1, {
      title: "공유 시나리오",
      content: "허용된 캐릭터를 데려온다.",
      characterIds: [1],
    });
    assert.ok(templateId > 0);
    db.close();
  });

  it("stores landscape scenario assets and exposes them on the campaign snapshot", () => {
    const db = memoryDb();
    const templateId = insertScenarioTemplate(db, 1, {
      title: "에셋 시나리오",
      content: "폐역에서 시작한다.",
      assets: [
        { url: "/uploads/cover.webp", tag: "표지", width: 800, height: 1200 },
        { url: "/uploads/hall.webp", tag: "대합실", width: 1600, height: 900 },
      ],
    });
    const campaignId = createTrpgCampaign(db, {
      hostUserId: 1,
      hostNickname: "렌",
      viewerUserId: 1,
      templateId,
    });
    const snap = loadTrpgSnapshot(db, campaignId, 1);
    assert.equal(snap?.scenarioAssets.length, 2);
    assert.equal(snap?.scenarioAssets[1]?.tag, "대합실");
    assert.throws(
      () =>
        insertScenarioTemplate(db, 1, {
          title: "세로 금지",
          content: "본문입니다.",
          assets: [
            { url: "/uploads/cover.webp", tag: "표지", width: 800, height: 1200 },
            { url: "/uploads/tall.webp", tag: "초상", width: 800, height: 1200 },
          ],
        }),
      /가로로 긴 이미지/
    );
    db.close();
  });

  it("rejects a scenario whose world, prose, secrets, and NPCs exceed 10,000 characters", () => {
    const db = memoryDb();
    const worldBody = "한".repeat(7000);
    db.prepare(
      `INSERT INTO worlds (creator_id, name, summary, content, trpg_enabled, trpg_visibility)
       VALUES (1, '북부', '요약', ?, 0, 'private')`
    ).run(worldBody);
    assert.throws(
      () =>
        insertScenarioTemplate(db, 1, {
          title: "너무 김",
          content: "가".repeat(2500),
          secretContent: "나".repeat(600),
          worldId: 1,
          npcs: [{ name: "역무원", description: "다".repeat(200), systemPrompt: "라".repeat(200) }],
        }),
      /이하여야/
    );
    const okId = insertScenarioTemplate(db, 1, {
      title: "여유",
      content: "한밤의 역에서 유령 기차를 기다린다.",
      worldId: 1,
    });
    assert.ok(okId > 0);
    assert.equal(
      countScenarioBundleChars({
        worldSummary: "요약",
        worldContent: worldBody,
        content: "한밤의 역에서 유령 기차를 기다린다.",
      }) <= TRPG_SCENARIO_BUNDLE_LIMIT,
      true
    );
    assert.throws(
      () =>
        updateScenarioTemplate(db, okId, 1, {
          title: "여유",
          content: "마".repeat(3500),
          worldId: 1,
        }),
      /이하여야/
    );
    db.close();
  });
});
