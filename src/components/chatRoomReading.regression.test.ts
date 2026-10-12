import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import {
  CHAT_PORTRAIT_MIN_CHAT_WIDTH_PX,
  mobilePortraitScrimOpacity,
} from "../lib/chatDisplayPrefs";

const read = (path: string) => fs.readFileSync(path, "utf8");

const css = read("src/app/globals.css");
const client = read("src/app/chat/[id]/ChatClient.tsx");
const toolbar = read("src/components/MessageBubbleToolbar.tsx");
const adultToggle = read("src/components/ChatRoomAdultModeToggle.tsx");

function cssBlock(source: string, selector: string): string {
  const at = source.indexOf(selector);
  assert.ok(at >= 0, `missing css selector: ${selector}`);
  const open = source.indexOf("{", at);
  const close = source.indexOf("}", open);
  return source.slice(open + 1, close);
}

describe("E4-3E chat room — reading column", () => {
  it("keeps the TS constant and the CSS custom property for the minimum chat column in sync", () => {
    assert.equal(CHAT_PORTRAIT_MIN_CHAT_WIDTH_PX, 440);
    assert.match(css, /--chat-portrait-min-chat-w: 440px;/);
  });

  it("scopes Korean eojeol line breaking to the chat room so other NovelText owners are unchanged", () => {
    const block = cssBlock(css, "html.chat-room-active .chat-novel-prose {");
    assert.match(block, /word-break:\s*keep-all/);
    assert.match(block, /overflow-wrap:\s*anywhere/);
    assert.doesNotMatch(cssBlock(css, "\n.chat-novel-prose {"), /word-break/);
  });

  it("anchors the composer to the viewport bottom for short chats at every width", () => {
    const mobile = css.slice(css.indexOf("@media (max-width: 575px) {\n  html.chat-room-active .chat-readability-root"));
    assert.match(mobile.slice(0, 200), /min-height:\s*100dvh/);
    const desktop = css.slice(css.indexOf("@media (min-width: 768px) {\n  html.chat-room-active .chat-room-portrait-grid"));
    assert.match(
      cssBlock(desktop, "html.chat-room-active .chat-room-portrait-chat-column {"),
      /align-self:\s*stretch/
    );
  });

  it("does not add truncation, collapse or height caps to chat prose", () => {
    const prose = cssBlock(css, "html.chat-room-active .chat-novel-prose {");
    assert.doesNotMatch(prose, /max-height|line-clamp|overflow:\s*hidden|text-overflow/);
    assert.doesNotMatch(client, /line-clamp|data-chat-collapse/);
  });
});

describe("E4-3E chat room — mobile background legibility", () => {
  const legacy = (op: number) => Math.max(0, 0.18 * (1 - op));
  const brightness = (op: number) => op * (1 - mobilePortraitScrimOpacity(op));

  it("leaves the default and low opacities exactly as before", () => {
    for (const op of [0, 0.1, 0.22, 0.28]) {
      assert.equal(mobilePortraitScrimOpacity(op), legacy(op));
    }
  });

  it("caps the extra image brightness above the reading threshold without freezing the slider", () => {
    let prev = brightness(0.28);
    for (const op of [0.4, 0.5, 0.65, 0.8, 1]) {
      const b = brightness(op);
      assert.ok(b > prev, `brightness must keep rising with the slider (op=${op})`);
      assert.ok(b < op, `scrim must dim the image above the threshold (op=${op})`);
      prev = b;
    }
    assert.ok(brightness(1) <= 0.5);
  });

  it("stays a valid alpha for any input", () => {
    for (const op of [-1, 0, 0.5, 1, 2, Number.NaN, Number.POSITIVE_INFINITY]) {
      const v = mobilePortraitScrimOpacity(op);
      assert.ok(v >= 0 && v <= 1, `alpha out of range for ${String(op)}`);
    }
  });

  it("feeds the background scrim from the same helper", () => {
    assert.match(client, /mobilePortraitScrimOpacity\(displayPrefs\.portraitBackgroundOpacity\)/);
  });
});

