import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  resolveCurrentTurnUserAuthoringDelegation,
} from "@/lib/currentTurnUserAuthoringDelegation";
import {
  TURN_ONLY_EXPIRY_RESET,
  wrapCurrentUserInput,
} from "@/lib/currentUserInputLabel";
import {
  buildNoGodmoddingBlock,
  COLLABORATIVE_INTERACTIVE_OWNER_TITLE,
} from "@/lib/noGodmodding";
import { resolveEffectiveUserAuthoring } from "@/lib/userCoauthorState";

const OLD_H44_TRANSITION =
  "Earlier assistant-authored [B] content is scene history only; when authoring permission is off, natural completion applies only to [B] actions explicitly started by the user in the current input.";
const H4_TURN_B =
  "OOC: 이번 턴만 유저 페르소나 말투로 내 대사를 써주고,\n내가 그녀를 끌어안으며 키스하는 장면과 이어서 행동도 진행해.\n캐릭터의 반응도 서술해줘.";
const H4_TURN_C = "*잠시 숨을 고르고 얼굴을 바라본다.* 괜찮아? 너무 빨랐으면 말해.";
const STARTED_WALK = "*손을 잡고 문 쪽으로 걷기 시작한다.* 같이 가자.";
const WRAP_MANUAL_SHA =
  "1f3e645d965bcefb7cf47bd1ec2774e97408e990c6c4cd952572d509ac83369f";

