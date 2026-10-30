import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RelationshipMetaDelta } from "@/lib/chatMemory";
import type { PostTurnSharedInitialRunResult } from "@/lib/postTurnSharedInitial/types";
import {
  RELATIONSHIP_SCENE_REQUEST_KIND,
  augmentRelationshipDeltaWithScene,
  mergeScenePromiseAdds,
} from "./postTurnRelationshipScene";

const SCENE = `"수리는 확실하게 해 두는 게 좋을 거다, 메딕."

제이의 서늘한 경고에 6은 어깨를 으쓱했다.

"Understood. No unauthorized amputations, promise."`;

function runResult(overrides: Partial<PostTurnSharedInitialRunResult> = {}): PostTurnSharedInitialRunResult {
  return {
    attempted: true,
    transportOk: true,
    text: "",
    usage: null,
    parsed: {
      jsonParseOk: true,
      dual: null,
      character: null,
      user: null,
      suggestedReplies: [],
      suggestedRepliesOk: false,
      suggestedRepliesDecisionQuality: null,
      relationship: {
        present: true,
        valid: true,
        delta: { items: [], itemsRemove: [], promisesAdd: [], promisesRemove: [] },
      },
      episodic: { present: false, valid: false, facts: [] },
    },
    httpStatus: 200,
    finishReason: null,
    errorCode: null,
    ...overrides,
  };
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    memoryEnabled: true,
    baseUsable: true,
    mainModelTailParsed: false,
    baseDelta: {
      items: ["제이: 은빛 반지"],
      itemsRemove: [],
      promisesAdd: [],
      promisesRemove: [],
    } as RelationshipMetaDelta,
    assistantProse: SCENE,
    userMessage: "*[ooc: 계속]*",
    charName: "식스",
    personaName: "제이",
    activePromises: ["예전 약속"],
    chatId: 7,
    assistantMessageId: 70,
    generationScope: { assistantMessageId: 70, generationSequence: 3 },
    ...overrides,
  };
}

