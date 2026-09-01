import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatMsg } from "@/lib/ai";
import { OPENROUTER_GEMINI_25_FLASH_MODEL } from "@/lib/chatModels";
import { POST_TURN_SHARED_INITIAL_REQUEST_KIND } from "@/lib/postTurnSharedInitial/types";
import { extractStatusWidgetValuesForTurn } from "@/lib/statusWidget/extract";
import { statusWidgetValuesHasContent } from "@/lib/statusWidget/displayPolicy";
import { DEFAULT_STATUS_WIDGET } from "@/lib/statusWidget/defaultTemplate";
import { collectWidgetJsonKeys } from "@/lib/statusWidget/prompt";
import { resolveStatusWidgetTurn } from "@/lib/statusWidget/resolve";
import { serializeStatusWidget } from "@/lib/statusWidget/serialize";
import type { StatusWidget } from "@/lib/statusWidget/types";

const creatorJson = serializeStatusWidget(DEFAULT_STATUS_WIDGET);
const userJson = serializeStatusWidget({
  ...DEFAULT_STATUS_WIDGET,
  name: "내 커스텀",
  fields: [{ id: "my_note", label: "메모", instruction: "표시용 메모" }],
});

const ASSISTANT =
  "*그는 천천히 고개를 들었다.* \"오늘은 좀 다르게 시작해볼까.\" *잔잔한 미소.*";

function padWidgetValue(key: string): string {
  return `${key}-상세서술`.padEnd(12, "내");
}

function buildCharacterValues(widget: StatusWidget = DEFAULT_STATUS_WIDGET): Record<string, string> {
  const character_values: Record<string, string> = {};
  for (const key of collectWidgetJsonKeys(widget)) {
    character_values[key] = padWidgetValue(key);
  }
  return character_values;
}

function buildUserValues(userWidget: StatusWidget): Record<string, string> {
  const user_values: Record<string, string> = {};
  for (const key of collectWidgetJsonKeys(userWidget)) {
    user_values[key] = padWidgetValue(key);
  }
  return user_values;
}

function jsonForWidget(widget: StatusWidget, overrides: Record<string, string> = {}): string {
  const obj: Record<string, unknown> = {};
  for (const key of collectWidgetJsonKeys(widget)) {
    obj[key] = overrides[key] ?? padWidgetValue(key);
  }
  obj.extracted_facts = [];
  return JSON.stringify(obj);
}

function sharedDualPartialJson(input: {
  characterOk: boolean;
  userOk: boolean;
  userWidget: StatusWidget;
}) {
  return JSON.stringify({
    statusWidget: {
      character_values: input.characterOk ? buildCharacterValues() : {},
      user_values: input.userOk ? buildUserValues(input.userWidget) : {},
      extracted_facts: [],
    },
  });
}

function makePartialDualCaller(input: {
  initialText: string;
  repairWidget: StatusWidget;
}) {
  const invocations: Array<{ requestKind: string }> = [];
  const caller = async (
    _system: string,
    _history: ChatMsg[],
    opts: { requestKind: string }
  ) => {
    invocations.push({ requestKind: opts.requestKind });
    const text =
      opts.requestKind === POST_TURN_SHARED_INITIAL_REQUEST_KIND
        ? input.initialText
        : jsonForWidget(input.repairWidget);
    return {
      text,
      usage: {
        inputTokens: 900,
        outputTokens: 300,
        estimated: false,
        upstreamCostUsd: 0.002,
      },
    };
  };
  return { caller, invocations };
}

function makeInvalidJsonCaller(userWidget: StatusWidget) {
  const invocations: Array<{ requestKind: string }> = [];
  let repairIndex = 0;
  const caller = async (
    _system: string,
    _history: ChatMsg[],
    opts: { requestKind: string }
  ) => {
    invocations.push({ requestKind: opts.requestKind });
    if (opts.requestKind === POST_TURN_SHARED_INITIAL_REQUEST_KIND) {
      return {
        text: "not-json{{{",
        usage: {
          inputTokens: 900,
          outputTokens: 300,
          estimated: false,
          upstreamCostUsd: 0.002,
        },
      };
    }
    const widget = repairIndex === 0 ? DEFAULT_STATUS_WIDGET : userWidget;
    repairIndex += 1;
    return {
      text: jsonForWidget(widget),
      usage: {
        inputTokens: 900,
        outputTokens: 300,
        estimated: false,
        upstreamCostUsd: 0.002,
      },
    };
  };
  return { caller, invocations };
}

