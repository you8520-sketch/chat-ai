/**
 * #1486 Phase 1 — deterministic fixtures on the LIVE memory path.
 * Character 라이크 18 / persona 렌. Not HISTORICAL_ONLY id=10.
 * No provider POST. Cursor does not assign a memory quality score.
 */
import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import Database from "better-sqlite3";

import {
  ensureEpisodicMemoryFactsTable,
  formatEpisodicMemoryPromptSection,
  getEpisodicMemoryForPrompt,
  inspectLexicalRelevanceForDebug,
  persistEpisodicMemoryFactsBestEffort,
} from "@/lib/episodicMemoryFacts";
import { classifyEpisodicFactTemporalNature } from "@/lib/episodicMemoryTemporal";
import { MEMORY_CAPACITY_FIXED } from "@/lib/memory/memory-capacity-shared";
import {
  MEMORY_POLICY_ID,
  RAW_HISTORY_COMPLETE_EXCHANGES,
  ROLLING_SUMMARY_INTERVAL,
} from "@/lib/memory/memory-constants";
import { ROLLING_SUMMARY_SYSTEM_PROMPT } from "@/lib/memory/memory-rolling-summary";
import { emergencyFallbackTrimLorebookSync } from "@/lib/memory/memory-global-projection";
import { HISTORICAL_RP_QUALIFICATION_CHARACTER_ID } from "@/lib/rpMainRpStyleLengthFixture";
import { RP_QUALITY_PRECALL_TARGET_SELECTOR } from "@/lib/rpQualityPrecall";
import type { ExtractedStatusFact } from "@/lib/statusWidget/types";
import type { buildContext as BuildContextFn } from "@/services/contextBuilder";

const productionRecallEnv = {
  NODE_ENV: "development",
  MEMORY_FEATURE_ENABLED: "1",
  EPISODIC_MEMORY_RECALL_ENABLED: "1",
} as NodeJS.ProcessEnv;

const LIVE = RP_QUALITY_PRECALL_TARGET_SELECTOR;

