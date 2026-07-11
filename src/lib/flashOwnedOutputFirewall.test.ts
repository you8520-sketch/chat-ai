import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPrimaryModelFlashFirewallBlock,
  sanitizePrimaryModelAssistantHistory,
  sanitizePrimaryModelContextSource,
  sanitizePrimaryModelHistoryMessages,
  sanitizePrimaryModelOutputArtifacts,
} from "@/lib/flashOwnedOutputFirewall";
import { HTML_OUTPUT_OWNERSHIP_BLOCK } from "@/lib/htmlVisualCardPolicy";

describe("flashOwnedOutputFirewall", () => {
  it("returns unified HTML OUTPUT OWNERSHIP block regardless of opts", () => {
    const block = buildPrimaryModelFlashFirewallBlock();
    assert.equal(block, HTML_OUTPUT_OWNERSHIP_BLOCK);
    assert.match(block, /\[HTML OUTPUT OWNERSHIP\]/);
    assert.match(block, /Korean RP prose only/);
    assert.match(block, /background server processes/);
    assert.match(block, /<<<STATUS_VALUES>>>/);
    assert.doesNotMatch(block, /Gemini/);
    assert.doesNotMatch(block, /DeepSeek/);
    assert.doesNotMatch(block, /YOU output/);
    assert.doesNotMatch(block, /Character-setting translation/);
    assert.doesNotMatch(block, /Memory \/ history compression/);
    assert.doesNotMatch(block, /Do NOT copy status/);

    assert.equal(
      buildPrimaryModelFlashFirewallBlock({ statusWidgetActive: true }),
      block
    );
    assert.equal(
      buildPrimaryModelFlashFirewallBlock({ mainModelOwnsHtmlVisualCard: true }),
      block
    );
    assert.equal(
      buildPrimaryModelFlashFirewallBlock({ modelOutputsPlainStatus: true }),
      block
    );
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
