import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildContext } from "@/services/contextBuilder";
import {
  HISTORICAL_TRUTH_CURRENT_USER_RECENCY_MARKER,
  HISTORICAL_TRUTH_POLICY_BLOCK,
  HISTORICAL_TRUTH_POLICY_SECTION_ID,
  HISTORICAL_TRUTH_POLICY_TITLE,
  buildHistoricalTruthCurrentUserRecencyRef,
  currentUserNeedsHistoricalTruthRecencyRef,
} from "@/lib/historicalTruthPolicy";
import { buildNoGodmoddingBlock } from "@/lib/noGodmodding";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
} from "@/lib/chatModels";

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

  it("assistant cannot invent prior user relationships or third-party familiarity", () => {
    assert.match(
      HISTORICAL_TRUTH_POLICY_BLOCK,
      /유저.*등장인물|등장인물.*유저|제3자|가족|조직/
    );
    assert.match(
      HISTORICAL_TRUTH_POLICY_BLOCK,
      /만난 적|알고 있|안부|약속|공유 사건/
    );
  });

  it("treats concrete user assertions as evidence but not presupposition-only questions", () => {
    assert.match(
      HISTORICAL_TRUTH_POLICY_BLOCK,
      /유저가 구체적으로 진술한 과거 사실/
    );
    assert.match(
      HISTORICAL_TRUTH_POLICY_BLOCK,
      /질문·요청·추측이 어떤 과거를 전제하더라도/
    );
    assert.match(
      HISTORICAL_TRUTH_POLICY_BLOCK,
      /"기억하지\?".*"알지\?".*"평소에 뭐 좋아하는지".*"전에 뭐였더라\?"/s
    );
    assert.match(
      HISTORICAL_TRUTH_POLICY_BLOCK,
      /구체 취향·사건·약속·공유 기억의 근거가 아니다/
    );
  });

  it("preserves harmless user-backstory inference and current-scene progression", () => {
    assert.match(
      HISTORICAL_TRUTH_POLICY_BLOCK,
      /유저의 독립적인 과거 빈칸.*가볍게 추정/
    );
    assert.match(
      HISTORICAL_TRUTH_POLICY_BLOCK,
      /현재 장면에서 새로 발생하는 만남·행동·관계 진전.*창작/
    );
  });

  it("detects recall/presupposition shapes without treating concrete scene setup as one", () => {
    assert.equal(
      currentUserNeedsHistoricalTruthRecencyRef(
        \'렌은 냉장고를 본다. "내가 평소에 뭐 좋아하는지 기억하지? 아무거나 골라봐."\'
      ),
      true
    );
    assert.equal(
      currentUserNeedsHistoricalTruthRecencyRef(
        "OOC: 첫 만남 이후 몇 차례 임무를 함께한 시점. 오늘 임무가 끝난 뒤 숙소에 들어왔다."
      ),
      false
    );
    assert.match(
      buildHistoricalTruthCurrentUserRecencyRef("우리 전에 뭐 먹었더라?"),
      /HISTORICAL TRUTH CHECK/
    );
  });

  it("places one compact historical-truth pointer on risky current USER input for all active quality models", () => {
    for (const modelId of [
      CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
    ]) {
      const built = buildBase({
        modelId,
        currentUserMessage:
          \'렌은 냉장고를 연다. "내가 평소에 뭐 좋아하는지 기억하지? 아무거나 골라봐."\',
        targetResponseChars: 2200,
      });
      assert.equal(countHistoricalTruthFullOwner(built.systemPrompt), 1);
      const lastUser = built.history[built.history.length - 1];
      assert.equal(lastUser?.role, "user");
      assert.equal(
        (lastUser!.content.match(/\\[HISTORICAL TRUTH CHECK\\]/g) ?? []).length,
        1
      );
      assert.match(
        lastUser!.content,
        /과거 공유 기억·첫 경험·과거 부재 단정은 \\[HISTORICAL TRUTH — CANONICAL MEMORY\\]를 따른다/
      );
    }
  });

  it("does not add the recency pointer to a concrete user-authored past setup", () => {
    const built = buildBase({
      currentUserMessage:
        "OOC: 첫 만남 이후 몇 차례 임무를 함께한 시점. 오늘 임무가 끝난 뒤 둘은 숙소에 들어와 있다.",
    });
    const lastUser = built.history[built.history.length - 1];
    assert.equal(lastUser?.role, "user");
    assert.equal(
      lastUser!.content.includes(HISTORICAL_TRUTH_CURRENT_USER_RECENCY_MARKER),
      false
    );
  });
  it("co-narration mode owner does not duplicate full historical truth body", () => {
    const block = buildNoGodmoddingBlock("A", "B", "coNarration");
    assert.doesNotMatch(block, /\[HISTORICAL TRUTH — CANONICAL MEMORY\]/);
    assert.doesNotMatch(block, /\[NO FALSE SHARED MEMORY\]/);
  });
});
