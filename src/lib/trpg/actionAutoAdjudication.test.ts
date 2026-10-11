import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { resolveTrpgActionCheckDecision } from "./actionCheck";
import { inferActionTypeFromMethodHints, scoreActionMethodHints } from "./actionMethodHints";
import {
  pickStatForActionDetailed,
  resolveHumanSubmittedActionType,
  type TrpgActionType,
} from "./actionTypes";
import { parseTrpgBotAction } from "./botActionParse";
import { EVEN_STATS, createTrpgCampaign, saveTrpgSheet } from "./engineCreate";
import { startTrpgCampaign, submitTrpgAction } from "./engineAdvance";
import { loadTrpgSnapshot } from "./engineSnapshot";
import { buildTrpgGmStructuredWireText } from "./gmStructuredOutput";
import {
  adjudicateLockedHumanSubmissions,
  ensureRoundAdjudicationContext,
  loadFrozenAdjudicationDecision,
} from "./roundAdjudication";
import { ensureTrpgTables } from "./schema";
import { loadLatestRound } from "./store";
import { DEFAULT_TRPG_STAT_DEFS, defsFromKeys } from "./stats";

const DEFAULT = DEFAULT_TRPG_STAT_DEFS;
const WITH_TEC = defsFromKeys(["str", "dex", "con", "int", "wis", "cha", "tec"]);
const WITH_MAG = defsFromKeys(["str", "dex", "con", "int", "wis", "cha", "mag"]);

function resolveHumanAuto(
  body: string,
  defs: typeof DEFAULT = DEFAULT
): {
  actionType: TrpgActionType;
  needsCheck: boolean;
  reason: string;
  statKey: string;
} {
  const actionType = resolveHumanSubmittedActionType(body);
  const decision = resolveTrpgActionCheckDecision({ body, actionType });
  const stat = pickStatForActionDetailed({
    actionType,
    selectedStat: null,
    body,
    defs,
  });
  return {
    actionType,
    needsCheck: decision.needsCheck,
    reason: decision.reason,
    statKey: stat.statKey,
  };
}

