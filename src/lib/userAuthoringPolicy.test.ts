import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  capabilitiesFromUserAuthoringLevel,
  parseUserAuthoringLevel,
} from "@/lib/userAuthoringPolicy";
import {
  resolveEffectiveUserAuthoring,
} from "@/lib/userCoauthorState";

describe("three-level user authoring policy", () => {
  it("normalizes unknown/legacy values to LIMITED", () => {
    assert.equal(parseUserAuthoringLevel(undefined), "LIMITED");
    assert.equal(parseUserAuthoringLevel("unknown"), "LIMITED");
    assert.equal(parseUserAuthoringLevel("normal"), "NORMAL");
    assert.equal(parseUserAuthoringLevel("allow"), "ALLOW");
  });

  it("LIMITED keeps B dialogue/actions/inner POV/fate user-owned", () => {
    assert.deepEqual(capabilitiesFromUserAuthoringLevel("LIMITED"), {
      allowDialogue: false,
      allowMajorActions: false,
      allowInnerPov: false,
      allowIrreversibleFate: false,
    });
  });

  it("NORMAL allows dialogue/actions but not private inner POV or irreversible fate", () => {
    assert.deepEqual(capabilitiesFromUserAuthoringLevel("NORMAL"), {
      allowDialogue: true,
      allowMajorActions: true,
      allowInnerPov: false,
      allowIrreversibleFate: false,
    });
  });

  it("ALLOW adds inner POV but still protects irreversible B fate", () => {
    assert.deepEqual(capabilitiesFromUserAuthoringLevel("ALLOW"), {
      allowDialogue: true,
      allowMajorActions: true,
      allowInnerPov: true,
      allowIrreversibleFate: false,
    });
  });

  it("chat-setting base becomes the effective delegation without fabricating an OOC source", () => {
    const normal = resolveEffectiveUserAuthoring({
      persistentMode: "OFF",
      baseLevel: "NORMAL",
      currentUserInput: "그를 바라본다.",
    });
    assert.equal(normal.persistentAfter, "OFF");
    assert.equal(normal.delegation.source, "chat_setting");
    assert.equal(normal.delegation.allowDialogue, true);
    assert.equal(normal.delegation.allowMajorActions, true);
    assert.equal(normal.delegation.allowInnerPov, false);
    assert.equal(normal.delegation.allowIrreversibleFate, false);

    const allow = resolveEffectiveUserAuthoring({
      persistentMode: "OFF",
      baseLevel: "ALLOW",
      currentUserInput: "그를 바라본다.",
    });
    assert.equal(allow.persistentAfter, "OFF");
    assert.equal(allow.delegation.source, "chat_setting");
    assert.equal(allow.delegation.allowInnerPov, true);
    assert.equal(allow.delegation.allowIrreversibleFate, false);
  });

  it("ALLOW + explicit 완전히 자유 opens irreversible fate as an OOC override", () => {
    const applied = resolveEffectiveUserAuthoring({
      persistentMode: "OFF",
      baseLevel: "ALLOW",
      currentUserInput: "OOC: 내 캐릭터 서술 완전히 자유. 생사 포함해서 전권 맡길게.",
    });
    assert.equal(applied.currentMode, "ABSOLUTE");
    assert.equal(applied.persistentAfter, "ABSOLUTE");
    assert.equal(applied.delegation.source, "explicit_ooc");
    assert.equal(applied.delegation.allowDialogue, true);
    assert.equal(applied.delegation.allowMajorActions, true);
    assert.equal(applied.delegation.allowInnerPov, true);
    assert.equal(applied.delegation.allowIrreversibleFate, true);
  });

  it("완전히 자유 alone is enough to mean full narrative authority", () => {
    const applied = resolveEffectiveUserAuthoring({
      persistentMode: "OFF",
      baseLevel: "LIMITED",
      currentUserInput: "OOC: 유저 캐릭터 서술 완전히 자유.",
    });
    assert.equal(applied.currentMode, "ABSOLUTE");
    assert.equal(applied.delegation.allowDialogue, true);
    assert.equal(applied.delegation.allowMajorActions, true);
    assert.equal(applied.delegation.allowInnerPov, true);
    assert.equal(applied.delegation.allowIrreversibleFate, true);
  });

  it("ALLOW + explicit revoke can narrow the room below the base level", () => {
    const applied = resolveEffectiveUserAuthoring({
      persistentMode: "OFF",
      baseLevel: "ALLOW",
      currentUserInput: "OOC: 이제 내 대사나 행동은 쓰지 마.",
    });
    assert.equal(applied.currentMode, "LIMITED");
    assert.equal(applied.persistentAfter, "LIMITED");
    assert.equal(applied.delegation.active, false);
  });

  it("turn-only absolute grant does not persist", () => {
    const applied = resolveEffectiveUserAuthoring({
      persistentMode: "OFF",
      baseLevel: "ALLOW",
      currentUserInput: "OOC: 이번 턴만 내 캐릭터 서술 완전히 자유. 생사 포함.",
    });
    assert.equal(applied.currentMode, "ABSOLUTE");
    assert.equal(applied.persistentAfter, "OFF");
    assert.equal(applied.delegation.duration, "turn");
    assert.equal(applied.delegation.allowIrreversibleFate, true);
  });
});
