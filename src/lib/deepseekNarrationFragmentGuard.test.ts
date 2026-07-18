import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEEPSEEK_BOTTOM_REMINDER,
  DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA,
  DEEPSEEK_SHORT_USER_TURN_BLOCK,
  isDeepSeekShortUserTurn,
  resolveDeepSeekShortUserTurnExtra,
  countDeepSeekShortUserTurnChars,
  buildDeepSeekBottomReminderBlock,
  prependDeepSeekBottomReminder,
  resolveDeepSeekShortHistoryLengthExtra,
} from "@/lib/deepseekPromptStructure";
import { buildRegenerateUserPrompt } from "@/lib/continueNarrative";
import {
  IMMERSIVE_PROSE_BLOCK,
  PROSE_STYLE_SECTION,
} from "@/lib/advancedProseNsfwGuidelines";
import { buildWebnovelOutputLayoutRecencyBlock } from "@/lib/webnovelOutputFormat";
import { estimateTokens } from "@/lib/tokenEstimate";
import {
  OPENROUTER_CLAUDE_DEFAULT,
  OPENROUTER_DEEPSEEK_V3_MODEL,
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_GEMINI_25_PRO_MODEL,
  OPENROUTER_QWEN_37_MAX_MODEL,
  isDeepSeekV4ProModel,
} from "@/lib/chatModels";

/** DeepSeek-only anti-fragment clause (must not appear in shared prose/layout SoT). */
const DEEPSEEK_NARRATION_GUARD =
  "대사는 캐릭터 말투에 따라 짧을 수 있다. 지문은 이어지는 행동·감각·의도를 같은 의미 단락 안에서 자연스럽게 연결하며, 짧은 문장마다 새 문단을 만들거나 한두 단어짜리 파편문을 습관적으로 반복하지 않는다.";

const LEGACY_DEEPSEEK_BOTTOM_REMINDER =
  "[System Reminder: 지문은 -다/-했다체(경어 금지), 실제 발화만 큰따옴표, 속마음·감정은 따옴표 없이 지문으로.]";

