import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  buildEpisodicCandidateScope,
  inspectLexicalRelevanceForDebug,
} from "@/lib/episodicMemoryFacts";
import { reconcileSummaryItemRoles } from "./memory-summary-integrity";
import { reconcilePromptMemoryRecordBody } from "./memory-turn-summary";
import {
  __setSummarizeTurnBatchCallerForTests,
  summarizeTurnBatch,
} from "./memory-rolling-summary";

const SOURCE = [
  "[80턴]",
  "유저: 공개 프러포즈를 성대하게 서술해.",
  "제이: 제이가 천천히 손을 뻗어, 오스카가 들고 있던 수류탄 핀 반지를 집어 들었다. 제이는 여유로운 동작으로 자신의 왼쪽 네 번째 손가락에 반지를 끼워 넣었다. 다음 날 아침, 메디컬 베이로 기어가다시피 출근한 오스카의 손가락에는, 그가 직접 만든 수류탄 핀 반지가 자랑스럽게 끼워져 있었다.",
].join("\n");

const STORED_76_80 =
  "이후 공개 프러포즈 미신을 믿은 오스카가 격납고에서 폭약 연막으로 청혼하고, 수류탄 핀 반지를 건넴. 제이는 반지를 끼워 약혼을 받아들이는 듯 응답했으나 폭약 낭비와 공개 소동은 처벌하겠다고 선언함. 오스카는 이를 기쁘게 받아들였고, 반지는 오스카가 계속 소유한 채 공식 약혼자라는 기쁨을 드러냄.";

const T100_QUESTION =
  "기억만 말해. 본편과 방금 시작된 외전이 있으면 둘을 구분해. 사람들 앞에서 관계를 확정하려고 물건을 주고받은 일은 어느 쪽의 과거인지, 누가 누구에게 무엇을 건넸는지 말해. 그 뒤에 호칭이나 명령이나 소유에 대한 말이 바뀐 것이 있으면 아직 유효한 것과 철회된 것을 구분해. 없으면 없다고 해.";

describe("B48 summary item roles", () => {
  it("replaces continued ownership when the source shows self-wear and leaves the later ring uncertain", () => {
    const first = reconcileSummaryItemRoles(STORED_76_80, SOURCE);
    assert.equal(first.reason, "continued_owner_contradicts_self_wear");
    assert.equal(first.changed, true);
    assert.doesNotMatch(first.text, /계속 소유/);
    assert.match(first.text, /제이는 반지를 자신의 몸에 끼워/);
    assert.match(first.text, /제이가 자신의 몸에 착용함/);
    assert.match(first.text, /오스카의 직접 만든 착용분이 같은 물건인지는 원문이 확정하지 않음/);
    assert.match(first.text, /수류탄 핀 반지를 건넴/);
    assert.doesNotMatch(first.text, /같은 물건이다|같은 반지다/);
    const second = reconcileSummaryItemRoles(first.text, SOURCE);
    assert.equal(second.changed, false);
    assert.equal(second.text, first.text);
  });

  it("leaves an unrelated continued owner and a wearer-owned item unchanged", () => {
    const unrelated = reconcileSummaryItemRoles(
      "열쇠는 렌이 계속 소유한 채 보관함. 다른 사건은 없음.",
      SOURCE
    );
    assert.equal(unrelated.changed, false);
    assert.match(unrelated.text, /렌이 계속 소유/);

    const sameOwner = reconcileSummaryItemRoles(
      "반지는 제이가 계속 소유한 채 보관함.",
      SOURCE
    );
    assert.equal(sameOwner.changed, false);
    assert.match(sameOwner.text, /제이가 계속 소유/);
  });

  it("does not invent a proposal into a summary that never mentioned the item", () => {
    const early = "골목에서 우산을 같이 쓴 뒤 하숙집으로 돌아옴.";
    const result = reconcileSummaryItemRoles(early, "유저: 안녕.\n제이: 제이가 고개를 끄덕였다.");
    assert.equal(result.changed, false);
    assert.equal(result.text, early);
  });

  it("skips a user-edited record", () => {
    const body = reconcilePromptMemoryRecordBody(
      { userEdited: true, inactive: false, turnStart: 76, turnEnd: 80 },
      STORED_76_80,
      [{ turnNumber: 80, user: "공개 프러포즈", assistant: SOURCE }]
    );
    assert.equal(body, STORED_76_80);
  });

  it("corrects a grounded batch at seal time", async () => {
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: STORED_76_80 }));
    try {
      const summary = await summarizeTurnBatch({
        dialogue: SOURCE,
        charName: "제이",
        startTurn: 76,
        endTurn: 80,
      });
      assert.match(summary, /제이가 자신의 몸에 착용함/);
      assert.match(summary, /원문이 확정하지 않음/);
      assert.doesNotMatch(summary, /계속 소유/);
      assert.ok(summary.length >= 80);
      assert.ok(summary.length <= 600);
    } finally {
      __setSummarizeTurnBatchCallerForTests(null);
    }
  });
});

describe("B48 episodic id 45 boundary", () => {
  const fact = {
    subject: "oscar_fitzroy",
    attribute: "proposal_ring",
    value: "grenade_pin_ring",
    fact_text: "오스카는 수류탄 안전 핀을 가공해 만든 은빛 반지를 프러포즈에 사용했다.",
  };

  it("scores the T100 paraphrase at zero and an overlapping query above zero", () => {
    const missed = inspectLexicalRelevanceForDebug(fact, T100_QUESTION);
    assert.equal(missed.relevanceScore, 0);
    const hit = inspectLexicalRelevanceForDebug(fact, "수류탄 핀 반지");
    assert.ok(hit.relevanceScore > 0);
  });

  it("keeps source turn 80 outside recall at current turn 81 with the default min age", () => {
    const db = new Database(":memory:");
    db.exec(
      `CREATE TABLE chat_memories (
        chat_id INTEGER PRIMARY KEY,
        memory_reset_after_message_id INTEGER,
        memory_epoch INTEGER
      )`
    );
    const scope = buildEpisodicCandidateScope(db, { chatId: 1, currentTurn: 81 }, {});
    assert.equal(scope?.minAgeTurns, 5);
    assert.equal(scope?.recallCutoffTurn, 76);
    assert.equal(80 > (scope?.recallCutoffTurn ?? 0), true);
    db.close();
  });
});
