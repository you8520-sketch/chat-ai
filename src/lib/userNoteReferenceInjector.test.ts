import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildReferenceUserNotePromptBlock,
  selectReferenceUserNoteForInjection,
  splitReferenceUserNoteChunks,
  USER_NOTE_REFERENCE_INJECT_MAX_CHARS,
} from "./userNoteReferenceInjector";

describe("userNoteReferenceInjector", () => {
  it("splits reference zone by paragraphs", () => {
    const chunks = splitReferenceUserNoteChunks("NPC A\n\nNPC B\n\nNPC C");
    assert.equal(chunks.length, 3);
  });

  it("does not inject when no keyword match", () => {
    const reference = "엘라라는 마법사다.\n\n드래곤은 산에 산다.";
    const injected = selectReferenceUserNoteForInjection({
      reference,
      userMessage: "오늘 날씨 좋다",
    });
    assert.equal(injected, "");
    assert.equal(buildReferenceUserNotePromptBlock(injected), "");
  });

  it("injects only matching chunks, not full reference", () => {
    const reference = [
      "엘라라는 마법사다. 불 마법을 쓴다.",
      "드래곤은 북쪽 산에 산다.",
      "reference tail for creator",
    ].join("\n\n");
    const injected = selectReferenceUserNoteForInjection({
      reference,
      userMessage: "엘라라에게 인사해",
    });
    assert.match(injected, /엘라라/);
    assert.doesNotMatch(injected, /드래곤/);
    assert.notEqual(injected.length, reference.length);
  });

  it("respects per-turn inject char cap", () => {
    const big = "키워드 ".repeat(400).trim();
    const reference = `${big}\n\n${big}\n\n${big}`;
    const injected = selectReferenceUserNoteForInjection({
      reference,
      userMessage: "키워드",
      maxInjectChars: 500,
    });
    assert.ok(injected.length <= 500);
    assert.ok(injected.length < reference.length);
  });

  it("builds prompt block with RAG header", () => {
    const block = buildReferenceUserNotePromptBlock("엘라라 설정");
    assert.match(block, /키워드 매칭/);
    assert.match(block, /엘라라 설정/);
  });

  it("defaults max inject below full reference storage", () => {
    assert.ok(USER_NOTE_REFERENCE_INJECT_MAX_CHARS < 9_000);
  });
});
