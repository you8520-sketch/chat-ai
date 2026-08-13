import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { canUseWorldForTrpg, loadTrpgCatalog } from "./catalog";
import { EVEN_STATS, addTrpgCompanions, createTrpgCampaign, joinTrpgCampaign, saveTrpgSheet } from "./engineCreate";
import { deleteTrpgCampaign, renameTrpgCampaign } from "./engineDelete";
import { advanceTrpgCampaign, startTrpgCampaign, submitTrpgAction, type TrpgEngineDeps } from "./engineAdvance";
import { listTrpgCampaigns, loadTrpgSnapshot } from "./engineSnapshot";
import { parseHumanPersona } from "./hostPersona";
import { trpgInvitePath } from "./invite";
import { insertScenarioTemplate } from "./scenarioTemplates";
import { ensureTrpgTables } from "./schema";
import { loadCampaign, loadParticipants, loadScenario, parseBotPersona } from "./store";

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE worlds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      trpg_enabled INTEGER NOT NULL DEFAULT 0,
      trpg_visibility TEXT NOT NULL DEFAULT 'private',
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

  it("spawns scenario NPCs with persona cards and suggested sheets", () => {
    const db = memoryDb();
    const templateId = insertScenarioTemplate(db, 7, {
      title: "폐역 탐험",
      content: "한밤의 역에서 유령 기차를 기다린다.",
      visibility: "public",
      startLocation: "대합실",
      startInventory: ["손전등"],
      defaultPcStats: { str: 4, dex: 7, int: 5, wis: 5, cha: 4, con: 5 },
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
    assert.equal(parts.length, 2);
    const npc = parts.find((p) => p.kind === "ai_character");
    assert.equal(npc?.display_name, "역무원");
    assert.equal(npc?.character_id, null);
    const persona = parseBotPersona(npc?.persona_json);
    assert.match(persona?.systemPrompt ?? "", /공손/);
    const scenario = loadScenario(db, campaignId);
    assert.equal(scenario.startLocation, "대합실");
    assert.deepEqual(scenario.startInventory, ["손전등"]);
    assert.equal(scenario.defaultPcStats?.dex, 7);
    db.close();
  });

  it("lists public opted-in worlds and own scenarios in the catalog", () => {
    const db = memoryDb();
    db.prepare(
      `INSERT INTO worlds (creator_id, name, summary, content, trpg_enabled, trpg_visibility)
       VALUES (2, '공개세계', '보임', '본문', 1, 'public')`
    ).run();
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
      content: "누구나 캠페인으로 쓸 수 있다.",
      secretContent: "진범은 역무원SECRETTOKEN",
      visibility: "public",
    });
    const catalog = loadTrpgCatalog(db, 1);
    assert.equal(catalog.publicWorlds.some((w) => w.name === "공개세계"), true);
    assert.equal(catalog.publicWorlds.some((w) => w.name === "숨김"), false);
    assert.equal(catalog.myWorlds.some((w) => w.name === "내것"), true);
    assert.equal(catalog.myScenarios.some((s) => s.title === "내 시나리오"), true);
    const pub = catalog.publicScenarios.find((s) => s.title === "공개 시나리오");
    assert.ok(pub);
    assert.equal(pub?.secretContent, "");
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
    assert.equal(campaign?.gm_secret, "역무원은이미죽었다SECRETGM");
    assert.doesNotMatch(campaign?.world_brief ?? "", /SECRETGM/);
    const snap = loadTrpgSnapshot(db, campaignId, 1);
    assert.doesNotMatch(snap?.worldBrief ?? "", /SECRETGM/);
    assert.equal(JSON.stringify(snap).includes("SECRETGM"), false);
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    const bot = loadParticipants(db, campaignId).find((p) => p.kind === "ai_character");
    assert.ok(bot);
    saveTrpgSheet(db, {
      campaignId,
      userId: 1,
      name: "역무원",
      stats: EVEN_STATS,
      participantId: bot!.id,
    });
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    submitTrpgAction(db, { campaignId, userId: 1, body: "역무원에게 말을 건다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const gmBlocks = seen.filter((s) => s.startsWith("gm:"));
    const botBlocks = seen.filter((s) => s.startsWith("bot:"));
    assert.ok(gmBlocks.some((s) => s.includes("SECRETGM")));
    assert.ok(botBlocks.length > 0);
    assert.ok(botBlocks.every((s) => !s.includes("SECRETGM")));
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

  it("lets the host bring up to three characters without ending after the first pick", () => {
    const db = memoryDb();
    db.prepare(
      `INSERT INTO characters (name, description, visibility, moderation_status, official)
       VALUES ('하나', '검사', 'public', 'approved', 1),
              ('두리', '도적', 'public', 'approved', 1),
              ('세찌', '마법사', 'public', 'approved', 1),
              ('네찌', '사제', 'public', 'approved', 1)`
    ).run();
    const campaignId = createTrpgCampaign(db, {
      hostUserId: 1,
      hostNickname: "렌",
      viewerUserId: 1,
      characterIds: [1, 2, 3],
    });
    const parts = loadParticipants(db, campaignId);
    assert.equal(parts.filter((p) => p.kind === "human").length, 1);
    assert.equal(parts.filter((p) => p.kind === "ai_character").length, 3);
    assert.deepEqual(
      parts.filter((p) => p.kind === "ai_character").map((p) => p.display_name),
      ["하나", "두리", "세찌"]
    );
    assert.throws(
      () =>
        createTrpgCampaign(db, {
          hostUserId: 1,
          hostNickname: "렌",
          viewerUserId: 1,
          characterIds: [1, 2, 3, 4],
        }),
      /최대 3명/
    );
    const extraId = createTrpgCampaign(db, {
      hostUserId: 1,
      hostNickname: "렌",
      viewerUserId: 1,
      characterIds: [1],
    });
    addTrpgCompanions(db, { campaignId: extraId, userId: 1, characterIds: [2, 3] });
    assert.equal(loadParticipants(db, extraId).filter((p) => p.kind === "ai_character").length, 3);
    db.close();
  });

  it("deletes unstarted solo drafts instead of leaving them hidden", () => {
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
    assert.equal(loadCampaign(db, second), null);

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
    assert.equal(loadCampaign(db, third), null);
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
});
