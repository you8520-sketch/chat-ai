import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRegenerateOocPriorityPrompt,
  buildRegenerateSystemDirective,
  buildRegenerateUserPrompt,
  formatRejectedDraftForRegenerate,
  oocOverridesRegenerateRpDirective,
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

  it("user prompt references system divergence only (no duplicate core directive)", () => {
    const block = buildRegenerateUserPrompt({
      userMessage: "앞으로 가자",
      personaName: "렌",
      charName: "에쉬",
      rejectedAssistantDraft: "에쉬가 고개를 끄덕였다.",
      regenAttemptId: "1730000000-abc123",
    });
    assert.match(block, /MANDATORY DIVERGENCE/i);
    assert.match(block, /REGEN_ATTEMPT 1730000000-abc123/i);
    assert.doesNotMatch(block, /\[REGENERATE INTENT/i);
    assert.doesNotMatch(block, /Rejected draft/i);
  });

  it("system directive includes regen attempt nonce", () => {
    const block = buildRegenerateSystemDirective({
      charName: "에쉬",
      rejectedAssistantDraft: "에쉬가 손을 내밀었다.",
      regenAttemptId: "1730000000-xyz",
    });
    assert.match(block, /REGEN_ATTEMPT 1730000000-xyz/i);
  });

  it("system directive includes rejected draft for divergence", () => {
    const block = buildRegenerateSystemDirective({
      charName: "에쉬",
      rejectedAssistantDraft: "에쉬가 손을 내밀었다. \"같이 가자.\"",
    });
    assert.match(block, /MANDATORY DIVERGENCE/i);
    assert.match(block, /Rejected draft/i);
    assert.match(block, /손을 내밀었다/);
    assert.match(block, /Regeneration must differ in: opening, action chain, emotional progression, ending/);
    assert.doesNotMatch(block, /CHAT OOC takes priority/i);
  });

  it("formatRejectedDraftForRegenerate preserves at least min chars when truncating", () => {
    const long = "가".repeat(8000);
    const formatted = formatRejectedDraftForRegenerate(long);
    assert.ok(formatted.length >= REGENERATE_REJECTED_DRAFT_MIN_CHARS);
    assert.ok(formatted.includes("…"));
  });
});
