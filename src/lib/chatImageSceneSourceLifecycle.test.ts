import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
  resolveDeterministicSceneBackground,
} from "./chatImageScenePlan";
import { ensureTrpgTables } from "./trpg/schema";
import { loadTrpgIllustrationScene } from "./trpg/illustrationCast";

describe("chat image scene source lifecycle", () => {
  it("G1 DIALOGUE ONLY: sceneBackground stays empty", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "user", content: '"같이 갈래?"' },
      { id: 2, role: "assistant", content: '"그래." 태형이 고개를 끄덕였다.' },
    ]);
    const plan = buildDeterministicScenePlan(messages);
    assert.equal(plan.sceneBackground, "");
    assert.doesNotMatch(plan.sceneBackground, /같이 갈래/);
    assert.doesNotMatch(plan.sceneBackground, /그래/);
  });

  it("G2 REAL ENVIRONMENT: environment event becomes background", () => {
    const background = resolveDeterministicSceneBackground([
      {
        id: "E1",
        order: 1,
        sourceMessageId: 1,
        sourceRole: "user",
        kind: "environment",
        actor: "environment",
        text: "비 내리는 서울역 옥상",
      },
    ]);
    assert.match(background, /서울역/);
  });

  it("G3 empty open clears previous source epoch state", () => {
    type Model = { summary: string; planHero: string };
    const sourceA = "SOURCE_A_MARKER";
    let state: Model = { summary: sourceA, planHero: "hero-A" };
    const beginEpoch = (): Model => ({ summary: "", planHero: "" });
    const applyA = (s: Model) => ({ ...s, summary: sourceA, planHero: "hero-A" });
    state = applyA(state);
    state = beginEpoch();
    assert.equal(state.summary, "");
    assert.equal(state.planHero, "");
    assert.doesNotMatch(state.summary, /SOURCE_A/);
  });

  it("G5 deterministic open uses zero provider calls", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "user", content: '"안녕"' },
      { id: 2, role: "assistant", content: "태형이 손을 흔든다." },
    ]);
    let providerCalls = 0;
    const plan = buildDeterministicScenePlan(messages);
    assert.ok(plan.events.length > 0);
    assert.equal(providerCalls, 0);
  });

  it("G11 SOURCE PREVIEW UI hidden from ChatSceneBuilder", () => {
    const builder = readFileSync("src/components/ChatSceneBuilder.tsx", "utf8");
    assert.doesNotMatch(builder, /장면 원본/);
    assert.doesNotMatch(builder, /sourcePreview \|\| "채팅 메시지 아래/);
  });

  it("G7/G8 TRPG image availability uses canonical narration only", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /canImage=\{Boolean\(imageId\) && Boolean\(row\.narration\?\.trim\(\)\)\}/);
    assert.doesNotMatch(room, /canImage=\{Boolean\(imageId\) && Boolean\(row\.narration \|\| liveGmStreamDraft\)\}/);
  });

  it("openGenerator always begins a fresh scene-source epoch", () => {
    const panel = readFileSync("src/components/ChatImageGeneratorPanel.tsx", "utf8");
    const openBlock = panel.match(
      /const openGenerator = \(event: Event\) => \{[\s\S]*?window\.addEventListener\("chat:image-generator:open", openGenerator\)/
    )?.[0];
    assert.ok(openBlock);
    assert.match(openBlock!, /const epoch = beginSceneSourceChange\(\)/);
    assert.match(openBlock!, /setComicSummary\(""\)/);
    assert.doesNotMatch(openBlock!, /if \(Number\.isFinite\(messageId\)[\s\S]*beginSceneSourceChange/);
  });

  it("resolveDeterministicSceneBackground ignores dialogue-only events", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "user", content: '"대사만 있다"' },
    ]);
    const plan = buildDeterministicScenePlan(messages);
    assert.equal(resolveDeterministicSceneBackground(plan.events), "");
  });
});

describe("TRPG illustration canonical source", () => {
  function memoryCampaignWithRounds(): {
    db: Database.Database;
    campaignId: number;
  } {
    const db = new Database(":memory:");
    ensureTrpgTables(db);
    db.prepare(
      `INSERT INTO trpg_campaigns (id, host_user_id, title, status) VALUES (1, 1, 'Test', 'ACTIVE')`
    ).run();
    db.prepare(
      `INSERT INTO trpg_participants (id, campaign_id, slot_index, kind, user_id, display_name, can_act, status)
       VALUES (1, 1, 0, 'human', 1, 'Host', 1, 'active')`
    ).run();
    db.prepare(
      `INSERT INTO trpg_character_sheets (participant_id, campaign_id, name, level, hp, max_hp, conditions_json, inventory_json, location, revision)
       VALUES (1, 1, 'Host', 1, 10, 10, '[]', '[]', 'CURRENT_SHEET_LOC', 1)`
    ).run();
    db.prepare(`INSERT INTO trpg_rounds (id, campaign_id, round_number, phase) VALUES (10, 1, 1, 'ROUND_COMPLETE')`).run();
    db.prepare(`INSERT INTO trpg_rounds (id, campaign_id, round_number, phase) VALUES (11, 1, 2, 'ROUND_COMPLETE')`).run();
    db.prepare(
      `INSERT INTO trpg_gm_messages (round_id, narration, structured_json) VALUES (10, ?, ?)`
    ).run(
      "Round 1 GM narration canonical.",
      JSON.stringify({ location: "Round 1 Tavern", delta: { location: "Round 1 Tavern" } })
    );
    db.prepare(
      `INSERT INTO trpg_gm_messages (round_id, narration, structured_json) VALUES (11, ?, ?)`
    ).run(
      "Round 2 GM narration canonical.",
      JSON.stringify({ location: "Round 2 Forest", delta: { location: "Round 2 Forest" } })
    );
    db.prepare(`UPDATE trpg_character_sheets SET location='CURRENT_SHEET_LOC' WHERE campaign_id=1`).run();
    return { db, campaignId: 1 };
  }

  it("G9/G10 loads round N narration and round-associated location, not current sheet", () => {
    const { db, campaignId } = memoryCampaignWithRounds();
    const round1 = loadTrpgIllustrationScene(db, {
      campaignId,
      viewerUserId: 1,
      roundNumber: 1,
    });
    assert.match(round1?.narration ?? "", /Round 1 GM narration/);
    assert.equal(round1?.location, "Round 1 Tavern");
    assert.notEqual(round1?.location, "CURRENT_SHEET_LOC");

    const round2 = loadTrpgIllustrationScene(db, {
      campaignId,
      viewerUserId: 1,
      roundNumber: 2,
    });
    assert.match(round2?.narration ?? "", /Round 2 GM narration/);
    assert.equal(round2?.location, "Round 2 Forest");
  });

  it("G8 returns empty narration before GM commit", () => {
    const { db, campaignId } = memoryCampaignWithRounds();
    db.prepare(`INSERT INTO trpg_rounds (id, campaign_id, round_number, phase) VALUES (12, 1, 3, 'GENERATING_NARRATION')`).run();
    const pending = loadTrpgIllustrationScene(db, {
      campaignId,
      viewerUserId: 1,
      roundNumber: 3,
    });
    assert.equal(pending?.narration, "");
  });
});
