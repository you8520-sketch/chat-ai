import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSceneContinuityPacket,
  reconcileHandoffContinuityWithCurrentUser,
} from "@/lib/adultSceneRouting";

describe("H1 handoff contact-direction reconciliation", () => {
  it("C1 — current user change outranks prior A-holds-B", () => {
    const reconciled = reconcileHandoffContinuityWithCurrentUser({
      text: "라이크가 렌의 허리를 감싸 안았다.",
      characterName: "라이크",
      personaName: "렌",
      currentUserText: "나는 그의 손을 밀어내고 태형의 손목을 잡는다.",
    });
    assert.equal(reconciled.previousActionActor, "렌");
    assert.equal(reconciled.previousActionTarget, "라이크");
    assert.match(reconciled.contactDirection ?? "", /렌 → 라이크/);
  });

  it("C2 — explicit current-user contact is retained when structured", () => {
    const reconciled = reconcileHandoffContinuityWithCurrentUser({
      text: "호텔 거실 조명이 낮았다.",
      characterName: "라이크",
      personaName: "렌",
      currentUserText: "내 허리를 감싼 손길을 느끼며 더 가까이 간다.",
    });
    assert.equal(reconciled.previousActionTarget, "렌");
    assert.ok(reconciled.previousActionActor);
    assert.match(reconciled.contactDirection ?? "", /→ 렌 contact/);
    const packet = buildSceneContinuityPacket({
      previousSceneMode: "normal",
      ...reconciled,
    });
    assert.equal(packet.previousActionTarget, "렌");
    assert.ok(packet.contactDirection);
  });

  it("C3 — no reliable direction omits the derived field", () => {
    const reconciled = reconcileHandoffContinuityWithCurrentUser({
      text: "태형은 주머니에 손을 넣은 채 형광등을 올려다보았다.",
      characterName: "라이크",
      personaName: "렌",
      currentUserText: "같이 갈래?",
    });
    assert.equal(reconciled.contactDirection, undefined);
    assert.equal(reconciled.previousActionActor, undefined);
    assert.equal(reconciled.previousActionTarget, undefined);
  });

  it("C3b — conflicting current-user action without a parseable new direction omits prior hold", () => {
    const reconciled = reconcileHandoffContinuityWithCurrentUser({
      text: "라이크가 렌의 허리를 감싸 안았다.",
      characterName: "라이크",
      personaName: "렌",
      currentUserText: "그의 손을 밀어내고 한 발 물러선다.",
    });
    // First-person 그의 손 밀어내 is a structured 렌 → 라이크 change.
    // A vaguer conflict with no body-target should omit:
    const vague = reconcileHandoffContinuityWithCurrentUser({
      text: "라이크가 렌의 허리를 감싸 안았다.",
      characterName: "라이크",
      personaName: "렌",
      currentUserText: "거리를 두고 숨을 고른다.",
    });
    assert.equal(vague.contactDirection, undefined);
    assert.ok(reconciled.contactDirection === undefined || reconciled.previousActionActor === "렌");
  });

  it("C4 — scene reset still drops old physical continuity", () => {
    const extracted = reconcileHandoffContinuityWithCurrentUser({
      text: "라이크가 렌의 허리를 감싸 안았다.",
      characterName: "라이크",
      personaName: "렌",
      currentUserText: "OOC: 기존 RP 종료. 새로운 에피소드 시작.",
    });
    const packet = buildSceneContinuityPacket({
      previousSceneMode: "explicit",
      sceneReset: true,
      ...extracted,
    });
    assert.equal(packet.sceneReset, true);
    assert.equal(packet.previousActionActor, undefined);
    assert.equal(packet.contactDirection, undefined);
    assert.equal(packet.location, undefined);
  });

  it("prior assistant contact never overwrites an explicit current-user direction", () => {
    const reconciled = reconcileHandoffContinuityWithCurrentUser({
      text: "라이크가 렌의 허리를 감싸 안았다.",
      characterName: "라이크",
      personaName: "렌",
      currentUserText: "렌이 라이크의 손목을 잡는다.",
    });
    assert.equal(reconciled.previousActionActor, "렌");
    assert.equal(reconciled.previousActionTarget, "라이크");
  });
});
