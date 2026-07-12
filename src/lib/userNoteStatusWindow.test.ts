import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  mergeUserNoteBodyFromEditor,
  splitUserNoteBodyForEditor,
  splitUserNotePromptZones,
  USER_NOTE_ZONE_SEPARATOR,
} from "./userNoteStatusWindow";
import { USER_NOTE_FOCUS_MAX } from "./persona";

describe("userNoteStatusWindow zone split", () => {
  it("stores focus and extension as separate UI zones via separator", () => {
    const stored = mergeUserNoteBodyFromEditor("고집중 규칙", "NPC 엘라라는 마법사다.");
    assert.ok(stored.includes(USER_NOTE_ZONE_SEPARATOR));

    const { focusBody, referenceBody } = splitUserNoteBodyForEditor(stored);
    assert.equal(focusBody, "고집중 규칙");
    assert.equal(referenceBody, "NPC 엘라라는 마법사다.");
  });

  it("prompt zones: extension is RAG even when focus is under 1000 chars", () => {
    const stored = mergeUserNoteBodyFromEditor(
      "a".repeat(200),
      "확장구간 NPC 설정"
    );
    const { mandatory, reference } = splitUserNotePromptZones(stored);
    assert.equal(mandatory, "a".repeat(200));
    assert.equal(reference, "확장구간 NPC 설정");
  });

  it("prompt zones: focus-only note has no reference", () => {
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

  it("legacy undelimited note over 1000 chars still position-splits", () => {
    const legacy = "f".repeat(USER_NOTE_FOCUS_MAX) + "legacy reference tail";
    const { mandatory, reference } = splitUserNotePromptZones(legacy);
    assert.equal(mandatory, "f".repeat(USER_NOTE_FOCUS_MAX));
    assert.equal(reference, "legacy reference tail");
  });
});