function sha(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function countNeedle(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("H4.5 S1–S8 turn-only expiry reset", () => {
  it("S1 — persistent FULL next ordinary turn stays FULL with no expiry reset", () => {
    const next = resolveEffectiveUserAuthoring({
      persistentMode: "FULL",
      currentUserInput: H4_TURN_C,
      previousUserInput: "OOC: 내 대사랑 행동도 알아서 써줘.",
    });
    assert.equal(next.currentMode, "FULL");
    assert.equal(next.persistentAfter, "FULL");
    assert.equal(next.transitionReason, "none");
    assert.equal(next.postDelegationBoundary, false);
    const wrapped = wrapCurrentUserInput(H4_TURN_C, {
      mode: "current_turn_ooc_delegated",
      coauthorDuration: "persistent",
    });
    assert.equal(wrapped.includes(TURN_ONLY_EXPIRY_RESET), false);
    assert.equal(wrapped.includes(OLD_H44_TRANSITION), false);
  });

  it("S2 — turn-only FULL then next ordinary is OFF with expiry reset once", () => {
    const grant = resolveEffectiveUserAuthoring({
      persistentMode: "OFF",
      currentUserInput: H4_TURN_B,
    });
    assert.equal(grant.currentMode, "FULL");
    assert.equal(grant.persistentAfter, "OFF");
    assert.equal(grant.directive.duration, "turn");
    assert.equal(grant.postDelegationBoundary, false);

    const next = resolveEffectiveUserAuthoring({
      persistentMode: grant.persistentAfter,
      currentUserInput: H4_TURN_C,
      previousUserInput: H4_TURN_B,
    });
    assert.equal(next.currentMode, "OFF");
    assert.equal(next.persistentAfter, "OFF");
    assert.equal(next.transitionReason, "turn_only_expiry");
    assert.equal(next.postDelegationBoundary, true);

    const wrapped = wrapCurrentUserInput(H4_TURN_C, {
      mode: "interactive",
      postDelegationBoundary: true,
    });
    assert.equal(countNeedle(wrapped, TURN_ONLY_EXPIRY_RESET), 1);
    assert.equal(wrapped.includes(OLD_H44_TRANSITION), false);
  });

  it("S3 — ordinary turn after the expiry transition has no reset sentence", () => {
    const afterExpiry = resolveEffectiveUserAuthoring({
      persistentMode: "OFF",
      currentUserInput: "응. 천천히 해도 돼.",
      previousUserInput: H4_TURN_C,
    });
    assert.equal(afterExpiry.currentMode, "OFF");
    assert.equal(afterExpiry.persistentAfter, "OFF");
    assert.equal(afterExpiry.transitionReason, "none");
    assert.equal(afterExpiry.postDelegationBoundary, false);

    const wrapped = wrapCurrentUserInput("응. 천천히 해도 돼.", {
      mode: "interactive",
      postDelegationBoundary: false,
    });
    assert.equal(wrapped.includes(TURN_ONLY_EXPIRY_RESET), false);
    assert.equal(sha(wrapCurrentUserInput("안녕.", { mode: "interactive" })), WRAP_MANUAL_SHA);
  });

  it("S4 — explicit persistent revoke stays OFF without expiry reset", () => {
    const applied = resolveEffectiveUserAuthoring({
      persistentMode: "FULL",
      currentUserInput: "OOC: 이제 내 대사나 행동은 쓰지 마.\n" + H4_TURN_C,
    });
    assert.equal(applied.currentMode, "OFF");
    assert.equal(applied.persistentAfter, "OFF");
    assert.equal(applied.transitionReason, "revoke");
    assert.equal(applied.postDelegationBoundary, false);
    const wrapped = wrapCurrentUserInput(
      "OOC: 이제 내 대사나 행동은 쓰지 마.\n" + H4_TURN_C,
      { mode: "interactive", postDelegationBoundary: false }
    );
    assert.equal(wrapped.includes(TURN_ONLY_EXPIRY_RESET), false);
  });

  it("S5 — ordinary STANDARD chat with no coauthor history has no extra transition", () => {
    const applied = resolveEffectiveUserAuthoring({
      persistentMode: "OFF",
      currentUserInput: "안녕.",
    });
    assert.equal(applied.currentMode, "OFF");
    assert.equal(applied.transitionReason, "none");
    assert.equal(applied.postDelegationBoundary, false);
    const wrapped = wrapCurrentUserInput("안녕.", { mode: "interactive" });
    assert.equal(sha(wrapped), WRAP_MANUAL_SHA);
    assert.equal(wrapped.includes(TURN_ONLY_EXPIRY_RESET), false);
    assert.equal(wrapped.includes(OLD_H44_TRANSITION), false);
  });

  it("S6 — current-user-started action still allows natural completion while OFF", () => {
    const ordinary = wrapCurrentUserInput(STARTED_WALK, { mode: "interactive" });
    const expiry = wrapCurrentUserInput(STARTED_WALK, {
      mode: "interactive",
      postDelegationBoundary: true,
    });
    assert.match(ordinary, /natural completion of an already-started action/);
    assert.match(expiry, /natural completion of an already-started action/);
    assert.match(ordinary, /손을 잡고 문 쪽으로 걷기 시작한다/);
    assert.equal(countNeedle(expiry, TURN_ONLY_EXPIRY_RESET), 1);
  });

  it("S7 — [A] character initiative remains allowed on STANDARD", () => {
    const owner = buildNoGodmoddingBlock("A", "B", "standard");
    assert.match(
      owner,
      new RegExp(COLLABORATIVE_INTERACTIVE_OWNER_TITLE.replace(/[[\]]/g, "\\$&"))
    );
    assert.match(owner, /능동적으로 수행한다/);
    assert.doesNotMatch(owner, /CURRENT-TURN OOC DELEGATION/);
    assert.equal(owner.includes(TURN_ONLY_EXPIRY_RESET), false);
  });

  it("S8 — current-turn delegation parser and wrappers stay unchanged", () => {
    const grant = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: H4_TURN_B,
    });
    assert.equal(grant.active, true);
    assert.equal(grant.allowDialogue, true);
    assert.equal(grant.allowMajorActions, true);
    const ordinary = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: H4_TURN_C,
    });
    assert.equal(ordinary.active, false);
    const wrapped = wrapCurrentUserInput(H4_TURN_B, {
      mode: "current_turn_ooc_delegated",
      coauthorDuration: "turn",
    });
    assert.match(wrapped, /This delegation applies to THIS TURN only/);
    assert.equal(wrapped.includes(TURN_ONLY_EXPIRY_RESET), false);
  });
});
