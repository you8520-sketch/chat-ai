import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatMsg } from "@/lib/ai";
import { DEFAULT_STATUS_WIDGET } from "@/lib/statusWidget/defaultTemplate";
import { extractStatusWidgetValuesForTurn } from "@/lib/statusWidget/extract";
import { collectWidgetJsonKeys } from "@/lib/statusWidget/prompt";
import { resolveStatusWidgetTurn } from "@/lib/statusWidget/resolve";
import { serializeStatusWidget } from "@/lib/statusWidget/serialize";
import { POST_TURN_SHARED_INITIAL_REQUEST_KIND } from "@/lib/postTurnSharedInitial/types";
import { parsePostTurnSharedInitialResponse } from "@/lib/postTurnSharedInitial/parse";
import { OPENROUTER_GEMINI_25_FLASH_MODEL } from "@/lib/chatModels";
import type { StatusWidget } from "@/lib/statusWidget/types";

const creatorJson = serializeStatusWidget(DEFAULT_STATUS_WIDGET);
const userJson = serializeStatusWidget({
  ...DEFAULT_STATUS_WIDGET,
  name: "내 커스텀",
  fields: [{ id: "my_note", label: "메모", instruction: "표시용 메모" }],
});

const ASSISTANT =
  "*그는 천천히 고개를 들었다.* \"오늘은 좀 다르게 시작해볼까.\" *잔잔한 미소.*";

function padReply(seed: string, length: number): string {
  const filler = "가".repeat(Math.max(0, length - seed.length));
  return `${seed}${filler}`.slice(0, length);
}

function padWidgetValue(key: string): string {
  return `${key}-상세서술`.padEnd(12, "내");
}

function buildCombinedWidgetJson(characterWidget: StatusWidget, userWidget: StatusWidget) {
  const character_values: Record<string, string> = {};
  for (const key of collectWidgetJsonKeys(characterWidget)) {
    character_values[key] = padWidgetValue(key);
  }
  const user_values: Record<string, string> = {};
  for (const key of collectWidgetJsonKeys(userWidget)) {
    user_values[key] = padWidgetValue(key);
  }
  return { character_values, user_values, extracted_facts: [] as unknown[] };
}

function makeSharedResponseJson(
  characterWidget: StatusWidget = DEFAULT_STATUS_WIDGET,
  userWidget: StatusWidget = {
    ...DEFAULT_STATUS_WIDGET,
    name: "내 커스텀",
    fields: [{ id: "my_note", label: "메모", instruction: "표시용 메모" }],
  }
) {
  return JSON.stringify({
    statusWidget: buildCombinedWidgetJson(characterWidget, userWidget),
    suggestedReplies: {
      items: [
        { kind: "escalate", text: padReply("*소매를 잡으며* \"그걸 지금 말이라고 해?\" ", 72) },
        { kind: "soften", text: padReply("*숨을 고르며* \"일단 여기 앉아서 천천히 얘기하자.\" ", 72) },
        { kind: "pivot", text: padReply("*창밖을 가리키며* \"저기 새로 생긴 카페, 같이 가볼래?\" ", 72) },
      ],
    },
  });
}

function makeSpyCaller(responseText: string) {
  const invocations: Array<{ requestKind: string }> = [];
  const caller = async (
    _system: string,
    _history: ChatMsg[],
    opts: { requestKind: string }
  ) => {
    invocations.push({ requestKind: opts.requestKind });
    return {
      text: responseText,
      usage: {
        inputTokens: 1500,
        outputTokens: 600,
        estimated: false,
        upstreamCostUsd: 0.003,
      },
    };
  };
  return { caller, invocations };
}

describe("postTurnSharedInitial parse", () => {
  it("parses dual widget + suggestions independently", () => {
    const both = resolveStatusWidgetTurn({
      characterWidgetJson: creatorJson,
      userWidgetJson: userJson,
      chatMode: "both",
      displayMode: "hidden",
    });
    const parsed = parsePostTurnSharedInitialResponse(makeSharedResponseJson(), {
      mode: "dual",
      charName: "레온",
      personaName: "렌",
      userMessage: "안녕",
      assistantProse: ASSISTANT,
      characterWidget: both.characterWidget!,
      userWidget: both.userWidget!,
      primaryModelId: "gpt-5.6-luna",
    });
    assert.equal(parsed.jsonParseOk, true);
    assert.equal(parsed.dual?.characterOk, true);
    assert.equal(parsed.dual?.userOk, true);
    assert.equal(parsed.suggestedRepliesOk, true);
    assert.equal(parsed.suggestedReplies.length, 3);
  });
});

