import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  mergeUserNoteBodyFromEditor,
  splitUserNoteBodyForEditor,
  splitUserNotePromptZones,
  USER_NOTE_ZONE_SEPARATOR,
} from "./userNoteStatusWindow";
import { USER_NOTE_FOCUS_MAX } from "./persona";

describe("userNoteStatusWindow focus-only", () => {
  it("stores focus only — reference input is ignored", () => {
    const stored = mergeUserNoteBodyFromEditor("고집중 규칙", "NPC 엘라라는 마법사다.");
    assert.ok(!stored.includes(USER_NOTE_ZONE_SEPARATOR));
    assert.equal(stored, "고집중 규칙");

    const { focusBody, referenceBody } = splitUserNoteBodyForEditor(stored);
    assert.equal(focusBody, "고집중 규칙");
    assert.equal(referenceBody, "");
  });

  it("prompt zones: focus-only note has no reference", () => {
    const stored = mergeUserNoteBodyFromEditor("a".repeat(200), "확장구간 NPC 설정");
    const { mandatory, reference } = splitUserNotePromptZones(stored);
    assert.equal(mandatory, "a".repeat(200));
    assert.equal(reference, "");
  });

  it("prompt zones: empty reference when focus-only", () => {
    const stored = mergeUserNoteBodyFromEditor("매 턴 주입 규칙", "");
    const { mandatory, reference } = splitUserNotePromptZones(stored);
    assert.equal(mandatory, "매 턴 주입 규칙");
    assert.equal(reference, "");
  });

  it("preserves trailing spaces while editing focus-only notes", () => {
    const stored = mergeUserNoteBodyFromEditor("중요 기억 ", "");
    const { focusBody, referenceBody } = splitUserNoteBodyForEditor(stored);
    assert.equal(focusBody, "중요 기억 ");
    assert.equal(referenceBody, "");
  });

  it("legacy undelimited note over 1000 chars keeps focus cap only", () => {
    const legacy = "f".repeat(USER_NOTE_FOCUS_MAX) + "legacy reference tail";
    const { mandatory, reference } = splitUserNotePromptZones(legacy);
    assert.equal(mandatory, "f".repeat(USER_NOTE_FOCUS_MAX));
    assert.equal(reference, "");
  });

  it("legacy separator in stored note strips reference portion for editor", () => {
    const legacy = `focus part${USER_NOTE_ZONE_SEPARATOR}reference tail`;
    const { focusBody, referenceBody } = splitUserNoteBodyForEditor(legacy);
    assert.equal(focusBody, "focus part");
    assert.equal(referenceBody, "");
  });
});
