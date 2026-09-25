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
    assert.equal(normal.delegation.allowAiCastIrreversibleExpansion, false);

    const allow = resolveEffectiveUserAuthoring({
      persistentMode: "OFF",
      baseLevel: "ALLOW",
      currentUserInput: "그를 바라본다.",
    });
    assert.equal(allow.persistentAfter, "OFF");
    assert.equal(allow.delegation.source, "chat_setting");
    assert.equal(allow.delegation.allowInnerPov, true);
    assert.equal(allow.delegation.allowIrreversibleFate, false);
    assert.equal(allow.delegation.allowAiCastIrreversibleExpansion, true);
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
    assert.equal(applied.delegation.allowAiCastIrreversibleExpansion, true);
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

  it("bare user-character 전권 is an explicit full-authority grant", () => {
    const applied = resolveEffectiveUserAuthoring({
      persistentMode: "OFF",
      baseLevel: "LIMITED",
      currentUserInput: "OOC: 내 캐릭터 전권.",
    });
    assert.equal(applied.currentMode, "ABSOLUTE");
    assert.equal(applied.delegation.allowIrreversibleFate, true);
  });

  it("negative full-authority wording never opens irreversible fate", () => {
    for (const currentUserInput of [
      "OOC: 내 캐릭터 전권은 주지 마.",
      "OOC: 내 캐릭터 죽음까지 허용하지 마.",
      "OOC: 내 캐릭터 생사 포함하지 마.",
      "OOC: 내 캐릭터 완전히 자유롭게 하지 마.",
    ]) {
      const applied = resolveEffectiveUserAuthoring({
        persistentMode: "OFF",
        baseLevel: "ALLOW",
        currentUserInput,
      });
      assert.equal(applied.delegation.allowIrreversibleFate, false, currentUserInput);
      assert.notEqual(applied.currentMode, "ABSOLUTE", currentUserInput);
    }
  });

  it("user-retained 전권 does not grant coauthor authority", () => {
    const applied = resolveEffectiveUserAuthoring({
      persistentMode: "OFF",
      baseLevel: "ALLOW",
      currentUserInput: "OOC: 내 캐릭터 전권은 내가 가질게.",
    });
    assert.equal(applied.currentMode, "OFF");
    assert.equal(applied.persistentAfter, "LIMITED");
    assert.equal(applied.delegation.active, false);
    assert.equal(applied.delegation.allowIrreversibleFate, false);
  });

  it("generic auto-progress OOC does not become a user-character FULL grant", () => {
    const applied = resolveEffectiveUserAuthoring({
      persistentMode: "OFF",
      baseLevel: "LIMITED",
      currentUserInput: "OOC: 다음 턴은 자동 서술하며 진행해.",
    });
    assert.equal(applied.currentMode, "OFF");
    assert.equal(applied.persistentAfter, "OFF");
    assert.equal(applied.delegation.active, false);
  });

  it("NPC 전권 instruction does not accidentally grant user-character fate authority", () => {
    const applied = resolveEffectiveUserAuthoring({
      persistentMode: "OFF",
      baseLevel: "LIMITED",
      currentUserInput: "OOC: NPC 전개는 전권 맡길게. 알아서 진행해.",
    });
    assert.equal(applied.currentMode, "OFF");
    assert.equal(applied.persistentAfter, "OFF");
    assert.equal(applied.delegation.active, false);
  });

  it("mentioning the user's thoughts without an authoring request does not open inner POV", () => {
    const applied = resolveEffectiveUserAuthoring({
      persistentMode: "OFF",
      baseLevel: "LIMITED",
      currentUserInput: "OOC: 내 생각은 아직 캐릭터가 모르는 설정이야.",
    });
    assert.equal(applied.currentMode, "OFF");
    assert.equal(applied.persistentAfter, "OFF");
    assert.equal(applied.delegation.active, false);
  });

  it("ALLOW + explicit revoke can narrow B below the base level without disabling AI-cast freedom", () => {
    const applied = resolveEffectiveUserAuthoring({
      persistentMode: "OFF",
      baseLevel: "ALLOW",
      currentUserInput: "OOC: 이제 내 대사나 행동은 쓰지 마.",
    });
    assert.equal(applied.currentMode, "OFF");
    assert.equal(applied.persistentAfter, "LIMITED");
    assert.equal(applied.delegation.active, false);
    assert.equal(applied.delegation.allowAiCastIrreversibleExpansion, true);
  });

  it("LIMITED + inner-POV OOC does not grant AI-cast irreversible expansion", () => {
    const applied = resolveEffectiveUserAuthoring({
      persistentMode: "OFF",
      baseLevel: "LIMITED",
      currentUserInput: "OOC: 내 캐릭터 속마음과 내면까지 소설처럼 써줘.",
    });
    assert.equal(applied.currentMode, "NOVEL");
    assert.equal(applied.delegation.allowInnerPov, true);
    assert.equal(applied.delegation.allowIrreversibleFate, false);
    assert.equal(applied.delegation.allowAiCastIrreversibleExpansion, false);
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
