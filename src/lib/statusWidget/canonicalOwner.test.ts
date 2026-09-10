import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_STATUS_WIDGET } from "./defaultTemplate";
import { resolveStatusWidgetTurn } from "./resolve";
import { STATUS_VALUES_BLOCK, STATUS_VALUES_END } from "./parseValues";
import { resolveStatusWidgetTurnValues } from "./telemetry";
import type { StatusWidgetExtractCaller } from "./extract";
import type { TokenUsage } from "@/lib/ai";
import { OPENROUTER_CLAUDE_DEFAULT } from "@/lib/chatModels";

const LEAK_JSON = JSON.stringify({
  시간: "14:30",
  장소: "카페",
  속마음: "긴장",
  현재상황: "대화",
  의식의흐름: "커피 → 대화",
  다음상황: "주문",
  extracted_facts: [],
});

const LUNA_JSON = JSON.stringify({
  시간: "15:00",
  장소: "도서관",
  속마음: "평온",
  현재상황: "독서",
  의식의흐름: "책 → 휴식",
  다음상황: "귀가",
  extracted_facts: [],
});

function mockUsage(n: number): TokenUsage {
  return { inputTokens: 10 + n, outputTokens: 5 + n, estimated: true };
}

function lunaCaller(returnText: string, kinds: string[]): StatusWidgetExtractCaller {
  return async (_s, _h, opts) => {
    kinds.push(opts.requestKind);
    return { text: returnText, usage: mockUsage(kinds.length) };
  };
}

function characterOnlyResolved() {
  return resolveStatusWidgetTurn({
    characterWidgetJson: JSON.stringify(DEFAULT_STATUS_WIDGET),
    chatMode: "character_only",
  });
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    chatId: -1,
    modelId: OPENROUTER_CLAUDE_DEFAULT,
    statusWidgetTurn: characterOnlyResolved(),
    charName: "레온",
    personaName: "렌",
    userMessage: "안녕",
    ...overrides,
  };
}

