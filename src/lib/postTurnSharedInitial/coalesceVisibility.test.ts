import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_STATUS_WIDGET } from "@/lib/statusWidget/defaultTemplate";
import { extractStatusWidgetValuesForTurn } from "@/lib/statusWidget/extract";
import { resolveStatusWidgetTurn } from "@/lib/statusWidget/resolve";
import { serializeStatusWidget } from "@/lib/statusWidget/serialize";
import { isStatusWidgetContextSafeForSuggestedRepliesCoalesce } from "./coalesceVisibility";
import { POST_TURN_SHARED_INITIAL_REQUEST_KIND } from "./types";

const creatorJson = serializeStatusWidget(DEFAULT_STATUS_WIDGET);
const userJson = serializeStatusWidget({
  ...DEFAULT_STATUS_WIDGET,
  name: "유저",
  fields: [{ id: "my_note", label: "메모", instruction: "표시용 메모" }],
});

const ASSISTANT = "*그는 고개를 들었다.* \"안녕.\"";

function dualResolved(displayMode: "both" | "hidden" | "creator" | "user") {
  return resolveStatusWidgetTurn({
    characterWidgetJson: creatorJson,
    userWidgetJson: userJson,
    chatMode: "both",
    displayMode,
  });
}

function charOnlyResolved(displayMode: "both" | "hidden" | "creator" | "user") {
  return resolveStatusWidgetTurn({
    characterWidgetJson: creatorJson,
    userWidgetJson: userJson,
    chatMode: "character_only",
    displayMode,
  });
}

function userOnlyResolved(displayMode: "both" | "hidden" | "creator" | "user") {
  return resolveStatusWidgetTurn({
    characterWidgetJson: creatorJson,
    userWidgetJson: userJson,
    chatMode: "user_only",
    displayMode,
  });
}

describe("context visibility gate matrix", () => {
  it("V1 dual + both → coalesce allowed", () => {
    assert.equal(isStatusWidgetContextSafeForSuggestedRepliesCoalesce(dualResolved("both")), true);
  });
  it("V2 dual + hidden → coalesce blocked", () => {
    assert.equal(isStatusWidgetContextSafeForSuggestedRepliesCoalesce(dualResolved("hidden")), false);
  });
  it("V3 dual + creator → coalesce blocked", () => {
    assert.equal(isStatusWidgetContextSafeForSuggestedRepliesCoalesce(dualResolved("creator")), false);
  });
  it("V4 dual + user → coalesce blocked", () => {
    assert.equal(isStatusWidgetContextSafeForSuggestedRepliesCoalesce(dualResolved("user")), false);
  });
  it("V5 character-only + creator → coalesce allowed", () => {
    assert.equal(isStatusWidgetContextSafeForSuggestedRepliesCoalesce(charOnlyResolved("creator")), true);
  });
  it("V6 character-only + both → coalesce allowed", () => {
    assert.equal(isStatusWidgetContextSafeForSuggestedRepliesCoalesce(charOnlyResolved("both")), true);
  });
  it("V7 character-only + user → coalesce blocked", () => {
    assert.equal(isStatusWidgetContextSafeForSuggestedRepliesCoalesce(charOnlyResolved("user")), false);
  });
  it("V8 character-only + hidden → coalesce blocked", () => {
    assert.equal(isStatusWidgetContextSafeForSuggestedRepliesCoalesce(charOnlyResolved("hidden")), false);
  });
  it("V9 user-only + user → coalesce allowed", () => {
    assert.equal(isStatusWidgetContextSafeForSuggestedRepliesCoalesce(userOnlyResolved("user")), true);
  });
  it("V10 user-only + both → coalesce allowed", () => {
    assert.equal(isStatusWidgetContextSafeForSuggestedRepliesCoalesce(userOnlyResolved("both")), true);
  });
  it("V11 user-only + creator → coalesce blocked", () => {
    assert.equal(isStatusWidgetContextSafeForSuggestedRepliesCoalesce(userOnlyResolved("creator")), false);
  });
  it("V12 user-only + hidden → coalesce blocked", () => {
    assert.equal(isStatusWidgetContextSafeForSuggestedRepliesCoalesce(userOnlyResolved("hidden")), false);
  });

  it("V2 integration — hidden dual uses widget combined, not shared initial", async () => {
    const resolved = dualResolved("hidden");
    const invocations: string[] = [];
    await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "안녕",
      assistantProse: ASSISTANT,
      resolved,
      caller: async (_s, _h, opts) => {
        invocations.push(opts.requestKind);
        return {
          text: JSON.stringify({ character_values: {}, user_values: {}, extracted_facts: [] }),
          usage: { inputTokens: 100, outputTokens: 50, estimated: false },
        };
      },
      coalesceSuggestedReplies: { enabled: true },
    });
    assert.equal(
      invocations.filter((k) => k === POST_TURN_SHARED_INITIAL_REQUEST_KIND).length,
      0
    );
    assert.ok(
      invocations.some((k) => k === "background-status-widget-extract-combined")
    );
  });
});
