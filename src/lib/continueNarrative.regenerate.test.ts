import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estimateTokens } from "@/lib/tokenEstimate";
import {
  buildRegenerateDivergeAxisLine,
  buildRegenerateDivergenceSummary,
  buildRegenerateOocPriorityPrompt,
  buildRegenerateSystemDirective,
  buildRegenerateUserPrompt,
  formatRejectedDraftForRegenerate,
  oocOverridesRegenerateRpDirective,
  REGENERATE_DIVERGENCE_SUMMARY_MAX_TOKENS,
  REGENERATE_REJECTED_DRAFT_MIN_CHARS,
} from "@/lib/continueNarrative";

describe("regenerate OOC priority", () => {
  it("detects OOC HTML / display-only overrides", () => {
    assert.equal(
      oocOverridesRegenerateRpDirective("OOC: RP 중지. HTML로 입력한 내용만 띄워줘"),
      true
    );
    assert.equal(
      oocOverridesRegenerateRpDirective("(OOC: HTML로 상태창 띄워줘)"),
      true
    );
    assert.equal(
      oocOverridesRegenerateRpDirective("OOC: 현재 장면 계속. 호감도 올려"),
      true
    );
    assert.equal(oocOverridesRegenerateRpDirective("계속 걸어"), false);
  });

  it("OOC priority prompt does not demand new RP arc", () => {
    const block = buildRegenerateOocPriorityPrompt({
      userMessage: "OOC: HTML만. 입력 내용 표기",
      personaName: "렌",
      charName: "에쉬",
    });
    assert.match(block, /CHAT OOC takes priority/i);
    assert.match(block, /user note status\/HTML suspended/i);
    assert.match(block, /Do NOT write RP narration/i);
    assert.doesNotMatch(block, /DIFFERENT story development/i);
  });

  it("OOC priority prompt does not duplicate rejected-draft summary or attempt nonce (system-owned)", () => {
    const block = buildRegenerateOocPriorityPrompt({
      userMessage: "OOC: HTML만. 입력 내용 표기",
      personaName: "렌",
      charName: "에쉬",
      rejectedAssistantDraft: "에쉬가 고개를 끄덕이며 창밖을 바라보았다. 오래된 침묵이 흘렀다.",
      regenAttemptId: "1730000000-abc123",
    });
    assert.doesNotMatch(block, /forbidden beats/i);
    assert.doesNotMatch(block, /Rejected draft/i);
    assert.doesNotMatch(block, /REGEN_ATTEMPT/i);
  });

  it("user prompt references system divergence only (no duplicate core directive)", () => {
    const block = buildRegenerateUserPrompt({
      userMessage: "앞으로 가자",
      personaName: "렌",
      charName: "에쉬",
      rejectedAssistantDraft: "에쉬가 고개를 끄덕였다.",
      regenAttemptId: "1730000000-abc123",
      targetResponseChars: 3200,
    });
    assert.match(block, /MANDATORY DIVERGENCE/i);
    // attempt nonce는 system directive 단일 출처 — user 턴 중복 주입 금지
    assert.doesNotMatch(block, /REGEN_ATTEMPT/i);
    assert.match(block, /Divergence is NOT an excuse for a shorter reply/i);
    assert.match(block, /MINIMUM_FLOOR 2,700/i);
    assert.doesNotMatch(block, /\[REGENERATE INTENT/i);
    assert.doesNotMatch(block, /Rejected draft/i);
    assert.doesNotMatch(block, /forbidden beats/i);
  });

  it("user prompt injects persona speech rules only when co-narration is on", () => {
    const base = {
      userMessage: "앞으로 가자",
      personaName: "렌",
      charName: "에쉬",
      usesBanmal: true,
      targetResponseChars: 3200,
    };
    const off = buildRegenerateUserPrompt(base);
    assert.doesNotMatch(off, /USER PERSONA SPEECH/i);

    const on = buildRegenerateUserPrompt({ ...base, coNarrationEnabled: true });
    assert.match(on, /USER PERSONA SPEECH/i);
    assert.match(on, /반말 ONLY/i);
  });

  it("system directive includes regen attempt nonce and diverge axis", () => {
    const block = buildRegenerateSystemDirective({
      charName: "에쉬",
      rejectedAssistantDraft: "에쉬가 손을 내밀었다.",
      regenAttemptId: "1730000000-xyz",
    });
    assert.match(block, /REGEN_ATTEMPT 1730000000-xyz/i);
    assert.match(block, /REGEN DIVERGE AXIS/i);
    assert.equal(
      buildRegenerateDivergeAxisLine("1730000000-xyz"),
      buildRegenerateDivergeAxisLine("1730000000-xyz")
    );
    assert.notEqual(
      buildRegenerateDivergeAxisLine("1730000000-xyz"),
      buildRegenerateDivergeAxisLine("1730000000-abc")
    );
  });

  it("system directive uses compact forbidden-beat summary by default", () => {
    const draft = [
      "*테라스에서 레온이 난간에 기대어 있었다.*",
      "",
      "*렌이 다가오자 한 걸음 물러섰다.*",
      "",
      "\"세렌티아의 왕족께서 이런 누추한 곳엔 어인 일이십니까.\"",
      "",
      "*그는 시선을 피하며 연회장 쪽을 가리켰다.*",
      "",
      "*마지막으로 차가운 표정으로 고개를 숙였다.*",
    ].join("\n");

    const block = buildRegenerateSystemDirective({
      charName: "레온",
      rejectedAssistantDraft: draft,
    });

    assert.match(block, /MANDATORY DIVERGENCE/i);
    assert.match(block, /avoid these beats; summary only/i);
    assert.match(block, /Opening to avoid:/i);
    assert.match(block, /Dialogue to avoid:/i);
    assert.match(block, /Ending hook to avoid:/i);
    assert.match(block, /테라스/);
    assert.doesNotMatch(block, /Opening situation:/i);
    assert.doesNotMatch(block, /\[Rejected draft — do NOT repeat/i);
    assert.ok(estimateTokens(block) <= REGENERATE_DIVERGENCE_SUMMARY_MAX_TOKENS + 400);
  });

  it("system directive can include full rejected draft when explicitly enabled", () => {
    const block = buildRegenerateSystemDirective({
      charName: "에쉬",
      rejectedAssistantDraft: "에쉬가 손을 내밀었다. \"같이 가자.\"",
      includeFullRejectedDraft: true,
    });
    assert.match(block, /\[Rejected draft — do NOT repeat/i);
    assert.match(block, /손을 내밀었다/);
    assert.doesNotMatch(block, /Opening situation:/i);
  });

  it("divergence summary stays within max token budget for long drafts", () => {
    const long = [
      "*".repeat(20) + " " + "가".repeat(1200),
      "",
      "*중간 행동 " + "나".repeat(800) + "*",
      "",
      "\"대사 " + "다".repeat(200) + "\"",
      "",
      "*끝 장면 " + "라".repeat(1200) + "*",
    ].join("\n");

    const summary = buildRegenerateDivergenceSummary(long);
    assert.ok(summary.length > 0);
    assert.ok(estimateTokens(summary) <= REGENERATE_DIVERGENCE_SUMMARY_MAX_TOKENS);
    assert.doesNotMatch(summary, /\[Rejected draft/i);
  });

  it("formatRejectedDraftForRegenerate preserves at least min chars when truncating", () => {
    const long = "가".repeat(8000);
    const formatted = formatRejectedDraftForRegenerate(long);
    assert.ok(formatted.length >= REGENERATE_REJECTED_DRAFT_MIN_CHARS);
    assert.ok(formatted.includes("…"));
  });
});
