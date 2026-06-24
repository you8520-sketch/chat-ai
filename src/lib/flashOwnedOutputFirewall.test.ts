import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPrimaryModelFlashFirewallBlock,
  sanitizePrimaryModelAssistantHistory,
  sanitizePrimaryModelContextSource,
  sanitizePrimaryModelHistoryMessages,
  sanitizePrimaryModelOutputArtifacts,
} from "@/lib/flashOwnedOutputFirewall";
import { RELATIONSHIP_MEMORY_SELF_EXTRACT_BLOCK } from "@/lib/relationshipMemoryTailPrompt";

describe("flashOwnedOutputFirewall", () => {
  it("firewall block forbids html json status when Flash owns all UI", () => {
    const block = buildPrimaryModelFlashFirewallBlock();
    assert.match(block, /SERVER GENERATED|FLASH-OWNED/);
    assert.match(block, /FORBIDDEN/);
    assert.match(block, /```html/);
    assert.match(block, /```json/);
    assert.match(block, /<<<STATUS_VALUES>>>/);
  });

  it("firewall block references STATUS WIDGET without duplicating markers when statusWidgetActive", () => {
    const block = buildPrimaryModelFlashFirewallBlock({ statusWidgetActive: true });
    assert.match(block, /\[STATUS WIDGET\]/);
    assert.doesNotMatch(block, /<<<STATUS_VALUES>>>/);
    assert.doesNotMatch(block, /<<<STATUS_VALUES>>> markers/);
  });

  it("firewall block allows main model html when mainModelOwnsHtmlVisualCard", () => {
    const block = buildPrimaryModelFlashFirewallBlock({ mainModelOwnsHtmlVisualCard: true });
    assert.match(block, /MAIN MODEL OUTPUT/);
    assert.match(block, /YOU output/);
    assert.doesNotMatch(block, /Gemini Flash generates ALL/);
  });

  it("firewall block allows plain status when modelOutputsPlainStatus", () => {
    const block = buildPrimaryModelFlashFirewallBlock({ modelOutputsPlainStatus: true });
    assert.match(block, /YOU output plain-text/);
    assert.match(block, /ALLOWED at the very end/);
  });

  it("firewall appends relationship self-extract for DeepSeek/Qwen path", () => {
    const block = buildPrimaryModelFlashFirewallBlock({
      mainModelOwnsRelationshipExtract: true,
    });
    assert.match(block, /RELATIONSHIP MEMORY — SELF-EXTRACT/);
    assert.ok(block.includes(RELATIONSHIP_MEMORY_SELF_EXTRACT_BLOCK));
  });

  it("strips html and pipe tables from primary output by default", () => {
    const input =
      "RP\n\n| a | b |\n|:---:|:---:|\n| 1 | 2 |\n\n```html\n<div>x</div>\n```";
    assert.equal(sanitizePrimaryModelOutputArtifacts(input), "RP");
  });

  it("preserves plain status in output when modelOutputsPlainStatus", () => {
    const input =
      "RP\n\nNPC의 속마음 한 줄 : test\n\n```html\n<div>x</div>\n```";
    assert.match(
      sanitizePrimaryModelOutputArtifacts(input, { modelOutputsPlainStatus: true }),
      /NPC의 속마음/
    );
    assert.doesNotMatch(
      sanitizePrimaryModelOutputArtifacts(input, { modelOutputsPlainStatus: true }),
      /```html/
    );
  });

  it("strips status templates from context source", () => {
    const note = `일반 RP 규칙 — 전투 시 주의할 점`;
    const out = sanitizePrimaryModelContextSource(note);
    assert.match(out, /일반 RP 규칙/);
  });

  it("sanitizes assistant history to prose only", () => {
    const hist = "RP 본문\n\n```html\n<div>ui</div>\n```";
    assert.equal(sanitizePrimaryModelAssistantHistory(hist), "RP 본문");
  });

  it("sanitizePrimaryModelHistoryMessages strips assistant artifacts only", () => {
    const raw =
      "RP\n\n| a | b |\n|:---:|:---:|\n| 1 | 2 |\n\n```html\n<div>x</div>\n```";
    const out = sanitizePrimaryModelHistoryMessages([
      { role: "user", content: "hello" },
      { role: "assistant", content: raw },
    ]);
    assert.equal(out[0].content, "hello");
    assert.equal(out[1].content, "RP");
  });
});
