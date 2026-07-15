import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEEPSEEK_BOTTOM_REMINDER,
  buildDeepSeekBottomReminderBlock,
  prependDeepSeekBottomReminder,
} from "@/lib/deepseekPromptStructure";
import {
  buildAdvancedProseNsfwGuidelines,
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

  it("does not inject the DeepSeek-only guard into shared [RHYTHM]/[MOVEMENT]/[OUTPUT LAYOUT]", () => {
    assert.doesNotMatch(PROSE_STYLE_SECTION, /대사는 캐릭터 말투에 따라 짧을 수 있다/);
    assert.doesNotMatch(PROSE_STYLE_SECTION, /한두 단어짜리 파편문을 습관적으로/);
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
    assert.match(layout, /2~5문장 정도 자연스럽게 묶을 수 있다/);
    assert.match(layout, /대사는 화자별 독립 문단/);
    assert.match(layout, /Never append dialogue/);
  });

  it("keeps dialogue/narration separation rules", () => {
    const layout = buildWebnovelOutputLayoutRecencyBlock();
    assert.match(layout, /Wrong:\s*그는 고개를 들었다\. "대사\."/);
    const guidelines = buildAdvancedProseNsfwGuidelines({ nsfwEnabled: false });
    assert.match(guidelines, /\[DIALOGUE & NARRATION\]/);
    assert.match(guidelines, /하나의 발화는 하나의 인용문/);
  });

  it("does not stack the same anti-fragment sentence across RHYTHM / MOVEMENT / reminder", () => {
    const rhythm = PROSE_STYLE_SECTION.slice(
      PROSE_STYLE_SECTION.indexOf("[RHYTHM]"),
      PROSE_STYLE_SECTION.indexOf("[SENSATION]")
    );
    const movement = PROSE_STYLE_SECTION.slice(
      PROSE_STYLE_SECTION.indexOf("[MOVEMENT & SPACE]"),
      PROSE_STYLE_SECTION.indexOf("[WEBNOVEL BREATH]")
    );
    assert.doesNotMatch(rhythm, /대사는 캐릭터 말투에 따라 짧을 수 있다/);
    assert.doesNotMatch(movement, /대사는 캐릭터 말투에 따라 짧을 수 있다/);
    assert.doesNotMatch(movement, /한두 단어짜리 파편문/);
    assert.doesNotMatch(rhythm, /짧은 문장마다 새 문단/);
    assert.match(rhythm, /강조·충격·급박/);
    assert.match(movement, /동작마다 독립 문장으로 쪼개지 말고/);
    assert.doesNotMatch(movement, /한 동작마다 무엇이 어디서/);
  });

  it("reports DeepSeek-only reminder token delta", () => {
    const delta = estimateTokens(DEEPSEEK_BOTTOM_REMINDER) - estimateTokens(LEGACY_DEEPSEEK_BOTTOM_REMINDER);
    assert.ok(delta > 0);
    assert.ok(delta <= 120, `expected small delta, got ${delta}`);
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
