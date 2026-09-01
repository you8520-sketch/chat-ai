import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COLLABORATIVE_HISTORY_PRECEDENT_BOUNDARY,
  CURRENT_USER_INPUT_HEADER,
  INTERACTIVE_OWNERSHIP_LOCK_MARKER,
  buildCurrentUserInputWrapper,
  wrapCurrentUserInput,
} from "@/lib/currentUserInputLabel";
import { resolveCurrentTurnUserAuthoringDelegation } from "@/lib/currentTurnUserAuthoringDelegation";
import {
  buildCompactNoGodmoddingStandardBlock,
  COLLABORATIVE_INTERACTIVE_OWNER_TITLE,
} from "@/lib/noGodmodding";

const STARTED_WALK = "*손을 잡고 문 쪽으로 걷기 시작한다.* 같이 가자.";
const SIMPLE_HUG = "*그녀를 끌어안는다.*";
const OOC_BOTH = "OOC: 이번 턴은 내 대사와 행동도 알아서 진행해.";
const ORDINARY_IC = "*잠시 숨을 고르고 얼굴을 바라본다.* 괜찮아? 너무 빨랐으면 말해.";

describe("H4.3 narrow history-precedent boundary", () => {
  it("A. PAST ASSISTANT PRECEDENT — ordinary IC wrapper contains the boundary", () => {
    const w = buildCurrentUserInputWrapper({ mode: "interactive", ownershipLockEnabled: false });
    assert.ok(w.startsWith(CURRENT_USER_INPUT_HEADER));
    assert.ok(w.includes(COLLABORATIVE_HISTORY_PRECEDENT_BOUNDARY));
    assert.match(w, /earlier delegated or co-authored turn/);
    assert.match(w, /established scene history only/);
    assert.match(w, /not permission or precedent/);
    assert.ok(!w.includes(INTERACTIVE_OWNERSHIP_LOCK_MARKER));
    assert.doesNotMatch(w, /Do NOT write any NEW \[B\] dialogue, intentional action/);
  });

  it("B. CURRENT USER STARTED ACTION — natural-completion allowance remains", () => {
    const wrapped = wrapCurrentUserInput(STARTED_WALK, {
      mode: "interactive",
      ownershipLockEnabled: false,
    });
    assert.match(wrapped, /natural completion of an already-started action/);
    assert.ok(wrapped.includes(STARTED_WALK));
    assert.ok(wrapped.includes(COLLABORATIVE_HISTORY_PRECEDENT_BOUNDARY));
    assert.match(wrapped, /Past assistant-authored/);
    assert.doesNotMatch(wrapped, /already-started action[\s\S]*are NOT permission/);
  });

  it("C. CURRENT-TURN DELEGATION — both grants; no standard ownership restriction", () => {
    const d = resolveCurrentTurnUserAuthoringDelegation({ currentUserInput: OOC_BOTH });
    assert.equal(d.active, true);
    assert.equal(d.allowDialogue, true);
    assert.equal(d.allowMajorActions, true);
    const w = buildCurrentUserInputWrapper({
      mode: "current_turn_ooc_delegated",
      ownershipLockEnabled: false,
    });
    assert.match(w, /CURRENT-TURN OOC DELEGATION/);
    assert.ok(!w.includes(COLLABORATIVE_HISTORY_PRECEDENT_BOUNDARY));
    assert.doesNotMatch(w, /remain user-authored/);
    assert.ok(!w.includes(INTERACTIVE_OWNERSHIP_LOCK_MARKER));
    const wrapped = wrapCurrentUserInput(OOC_BOTH, { mode: "current_turn_ooc_delegated" });
    assert.ok(wrapped.includes(OOC_BOTH));
    assert.ok(!wrapped.includes(COLLABORATIVE_HISTORY_PRECEDENT_BOUNDARY));
  });

  it("D. ORDINARY FIRST-TURN INTERACTION — collaborative behavior unchanged besides the boundary", () => {
    const w = buildCurrentUserInputWrapper({ mode: "interactive" });
    assert.match(w, /completed input and the newest state of the scene/);
    assert.match(w, /Continue from what it changes now/);
    assert.match(w, /remain user-authored/);
    assert.match(w, /Minor reversible expression/);
    assert.match(w, /USER CONTROL — COLLABORATIVE INTERACTIVE/);
    assert.ok(w.includes(COLLABORATIVE_HISTORY_PRECEDENT_BOUNDARY));
    assert.ok(!w.includes(INTERACTIVE_OWNERSHIP_LOCK_MARKER));
    const firstTurn = wrapCurrentUserInput("*문을 닫고 가까이 다가간다.* 오늘 밤은 이렇게 있어줄래.", {
      mode: "interactive",
    });
    assert.match(firstTurn, /문을 닫고 가까이 다가간다/);
    assert.ok(firstTurn.includes(COLLABORATIVE_HISTORY_PRECEDENT_BOUNDARY));
  });

  it("E. CHARACTER INITIATIVE — [A] may act; wrapper is not an absolute freeze", () => {
    const owner = buildCompactNoGodmoddingStandardBlock();
    assert.match(owner, new RegExp(COLLABORATIVE_INTERACTIVE_OWNER_TITLE.replace(/[[\]]/g, "\\$&")));
    assert.match(owner, /능동적으로 수행한다/);
    const w = buildCurrentUserInputWrapper({ mode: "interactive", ownershipLockEnabled: false });
    assert.doesNotMatch(w, /do not stop every turn merely to ask a meta-question/);
    assert.doesNotMatch(w, /Do NOT write any NEW \[B\] dialogue, intentional action, thought/);
    assert.match(w, /Minor reversible expression/);
    assert.ok(w.includes(COLLABORATIVE_HISTORY_PRECEDENT_BOUNDARY));
  });
});

