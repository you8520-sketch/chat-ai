import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildContext } from "@/services/contextBuilder";
import {
  HISTORICAL_TRUTH_POLICY_BLOCK,
  HISTORICAL_TRUTH_POLICY_SECTION_ID,
  HISTORICAL_TRUTH_POLICY_TITLE,
} from "@/lib/historicalTruthPolicy";
import { buildNoGodmoddingBlock } from "@/lib/noGodmodding";

function countHistoricalTruthFullOwner(text: string): number {
  const escaped = HISTORICAL_TRUTH_POLICY_TITLE.replace(/[[\]]/g, "\\$&");
  return (text.match(new RegExp(escaped, "g")) ?? []).length;
}

function buildBase(opts: Partial<Parameters<typeof buildContext>[0]> = {}) {
  return buildContext({
    charName: "A",
    chunks: [],
    userNickname: "B",
    shortTermHistory: [],
    currentUserMessage: "계속.",
    nsfw: false,
    provider: "openrouter",
    episodicMemoryBlock: "",
    completedTurns: 6,
    ...opts,
  });
}

function historicalTruthSection(built: ReturnType<typeof buildContext>): string {
  return (
    built.meta.trackedSections?.find((s) => s.id === HISTORICAL_TRUTH_POLICY_SECTION_ID)
      ?.text ?? ""
  );
}

describe("historical truth — production miss-path owner matrix", () => {
  it("REC-16 STANDARD / zero episodic: canonical owner exactly once with FF-D semantics", () => {
    const built = buildBase();
    assert.equal(countHistoricalTruthFullOwner(built.systemPrompt), 1);
    assert.equal(historicalTruthSection(built), HISTORICAL_TRUTH_POLICY_BLOCK);
    assert.match(built.systemPrompt, /matching event가 보이지 않는다는 사실만으로/);
    assert.match(built.systemPrompt, /처음이었다/);
    assert.doesNotMatch(built.systemPrompt, /\[EPISODIC MEMORY - RETRIEVED FACTS\]/);
  });

  it("REC-17 AUTO / zero episodic: canonical owner exactly once", () => {
    const built = buildBase({ isContinue: true });
    assert.equal(countHistoricalTruthFullOwner(built.systemPrompt), 1);
    assert.doesNotMatch(built.systemPrompt, /\[EPISODIC MEMORY - RETRIEVED FACTS\]/);
  });

  it("REC-18 REGEN / zero episodic: canonical owner exactly once", () => {
    const built = buildBase({
      regenerate: true,
      currentUserMessage: "[SYSTEM: REGENERATE — rewrite ONLY the last assistant message]",
      rejectedAssistantDraft: "A가 고개를 끄덕였다.",
    });
    assert.equal(countHistoricalTruthFullOwner(built.systemPrompt), 1);
    assert.doesNotMatch(built.systemPrompt, /\[EPISODIC MEMORY - RETRIEVED FACTS\]/);
  });

  it("REC-19 CURRENT-TURN DELEGATED / zero episodic: canonical owner exactly once", () => {
    const built = buildBase({
      currentTurnAuthoringDelegation: {
        active: true,
        allowDialogue: true,
        allowMajorActions: false,
        source: "explicit_ooc",
      },
    });
    assert.equal(countHistoricalTruthFullOwner(built.systemPrompt), 1);
    assert.doesNotMatch(built.systemPrompt, /\[EPISODIC MEMORY - RETRIEVED FACTS\]/);
  });

  it("REC-17b CO-NARRATION / zero episodic: canonical owner exactly once", () => {
    const built = buildBase({ userImpersonation: true });
    assert.equal(countHistoricalTruthFullOwner(built.systemPrompt), 1);
    assert.doesNotMatch(built.systemPrompt, /\[EPISODIC MEMORY - RETRIEVED FACTS\]/);
  });

  it("co-narration mode owner does not duplicate full historical truth body", () => {
    const block = buildNoGodmoddingBlock("A", "B", "coNarration");
    assert.doesNotMatch(block, /\[HISTORICAL TRUTH — CANONICAL MEMORY\]/);
    assert.doesNotMatch(block, /\[NO FALSE SHARED MEMORY\]/);
  });
});
