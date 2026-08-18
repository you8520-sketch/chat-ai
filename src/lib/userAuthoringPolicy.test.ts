import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveUserAuthoringPolicy } from "@/lib/userAuthoringPolicy";
import { resolveUserImpersonationAllowance } from "@/lib/userImpersonationPolicy";

describe("resolveUserAuthoringPolicy", () => {
  it("TEST A — ordinary manual → standard owner", () => {
    const policy = resolveUserAuthoringPolicy({ currentUserInput: "안녕." });
    assert.equal(policy.mode, "manual");
    assert.equal(policy.ownerMode, "standard");
    assert.equal(policy.allowUserDialogue, false);
    assert.equal(policy.allowUserMajorActions, false);
    assert.equal(policy.source, "manual_default");
  });

  it("TEST B — manual + dialogue delegation", () => {
    const policy = resolveUserAuthoringPolicy({
      currentUserInput: "OOC: 내 대사도 페르소나에 맞춰서 써줘.\n*그를 바라본다.*",
    });
    assert.equal(policy.mode, "delegated");
    assert.equal(policy.ownerMode, "currentTurnDelegated");
    assert.equal(policy.allowUserDialogue, true);
    assert.equal(policy.allowUserMajorActions, false);
    assert.equal(policy.source, "current_turn_ooc");
  });

  it("TEST C — manual + action delegation", () => {
    const policy = resolveUserAuthoringPolicy({
      currentUserInput: "OOC: 내 행동도 알아서 진행해.",
    });
    assert.equal(policy.allowUserDialogue, false);
    assert.equal(policy.allowUserMajorActions, true);
    assert.equal(policy.mode, "delegated");
  });

  it("TEST D — full current-turn delegation", () => {
    const policy = resolveUserAuthoringPolicy({
      currentUserInput:
        "OOC: 유저대사를 유저페르소나 성격에 맞춰서\n자동서술하며 턴을 진행한다.",
    });
    assert.equal(policy.allowUserDialogue, true);
    assert.equal(policy.allowUserMajorActions, true);
    assert.equal(policy.mode, "delegated");
  });

  it("TEST E — in-character false positive stays manual", () => {
    const policy = resolveUserAuthoringPolicy({
      currentUserInput: '"네가 알아서 해."',
    });
    assert.equal(policy.mode, "manual");
    assert.equal(policy.currentTurnDelegation.active, false);
    assert.equal(policy.ownerMode, "standard");
  });

  it("TEST F — OOC without delegation stays manual", () => {
    const policy = resolveUserAuthoringPolicy({
      currentUserInput: "OOC: 지금 장면은 낮이야.",
    });
    assert.equal(policy.mode, "manual");
    assert.equal(policy.currentTurnDelegation.active, false);
  });

  it("TEST G — Auto Progression keeps autoContinue owner", () => {
    const policy = resolveUserAuthoringPolicy({ isContinue: true });
    assert.equal(policy.mode, "auto_progression");
    assert.equal(policy.ownerMode, "autoContinue");
    assert.equal(policy.source, "auto_progression");
  });

  it("TEST H — no persisted delegation on the next manual turn", () => {
    const turnN = resolveUserAuthoringPolicy({
      currentUserInput: "OOC: 내 대사랑 행동도 알아서 써줘.",
    });
    const turnN1 = resolveUserAuthoringPolicy({
      currentUserInput: "평범한 수동 입력",
    });
    assert.equal(turnN.mode, "delegated");
    assert.equal(turnN1.mode, "manual");
    assert.equal(turnN1.ownerMode, "standard");
  });

  it("TEST I — existing structured opt-in stays coNarration", () => {
    assert.equal(
      resolveUserImpersonationAllowance({ userNote: "(OOC: 유저 사칭 허용)" }),
      true
    );
    const policy = resolveUserAuthoringPolicy({
      userImpersonationAllowed: true,
      currentUserInput: "안녕.",
    });
    assert.equal(policy.mode, "structured");
    assert.equal(policy.ownerMode, "coNarration");
    assert.equal(policy.source, "structured_existing");
  });
});
