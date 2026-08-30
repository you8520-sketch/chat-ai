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
import {
  buildPostTurnSharedInitialSystem,
  buildPostTurnSharedInitialUserBlock,
  countAuthoritativeSharedOutputContracts,
  sharedSystemHasConflictingWidgetOnlyContract,
} from "@/lib/postTurnSharedInitial/prompt";
import { resolveSuggestedRepliesExtractMaxAttempts } from "@/lib/suggestedReplies/job";
import { OPENROUTER_GEMINI_25_FLASH_MODEL } from "@/lib/chatModels";
import type { StatusWidget } from "@/lib/statusWidget/types";
import { buildCombinedDualWidgetExtractSystem } from "@/lib/statusWidget/extractNormalize";

const creatorJson = serializeStatusWidget(DEFAULT_STATUS_WIDGET);
const userJson = serializeStatusWidget({
  ...DEFAULT_STATUS_WIDGET,
  name: "내 커스텀",
  fields: [{ id: "my_note", label: "메모", instruction: "표시용 메모" }],
});

const ASSISTANT =
  "*그는 천천히 고개를 들었다.* \"오늘은 좀 다르게 시작해볼까.\" *잔잔한 미소.*";

const PUBLIC_PERSONA = {
  userPersona: "이름/호칭: 렌\n성별: 남성 — 절대 준수.",
  personaDescription: "냉소적인 반말, 짧은 문장.",
  personaSpeechExamples: "\"흥, 내가 왜.\"",
};

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

describe("shared initial call graph", () => {
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
      ...PUBLIC_PERSONA,
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
      !spy.invocations.some((i) => i.requestKind === "background-status-widget-extract-combined")
    );
    assert.ok(
      !spy.invocations.some((i) => i.requestKind === "background-suggested-replies-extract")
    );
  });

  it("T9 shared transport failure — attempt consumed, no second full initial", async () => {
    const both = resolveStatusWidgetTurn({
      characterWidgetJson: creatorJson,
      userWidgetJson: userJson,
      chatMode: "both",
      displayMode: "hidden",
    });
    const invocations: Array<{ requestKind: string }> = [];
    const caller = async (
      _system: string,
      _history: ChatMsg[],
      opts: { requestKind: string }
    ) => {
      invocations.push({ requestKind: opts.requestKind });
      if (opts.requestKind === POST_TURN_SHARED_INITIAL_REQUEST_KIND) {
        throw new Error("503 provider unavailable");
      }
      return {
        text: JSON.stringify(buildCombinedWidgetJson(DEFAULT_STATUS_WIDGET, both.userWidget!)),
        usage: {
          inputTokens: 800,
          outputTokens: 200,
          estimated: false,
          upstreamCostUsd: 0.001,
        },
      };
    };

    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "안녕",
      assistantProse: ASSISTANT,
      resolved: both,
      caller,
      primaryModelId: OPENROUTER_GEMINI_25_FLASH_MODEL,
      coalesceSuggestedReplies: { enabled: true },
    });

    assert.equal(
      invocations.filter((i) => i.requestKind === POST_TURN_SHARED_INITIAL_REQUEST_KIND).length,
      1
    );
    assert.equal(
      invocations.filter((i) => i.requestKind === "background-status-widget-extract-combined")
        .length,
      0
    );
    assert.equal(result.meta.sharedInitialConsumed, true);
    assert.equal(result.meta.postTurnSharedInitial, true);
    assert.equal(result.meta.prefetchedSuggestedReplies, null);
    assert.ok(result.meta.actualCallCount <= 4, "widget failure budget not expanded beyond dual_combined max");
    assert.equal(resolveSuggestedRepliesExtractMaxAttempts(result.meta.sharedInitialConsumed), 2);
  });
});

describe("T10 shared prompt output contract", () => {
  it("exactly one authoritative output contract, no conflicting widget-only top-level schema", () => {
    const both = resolveStatusWidgetTurn({
      characterWidgetJson: creatorJson,
      userWidgetJson: userJson,
      chatMode: "both",
      displayMode: "hidden",
    });
    const sharedSystem = buildPostTurnSharedInitialSystem({
      mode: "dual",
      charName: "레온",
      personaName: "렌",
      userMessage: "안녕",
      assistantProse: ASSISTANT,
      characterWidget: both.characterWidget!,
      userWidget: both.userWidget!,
      primaryModelId: "gpt-5.6-luna",
    });
    const widgetOnlySystem = buildCombinedDualWidgetExtractSystem(
      both.characterWidget!,
      both.userWidget!,
      true
    );

    assert.equal(countAuthoritativeSharedOutputContracts(sharedSystem), 1);
    assert.equal(sharedSystemHasConflictingWidgetOnlyContract(sharedSystem), false);
    assert.match(sharedSystem, /"statusWidget"/);
    assert.match(sharedSystem, /"suggestedReplies"/);
    assert.equal(countAuthoritativeSharedOutputContracts(widgetOnlySystem), 1);
    assert.equal(sharedSystemHasConflictingWidgetOnlyContract(widgetOnlySystem), true);
  });
});

describe("T13 persona voice context parity", () => {
  it("public voice context preserved, secret markers absent", () => {
    const both = resolveStatusWidgetTurn({
      characterWidgetJson: creatorJson,
      userWidgetJson: userJson,
      chatMode: "both",
      displayMode: "hidden",
    });
    const block = buildPostTurnSharedInitialUserBlock({
      mode: "dual",
      charName: "레온",
      personaName: "렌",
      userMessage: "안녕",
      assistantProse: ASSISTANT,
      characterWidget: both.characterWidget!,
      userWidget: both.userWidget!,
      primaryModelId: "gpt-5.6-luna",
      userPersona: PUBLIC_PERSONA.userPersona,
      personaDescription: PUBLIC_PERSONA.personaDescription,
      personaSpeechExamples: PUBLIC_PERSONA.personaSpeechExamples,
    });
    assert.match(block, /USER PERSONA PERSONALITY/);
    assert.match(block, /USER SPEECH EXAMPLES/);
    assert.match(block, /냉소적인 반말/);
    assert.match(block, /SUGGESTED REPLIES VOICE CONTEXT/);
    assert.doesNotMatch(block, /비밀설정|secret_description|NPC들은 모르는/i);
  });
});
