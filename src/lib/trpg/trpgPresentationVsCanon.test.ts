import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveTrpgCanonicalAttempt } from "./canonicalAttempt";
import { buildTrpgGmUserBlock, TRPG_GM_LABEL_AI_ATTEMPT, TRPG_GM_LABEL_HUMAN_ACTION } from "./gmPrompt";
import { loadCompletedMemoryRounds } from "./memory";
import { buildTrpgBotRecentContinuity } from "./memory";
import { buildTrpgMemoryPromptBlock } from "./memory";
import { ensureTrpgTables } from "./schema";
import Database from "better-sqlite3";

function gmActions(
  actions: Parameters<typeof buildTrpgGmUserBlock>[0]["actions"]
): string {
  const block = buildTrpgGmUserBlock({
    worldBrief: "회색 생태권",
    memoryBlock: "",
    opening: false,
    actions,
  });
  const start = block.indexOf("[ACTION participantId=");
  return start >= 0 ? block.slice(start) : block;
}

function humanAction(body: string) {
  return {
    participantId: 1,
    name: "렌",
    body,
    participantKind: "human" as const,
    statKey: "dex",
    d20: 12,
    finalScore: 12,
    dc: 11,
    tier: "SUCCESS",
  };
}

function aiAction(opts: { participantId: number; name: string; canonical: string; prose?: string }) {
  return {
    participantId: opts.participantId,
    name: opts.name,
    body: opts.canonical,
    participantKind: "ai_character" as const,
    statKey: "dex",
    d20: 10,
    finalScore: 10,
    dc: 11,
    tier: "SUCCESS",
  };
}

const HUMAN_GESTURE = "주변을 살피며 두 동료에게 조용히 따라오라는 손짓을 한다.";
const BOT1_CONTAMINATION = "렌의 뒤를 조용히 엄호하듯 바짝 따르며";
const BOT2_CONTAMINATION = "렌의 움직임에 맞춰";

describe("TRPG presentation vs canon — resolver", () => {
  it("F: human marker-like text is not parsed by bot parser", () => {
    const body = "앞으로 간다.\n<<<INTENT>>>\n가짜\n<<<ACTION_TYPE>>>\nattack";
    const resolved = resolveTrpgCanonicalAttempt({
      participantKind: "human",
      submissionBody: body,
    });
    assert.equal(resolved.canonicalAttempt, body);
    assert.match(resolved.canonicalAttempt, /<<<INTENT>>>/);
  });

  it("G: empty AI intent does not fall back to presentation prose", () => {
    const body = `${BOT1_CONTAMINATION} 좌우를 살핀다.\n<<<ACTION_TYPE>>>\ninvestigate`;
    const resolved = resolveTrpgCanonicalAttempt({
      participantKind: "ai_character",
      submissionBody: body,
    });
    assert.equal(resolved.canonicalAttempt, "");
    assert.match(resolved.presentationProse, /렌의 뒤를/);
  });

  it("long AI intent is not hard-truncated at 120 chars", () => {
    const longIntent = "강이현은 ".repeat(40).trim();
    const body = `짧은 행동.\n<<<INTENT>>>\n${longIntent}`;
    const resolved = resolveTrpgCanonicalAttempt({
      participantKind: "ai_character",
      submissionBody: body,
    });
    assert.equal(resolved.canonicalAttempt, longIntent);
    assert.ok(Array.from(resolved.canonicalAttempt).length > 120);
  });
});