describe("E4-3E chat room — composer", () => {
  const dockStart = client.indexOf("ref={inputDockRef}");
  const dock = client.slice(dockStart, client.indexOf("<aside", dockStart));

  it("keeps the send / continue behavior wiring unchanged", () => {
    assert.match(dock, /onClick=\{send\}/);
    assert.match(dock, /disabled=\{inputLocked \|\| !input\.trim\(\)\}/);
    assert.match(dock, /onClick=\{sendContinue\}/);
    assert.match(dock, /disabled=\{inputLocked \|\| !canContinue\}/);
    assert.match(dock, /e\.ctrlKey \|\| e\.metaKey/);
    assert.match(dock, /maxLength=\{CHAT_MESSAGE_MAX\}/);
  });

  it("marks the generating state on the send button without changing its label", () => {
    assert.match(dock, /aria-busy=\{inputLocked \|\| undefined\}/);
    assert.match(dock, /data-chat-send-state=/);
    assert.match(dock, /\n\s+전송\n/);
  });

  it("gives primary actions a 44px touch target on mobile only", () => {
    assert.equal((dock.match(/min-h-11/g) ?? []).length, 2);
    assert.equal((dock.match(/min-\[576px\]:min-h-0/g) ?? []).length, 2);
  });

  it("keeps the estimate note once, linked to the model picker, and never drops the price label", () => {
    assert.equal((client.match(/id="picker-estimate-note"/g) ?? []).length, 1);
    assert.match(dock, /aria-describedby="picker-estimate-note"/);
    assert.match(dock, /selectedAIOptionLabel\(/);
    assert.match(dock, /\{PICKER_ESTIMATE_VARIANCE_NOTE\}/);
  });

  it("moves the estimate-aware row onto its own line instead of overlapping the toggles", () => {
    assert.match(dock, /selectedEstimateShown\s*\n?\s*\? "basis-full min-\[576px\]:basis-auto"/);
    const labelOpen = dock.indexOf("<label");
    const labelClose = dock.indexOf("</label>");
    assert.ok(labelOpen >= 0 && labelClose > labelOpen);
    assert.doesNotMatch(dock.slice(labelOpen, labelClose), /ChatRoomAdultModeToggle/);
    assert.match(dock, /<ChatRoomAdultModeToggle/);
  });

  it("enlarges the adult-mode switch hit area without changing its size or behavior", () => {
    assert.match(adultToggle, /before:-inset-y-2\.5/);
    assert.match(adultToggle, /onClick=\{onToggle\}/);
    assert.match(adultToggle, /aria-pressed=\{enabled\}/);
  });
});

describe("E4-3E chat room — messages", () => {
  it("renders the user turn as a labelled quiet card with the same NovelText variant", () => {
    assert.match(client, /data-chat-user-message="true"/);
    assert.match(client, /<span className="sr-only">내 메시지<\/span>/);
    assert.match(client, /variant="user"/);
  });

  it("enlarges toolbar targets on mobile and keeps every action wired", () => {
    assert.match(toolbar, /h-10 w-10[^"]*min-\[576px\]:h-8 min-\[576px\]:w-8/);
    for (const label of ["재생성", "수정", "턴 삭제", "분기 생성", "북마크", "이미지 생성"]) {
      assert.match(toolbar, new RegExp(`aria-label="${label}"`));
    }
    assert.match(toolbar, /expectedAssistantMessageId/);
  });

  it("does not touch the scroll-follow / stream owners", () => {
    for (const marker of [
      "data-chat-live-reading-active",
      "data-chat-follow-latest",
      "data-chat-manual-detached",
      "data-chat-live-follow-tail-spacer",
      "data-chat-assistant-stream-end",
      "LIVE_FOLLOW_TAIL_SPACER_RATIO",
    ]) {
      assert.ok(client.includes(marker), `lost ${marker}`);
    }
  });
});