describe("status canonical owner orchestration (Luna decides, leak never canonical)", () => {
  it("clean prose → single Luna invocation, final values are Luna's", async () => {
    const kinds: string[] = [];
    const out = await resolveStatusWidgetTurnValues({
      ...baseInput(),
      savedText: "RP 본문입니다. 카페에서 마주쳤다.",
      rawWidgetSourceText: "RP 본문입니다. 카페에서 마주쳤다.",
      extractCaller: lunaCaller(LUNA_JSON, kinds),
    });
    assert.equal(kinds.length, 1);
    assert.ok(kinds[0]!.includes("background-status-widget-extract"));
    assert.equal(out.telemetry.resolutionSource, "v3_extract");
    assert.equal(out.telemetry.splitRawHit, false);
    assert.ok(out.values);
    assert.equal(out.values.character?.시간, "15:00");
  });

  it("partial leak → leak stripped, Luna decides, leaked subset not canonical", async () => {
    const partialLeak = JSON.stringify({ 시간: "14:30" });
    const raw = `RP 본문입니다.\n\n${STATUS_VALUES_BLOCK}\n${partialLeak}\n${STATUS_VALUES_END}`;
    const kinds: string[] = [];
    const out = await resolveStatusWidgetTurnValues({
      ...baseInput(),
      savedText: raw,
      rawWidgetSourceText: raw,
      extractCaller: lunaCaller(LUNA_JSON, kinds),
    });
    assert.ok(kinds.length > 0, "Luna must run for the missing fields");
    assert.doesNotMatch(out.prose, /STATUS_VALUES/);
    assert.equal(out.telemetry.splitRawHit, true);
    assert.ok(out.values);
    assert.equal(out.values.character?.시간, "15:00", "leaked subset must not survive as canonical");
    assert.notEqual(out.telemetry.resolutionSource, "split_raw");
  });

  it("widget inactive → no Luna invocation", async () => {
    const inactive = resolveStatusWidgetTurn({
      characterWidgetJson: JSON.stringify(DEFAULT_STATUS_WIDGET),
      chatMode: "off",
    });
    assert.equal(inactive.active, false);
    const kinds: string[] = [];
    const out = await resolveStatusWidgetTurnValues({
      ...baseInput({ statusWidgetTurn: inactive }),
      savedText: "RP 본문입니다.",
      rawWidgetSourceText: "RP 본문입니다.",
      extractCaller: lunaCaller(LUNA_JSON, kinds),
    });
    assert.equal(kinds.length, 0, "inactive widget must not call Luna");
    assert.equal(out.values, null);
  });

  it("regeneration uses the same Luna canonical owner", async () => {
    const raw = `RP 본문입니다.\n\n${STATUS_VALUES_BLOCK}\n${LEAK_JSON}\n${STATUS_VALUES_END}`;
    const kinds: string[] = [];
    const out = await resolveStatusWidgetTurnValues({
      ...baseInput(),
      savedText: raw,
      rawWidgetSourceText: raw,
      regenerate: true,
      regenerateMessageId: -2,
      extractCaller: lunaCaller(LUNA_JSON, kinds),
    });
    assert.ok(kinds.length > 0, "regen must invoke Luna canonical extraction");
    assert.ok(out.values);
    assert.equal(out.values.character?.시간, "15:00");
    assert.equal(out.telemetry.regenerate, true);
    assert.notEqual(out.telemetry.resolutionSource, "split_raw");
  });

  it("Luna initial failure → no values, leaked tail never promoted as fallback", async () => {
    const raw = `RP 본문입니다.\n\n${STATUS_VALUES_BLOCK}\n${LEAK_JSON}\n${STATUS_VALUES_END}`;
    const kinds: string[] = [];
    const failingCaller: StatusWidgetExtractCaller = async (_s, _h, opts) => {
      kinds.push(opts.requestKind);
      return { text: "", usage: mockUsage(kinds.length) };
    };
    const out = await resolveStatusWidgetTurnValues({
      ...baseInput(),
      savedText: raw,
      rawWidgetSourceText: raw,
      extractCaller: failingCaller,
    });
    assert.ok(kinds.length > 0, "Luna must be attempted");
    assert.equal(out.values, null, "failed Luna must not fall back to leaked values");
    assert.equal(out.telemetry.resolutionSource, "none");
    assert.doesNotMatch(out.prose, /STATUS_VALUES/, "leak still stripped from prose");
    assert.equal(out.telemetry.splitRawHit, true);
  });

  it("shared/coalesced path → Luna invoked, canonical values from Luna, no new duplicate", async () => {
    // Note: the widget-only mock does not satisfy the combined shared parser,
    // so the pre-existing shared-miss → dedicated-repair fallback engages.
    // That fallback is shared-orchestration logic, not new duplication from
    // the canonical-owner change. Assert Luna ownership + bounded calls.
    const kinds: string[] = [];
    const out = await resolveStatusWidgetTurnValues({
      ...baseInput(),
      savedText: "RP 본문입니다. 카페에서 마주쳤다.",
      rawWidgetSourceText: "RP 본문입니다. 카페에서 마주쳤다.",
      coalesceSuggestedReplies: true,
      extractCaller: lunaCaller(LUNA_JSON, kinds),
    });
    assert.ok(kinds.length >= 1, "Luna extraction must be invoked");
    assert.ok(
      kinds.length <= 2,
      `bounded physical calls (shared miss → repair fallback is pre-existing), kinds=${kinds.join(",")}`
    );
    assert.ok(
      kinds.every((kind) => kind.includes("background-")),
      "every invocation must be a Luna background call"
    );
    assert.ok(out.values);
    assert.equal(out.values.character?.시간, "15:00");
    assert.notEqual(out.telemetry.resolutionSource, "split_raw");
  });
});