describe("T1/T2 shared initial call graph", () => {
  it("T1/T2 creator+user widget + coalesce → 1 provider call (shared initial)", async () => {
    const both = resolveStatusWidgetTurn({
      characterWidgetJson: creatorJson,
      userWidgetJson: userJson,
      chatMode: "both",
      displayMode: "hidden",
    });
    const spy = makeSpyCaller(makeSharedResponseJson());

    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "안녕",
      assistantProse: ASSISTANT,
      resolved: both,
      caller: spy.caller,
      primaryModelId: "gpt-5.6-luna",
      coalesceSuggestedReplies: { enabled: true },
    });

    assert.equal(spy.invocations.length, 1);
    assert.equal(spy.invocations[0]?.requestKind, POST_TURN_SHARED_INITIAL_REQUEST_KIND);
    assert.equal(result.meta.sharedInitialConsumed, true);
    assert.equal(result.meta.postTurnSharedInitial, true);
    assert.equal(result.meta.prefetchedSuggestedReplies?.length, 3);
    assert.equal(result.meta.actualCallCount, 1);
    assert.equal(result.meta.extractMode, "dual_combined");
    assert.equal(result.meta.billing?.postTurnSharedInitial, true);
  });

  it("T3 widget ON + coalesce OFF → 1 widget combined call only", async () => {
    const both = resolveStatusWidgetTurn({
      characterWidgetJson: creatorJson,
      userWidgetJson: userJson,
      chatMode: "both",
      displayMode: "hidden",
    });
    const userWidget = both.userWidget!;
    const spy = makeSpyCaller(
      JSON.stringify(buildCombinedWidgetJson(DEFAULT_STATUS_WIDGET, userWidget))
    );

    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "안녕",
      assistantProse: ASSISTANT,
      resolved: both,
      caller: spy.caller,
      primaryModelId: "gpt-5.6-luna",
    });

    assert.equal(spy.invocations.length, 1);
    assert.equal(spy.invocations[0]?.requestKind, "background-status-widget-extract-combined");
    assert.equal(result.meta.postTurnSharedInitial, false);
    assert.equal(result.meta.actualCallCount, 1);
  });

  it("T4 widget OFF path — character-only + coalesce → 1 shared call", async () => {
    const charOnly = resolveStatusWidgetTurn({
      characterWidgetJson: creatorJson,
      userWidgetJson: null,
      chatMode: "character",
      displayMode: "hidden",
    });
    const character_values: Record<string, string> = {};
    for (const key of collectWidgetJsonKeys(DEFAULT_STATUS_WIDGET)) {
      character_values[key] = padWidgetValue(key);
    }
    const spy = makeSpyCaller(
      JSON.stringify({
        statusWidget: { character_values, extracted_facts: [] },
        suggestedReplies: {
          items: [
            { kind: "escalate", text: padReply("*손을 뻗으며* \"잠깐, 그 말부터 다시 들어보자.\" ", 72) },
            { kind: "soften", text: padReply("*미소 지으며* \"괜찮아, 천천히 말해도 돼.\" ", 72) },
            { kind: "pivot", text: padReply("*시계를 보며* \"일단 밥부터 먹고 얘기할까?\" ", 72) },
          ],
        },
      })
    );

    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "안녕",
      assistantProse: ASSISTANT,
      resolved: charOnly,
      caller: spy.caller,
      primaryModelId: "gpt-5.6-luna",
      coalesceSuggestedReplies: { enabled: true },
    });

    assert.equal(spy.invocations.length, 1);
    assert.equal(spy.invocations[0]?.requestKind, POST_TURN_SHARED_INITIAL_REQUEST_KIND);
    assert.equal(result.meta.extractMode, "single");
    assert.equal(result.meta.prefetchedSuggestedReplies?.length, 3);
  });

  it("T5 widget OFF + suggestions would coalesce but neither extract needed → 0 calls", async () => {
    const inactive = resolveStatusWidgetTurn({
      characterWidgetJson: creatorJson,
      userWidgetJson: userJson,
      chatMode: "both",
      displayMode: "hidden",
    });
    inactive.active = false;
    const spy = makeSpyCaller(makeSharedResponseJson());

    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "안녕",
      assistantProse: ASSISTANT,
      resolved: inactive,
      caller: spy.caller,
      primaryModelId: "gpt-5.6-luna",
      coalesceSuggestedReplies: { enabled: true },
    });

    assert.equal(spy.invocations.length, 0);
    assert.equal(result.meta.actualCallCount, 0);
  });

  it("T6 both ON + suggestion malformed — widget ok, suggestion prefetched null", async () => {
    const both = resolveStatusWidgetTurn({
      characterWidgetJson: creatorJson,
      userWidgetJson: userJson,
      chatMode: "both",
      displayMode: "hidden",
    });
    const userWidget = both.userWidget!;
    const spy = makeSpyCaller(
      JSON.stringify({
        statusWidget: buildCombinedWidgetJson(DEFAULT_STATUS_WIDGET, userWidget),
        suggestedReplies: { items: [{ kind: "escalate", text: "짧음" }] },
      })
    );

    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "안녕",
      assistantProse: ASSISTANT,
      resolved: both,
      caller: spy.caller,
      primaryModelId: "gpt-5.6-luna",
      coalesceSuggestedReplies: { enabled: true },
    });

    assert.equal(spy.invocations.length, 1);
    assert.equal(result.meta.postTurnSharedInitial, true);
    assert.equal(result.meta.prefetchedSuggestedReplies, null);
    assert.ok(result.values.character);
    assert.ok(result.values.user);
  });

  it("T7 widget malformed / suggestions valid — widget repair only, suggestions prefetched", async () => {
    const both = resolveStatusWidgetTurn({
      characterWidgetJson: creatorJson,
      userWidgetJson: userJson,
      chatMode: "both",
      displayMode: "hidden",
    });
    const spy = makeSpyCaller(
      JSON.stringify({
        statusWidget: { character_values: {}, user_values: {}, extracted_facts: [] },
        suggestedReplies: {
          items: [
            { kind: "escalate", text: padReply("*소매를 잡으며* \"그걸 지금 말이라고 해?\" ", 72) },
            { kind: "soften", text: padReply("*숨을 고르며* \"일단 여기 앉아서 천천히 얘기하자.\" ", 72) },
            { kind: "pivot", text: padReply("*창밖을 가리키며* \"저기 새로 생긴 카페, 같이 가볼래?\" ", 72) },
          ],
        },
      })
    );

    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "안녕",
      assistantProse: ASSISTANT,
      resolved: both,
      caller: spy.caller,
      primaryModelId: OPENROUTER_GEMINI_25_FLASH_MODEL,
      coalesceSuggestedReplies: { enabled: true },
    });

    assert.ok(result.meta.prefetchedSuggestedReplies?.length === 3);
    assert.ok(spy.invocations.length >= 2);
    assert.equal(spy.invocations[0]?.requestKind, POST_TURN_SHARED_INITIAL_REQUEST_KIND);
    assert.ok(
      spy.invocations.slice(1).every((i) => i.requestKind.includes("status-widget")),
      "follow-up calls are widget repair only"
    );
    assert.ok(
      !spy.invocations.some((i) => i.requestKind === "background-suggested-replies-extract")
    );
  });

  it("T8 both malformed — shared=1 then independent widget repairs, no suggestion extract", async () => {
    const both = resolveStatusWidgetTurn({
      characterWidgetJson: creatorJson,
      userWidgetJson: userJson,
      chatMode: "both",
      displayMode: "hidden",
    });
    const spy = makeSpyCaller(
      JSON.stringify({
        statusWidget: { character_values: {}, user_values: {}, extracted_facts: [] },
        suggestedReplies: { items: [{ kind: "escalate", text: "짧음" }] },
      })
    );

    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "안녕",
      assistantProse: ASSISTANT,
      resolved: both,
      caller: spy.caller,
      primaryModelId: OPENROUTER_GEMINI_25_FLASH_MODEL,
      coalesceSuggestedReplies: { enabled: true },
    });

    assert.equal(spy.invocations[0]?.requestKind, POST_TURN_SHARED_INITIAL_REQUEST_KIND);
    assert.equal(result.meta.prefetchedSuggestedReplies, null);
    assert.ok(spy.invocations.length >= 2);
    assert.ok(spy.invocations.length <= 4, "widget repair budget not expanded beyond dual_combined max");
    assert.ok(
      !spy.invocations.some((i) => i.requestKind === "background-suggested-replies-extract")
    );
  });
});