function resolveBothWidgets() {
  return resolveStatusWidgetTurn({
    characterWidgetJson: creatorJson,
    userWidgetJson: userJson,
    chatMode: "both",
    displayMode: "both",
  });
}

describe("shared initial partial dual extraction (production path)", () => {
  it("character success + user fail — preserve character, repair user only", async () => {
    const both = resolveBothWidgets();
    const userWidget = both.userWidget!;
    const { caller, invocations } = makePartialDualCaller({
      initialText: sharedDualPartialJson({ characterOk: true, userOk: false, userWidget }),
      repairWidget: userWidget,
    });

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

    const sharedInitialCalls = invocations.filter(
      (i) => i.requestKind === POST_TURN_SHARED_INITIAL_REQUEST_KIND
    ).length;
    const repairCalls = invocations.filter(
      (i) => i.requestKind === "background-status-widget-extract-repair"
    ).length;
    const initialDiag = result.meta.attemptDiagnostics.find((d) => d.stage === "initial");

    assert.equal(sharedInitialCalls, 1);
    assert.equal(repairCalls, 1);
    assert.equal(result.meta.actualCallCount, 2);
    assert.equal(initialDiag?.succeeded, false);
    assert.equal(initialDiag?.reasonCode, "V3_INITIAL_EMPTY");
    assert.equal(result.meta.character?.stages.includes("repair"), false);
    assert.equal(result.meta.user?.stages.includes("repair"), true);
    assert.equal(statusWidgetValuesHasContent({ character: result.values.character ?? undefined }), true);
    assert.equal(statusWidgetValuesHasContent({ user: result.values.user ?? undefined }), true);
  });

  it("character fail + user success — preserve user, repair character only", async () => {
    const both = resolveBothWidgets();
    const userWidget = both.userWidget!;
    const { caller, invocations } = makePartialDualCaller({
      initialText: sharedDualPartialJson({ characterOk: false, userOk: true, userWidget }),
      repairWidget: DEFAULT_STATUS_WIDGET,
    });

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

    const repairCalls = invocations.filter(
      (i) => i.requestKind === "background-status-widget-extract-repair"
    ).length;
    const initialDiag = result.meta.attemptDiagnostics.find((d) => d.stage === "initial");

    assert.equal(
      invocations.filter((i) => i.requestKind === POST_TURN_SHARED_INITIAL_REQUEST_KIND).length,
      1
    );
    assert.equal(repairCalls, 1);
    assert.equal(result.meta.actualCallCount, 2);
    assert.equal(initialDiag?.succeeded, false);
    assert.equal(initialDiag?.reasonCode, "V3_INITIAL_EMPTY");
    assert.equal(result.meta.character?.stages.includes("repair"), true);
    assert.equal(result.meta.user?.stages.includes("repair"), false);
    assert.equal(statusWidgetValuesHasContent({ character: result.values.character ?? undefined }), true);
    assert.equal(statusWidgetValuesHasContent({ user: result.values.user ?? undefined }), true);
  });

  it("invalid JSON — no parsed payload preserved, both sources repaired", async () => {
    const both = resolveBothWidgets();
    const userWidget = both.userWidget!;
    const { caller, invocations } = makeInvalidJsonCaller(userWidget);

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

    const initialDiag = result.meta.attemptDiagnostics.find((d) => d.stage === "initial");
    const repairCalls = invocations.filter(
      (i) => i.requestKind === "background-status-widget-extract-repair"
    ).length;

    assert.equal(initialDiag?.succeeded, false);
    assert.equal(initialDiag?.reasonCode, "V3_PARSE_FAILED");
    assert.equal(repairCalls, 2);
    assert.ok(result.meta.actualCallCount >= 3);
    assert.equal(statusWidgetValuesHasContent({ character: result.values.character ?? undefined }), true);
    assert.equal(statusWidgetValuesHasContent({ user: result.values.user ?? undefined }), true);
  });
});