const KOREAN_FIXTURES: Array<{
  id: string;
  body: string;
  defs?: typeof DEFAULT;
  actionType: TrpgActionType;
  needsCheck: boolean;
  statKey: string;
}> = [
  { id: "talk-nod", body: "고개를 끄덕인다. 「안녕.」", actionType: "free", needsCheck: false, statKey: "dex" },
  { id: "talk-question", body: "「지금 어때?」", actionType: "free", needsCheck: false, statKey: "dex" },
  { id: "talk-greeting", body: "역무원에게 말을 건다.", actionType: "free", needsCheck: false, statKey: "dex" },
  { id: "flavor-lean", body: "벽에 기대 선다.", actionType: "free", needsCheck: false, statKey: "dex" },
  { id: "ordinary-step", body: "자세를 바로잡고 한 발 물러선다.", actionType: "free", needsCheck: false, statKey: "dex" },
  { id: "safe-rest", body: "안전한 곳에서 잠시 휴식하며 상처를 추스른다.", actionType: "free", needsCheck: false, statKey: "dex" },
  { id: "ordinary-medkit", body: "구급키트를 사용한다.", actionType: "free", needsCheck: false, statKey: "dex" },
  { id: "ordinary-bandage", body: "붕대를 사용한다.", actionType: "free", needsCheck: false, statKey: "wis" },
  { id: "free-walk", body: "열린 통로로 걸어간다.", actionType: "free", needsCheck: false, statKey: "dex" },
  { id: "talk-hazard-quote", body: "「저쪽 포자 위험한데?」", actionType: "free", needsCheck: false, statKey: "dex" },
  { id: "persuade-guard", body: "경비병을 설득한다.", actionType: "persuade", needsCheck: true, statKey: "cha" },
  { id: "contested-lie", body: "경비병에게 거짓말로 통과하려 한다.", actionType: "persuade", needsCheck: true, statKey: "cha" },
  { id: "attack-fist", body: "형체의 옆구리를 향해 주먹을 내지른다.", actionType: "attack", needsCheck: true, statKey: "str" },
  { id: "attack-cut", body: "검으로 벤다.", actionType: "attack", needsCheck: true, statKey: "str" },
  { id: "attack-break-door", body: "문을 힘으로 부순다.", actionType: "attack", needsCheck: true, statKey: "str" },
  {
    id: "attack-spell",
    body: "화염 주문을 외운다.",
    defs: WITH_MAG,
    actionType: "attack",
    needsCheck: true,
    statKey: "mag",
  },
  { id: "defend-block", body: "출입구를 가로막는다.", actionType: "defend", needsCheck: true, statKey: "con" },
  { id: "investigate-look", body: "주변을 살핀다.", actionType: "investigate", needsCheck: true, statKey: "int" },
  { id: "investigate-verb", body: "조사한다.", actionType: "investigate", needsCheck: true, statKey: "int" },
  { id: "investigate-drawers", body: "서랍을 뒤진다.", actionType: "investigate", needsCheck: true, statKey: "int" },
  { id: "stealth-hide", body: "그늘에 숨는다.", actionType: "free", needsCheck: true, statKey: "dex" },
  { id: "stealth-sneak", body: "몰래 환풍구로 들어간다.", actionType: "free", needsCheck: true, statKey: "dex" },
  {
    id: "lockpick-tool",
    body: "도구로 자물쇠를 딴다.",
    defs: WITH_TEC,
    actionType: "free",
    needsCheck: true,
    statKey: "tec",
  },
  { id: "forced-door", body: "잠긴 문을 억지로 연다.", actionType: "free", needsCheck: true, statKey: "dex" },
  { id: "hazard-jump", body: "무너지는 잔해 사이를 뛰어넘는다.", actionType: "free", needsCheck: true, statKey: "dex" },
  { id: "hazard-spore", body: "포자 지대로 들어간다.", actionType: "free", needsCheck: true, statKey: "dex" },
  { id: "first-aid", body: "상처를 응급처치한다.", actionType: "free", needsCheck: true, statKey: "wis" },
  { id: "status-treat", body: "마비 상태를 치료한다.", actionType: "free", needsCheck: true, statKey: "wis" },
  { id: "hazard-item", body: "연막탄을 적에게 던진다.", actionType: "free", needsCheck: true, statKey: "dex" },
  { id: "compound-cut", body: "고개를 끄덕인 뒤 검으로 벤다.", actionType: "attack", needsCheck: true, statKey: "str" },
  { id: "travel-warehouse", body: "창고로 간다.", actionType: "free", needsCheck: false, statKey: "str" },
  { id: "talk-magic-ask", body: "「마법을 쓸 수 있어?」", actionType: "free", needsCheck: false, statKey: "dex" },
  { id: "talk-dont-lie", body: "「거짓말하지 마.」", actionType: "free", needsCheck: false, statKey: "dex" },
  { id: "flavor-window-look", body: "창문 밖을 바라본다.", actionType: "free", needsCheck: false, statKey: "str" },
  { id: "attack-spear", body: "창으로 적을 찌른다.", actionType: "attack", needsCheck: true, statKey: "str" },
  { id: "attack-magic-bolt", body: "마법 주문으로 적을 공격한다.", actionType: "attack", needsCheck: true, statKey: "str" },
  { id: "open-teahouse", body: "열린 찻집 문으로 들어간다.", actionType: "free", needsCheck: false, statKey: "dex" },
  { id: "first-aid-bandage", body: "붕대로 상처를 응급처치한다.", actionType: "free", needsCheck: true, statKey: "wis" },
];