describe("augmentRelationshipDeltaWithScene", () => {
  it("skips when memory is off", async () => {
    let calls = 0;
    const out = await augmentRelationshipDeltaWithScene(baseInput({ memoryEnabled: false }), {
      run: async () => {
        calls += 1;
        return runResult();
      },
    });
    assert.equal(calls, 0);
    assert.deepEqual(out.promisesAdd, []);
    assert.deepEqual(out.items, ["제이: 은빛 반지"]);
  });

  it("skips when the first relationship section was not usable", async () => {
    let calls = 0;
    await augmentRelationshipDeltaWithScene(baseInput({ baseUsable: false }), {
      run: async () => {
        calls += 1;
        return runResult();
      },
    });
    assert.equal(calls, 0);
  });

  it("skips when the first pass already extracted a promise", async () => {
    let calls = 0;
    const out = await augmentRelationshipDeltaWithScene(
      baseInput({
        baseDelta: {
          items: [],
          itemsRemove: [],
          promisesAdd: [{ text: "이미 저장된 약속" }],
          promisesRemove: [],
        },
      }),
      {
        run: async () => {
          calls += 1;
          return runResult();
        },
      }
    );
    assert.equal(calls, 0);
    assert.deepEqual(out.promisesAdd, [{ text: "이미 저장된 약속" }]);
  });

  it("skips when the main RP tail already owns the relationship delta", async () => {
    let calls = 0;
    const out = await augmentRelationshipDeltaWithScene(
      baseInput({ mainModelTailParsed: true }),
      {
        run: async () => {
          calls += 1;
          return runResult();
        },
      }
    );
    assert.equal(calls, 0);
    assert.deepEqual(out.items, ["제이: 은빛 반지"]);
  });

  it("preserves a first-pass new promise on a turn that also cancels an old one", async () => {
    let calls = 0;
    const out = await augmentRelationshipDeltaWithScene(
      baseInput({
        baseDelta: {
          items: [],
          itemsRemove: [],
          promisesAdd: [{ text: "새 약속" }],
          promisesRemove: ["옛 약속"],
        },
      }),
      {
        run: async () => {
          calls += 1;
          return runResult();
        },
      }
    );
    assert.equal(calls, 0);
    assert.deepEqual(out.promisesAdd, [{ text: "새 약속" }]);
    assert.deepEqual(out.promisesRemove, ["옛 약속"]);
  });

  it("skips conservatively when the first pass cancels a promise", async () => {
    let calls = 0;
    const out = await augmentRelationshipDeltaWithScene(
      baseInput({
        baseDelta: {
          items: [],
          itemsRemove: [],
          promisesAdd: [],
          promisesRemove: ["허가 없는 절단은 하지 않는다"],
        },
      }),
      {
        run: async () => {
          calls += 1;
          return runResult();
        },
      }
    );
    assert.equal(calls, 0);
    assert.deepEqual(out.promisesAdd, []);
    assert.deepEqual(out.promisesRemove, ["허가 없는 절단은 하지 않는다"]);
  });

  it("does not recover a different new promise on a cancellation turn", async () => {
    // Documented conservative trade-off: the first pass stays canonical, so a
    // new promise in the same turn is not recovered by the scene call.
    let calls = 0;
    const out = await augmentRelationshipDeltaWithScene(
      baseInput({
        baseDelta: {
          items: [],
          itemsRemove: [],
          promisesAdd: [],
          promisesRemove: ["허가 없는 절단은 하지 않는다"],
        },
      }),
      {
        run: async () => {
          calls += 1;
          return runResult({
            parsed: {
              ...runResult().parsed!,
              relationship: {
                present: true,
                valid: true,
                delta: {
                  items: [],
                  itemsRemove: [],
                  promisesAdd: [{ text: "내일 다시 올게" }],
                  promisesRemove: [],
                },
              },
            },
          });
        },
      }
    );
    assert.equal(calls, 0);
    assert.deepEqual(out.promisesAdd, []);
  });

  it("skips when the prose has no explicit commitment cue", async () => {
    let calls = 0;
    await augmentRelationshipDeltaWithScene(
      baseInput({ assistantProse: "6은 조용히 메스를 내려놓았다." }),
      {
        run: async () => {
          calls += 1;
          return runResult();
        },
      }
    );
    assert.equal(calls, 0);
  });

  it("makes one isolated scene call with the window and distinct request kind", async () => {
    let calls = 0;
    let seen:
      | {
          assistantProse: string;
          includeSuggestions: boolean;
          includeEpisodic: boolean;
          relationshipSceneWindow: boolean;
          requestKind: string;
          previousAssistantMessage: string | null | undefined;
          ledgerFamily: string | undefined;
          ledgerRequestKind: string | undefined;
        }
      | undefined;
    const out = await augmentRelationshipDeltaWithScene(baseInput(), {
      run: async (input, _caller, ledger) => {
        calls += 1;
        seen = {
          assistantProse: input.assistantProse,
          includeSuggestions: input.includeSuggestions === true,
          includeEpisodic: input.includeEpisodic === true,
          relationshipSceneWindow: input.relationshipSceneWindow === true,
          requestKind: input.requestKind ?? "",
          previousAssistantMessage: input.previousAssistantMessage,
          ledgerFamily: ledger?.family,
          ledgerRequestKind: ledger?.requestKind,
        };
        return runResult({
          parsed: {
            ...runResult().parsed!,
            relationship: {
              present: true,
              valid: true,
              delta: {
                items: [],
                itemsRemove: [],
                promisesAdd: [
                  {
                    text: "6 promises Jay to make Damian as good as new without unauthorized amputations.",
                    deadline: "while treating Damian",
                  },
                ],
                promisesRemove: [],
              },
            },
          },
        });
      },
    });

    assert.equal(calls, 1);
    assert.ok(seen);
    assert.match(seen!.assistantProse, /No unauthorized amputations, promise/);
    assert.doesNotMatch(seen!.assistantProse, /^\[THIS TURN/);
    assert.equal(seen!.includeSuggestions, false);
    assert.equal(seen!.includeEpisodic, false);
    assert.equal(seen!.relationshipSceneWindow, true);
    assert.equal(seen!.previousAssistantMessage, undefined);
    assert.equal(seen!.requestKind, RELATIONSHIP_SCENE_REQUEST_KIND);
    assert.equal(seen!.ledgerFamily, "memory_relationship");
    assert.equal(seen!.ledgerRequestKind, RELATIONSHIP_SCENE_REQUEST_KIND);
    assert.equal(out.promisesAdd?.length, 1);
    assert.deepEqual(out.items, ["제이: 은빛 반지"]);
  });

  it("keeps the first pass items/removes and ignores the scene call's items", async () => {
    const out = await augmentRelationshipDeltaWithScene(
      baseInput({
        baseDelta: {
          items: ["제이: 은빛 반지"],
          itemsRemove: ["오스카: 열쇠"],
          promisesAdd: [],
          promisesRemove: [],
        },
      }),
      {
        run: async () =>
          runResult({
            parsed: {
              ...runResult().parsed!,
              relationship: {
                present: true,
                valid: true,
                delta: {
                  items: ["6: 메스"],
                  itemsRemove: ["제이: 은빛 반지"],
                  promisesAdd: [{ text: "새 약속" }],
                  promisesRemove: ["예전 약속"],
                },
              },
            },
          }),
      }
    );
    assert.deepEqual(out.items, ["제이: 은빛 반지"]);
    assert.deepEqual(out.itemsRemove, ["오스카: 열쇠"]);
    assert.deepEqual(out.promisesRemove, []);
    assert.deepEqual(out.promisesAdd, [{ text: "새 약속" }]);
  });

  it("does not let the scene call reactivate a promise the first pass removed", async () => {
    const out = await augmentRelationshipDeltaWithScene(
      baseInput({
        baseDelta: {
          items: [],
          itemsRemove: [],
          promisesAdd: [],
          promisesRemove: ["허가 없는 절단은 하지 않는다"],
        },
      }),
      {
        run: async () =>
          runResult({
            parsed: {
              ...runResult().parsed!,
              relationship: {
                present: true,
                valid: true,
                delta: {
                  items: [],
                  itemsRemove: [],
                  promisesAdd: [{ text: "허가 없는 절단은 하지 않는다" }],
                  promisesRemove: [],
                },
              },
            },
          }),
      }
    );
    assert.deepEqual(out.promisesAdd, []);
    assert.deepEqual(out.promisesRemove, ["허가 없는 절단은 하지 않는다"]);
  });

  it("keeps the first-pass delta on transport failure and never retries", async () => {
    let calls = 0;
    const out = await augmentRelationshipDeltaWithScene(baseInput(), {
      run: async () => {
        calls += 1;
        return runResult({ transportOk: false, parsed: null, httpStatus: 502 });
      },
    });
    assert.equal(calls, 1);
    assert.deepEqual(out.promisesAdd, []);
    assert.deepEqual(out.items, ["제이: 은빛 반지"]);
  });

  it("keeps the first-pass delta on a malformed relationship section", async () => {
    const out = await augmentRelationshipDeltaWithScene(baseInput(), {
      run: async () =>
        runResult({
          parsed: {
            ...runResult().parsed!,
            relationship: { present: true, valid: false, delta: {} },
          },
        }),
    });
    assert.deepEqual(out.promisesAdd, []);
    assert.deepEqual(out.items, ["제이: 은빛 반지"]);
  });
});

describe("mergeScenePromiseAdds", () => {
  it("dedupes whitespace/case variants and drops removed promises", () => {
    const out = mergeScenePromiseAdds(
      {
        items: [],
        itemsRemove: [],
        promisesAdd: [{ text: "Existing Promise" }],
        promisesRemove: ["Cancelled Promise"],
      },
      [
        { text: " existing   promise " },
        { text: "cancelled promise" },
        { text: "active promise" },
        { text: "New Promise", deadline: "tomorrow" },
      ],
      ["Active Promise"]
    );
    assert.deepEqual(out.promisesAdd, [
      { text: "Existing Promise" },
      { text: "New Promise", deadline: "tomorrow" },
    ]);
  });
});