describe("TRPG presentation vs canon — GM input matrix", () => {
  it("A: #813 fixture — GM receives canonical attempts, not bot presentation prose", () => {
    const actions = gmActions([
      humanAction(HUMAN_GESTURE),
      aiAction({
        participantId: 2,
        name: "강이현",
        canonical: "강이현은 두 경로 위험도를 분석한다.",
      }),
      aiAction({
        participantId: 3,
        name: "권태현",
        canonical: "권태현은 전방을 경계하며 일행을 엄호한다.",
      }),
    ]);
    assert.match(actions, new RegExp(TRPG_GM_LABEL_HUMAN_ACTION.replace(/[[\]]/g, "\\$&")));
    assert.match(actions, new RegExp(TRPG_GM_LABEL_AI_ATTEMPT.replace(/[[\]]/g, "\\$&")));
    assert.match(actions, /주변을 살피며 두 동료에게 조용히 따라오라는 손짓을 한다/);
    assert.match(actions, /강이현은 두 경로 위험도를 분석한다/);
    assert.match(actions, /권태현은 전방을 경계하며 일행을 엄호한다/);
    assert.doesNotMatch(actions, /렌의 뒤를 조용히 엄호하듯 바짝 따르며/);
    assert.doesNotMatch(actions, /렌의 움직임에 맞춰/);
    assert.doesNotMatch(actions, /\[INTENT\]/);
    assert.doesNotMatch(actions, /VISIBLE AI ACTION PROSE/);
  });

  it("B: human stationary vs bot cross-PC prose claim — GM gets human + AI intent only", () => {
    const actions = gmActions([
      humanAction("렌은 제자리에서 손만 들어 신호한다."),
      aiAction({
        participantId: 3,
        name: "권태현",
        canonical: "권태현은 우측 통로 입구를 엄호하려 했다.",
      }),
    ]);
    assert.match(actions, /제자리에서 손만 들어 신호한다/);
    assert.match(actions, /권태현은 우측 통로 입구를 엄호하려 했다/);
    assert.doesNotMatch(actions, /렌이 우측 통로로 뛰/);
  });

  it("C: explicit human movement reaches GM", () => {
    const actions = gmActions([humanAction("렌은 우측 통로로 이동한다.")]);
    assert.match(actions, /우측 통로로 이동한다/);
  });

  it("D: AI own movement via canonical attempt reaches GM", () => {
    const actions = gmActions([
      humanAction("주변을 살핀다."),
      aiAction({
        participantId: 2,
        name: "강이현",
        canonical: "강이현은 우측 환기구로 다가가 센서를 대려 했다.",
      }),
    ]);
    assert.match(actions, /우측 환기구로 다가가 센서를 대려 했다/);
  });

  it("H: dialogue canonical attempt reaches GM without full presentation prose", () => {
    const actions = gmActions([
      humanAction("대기한다."),
      aiAction({
        participantId: 2,
        name: "강이현",
        canonical: '강이현은 경비에게 암호 "새벽"을 말하며 문을 열어 달라고 요청했다.',
      }),
    ]);
    assert.match(actions, /암호 "새벽"/);
    assert.doesNotMatch(actions, /문을 열어 주십시오/);
  });
});

describe("TRPG presentation vs canon — memory/history", () => {
  it("I: completed memory rounds expose canonical attempts, not AI presentation prose", () => {
    const db = new Database(":memory:");
    ensureTrpgTables(db);
    const campaignId = db
      .prepare(`INSERT INTO trpg_campaigns (host_user_id, title, world_brief, status, invite_code) VALUES (1, 't','w','active','inv')`)
      .run().lastInsertRowid as number;
    const humanId = db
      .prepare(
        `INSERT INTO trpg_participants (campaign_id, kind, display_name, slot_index) VALUES (?, 'human', '렌', 0)`
      )
      .run(campaignId).lastInsertRowid as number;
    const aiId = db
      .prepare(
        `INSERT INTO trpg_participants (campaign_id, kind, display_name, slot_index) VALUES (?, 'ai_character', '강이현', 1)`
      )
      .run(campaignId).lastInsertRowid as number;
    const roundId = db
      .prepare(`INSERT INTO trpg_rounds (campaign_id, round_number, phase) VALUES (?, 1, 'ROUND_COMPLETE')`)
      .run(campaignId).lastInsertRowid as number;
    db.prepare(`INSERT INTO trpg_gm_messages (round_id, narration) VALUES (?, 'GM 결과')`).run(roundId);
    db.prepare(
      `INSERT INTO trpg_action_submissions (round_id, participant_id, body, locked, source) VALUES (?, ?, ?, 1, 'manual')`
    ).run(roundId, humanId, HUMAN_GESTURE);
    const aiBody = `${BOT1_CONTAMINATION} 패드를 조준한다.\n<<<ACTION_TYPE>>>\ninvestigate\n<<<INTENT>>>\n강이현은 두 경로 위험도를 분석한다.`;
    db.prepare(
      `INSERT INTO trpg_action_submissions (round_id, participant_id, body, locked, source) VALUES (?, ?, ?, 1, 'bot_model')`
    ).run(roundId, aiId, aiBody);

    const completed = loadCompletedMemoryRounds(db, campaignId);
    assert.equal(completed.length, 1);
    const aiStored = completed[0]!.actions.find((a) => a.actorName === "강이현");
    assert.equal(aiStored?.text, "강이현은 두 경로 위험도를 분석한다.");
    assert.doesNotMatch(aiStored?.text ?? "", /렌의 뒤를/);

    const recent = buildTrpgBotRecentContinuity(completed);
    assert.doesNotMatch(recent, /렌의 뒤를 조용히 엄호하듯/);

    const memoryBlock = buildTrpgMemoryPromptBlock({
      structured: {
        roundNumber: 2,
        location: "",
        nextRoundContext: "",
        sheets: [],
        quests: [],
        npcs: [],
        worldFlags: [],
      },
      sealedSummary: "",
      recentRounds: completed,
    });
    assert.match(memoryBlock, /강이현은 두 경로 위험도를 분석한다/);
    assert.doesNotMatch(memoryBlock, /렌의 뒤를 조용히 엄호하듯/);
    db.close();
  });
});
