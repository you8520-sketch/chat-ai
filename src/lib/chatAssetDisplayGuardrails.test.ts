import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  CHAT_PORTRAIT_PANEL_IMG_ENHANCED_CLASS,
  CHAT_PORTRAIT_PANEL_MAX_WIDTH_CLASS,
  CHAT_PORTRAIT_RAIL_HEIGHT,
  normalizeShowCharacterPortrait,
} from "@/lib/chatDisplayPrefs";
import { normalizeQuoteSelectionText } from "@/lib/quoteSelectionContainer";

function read(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

describe("general chat asset display guardrails (B0 — production behavior unchanged)", () => {
  it("LEFT-NO-CROP-CLASS: panel image keeps object-contain + object-top", () => {
    assert.match(CHAT_PORTRAIT_PANEL_IMG_ENHANCED_CLASS, /object-contain/);
    assert.match(CHAT_PORTRAIT_PANEL_IMG_ENHANCED_CLASS, /object-top/);
    assert.doesNotMatch(CHAT_PORTRAIT_PANEL_IMG_ENHANCED_CLASS, /object-cover/);
    assert.match(CHAT_PORTRAIT_PANEL_IMG_ENHANCED_CLASS, /h-full w-full/);
  });

  it("LEFT-NO-CROP-FRAME: frame binds aspect-ratio from the asset's own dimensions", () => {
    const source = read("src/components/ChatCharacterPortrait.tsx");
    // Definite rail height + asset aspect -> intrinsic width (no sideways crop).
    assert.match(source, /aspectRatio: `\$\{w\} \/ \$\{h\}`/);
    assert.match(source, /min\(\$\{CHAT_PORTRAIT_RAIL_HEIGHT\}/);
    assert.match(source, /CHAT_PORTRAIT_PANEL_IMG_ENHANCED_CLASS/);
    assert.ok(CHAT_PORTRAIT_RAIL_HEIGHT.trim().length > 0);
    assert.match(CHAT_PORTRAIT_PANEL_MAX_WIDTH_CLASS, /max-w-\[var\(--chat-portrait-max-w\)\]/);
  });

  it("SELECTION-TEXT: quote text normalization is deterministic", () => {
    const nbsp = String.fromCharCode(160);
    assert.equal(normalizeQuoteSelectionText("  hello   world  "), "hello   world");
    assert.equal(normalizeQuoteSelectionText(`a${nbsp}${nbsp}b`), "a  b");
    assert.equal(normalizeQuoteSelectionText("line1\n\n\nline2"), "line1\n\nline2");
    assert.equal(normalizeQuoteSelectionText(""), "");
  });

  it("SELECTION-UI: floating toolbar contract and container wiring", () => {
    const toolbar = read("src/components/ChatSelectionQuoteToolbar.tsx");
    assert.match(toolbar, /data-quote-toolbar/);
    assert.match(toolbar, /\bfixed\b/);
    assert.match(toolbar, /z-\[140\]/);
    assert.match(toolbar, /이미지 저장/);
    const client = read("src/app/chat/[id]/ChatClient.tsx");
    assert.match(client, /containerRef=\{quoteSelectContainerRef\}/);
    assert.match(client, /ref=\{quoteSelectContainerRef\}/);
    assert.match(client, /data-quote-assistant/);
  });

  it("SELECTION-CONTAINER: assistant boundary + ignore contract", () => {
    const container = read("src/lib/quoteSelectionContainer.ts");
    assert.match(container, /data-quote-assistant/);
    assert.match(container, /data-quote-ignore/);
    assert.match(container, /\[data-quote-ui\]/);
    assert.match(container, /startAssistant !== endAssistant/);
  });

  it("PREFS: portrait display defaults on and toggles through the quick rail", () => {
    assert.equal(normalizeShowCharacterPortrait(undefined), true);
    assert.equal(normalizeShowCharacterPortrait(true), true);
    assert.equal(normalizeShowCharacterPortrait(false), false);
    const rail = read("src/components/ChatRoomDisplayQuickRail.tsx");
    assert.match(rail, /showCharacterPortrait: !on/);
    assert.match(rail, /에셋ON/);
    assert.match(rail, /에셋OFF/);
  });

  it("LIVE-FOLLOW-DOM: message list keeps the selection container and assistant markers", () => {
    const client = read("src/app/chat/[id]/ChatClient.tsx");
    assert.match(client, /ref=\{quoteSelectContainerRef\}/);
    assert.match(client, /data-quote-assistant/);
    assert.match(client, /data-chat-assistant-stream-end/);
  });
});