describe("H4.3 regression fixtures", () => {
  it("R1 — STARTED ACTION COMPLETION remains allowed on the standard wrapper", () => {
    const wrapped = wrapCurrentUserInput(STARTED_WALK, { mode: "interactive" });
    assert.match(wrapped, /natural completion of an already-started action/);
    assert.match(wrapped, /small movement\/contact/);
    assert.ok(wrapped.includes(STARTED_WALK));
    assert.ok(!wrapped.includes(INTERACTIVE_OWNERSHIP_LOCK_MARKER));
  });

  it("R2 — SIMPLE CONTACT keeps trivial continuity; no extra consequential grant", () => {
    const wrapped = wrapCurrentUserInput(SIMPLE_HUG, { mode: "interactive" });
    assert.ok(wrapped.includes(SIMPLE_HUG));
    assert.match(wrapped, /small movement\/contact\/object-handling\/daily continuity/);
    assert.ok(wrapped.includes(COLLABORATIVE_HISTORY_PRECEDENT_BOUNDARY));
    assert.match(wrapped, /consequential actions, consent\/refusal, or decisions on this turn/);
  });

  it("R3 — CHARACTER INITIATIVE owner is unchanged", () => {
    const owner = buildCompactNoGodmoddingStandardBlock();
    assert.match(owner, /자신의 성격과 현재 상황에 맞는 대사·행동·접촉·제안/);
    assert.match(owner, /능동적으로 수행한다/);
    const w = buildCurrentUserInputWrapper({ mode: "interactive" });
    assert.doesNotMatch(w, /\[A\] must wait|must remain passive|do not write the character/i);
  });

  it("R4 — CURRENT OOC DELEGATION still grants dialogue and major actions", () => {
    const d = resolveCurrentTurnUserAuthoringDelegation({ currentUserInput: OOC_BOTH });
    assert.equal(d.active, true);
    assert.equal(d.allowDialogue, true);
    assert.equal(d.allowMajorActions, true);
    assert.equal(d.source, "explicit_ooc");
  });

  it("R5 — DELEGATION ENDS NEXT TURN; history boundary is on the restored standard owner", () => {
    const delegated = resolveCurrentTurnUserAuthoringDelegation({ currentUserInput: OOC_BOTH });
    const next = resolveCurrentTurnUserAuthoringDelegation({ currentUserInput: ORDINARY_IC });
    assert.equal(delegated.active, true);
    assert.equal(next.active, false);
    assert.equal(next.allowDialogue, false);
    assert.equal(next.allowMajorActions, false);
    const nextWrapped = wrapCurrentUserInput(ORDINARY_IC, { mode: "interactive" });
    assert.ok(nextWrapped.includes(COLLABORATIVE_HISTORY_PRECEDENT_BOUNDARY));
    assert.match(nextWrapped, /remain user-authored/);
    assert.doesNotMatch(nextWrapped, /CURRENT-TURN OOC DELEGATION/);
    assert.ok(!nextWrapped.includes(INTERACTIVE_OWNERSHIP_LOCK_MARKER));
  });
});
