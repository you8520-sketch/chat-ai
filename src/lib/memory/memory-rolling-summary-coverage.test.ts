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
import { afterEach, describe, it } from "node:test";
import { isTurnEligibleForMemoryRecord } from "./memory-ooc-filter";
import {
  __formatBatchDialogueForTests,
  __setSummarizeTurnBatchCallerForTests,
  summarizeTurnBatch,
} from "./memory-rolling-summary";
import {
  classifyMemoryBatchScopes,
  type TurnScopeClass,
} from "./memory-summary-scope";

const COMPLETE_SUMMARY =
  "두 사람은 첫 만남 뒤 카페로 이동했다 → 숨겨 둔 출생의 비밀을 공유하며 신뢰가 깊어졌다 → " +
  "다시 만나겠다는 약속 뒤 오해로 갈등했지만 반응을 확인했다 → 함께 북쪽 역으로 이동하기로 결정했다.";

afterEach(() => {
  __setSummarizeTurnBatchCallerForTests(null);
});

describe("rolling summary full-batch source coverage", () => {
  it("passes all six distinct main-RP turns and markers to the existing single LLM call", async () => {
    const markers = [
      "첫만남_해질녘정원",
      "카페이동_창가자리",
      "비밀공개_푸른문장",
      "약속성립_자정종탑",
      "갈등반응_깨진찻잔",
      "장소이동_북쪽역",
    ];
    const entries = markers.map((marker, i) => ({
      turnIndex: i + 1,
      turn: {
        user: `${marker}에 관한 인씬 행동을 이어간다.`,
        assistant: `${marker} 사건에 캐릭터가 반응하고 다음 결과가 생긴다.`,
      },
    }));
    const plan = classifyMemoryBatchScopes(entries);

    assert.deepEqual(plan.classes, Array<TurnScopeClass>(6).fill("main_rp"));
    assert.deepEqual(
      plan.mainTurns.map((entry) => entry.turnIndex),
      [1, 2, 3, 4, 5, 6]
    );
    assert.equal(plan.noncanonTurns.length, 0);
    assert.equal(plan.preferenceTurns.length, 0);
    assert.equal(plan.plainOocTurns.length, 0);
    assert.equal(entries.every((entry) => isTurnEligibleForMemoryRecord(entry.turn.user)), true);

    const mainEntries = plan.mainTurns.filter((entry) =>
      isTurnEligibleForMemoryRecord(entry.turn.user)
    );
    let captured = "";
    let calls = 0;
    __setSummarizeTurnBatchCallerForTests(async (_system, history) => {
      calls += 1;
      captured = history[0]?.content ?? "";
      return { text: COMPLETE_SUMMARY };
    });

    const summary = await summarizeTurnBatch({
      dialogue: __formatBatchDialogueForTests(mainEntries, "태형"),
      charName: "태형",
      startTurn: mainEntries[0]!.turnIndex,
      endTurn: mainEntries.at(-1)!.turnIndex,
      sourceTurnIndexes: mainEntries.map((entry) => entry.turnIndex),
    });

    assert.equal(calls, 1);
    assert.equal(summary, COMPLETE_SUMMARY);
    for (let turn = 1; turn <= 6; turn += 1) {
      assert.match(captured, new RegExp(`\\[${turn}턴\\]`));
    }
    for (const marker of markers) assert.match(captured, new RegExp(marker));
    assert.match(captured, /요약 대상 RP source 턴/);
    assert.match(captured, /앞·중간·뒤를 모두 검토/);
    assert.match(captured, /마지막 턴 하나로 축소하지 말고/);
  });

  it("keeps six short unmarked in-scene replies in main_rp", () => {
    const messages = ["응.", "왜?", "같이 가.", "좋아.", "진짜?", "가보자."];
    const entries = messages.map((user, i) => ({
      turnIndex: i + 1,
      turn: { user, assistant: `짧은 인씬 응답 ${i + 1}` },
    }));
    const plan = classifyMemoryBatchScopes(entries);

    assert.deepEqual(plan.classes, Array<TurnScopeClass>(6).fill("main_rp"));
    assert.deepEqual(
      plan.mainTurns.map((entry) => entry.turnIndex),
      [1, 2, 3, 4, 5, 6]
    );
    assert.equal(entries.every((entry) => isTurnEligibleForMemoryRecord(entry.turn.user)), true);
  });
});