function createDb(): Database.Database {
  const db = new Database(":memory:");
  ensureEpisodicMemoryFactsTable(db);
  db.exec(`
    CREATE TABLE chat_memories (
      chat_id INTEGER PRIMARY KEY,
      memory_reset_after_message_id INTEGER,
      memory_epoch INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}

function sceneEvent(overrides: Partial<ExtractedStatusFact> & Pick<ExtractedStatusFact, "fact_text" | "value">): ExtractedStatusFact {
  return {
    category: "relationship",
    subject: "laike_ren",
    attribute: "scene_event",
    importance: "critical",
    evidence_type: "explicit_scene_event",
    ...overrides,
  };
}

function persistTurn(
  db: Database.Database,
  sourceTurn: number,
  fact: ExtractedStatusFact
): void {
  persistEpisodicMemoryFactsBestEffort(db, {
    chatId: 1,
    characterId: LIVE.characterId,
    sourceTurn,
    facts: [fact],
    metadata: { memory_evidence_type: fact.evidence_type },
  });
}

function recall(
  db: Database.Database,
  currentTurn: number,
  currentUserMessage: string
) {
  return getEpisodicMemoryForPrompt(
    db,
    {
      chatId: 1,
      characterId: LIVE.characterId,
      currentTurn,
      currentUserMessage,
    },
    productionRecallEnv
  );
}

let buildContext: typeof BuildContextFn;

before(async () => {
  ({ buildContext } = await import("@/services/contextBuilder"));
});

describe("#1486 Phase 1 live memory path (라이크 18 / 렌)", () => {
  it("binds fixtures to current homepage identity, not HISTORICAL_ONLY id=10", () => {
    assert.equal(LIVE.characterId, 18);
    assert.equal(LIVE.characterName, "라이크");
    assert.equal(LIVE.personaName, "렌");
    assert.equal(HISTORICAL_RP_QUALIFICATION_CHARACTER_ID, 10);
    assert.notEqual(LIVE.characterId, HISTORICAL_RP_QUALIFICATION_CHARACTER_ID);
    assert.equal(MEMORY_POLICY_ID, "summary5_raw4");
    assert.equal(ROLLING_SUMMARY_INTERVAL, 5);
    assert.equal(RAW_HISTORY_COMPLETE_EXCHANGES, 4);
    assert.equal(MEMORY_CAPACITY_FIXED, 10000);
  });

  it("A. recalls a 6-turn-old scene event under production minAge", () => {
    const db = createDb();
    persistTurn(
      db,
      1,
      sceneEvent({
        value: "shared_umbrella",
        fact_text: "라이크와 렌이 비 오는 골목에서 우산을 같이 썼다.",
      })
    );
    const result = recall(db, 7, "그때 우산 같이 썼던 거 기억나?");
    assert.equal(result.facts.length >= 1, true);
    assert.match(result.promptBlock, /우산을 같이 썼다/);
    assert.match(result.promptBlock, /\[T1\]/);
  });

  it("B. recalls a 50-turn-old scene event among later filler", () => {
    const db = createDb();
    persistTurn(
      db,
      1,
      sceneEvent({
        value: "rooftop_first_smoke",
        fact_text: "라이크와 렌이 옥상에서 처음으로 담배를 나눠 피웠다.",
      })
    );
    for (let turn = 2; turn <= 48; turn += 1) {
      persistEpisodicMemoryFactsBestEffort(db, {
        chatId: 1,
        characterId: LIVE.characterId,
        sourceTurn: turn,
        facts: [
          {
            category: "setting",
            subject: "ambient",
            attribute: "ambient_detail",
            value: `detail_${turn}`,
            importance: "normal",
            fact_text: `T${turn}에서 무관한 배경 디테일이 기록되었다.`,
            evidence_type: "explicit_scene_event",
          },
        ],
      });
    }
    const stored = db
      .prepare("SELECT fact_text AS t FROM episodic_memory_facts WHERE source_turn = 1")
      .get() as { t?: string } | undefined;
    assert.match(String(stored?.t ?? ""), /옥상에서 처음으로 담배를/);
    const result = recall(db, 51, "옥상에서 담배 피웠던 첫날 기억해?");
    assert.equal(
      result.facts.some((fact) => fact.fact_text.includes("옥상에서 처음으로 담배를")),
      true,
      "50-turn-old rooftop scene must remain injectable"
    );
  });

  it("C. keeps day-old and month-old event wording distinct in the retrieved block", () => {
    const db = createDb();
    persistTurn(
      db,
      8,
      sceneEvent({
        value: "rain_two_days_ago",
        fact_text: "이틀 전 라이크와 렌이 비를 맞으며 정류장까지 걸었다.",
      })
    );
    persistTurn(
      db,
      40,
      sceneEvent({
        value: "move_two_months_ago",
        fact_text: "두 달 전 렌이 라이크의 하숙집으로 짐을 옮겼다.",
      })
    );
    const stored = db
      .prepare("SELECT source_turn AS t, fact_text AS f FROM episodic_memory_facts ORDER BY source_turn")
      .all() as Array<{ t: number; f: string }>;
    assert.equal(stored.length, 2, "both dated scene_events must persist");
    assert.match(stored[0]?.f ?? "", /이틀 전/);
    assert.match(stored[1]?.f ?? "", /두 달 전/);

    const query = "이틀 전과 두 달 전 일을 구분해줘";
    const dayLex = inspectLexicalRelevanceForDebug(
      { subject: "laike_ren", attribute: "scene_event", value: "rain_two_days_ago", fact_text: stored[0]!.f },
      query
    );
    const monthLex = inspectLexicalRelevanceForDebug(
      { subject: "laike_ren", attribute: "scene_event", value: "move_two_months_ago", fact_text: stored[1]!.f },
      query
    );
    assert.ok(dayLex.relevanceScore > 0, "day-old wording must keep lexical overlap");
    assert.ok(monthLex.relevanceScore > 0, "month-old wording must keep lexical overlap via 달");
    assert.ok(monthLex.tokensAfterFirst5.includes("달"));

    const result = recall(db, 46, query);
    assert.match(result.promptBlock, /이틀 전/);
    assert.match(result.promptBlock, /두 달 전/);
    assert.notEqual(
      result.promptBlock.includes("방금 전 비를"),
      true,
      "must not recast a dated event as just-now"
    );
  });

  it("C-neg. calendar unigrams do not inject 달리기/달빛/소년/주머니", () => {
    const db = createDb();
    persistTurn(
      db,
      8,
      sceneEvent({
        value: "rain_two_days_ago",
        fact_text: "이틀 전 라이크와 렌이 비를 맞으며 정류장까지 걸었다.",
      })
    );
    persistTurn(
      db,
      12,
      sceneEvent({
        value: "alley_running_drill",
        fact_text: "라이크가 골목에서 달리기 연습을 했다.",
      })
    );
    persistTurn(
      db,
      20,
      sceneEvent({
        value: "rooftop_moonlight",
        fact_text: "옥상에 달빛이 떨어졌다.",
      })
    );
    persistTurn(
      db,
      28,
      sceneEvent({
        value: "pocket_matches",
        fact_text: "렌이 주머니에서 성냥을 꺼냈다.",
      })
    );
    persistTurn(
      db,
      36,
      sceneEvent({
        value: "saw_the_boy",
        fact_text: "라이크는 그 소년을 처음 보았다.",
      })
    );
    persistTurn(
      db,
      40,
      sceneEvent({
        value: "move_two_months_ago",
        fact_text: "두 달 전 렌이 라이크의 하숙집으로 짐을 옮겼다.",
      })
    );

    const contrast = "이틀 전과 두 달 전 일을 구분해줘";
    const runFact = {
      subject: "laike_ren",
      attribute: "scene_event",
      value: "alley_running_drill",
      fact_text: "라이크가 골목에서 달리기 연습을 했다.",
    };
    const moonFact = {
      subject: "laike_ren",
      attribute: "scene_event",
      value: "rooftop_moonlight",
      fact_text: "옥상에 달빛이 떨어졌다.",
    };
    const pocketFact = {
      subject: "laike_ren",
      attribute: "scene_event",
      value: "pocket_matches",
      fact_text: "렌이 주머니에서 성냥을 꺼냈다.",
    };
    const boyFact = {
      subject: "laike_ren",
      attribute: "scene_event",
      value: "saw_the_boy",
      fact_text: "라이크는 그 소년을 처음 보았다.",
    };
    const monthFact = {
      subject: "laike_ren",
      attribute: "scene_event",
      value: "move_two_months_ago",
      fact_text: "두 달 전 렌이 라이크의 하숙집으로 짐을 옮겼다.",
    };

    assert.equal(inspectLexicalRelevanceForDebug(runFact, contrast).relevanceScore, 0);
    assert.equal(inspectLexicalRelevanceForDebug(moonFact, contrast).relevanceScore, 0);
    assert.equal(inspectLexicalRelevanceForDebug(pocketFact, "한 주 전 일이야?").relevanceScore, 0);
    assert.equal(inspectLexicalRelevanceForDebug(boyFact, "몇 년 전 일이야?").relevanceScore, 0);
    assert.ok(inspectLexicalRelevanceForDebug(monthFact, contrast).relevanceScore > 0);
    assert.ok(inspectLexicalRelevanceForDebug(runFact, "달리기 하던 날 기억나?").relevanceScore > 0);

    const contrastRecall = recall(db, 46, contrast);
    assert.match(contrastRecall.promptBlock, /이틀 전/);
    assert.match(contrastRecall.promptBlock, /두 달 전/);
    assert.equal(contrastRecall.promptBlock.includes("달리기"), false);
    assert.equal(contrastRecall.promptBlock.includes("달빛"), false);
    assert.equal(contrastRecall.promptBlock.includes("주머니"), false);
    assert.equal(contrastRecall.promptBlock.includes("소년"), false);

    const moonQuery = "달이 뜬 밤 기억나?";
    assert.equal(inspectLexicalRelevanceForDebug(monthFact, moonQuery).relevanceScore, 0);
    const moonRecall = recall(db, 46, moonQuery);
    assert.equal(moonRecall.promptBlock.includes("두 달 전"), false);

    const twoCharRecall = recall(db, 46, "달리기 하던 날 기억나?");
    assert.match(twoCharRecall.promptBlock, /달리기/);
    assert.equal(twoCharRecall.promptBlock.includes("두 달 전"), false);
  });

  it("D. keeps past event, blocks current-only emotion, and does not invent a future plan", () => {
    const past = classifyEpisodicFactTemporalNature({
      attribute: "scene_event",
      evidence_type: "explicit_scene_event",
      fact_text: "라이크는 렌의 손을 잡고 골목을 빠져나왔다.",
    });
    const currentEmotion = classifyEpisodicFactTemporalNature({
      attribute: "current_emotion",
      fact_text: "라이크는 지금 초조하다.",
    });
    const futureGuess = classifyEpisodicFactTemporalNature({
      attribute: "current_mood",
      fact_text: "라이크는 내일 떠나려 한다.",
    });
    assert.equal(past, "historical_event");
    assert.equal(currentEmotion, "clearly_temporary");
    assert.equal(futureGuess, "clearly_temporary");

    const db = createDb();
    persistTurn(
      db,
      10,
      sceneEvent({
        value: "escaped_alley",
        fact_text: "라이크는 렌의 손을 잡고 골목을 빠져나왔다.",
      })
    );
    persistTurn(db, 12, {
      category: "character",
      subject: "laike",
      attribute: "current_emotion",
      value: "anxious",
      importance: "important",
      fact_text: "라이크는 지금 초조하다.",
      evidence_type: "explicit_scene_event",
    });
    const result = recall(db, 18, "그날 골목에서 무슨 일이 있었지?");
    assert.match(result.promptBlock, /골목을 빠져나왔다/);
    assert.equal(result.promptBlock.includes("지금 초조하다"), false);
  });

  it("E. preserves an explicit 공수 direction and does not infer it from gender", () => {
    const db = createDb();
    persistTurn(db, 15, {
      category: "relationship",
      subject: "laike_ren",
      attribute: "role_direction",
      value: "laike_led_ren_followed",
      importance: "important",
      fact_text: "그 장면에서 라이크가 먼저 안았고 렌이 따랐다.",
      evidence_type: "explicit_scene_event",
    });
    const result = recall(db, 22, "그때 누가 먼저 안았는지 기억해?");
    assert.match(result.promptBlock, /라이크가 먼저 안았고 렌이 따랐다/);
    assert.equal(ROLLING_SUMMARY_SYSTEM_PROMPT.includes("공수 포지션"), true);
    assert.equal(ROLLING_SUMMARY_SYSTEM_PROMPT.includes("성별·호칭·신체 묘사를 뒤집지 않는다"), true);
  });

  it("F. keeps a completed emotion-change event and drops a momentary mood", () => {
    const change = classifyEpisodicFactTemporalNature({
      attribute: "scene_event",
      evidence_type: "explicit_scene_event",
      fact_text: "렌의 거절 이후 라이크의 화가 풀리고 미안해했다.",
    });
    const mood = classifyEpisodicFactTemporalNature({
      attribute: "current_mood",
      fact_text: "라이크는 지금 기분이 좋다.",
    });
    assert.equal(change, "historical_event");
    assert.equal(mood, "clearly_temporary");
  });

  it("G. does not promote an assistant-only claim into a shared scene event", () => {
    const db = createDb();
    persistTurn(db, 9, {
      category: "relationship",
      subject: "laike_ren",
      attribute: "prior_meeting",
      value: "claimed_childhood",
      importance: "important",
      fact_text: "라이크는 렌을 어릴 적부터 안다고 말했다.",
      evidence_type: "explicit_character_claim",
    });
    const result = recall(db, 16, "우리가 어릴 때부터 알았다고?");
    assert.match(result.promptBlock, /안다고 말했다/);
    assert.equal(result.promptBlock.includes("어릴 적부터 친구였다."), false);
  });

  it("H. 5-turn summary owner keeps time, actor, and fact-preservation rules without adding a second prompt", () => {
    assert.match(ROLLING_SUMMARY_SYSTEM_PROMPT, /작중 시간은 본문·상태창·정본에 명시된 경우에만 기록/);
    assert.match(ROLLING_SUMMARY_SYSTEM_PROMPT, /불명확하면 추측하지 않는다/);
    assert.match(ROLLING_SUMMARY_SYSTEM_PROMPT, /참가자·행위 방향·역할 방향/);
    assert.match(ROLLING_SUMMARY_SYSTEM_PROMPT, /유저의 명확한 선택이 캐릭터의 태도·감정·행동에 영향을 주었으면 반드시 기록/);
    assert.match(ROLLING_SUMMARY_SYSTEM_PROMPT, /유저의 생각·의도·감정을 입력에 없는 내용으로 추측하지 않는다/);
    assert.equal(ROLLING_SUMMARY_SYSTEM_PROMPT.includes("더 길게 써라"), false);
    assert.equal(ROLLING_SUMMARY_SYSTEM_PROMPT.includes("심리학을 써라"), false);
  });

  it("I. retrieved episodic facts reach contextBuilder section 3a", () => {
    const db = createDb();
    persistTurn(
      db,
      3,
      sceneEvent({
        value: "dropped_key",
        fact_text: "렌이 하숙집 열쇠를 계단에서 떨어뜨렸다.",
      })
    );
    const retrieved = recall(db, 10, "열쇠를 어디에 떨어뜨렸지?");
    assert.match(retrieved.promptBlock, /하숙집 열쇠/);
    const formatted = formatEpisodicMemoryPromptSection(retrieved.facts);
    assert.equal(formatted.includes("[EPISODIC MEMORY - RETRIEVED FACTS]"), true);

    const built = buildContext({
      charName: LIVE.characterName,
      chunks: [],
      userNickname: LIVE.personaName,
      shortTermHistory: [],
      nsfw: false,
      longTermMemory: "[현재기억]\n라이크는 렌과 하숙집에서 지낸다.",
      episodicMemoryBlock: retrieved.promptBlock,
      currentUserMessage: "열쇠를 어디에 떨어뜨렸지?",
    });
    const ids = (built.meta?.trackedSections ?? []).map((section) => section.id);
    assert.ok(ids.includes("episodic-memory-retrieved-facts"));
    assert.match(built.systemPrompt, /하숙집 열쇠/);
  });

  it("documents the live 10,000-char LTM cap without raising it", () => {
    const older = `[1~5턴] 두 달 전 렌이 하숙집으로 짐을 옮김.\n`;
    const recent = `[46~50턴] 오늘 라이크가 창가에서 차를 마심.\n`;
    const oversized = `${older}${recent}${"배경 ".repeat(4000)}`;
    assert.ok(oversized.length > MEMORY_CAPACITY_FIXED);
    const trimmed = emergencyFallbackTrimLorebookSync(oversized, MEMORY_CAPACITY_FIXED);
    assert.ok(trimmed.length <= MEMORY_CAPACITY_FIXED);
    assert.equal(MEMORY_CAPACITY_FIXED, 10000);
  });
});