describe("human auto adjudication fixtures", () => {
  it("covers at least 25 Korean action bodies", () => {
    assert.ok(KOREAN_FIXTURES.length >= 25, `expected >= 25 fixtures, got ${KOREAN_FIXTURES.length}`);
  });

  for (const row of KOREAN_FIXTURES) {
    it(`${row.id}: ${row.body}`, () => {
      const resolved = resolveHumanAuto(row.body, row.defs ?? DEFAULT);
      assert.equal(resolved.actionType, row.actionType, resolved.reason);
      assert.equal(resolved.needsCheck, row.needsCheck, resolved.reason);
      assert.equal(resolved.statKey, row.statKey);
    });
  }

  it("does not pick the highest sheet stat when the method is physical", () => {
    const defs = defsFromKeys(["str", "dex", "con", "int", "wis", "cha"]);
    const highCha = pickStatForActionDetailed({
      actionType: "attack",
      selectedStat: null,
      body: "검으로 벤다.",
      defs,
    });
    assert.equal(highCha.statKey, "str");
    assert.notEqual(highCha.statKey, "cha");
  });

  it("stat hints may still match 창, but type inference does not lock warehouse travel", () => {
    assert.ok(scoreActionMethodHints("창고로 간다.", "str") > 0);
    assert.equal(inferActionTypeFromMethodHints("창고로 간다."), null);
    assert.equal(resolveHumanSubmittedActionType("창고로 간다."), "free");
    assert.equal(resolveHumanSubmittedActionType("「마법을 쓸 수 있어?」"), "free");
    assert.equal(resolveHumanSubmittedActionType("「거짓말하지 마.」"), "free");
    assert.equal(resolveHumanSubmittedActionType("창문 밖을 바라본다."), "free");
    assert.equal(inferActionTypeFromMethodHints("창으로 적을 찌른다."), "attack");
    assert.equal(inferActionTypeFromMethodHints("마법 주문으로 적을 공격한다."), "attack");
    assert.equal(inferActionTypeFromMethodHints("경비병에게 거짓말로 통과하려 한다."), "persuade");
  });

  it("client selectedStat and invalid keys do not change human resolution", () => {
    const body = "검으로 벤다.";
    const automatic = pickStatForActionDetailed({
      actionType: resolveHumanSubmittedActionType(body),
      selectedStat: null,
      body,
      defs: DEFAULT,
    });
    assert.equal(automatic.statKey, "str");
    assert.equal(
      pickStatForActionDetailed({
        actionType: resolveHumanSubmittedActionType(body),
        selectedStat: "not-a-stat",
        body,
        defs: DEFAULT,
      }).statKey,
      "str"
    );
  });
});

