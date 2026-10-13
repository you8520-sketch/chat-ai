import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import {
  CHAT_PORTRAIT_MIN_CHAT_WIDTH_PX,
  CHAT_PORTRAIT_MIN_CHAT_WIDTH_FLOOR_PX,
  mobilePortraitCaptionAlpha,
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
    assert.equal(CHAT_PORTRAIT_MIN_CHAT_WIDTH_FLOOR_PX, 360);
    assert.match(
      css,
      /--chat-portrait-min-chat-w: clamp\(360px, calc\(100cqw - 1\.5rem - 273px\), 440px\);/
    );
  });

  it("scopes Korean eojeol line breaking to the chat room so other NovelText owners are unchanged", () => {
    const block = cssBlock(css, "html.chat-room-active .chat-novel-prose {");
    assert.match(block, /word-break:\s*keep-all/);
    assert.match(block, /overflow-wrap:\s*anywhere/);
    assert.doesNotMatch(cssBlock(css, "\n.chat-novel-prose {"), /word-break/);
  });

  it("anchors the composer to the viewport bottom for short chats at every width", () => {
    const mobile = css.slice(css.indexOf("@media (max-width: 767px) {\n  /* 짧은 대화에서도"));
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

describe("E4-3E chat room — mobile background legibility (candidate B caption backing)", () => {
  it("leaves the default and low opacities without any caption backing", () => {
    for (const op of [0, 0.1, 0.22, 0.28]) {
      assert.equal(mobilePortraitCaptionAlpha(op), 0);
    }
  });

  it("raises the backing monotonically with the slider and caps it so the image stays visible", () => {
    let prev = 0;
    for (const op of [0.4, 0.5, 0.65, 0.8, 1]) {
      const a = mobilePortraitCaptionAlpha(op);
      assert.ok(a >= prev, `alpha must not fall as the slider rises (op=${op})`);
      assert.ok(a > 0 && a <= 0.78);
      prev = a;
    }
  });

  it("stays a valid alpha for any input", () => {
    for (const op of [-1, 0, 0.5, 1, 2, Number.NaN, Number.POSITIVE_INFINITY]) {
      const v = mobilePortraitCaptionAlpha(op);
      assert.ok(v >= 0 && v <= 1, `alpha out of range for ${String(op)}`);
    }
  });

  it("keeps the image scrim formula untouched and feeds the backing only in background mode", () => {
    assert.match(client, /Math\.max\(0, 0\.18 \* \(1 - displayPrefs\.portraitBackgroundOpacity\)\)/);
    assert.match(client, /assetPresentation === "background"\s*\?\s*mobilePortraitCaptionAlpha\(displayPrefs\.portraitBackgroundOpacity\)/);
    assert.match(client, /"chat-caption-backing min-w-0"/);
  });

  it("applies the backing on phones only and never to the 576+ layout", () => {
    const at = css.indexOf("@media (max-width: 575px) {\n  html.chat-room-active .chat-caption-backing");
    assert.ok(at >= 0);
    assert.match(css.slice(at, at + 400), /rgb\(18 18 18 \/ var\(--chat-caption-alpha, 0\)\)/);
  });
});

describe("E4-3E chat room — cinematic dialogue link (candidate B)", () => {
  it("links the dialogue bar to the character hue without touching the user's dialogue color", () => {
    assert.match(client, /\["--chat-scene-accent" as string\]: characterHueAccent\(character\.hue\)\.keyline/);
    assert.match(css, /html\.chat-room-active \.chat-novel-prose p:has\(> \.chat-dialogue-accent\)::before \{\s*background: var\(--chat-scene-accent/);
    assert.doesNotMatch(css, /--chat-scene-accent[^;]*dialogueColor/);
  });

  it("keeps the dialogue tint scoped to the chat room and very light", () => {
    const m = css.match(/color-mix\(in srgb, var\(--chat-scene-accent, #8b5cf6\) (\d+)%, transparent\)/);
    assert.ok(m);
    assert.ok(Number(m![1]) <= 12);
  });

  it("indents the user card so the two speakers read as separate lanes", () => {
    assert.match(client, /data-chat-user-message="true"\s+className="ml-4 [^"]*min-\[576px\]:ml-8"/);
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

  it("gives primary actions a 40px touch target on mobile only", () => {
    assert.equal((dock.match(/min-h-10 /g) ?? []).length, 2);
    assert.equal((dock.match(/min-\[576px\]:min-h-0/g) ?? []).length, 2);
  });

  it("keeps the estimate note once, linked to the model picker, and never drops the price label", () => {
    assert.equal((client.match(/id="picker-estimate-note"/g) ?? []).length, 1);
    assert.match(dock, /aria-describedby="picker-estimate-note"/);
    assert.match(dock, /selectedAIOptionLabel\(/);
    assert.match(dock, /\{PICKER_ESTIMATE_VARIANCE_NOTE\}/);
  });

  it("keeps the model picker and adult switch in one row so a long estimate label cannot overlap them", () => {
    const labelOpen = dock.indexOf("<label");
    const labelClose = dock.indexOf("</label>");
    assert.ok(labelOpen >= 0 && labelClose > labelOpen);
    const label = dock.slice(labelOpen, labelClose);
    assert.doesNotMatch(label, /ChatRoomAdultModeToggle|추천 메시지/);
    assert.match(label, /min-w-0 max-w-full flex-1/);
    assert.ok(dock.indexOf("<ChatRoomAdultModeToggle") > labelClose);
  });

  it("moves the suggested-replies switch next to the note and counter without changing its wiring", () => {
    const sw = dock.indexOf('aria-label="추천 메시지"');
    assert.ok(sw > dock.indexOf("</label>"));
    assert.equal((dock.match(/aria-label="추천 메시지"/g) ?? []).length, 1);
    assert.match(dock, /onClick=\{handleSuggestedRepliesToggle\}/);
    assert.match(dock, /aria-checked=\{displayPrefs\.showSuggestedReplies\}/);
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
