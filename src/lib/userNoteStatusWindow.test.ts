import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  mergeUserNoteBodyFromEditor,
  readStoredFocus,
  resolveEffectiveFocusForPrompt,
  splitUserNoteBodyForEditor,
  splitUserNotePromptZones,
  USER_NOTE_ZONE_SEPARATOR,
  validateFocusInput,
} from "./userNoteStatusWindow";
import { USER_NOTE_FOCUS_MAX } from "./persona";

describe("userNoteStatusWindow focus-only", () => {
  it("stores focus only — reference input is ignored", () => {
    const stored = mergeUserNoteBodyFromEditor("고집중 규칙", "NPC 엘라라는 마법사다.");
    assert.ok(!stored.includes(USER_NOTE_ZONE_SEPARATOR));
    assert.equal(stored, "고집중 규칙");

    const { focusBody } = splitUserNoteBodyForEditor(stored);
    assert.equal(focusBody, "고집중 규칙");
  });

  it("readStoredFocus returns full stored text without tier truncation", () => {
    const stored = "x".repeat(1800);
    assert.equal(readStoredFocus(stored).length, 1800);
    assert.equal(resolveEffectiveFocusForPrompt(stored, 1000).length, 1000);
  });

  it("validateFocusInput rejects raw length before slicing", () => {
    const raw1500 = "a".repeat(1500);
    const freeCheck = validateFocusInput(raw1500, 1000);
    assert.equal(freeCheck.ok, false);
    assert.equal(readStoredFocus(raw1500).length, 1500);
  });

  it("FREE validation matrix", () => {
    assert.equal(validateFocusInput("x".repeat(999), 1000).ok, true);
    assert.equal(validateFocusInput("x".repeat(1000), 1000).ok, true);
    assert.equal(validateFocusInput("x".repeat(1001), 1000).ok, false);
  });

  it("SUBSCRIBED validation matrix", () => {
    assert.equal(validateFocusInput("x".repeat(1999), 2000).ok, true);
    assert.equal(validateFocusInput("x".repeat(2000), 2000).ok, true);
    assert.equal(validateFocusInput("x".repeat(2001), 2000).ok, false);
  });

  it("editor read does not truncate stored overflow on downgrade", () => {
    const stored = "f".repeat(1800);
    const { focusBody, focusBodyMax, overCurrentPlanLimit, storedFocusChars } =
      splitUserNoteBodyForEditor(stored, 0, 1000);
    assert.equal(focusBody.length, 1800);
    assert.equal(storedFocusChars, 1800);
    assert.equal(focusBodyMax, 1000);
    assert.equal(overCurrentPlanLimit, true);
  });

  it("legacy separator strips reference suffix only", () => {
    const legacy = `focus part${USER_NOTE_ZONE_SEPARATOR}reference tail`;
    assert.equal(readStoredFocus(legacy), "focus part");
  });

  it("prompt zones use effective projection only", () => {
    const stored = "a".repeat(1800);
    const { mandatory } = splitUserNotePromptZones(stored, 0, 1000);
    assert.equal(mandatory.length, 1000);
    assert.equal(readStoredFocus(stored).length, 1800);
  });

  it("legacy undelimited note keeps full stored body after cleanup semantics", () => {
    const legacy = "f".repeat(USER_NOTE_FOCUS_MAX) + "legacy reference tail";
    assert.equal(readStoredFocus(legacy).length, legacy.length);
    const { mandatory } = splitUserNotePromptZones(legacy, 0, USER_NOTE_FOCUS_MAX);
    assert.equal(mandatory.length, USER_NOTE_FOCUS_MAX);
  });
});
