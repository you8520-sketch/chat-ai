import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CURRENT_USER_INPUT_HEADER,
  INTERACTIVE_OWNERSHIP_LOCK_MARKER,
  buildCurrentUserInputWrapper,
  wrapCurrentUserInput,
} from "@/lib/currentUserInputLabel";
import { isInteractiveUserOwnershipLockEnabledForUser } from "@/lib/interactiveUserOwnershipLock";

describe("CURRENT USER INPUT — interactive ownership recency lock (admin canary gate)", () => {
  it("A. interactive + gate ON → strict ownership lock injected", () => {
    const w = buildCurrentUserInputWrapper({ mode: "interactive", ownershipLockEnabled: true });
    assert.ok(w.startsWith(CURRENT_USER_INPUT_HEADER));
    assert.ok(w.includes(INTERACTIVE_OWNERSHIP_LOCK_MARKER));
    assert.match(w, /\[B\] is controlled ONLY by the user/);
    assert.match(w, /Past history is NOT permission/);
    assert.match(w, /Do NOT write any NEW \[B\] dialogue/);
    assert.match(w, /NOT precedent or permission; do not imitate that ownership pattern/);
    assert.match(w, /Continue the scene through AI-controlled characters, NPCs/);
  });

  it("A2. interactive + gate OFF → legacy compact behavior, NO lock marker (no global change)", () => {
    const w = buildCurrentUserInputWrapper({ mode: "interactive", ownershipLockEnabled: false });
    assert.ok(w.startsWith(CURRENT_USER_INPUT_HEADER));
    assert.ok(!w.includes(INTERACTIVE_OWNERSHIP_LOCK_MARKER));
    assert.ok(!w.includes("[B] ="));
    // Legacy compact phrases retained.
    assert.match(w, /Do not continue writing the user's future/);
    assert.match(w, /completed user input/);
  });

  it("A3. interactive + no gate opt → defaults to legacy behavior (no lock)", () => {
    const w = buildCurrentUserInputWrapper({ mode: "interactive" });
    assert.ok(!w.includes(INTERACTIVE_OWNERSHIP_LOCK_MARKER));
  });

  it("B. personaName provided + gate ON → named actor included (two distinct names)", () => {
    const w = buildCurrentUserInputWrapper({
      mode: "interactive",
      ownershipLockEnabled: true,
      personaName: "렌",
    });
    assert.match(w, /\[B\] = 렌/);
    const wA = buildCurrentUserInputWrapper({
      mode: "interactive",
      ownershipLockEnabled: true,
      personaName: "PersonaA",
    });
    const wB = buildCurrentUserInputWrapper({
      mode: "interactive",
      ownershipLockEnabled: true,
      personaName: "PersonaB",
    });
    assert.match(wA, /\[B\] = PersonaA/);
    assert.match(wB, /\[B\] = PersonaB/);
    assert.notEqual(wA, wB);
    // No test-character literal hard-coded in the rule body.
    assert.doesNotMatch(wA, /라이크|에녹/);
  });

  it("C. personaName missing/empty + gate ON → generic [B] fallback (not account identity)", () => {
    const wNone = buildCurrentUserInputWrapper({ mode: "interactive", ownershipLockEnabled: true });
    assert.match(wNone, /\[B\] = USER_PERSONA/);
    const wEmpty = buildCurrentUserInputWrapper({
      mode: "interactive",
      ownershipLockEnabled: true,
      personaName: "   ",
    });
    assert.match(wEmpty, /\[B\] = USER_PERSONA/);
  });

  it("D. auto_progression → lock NOT injected regardless of gate", () => {
    const wOff = buildCurrentUserInputWrapper({ mode: "auto_progression", ownershipLockEnabled: false });
    const wOn = buildCurrentUserInputWrapper({ mode: "auto_progression", ownershipLockEnabled: true, personaName: "렌" });
    for (const w of [wOff, wOn]) {
      assert.ok(w.startsWith(CURRENT_USER_INPUT_HEADER));
      assert.ok(!w.includes(INTERACTIVE_OWNERSHIP_LOCK_MARKER));
      assert.ok(!w.includes("[B] ="));
      assert.match(w, /Current mode allows limited\/full user co-narration/);
    }
  });

  it("E. ooc_user_impersonation_allowed → lock NOT injected regardless of gate", () => {
    const w = buildCurrentUserInputWrapper({
      mode: "ooc_user_impersonation_allowed",
      ownershipLockEnabled: true,
      personaName: "렌",
    });
    assert.ok(w.startsWith(CURRENT_USER_INPUT_HEADER));
    assert.ok(!w.includes(INTERACTIVE_OWNERSHIP_LOCK_MARKER));
    assert.ok(!w.includes("[B] ="));
    assert.match(w, /Current mode allows limited\/full user co-narration/);
  });

  it("F. existing CURRENT USER INPUT wrapper idempotency preserved (gate on & off)", () => {
    const body = '고개를 든다\n"안녕"';
    const once = wrapCurrentUserInput(body, { mode: "interactive", ownershipLockEnabled: true });
    assert.equal(wrapCurrentUserInput(once, { mode: "interactive", ownershipLockEnabled: true }), once);
    const onceLegacy = wrapCurrentUserInput(body, { mode: "interactive", ownershipLockEnabled: false });
    assert.equal(wrapCurrentUserInput(onceLegacy, { mode: "interactive", ownershipLockEnabled: false }), onceLegacy);
    // Body appended verbatim.
    assert.match(once, /고개를 든다/);
    // Legacy backward-compat phrases retained when gate off.
    assert.match(onceLegacy, /Do not continue writing the user's future/);
    assert.match(onceLegacy, /completed user input/);
    // Empty input passthrough.
    assert.equal(wrapCurrentUserInput("   ", { mode: "interactive", ownershipLockEnabled: true }), "");
  });

  it("G. wrapper does not touch LENGTH / Terminal / prose markers (gate on & off)", () => {
    const on = buildCurrentUserInputWrapper({
      mode: "interactive",
      ownershipLockEnabled: true,
      personaName: "렌",
    });
    const off = buildCurrentUserInputWrapper({ mode: "interactive", ownershipLockEnabled: false });
    for (const w of [on, off]) {
      assert.doesNotMatch(w, /TARGET_LENGTH|MINIMUM_FLOOR|TERMINAL|target_response_chars/i);
      assert.doesNotMatch(w, /분량|길이/);
    }
  });

  it("H. auto/ooc branch byte-identical to pre-change snapshot; interactive delta is only the ownership block (gate on)", () => {
    const realAuto = buildCurrentUserInputWrapper({ mode: "auto_progression" });
    assert.ok(
      realAuto.includes(
        "Current mode allows limited/full user co-narration per [NO GODMODDING] / novel rules."
      )
    );
    assert.ok(
      realAuto.includes(
        "If the input contains parentheses or action text, treat it as completed user input — not permission to keep narrating the user."
      )
    );
    assert.ok(!realAuto.includes(INTERACTIVE_OWNERSHIP_LOCK_MARKER));

    // Interactive gate-on: pre-change lines still present, plus the lock.
    const inter = buildCurrentUserInputWrapper({ mode: "interactive", ownershipLockEnabled: true });
    assert.match(inter, /The following is the user's latest input/);
    assert.match(inter, /Do not continue writing the user's future/);
    assert.match(inter, /completed user input/);
    assert.ok(inter.includes(INTERACTIVE_OWNERSHIP_LOCK_MARKER));

    // Interactive gate-off: byte-identical to pre-patch legacy wrapper.
    const interOff = buildCurrentUserInputWrapper({ mode: "interactive", ownershipLockEnabled: false });
    assert.ok(!interOff.includes(INTERACTIVE_OWNERSHIP_LOCK_MARKER));
    assert.match(interOff, /It is what the user already said\/did\.\nDo not continue writing/);
  });
});

describe("INTERACTIVE_USER_OWNERSHIP_LOCK gate (separate from Canon cohort)", () => {
  it("default OFF when env unset", () => {
    delete process.env.INTERACTIVE_USER_OWNERSHIP_LOCK_ENABLED;
    delete process.env.INTERACTIVE_USER_OWNERSHIP_LOCK_USER_IDS;
    assert.equal(isInteractiveUserOwnershipLockEnabledForUser(1), false);
    assert.equal(isInteractiveUserOwnershipLockEnabledForUser(undefined), false);
  });

  it("OFF when enabled but user not in allowlist", () => {
    process.env.INTERACTIVE_USER_OWNERSHIP_LOCK_ENABLED = "1";
    process.env.INTERACTIVE_USER_OWNERSHIP_LOCK_USER_IDS = "1";
    assert.equal(isInteractiveUserOwnershipLockEnabledForUser(1), true);
    assert.equal(isInteractiveUserOwnershipLockEnabledForUser(2), false);
    assert.equal(isInteractiveUserOwnershipLockEnabledForUser(null), false);
  });

  it("OFF when allowlist empty even if enabled", () => {
    process.env.INTERACTIVE_USER_OWNERSHIP_LOCK_ENABLED = "1";
    process.env.INTERACTIVE_USER_OWNERSHIP_LOCK_USER_IDS = "";
    assert.equal(isInteractiveUserOwnershipLockEnabledForUser(1), false);
  });

  it("OFF when enabled flag is not 1/true", () => {
    process.env.INTERACTIVE_USER_OWNERSHIP_LOCK_ENABLED = "0";
    process.env.INTERACTIVE_USER_OWNERSHIP_LOCK_USER_IDS = "1";
    assert.equal(isInteractiveUserOwnershipLockEnabledForUser(1), false);
  });

  it("supports comma-separated allowlist", () => {
    process.env.INTERACTIVE_USER_OWNERSHIP_LOCK_ENABLED = "true";
    process.env.INTERACTIVE_USER_OWNERSHIP_LOCK_USER_IDS = "1, 7 ,42";
    assert.equal(isInteractiveUserOwnershipLockEnabledForUser(1), true);
    assert.equal(isInteractiveUserOwnershipLockEnabledForUser(7), true);
    assert.equal(isInteractiveUserOwnershipLockEnabledForUser(42), true);
    assert.equal(isInteractiveUserOwnershipLockEnabledForUser(8), false);
  });

  // Cleanup
  it("cleanup env", () => {
    delete process.env.INTERACTIVE_USER_OWNERSHIP_LOCK_ENABLED;
    delete process.env.INTERACTIVE_USER_OWNERSHIP_LOCK_USER_IDS;
    assert.equal(isInteractiveUserOwnershipLockEnabledForUser(1), false);
  });
});