describe("DeepSeek narration fragment guard (prompt snapshot)", () => {
  it("embeds the narration-guard clause exactly once in the DeepSeek reminder", () => {
    assert.equal(
      (DEEPSEEK_BOTTOM_REMINDER.match(new RegExp(DEEPSEEK_NARRATION_GUARD.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? [])
        .length,
      1
    );
    assert.equal((buildDeepSeekBottomReminderBlock().match(/System Reminder:/g) ?? []).length, 1);
    assert.match(DEEPSEEK_BOTTOM_REMINDER, /지문은 -다\/-했다체/);
    assert.match(DEEPSEEK_BOTTOM_REMINDER, /실제 발화만 큰따옴표/);
  });

  it("does not inject the DeepSeek-only guard into shared prose / OUTPUT LAYOUT", () => {
    assert.doesNotMatch(PROSE_STYLE_SECTION, /대사는 캐릭터 말투에 따라 짧을 수 있다/);
    assert.doesNotMatch(PROSE_STYLE_SECTION, /한두 단어짜리 파편문을 습관적으로/);
    assert.doesNotMatch(IMMERSIVE_PROSE_BLOCK, /대사는 캐릭터 말투에 따라 짧을 수 있다/);
    const layout = buildWebnovelOutputLayoutRecencyBlock();
    assert.doesNotMatch(layout, /대사는 캐릭터 말투에 따라 짧을 수 있다/);
    assert.doesNotMatch(layout, /한두 단어짜리 파편문을 습관적으로/);
  });

  it("keeps DeepSeek reminder application gated to V4 Pro (not Gemini/Qwen/Claude)", () => {
    assert.equal(isDeepSeekV4ProModel(OPENROUTER_DEEPSEEK_V4_PRO_MODEL), true);
    assert.equal(isDeepSeekV4ProModel(OPENROUTER_DEEPSEEK_V3_MODEL), false);
    assert.equal(isDeepSeekV4ProModel(OPENROUTER_QWEN_37_MAX_MODEL), false);
    assert.equal(isDeepSeekV4ProModel(OPENROUTER_GEMINI_25_PRO_MODEL), false);
    assert.equal(isDeepSeekV4ProModel(OPENROUTER_CLAUDE_DEFAULT), false);
  });

  it("prepends the reminder once for DeepSeek user turns", () => {
    const once = prependDeepSeekBottomReminder("hello");
    assert.equal(once.startsWith(DEEPSEEK_BOTTOM_REMINDER), true);
    assert.equal((once.match(/System Reminder:/g) ?? []).length, 1);
    const twice = prependDeepSeekBottomReminder(once);
    assert.equal(twice, once);
  });

  it("clarifies 한 줄 한 화법 as speaker separation, not per-sentence narration breaks", () => {
    const layout = buildWebnovelOutputLayoutRecencyBlock();
    assert.match(layout, /한 줄 한 화법 = 화자가 바뀌면 문단을 나눈다는 뜻/);
    assert.match(layout, /지문 한 문장마다 새 문단을 만들라는 뜻이 아니다/);
    assert.match(layout, /초점이 조금 바뀌더라도 한 문단 안에서 자연스럽게 연결/);
    assert.match(layout, /대사는 화자별 독립 문단/);
    assert.match(layout, /Never append dialogue/);
  });

  it("DeepSeek SINGLE CALL is length-only (not a separate prose dialect)", () => {
    assert.match(DEEPSEEK_BOTTOM_REMINDER, /\[DEEPSEEK LENGTH — SINGLE CALL\]/);
    assert.match(DEEPSEEK_BOTTOM_REMINDER, /single response/i);
    assert.match(DEEPSEEK_BOTTOM_REMINDER, /never imitate a short prior assistant reply/);
    assert.match(DEEPSEEK_BOTTOM_REMINDER, /independently of the length of recent messages/);
    assert.doesNotMatch(DEEPSEEK_BOTTOM_REMINDER, /\[IMMERSIVE PROSE\]/);
    assert.doesNotMatch(DEEPSEEK_BOTTOM_REMINDER, /뜻이었다/);
    assert.doesNotMatch(DEEPSEEK_BOTTOM_REMINDER, /중간 단계를 건너뛰지/);
  });

  it("adds SHORT HISTORY length extra only when recent assistants are short", () => {
    assert.equal(resolveDeepSeekShortHistoryLengthExtra([]), DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA);
    assert.equal(
      resolveDeepSeekShortHistoryLengthExtra([
        { role: "assistant", content: "짧다.".repeat(50) },
      ]),
      DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA
    );
    assert.equal(
      resolveDeepSeekShortHistoryLengthExtra([
        { role: "assistant", content: "긴응답.".repeat(900) },
      ]),
      null
    );
    assert.match(DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA, /\[SHORT HISTORY\]/);
    assert.match(DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA, /not a response-length example/);
    assert.match(DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA, /roughly normal requested length/);
    assert.doesNotMatch(DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA, /4,500/);
    assert.doesNotMatch(DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA, /MINIMUM_FLOOR \(2,700\+\)/);
    assert.doesNotMatch(DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA, /뜻이었다/);
  });

  it("SHORT USER TURN — gates brief RP lines; skips OOC/long/system", () => {
    for (const s of ["배고파.", "응.", "왜?", "졸려.", "뭐 해?", "괜찮아?"]) {
      assert.equal(isDeepSeekShortUserTurn(s), true, s);
      assert.equal(resolveDeepSeekShortUserTurnExtra(s), DEEPSEEK_SHORT_USER_TURN_BLOCK);
    }
    assert.ok(countDeepSeekShortUserTurnChars("배고파.") <= 20);
    assert.equal(
      isDeepSeekShortUserTurn("렌이 식탁에 천천히 앉아 창밖을 바라보며 한숨을 쉬었다."),
      false
    );
    assert.equal(isDeepSeekShortUserTurn("(OOC: 더 짧게 써줘)"), false);
    assert.equal(isDeepSeekShortUserTurn("[채팅 시작]"), false);
    const regen = buildRegenerateUserPrompt({ userMessage: "배고파." });
    assert.equal(isDeepSeekShortUserTurn(regen), true);
    assert.match(DEEPSEEK_SHORT_USER_TURN_BLOCK, /\[SHORT USER TURN\]/);
    assert.match(DEEPSEEK_SHORT_USER_TURN_BLOCK, /interaction cue/);
    assert.doesNotMatch(DEEPSEEK_SHORT_USER_TURN_BLOCK, /REGEN/);
  });

  it("keeps dialogue/narration separation rules", () => {
    const layout = buildWebnovelOutputLayoutRecencyBlock();
    assert.match(layout, /Wrong:\s*그는 고개를 들었다\. "대사\."/);
    assert.match(layout, /\[DIALOGUE & NARRATION\]/);
    assert.match(layout, /하나의 발화는 하나의 인용문/);
  });

  it("does not stack DeepSeek anti-fragment into RHYTHM / IMMERSIVE", () => {
    const rhythm = PROSE_STYLE_SECTION.slice(
      PROSE_STYLE_SECTION.indexOf("[RHYTHM]"),
      PROSE_STYLE_SECTION.indexOf("[SENSATION]")
    );
    assert.doesNotMatch(rhythm, /대사는 캐릭터 말투에 따라 짧을 수 있다/);
    assert.doesNotMatch(rhythm, /짧은 문장마다 새 문단/);
    assert.match(rhythm, /강조·충격·급박/);
    assert.match(IMMERSIVE_PROSE_BLOCK, /모든 움직임을 순서대로 기록하지 않는다/);
    assert.doesNotMatch(IMMERSIVE_PROSE_BLOCK, /한두 단어짜리 파편문/);
  });

  it("reports DeepSeek-only reminder token delta", () => {
    const delta = estimateTokens(DEEPSEEK_BOTTOM_REMINDER) - estimateTokens(LEGACY_DEEPSEEK_BOTTOM_REMINDER);
    assert.ok(delta > 0);
    // Anti-fragment fencing + compact SINGLE CALL length stabilization.
    assert.ok(delta <= 400, `expected bounded delta, got ${delta}`);
  });
});

describe("DeepSeek narration fragment — before/after sample target", () => {
  it("documents the intended rewrite shape (fixture, not live model)", () => {
    const before = [
      "그는 크로스백에서 물병을 꺼냈다.",
      "검정색 텀블러.",
      "표면에 흠집이 있었다.",
    ].join(" ");
    const afterTarget = "그는 크로스백에서 표면 곳곳에 흠집이 난 검은 텀블러를 꺼내 건넸다.";
    assert.match(before, /검정색 텀블러\./);
    assert.doesNotMatch(afterTarget, /검정색 텀블러\./);
    assert.match(afterTarget, /검은 텀블러를 꺼내 건넸다/);
  });
});
