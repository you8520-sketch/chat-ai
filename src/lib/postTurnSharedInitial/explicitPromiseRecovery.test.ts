import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatMemoryMetaForPrompt } from "@/lib/chatMemory";
import {
  attachRecoveredPromisesToDelta,
  recoverExplicitPromisesFromTurnProse,
} from "./explicitPromiseRecovery";

const T71_USER =
  "*[ooc:다시 동인지를 읽지않으면 못나가는 방에서 빠져나언후 나이트호크안으로 돌아온상황부터 이야기를 전개한다]*";
const T71_PROMISE_KO = "허가 없는 절단은 안 할게요, 약속하죠.";
const T71_PROMISE_EN = "No unauthorized amputations, promise.";

function longT71Assistant(): string {
  const padding = "메디컬 베이의 조명과 기기 소음이 이어진다. ".repeat(180);
  return `${padding}식스가 장갑을 고쳐 끼며 말했다. 「${T71_PROMISE_KO}」 ${T71_PROMISE_EN} ${padding}`;
}

describe("explicit promise recovery", () => {
  it("recovers the T71 amputation promise from long assistant prose", () => {
    const recovered = recoverExplicitPromisesFromTurnProse({
      userMessage: T71_USER,
      assistantMessage: longT71Assistant(),
    });
    assert.equal(recovered.length, 1);
    assert.match(recovered[0]!.text, /허가 없는 절단은 안 할게요, 약속하죠/);
    assert.doesNotMatch(recovered[0]!.text, /식스|도노반|제이|오스카|데미안/);
  });

  it("does not write items when attaching a recovered T71 promise", () => {
    const delta = attachRecoveredPromisesToDelta(
      { items: [], itemsRemove: [], promisesAdd: [], promisesRemove: [] },
      { userMessage: T71_USER, assistantMessage: longT71Assistant() }
    );
    assert.deepEqual(delta.items, []);
    assert.equal(delta.promisesAdd?.length, 1);
    const prompt = formatMemoryMetaForPrompt({
      honorifics: [],
      items: [],
      thoughts: [],
      promises: delta.promisesAdd ?? [],
    });
    assert.match(String(prompt), /약속:.*허가 없는 절단은 안 할게요/);
    assert.doesNotMatch(String(prompt), /소지품/);
  });

  it("keeps a model-emitted promisesAdd and does not invent a second row", () => {
    const delta = attachRecoveredPromisesToDelta(
      {
        items: [],
        promisesAdd: [{ text: "모델이 이미 기록한 약속", deadline: "처치가 끝날 때까지" }],
      },
      { userMessage: T71_USER, assistantMessage: longT71Assistant() }
    );
    assert.deepEqual(delta.promisesAdd, [
      { text: "모델이 이미 기록한 약속", deadline: "처치가 끝날 때까지" },
    ]);
  });

  it("does not recover a cancellation or an unaccepted offer", () => {
    assert.deepEqual(
      recoverExplicitPromisesFromTurnProse({
        userMessage: "라이크, 네 검을 갈아 주겠다던 내 약속은 취소할게.",
        assistantMessage: "검 손질은 없던 일로 하지.",
      }),
      []
    );
    assert.deepEqual(
      recoverExplicitPromisesFromTurnProse({
        userMessage: "이번 금요일 저녁에 한강에서 같이 야경 볼래요?",
        assistantMessage: "히유는 잠시 숨을 고르더니 창밖만 바라보았다.",
      }),
      []
    );
    assert.deepEqual(
      recoverExplicitPromisesFromTurnProse({
        userMessage: "능선 너머에서 약속된 신호가 올랐다.",
        assistantMessage: "사내가 그 연기를 보더니 입을 다물었다.",
      }),
      []
    );
  });
});