describe("human submit authority", () => {
  it("ignores posted actionType/selectedStat and keeps the player body", async () => {
    const db = new Database(":memory:");
    ensureTrpgTables(db);
    const deps = {
      skipBilling: true,
      rollD20: () => 16,
      gmCall: async () => ({
        text: buildTrpgGmStructuredWireText("장면이 이어진다.", {
          players: [],
          location: "",
          next_round_context: "",
          questsAdd: [],
          flagsAdd: [],
          campaign_finished: false,
        }),
      }),
    };
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    const body = "경비병을 설득한다.";
    submitTrpgAction(db, {
      campaignId,
      userId: 1,
      body,
      actionType: "attack",
      selectedStat: "str",
    });
    const stored = db
      .prepare(`SELECT body, action_type, selected_stat FROM trpg_action_submissions`)
      .get() as { body: string; action_type: string; selected_stat: string | null };
    assert.equal(stored.body, body);
    assert.equal(stored.action_type, "persuade");
    assert.equal(stored.selected_stat, null);
    const snap = loadTrpgSnapshot(db, campaignId, 1);
    assert.equal(snap?.myDraft?.body, body);
    const round = loadLatestRound(db, campaignId)!;
    const ctx = ensureRoundAdjudicationContext(db, {
      campaignId,
      roundId: round.id,
      roundNumber: round.round_number,
      deps,
    });
    adjudicateLockedHumanSubmissions(db, {
      campaignId,
      roundId: round.id,
      pre: ctx.pre,
      deps,
    });
    const roll = db.prepare(`SELECT stat_key FROM trpg_dice_rolls WHERE round_id=?`).get(round.id) as
      | { stat_key: string }
      | undefined;
    assert.equal(roll?.stat_key, "cha");
    db.close();
  });

  it("live path: noun/talk false-positives stay free with no dice; combat/persuade/heal still roll", async () => {
    const rows: Array<{
      body: string;
      actionType: TrpgActionType;
      needsCheck: boolean;
      rollStat: string | null;
    }> = [
      { body: "창고로 간다.", actionType: "free", needsCheck: false, rollStat: null },
      { body: "「마법을 쓸 수 있어?」", actionType: "free", needsCheck: false, rollStat: null },
      { body: "「거짓말하지 마.」", actionType: "free", needsCheck: false, rollStat: null },
      { body: "창문 밖을 바라본다.", actionType: "free", needsCheck: false, rollStat: null },
      { body: "창으로 적을 찌른다.", actionType: "attack", needsCheck: true, rollStat: "str" },
      { body: "마법 주문으로 적을 공격한다.", actionType: "attack", needsCheck: true, rollStat: "str" },
      { body: "경비병에게 거짓말로 통과하려 한다.", actionType: "persuade", needsCheck: true, rollStat: "cha" },
      { body: "잠긴 문을 억지로 연다.", actionType: "free", needsCheck: true, rollStat: "dex" },
      { body: "열린 찻집 문으로 들어간다.", actionType: "free", needsCheck: false, rollStat: null },
      { body: "붕대로 상처를 응급처치한다.", actionType: "free", needsCheck: true, rollStat: "wis" },
    ];
    for (const row of rows) {
      const db = new Database(":memory:");
      ensureTrpgTables(db);
      const deps = {
        skipBilling: true,
        rollD20: () => 16,
        gmCall: async () => ({
          text: buildTrpgGmStructuredWireText("장면이 이어진다.", {
            players: [],
            location: "",
            next_round_context: "",
            questsAdd: [],
            flagsAdd: [],
            campaign_finished: false,
          }),
        }),
      };
      const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
      saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
      await startTrpgCampaign(db, { campaignId, userId: 1, deps });
      submitTrpgAction(db, { campaignId, userId: 1, body: row.body });
      const stored = db
        .prepare(`SELECT id, body, action_type, selected_stat FROM trpg_action_submissions`)
        .get() as { id: number; body: string; action_type: string; selected_stat: string | null };
      assert.equal(stored.body, row.body);
      assert.equal(stored.action_type, row.actionType);
      assert.equal(stored.selected_stat, null);
      const snap = loadTrpgSnapshot(db, campaignId, 1);
      assert.equal(snap?.myDraft?.body, row.body);
      const round = loadLatestRound(db, campaignId)!;
      const ctx = ensureRoundAdjudicationContext(db, {
        campaignId,
        roundId: round.id,
        roundNumber: round.round_number,
        deps,
      });
      adjudicateLockedHumanSubmissions(db, {
        campaignId,
        roundId: round.id,
        pre: ctx.pre,
        deps,
      });
      const frozen = loadFrozenAdjudicationDecision(db, round.id, stored.id);
      assert.equal(frozen?.needsCheck, row.needsCheck, row.body);
      const roll = db
        .prepare(`SELECT stat_key FROM trpg_dice_rolls WHERE round_id=?`)
        .get(round.id) as { stat_key: string } | undefined;
      if (row.needsCheck) {
        assert.equal(roll?.stat_key, row.rollStat, row.body);
      } else {
        assert.equal(roll, undefined, row.body);
      }
      db.close();
    }
  });

  it("preserves explicit bot ACTION_TYPE and INTENT", () => {
    const raw =
      "권태현은 마체테를 고쳐 쥐고 앞으로 나섰다.\n\n<<<ACTION_TYPE>>>\nattack\n\n<<<INTENT>>>\n권태현은 형체의 옆구리를 베려 했다.";
    const parsed = parseTrpgBotAction(raw);
    assert.equal(parsed.actionType, "attack");
    assert.equal(parsed.intent, "권태현은 형체의 옆구리를 베려 했다.");
    assert.doesNotMatch(parsed.prose, /ACTION_TYPE|INTENT/);
    const engine = readFileSync("src/lib/trpg/engineAdvance.ts", "utf8");
    assert.match(
      engine,
      /upsertLockedAction\(db, opts\.roundId, bot\.id, body, parseTrpgBotAction\(body\)\.actionType, null, "bot_model"\)/
    );
    assert.match(engine, /resolveHumanSubmittedActionType\(text\)/);
  });
});
