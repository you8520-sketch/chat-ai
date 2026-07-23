import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CURRENT_USER_INPUT_HEADER,
  INTERACTIVE_OWNERSHIP_LOCK_MARKER,
  INTERACTIVE_OWNERSHIP_TERMINAL_ECHO_MARKER,
  buildCurrentUserInputWrapper,
  wrapCurrentUserInput,
} from "@/lib/currentUserInputLabel";
import {
  isInteractiveUserOwnershipLockEnabledForUser,
  isInteractiveUserOwnershipTerminalEchoEnabledForUser,
} from "@/lib/interactiveUserOwnershipLock";

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

  // ---- A-E: allowlist exact-integer strictness regression ----
  it("A. USER_IDS='1.9' userId=1 -> false (no flooring)", () => {
    process.env.INTERACTIVE_USER_OWNERSHIP_LOCK_ENABLED = "1";
    process.env.INTERACTIVE_USER_OWNERSHIP_LOCK_USER_IDS = "1.9";
    assert.equal(isInteractiveUserOwnershipLockEnabledForUser(1), false);
    assert.equal(isInteractiveUserOwnershipLockEnabledForUser(2), false);
  });

  it("B. USER_IDS='1e2' userId=100 -> false (exponent rejected)", () => {
    process.env.INTERACTIVE_USER_OWNERSHIP_LOCK_ENABLED = "1";
    process.env.INTERACTIVE_USER_OWNERSHIP_LOCK_USER_IDS = "1e2";
    assert.equal(isInteractiveUserOwnershipLockEnabledForUser(100), false);
    assert.equal(isInteractiveUserOwnershipLockEnabledForUser(1), false);
  });

  it("C. '1,abc,2.5,7' -> user1 true, user7 true, others false", () => {
    process.env.INTERACTIVE_USER_OWNERSHIP_LOCK_ENABLED = "1";
    process.env.INTERACTIVE_USER_OWNERSHIP_LOCK_USER_IDS = "1,abc,2.5,7";
    assert.equal(isInteractiveUserOwnershipLockEnabledForUser(1), true);
    assert.equal(isInteractiveUserOwnershipLockEnabledForUser(7), true);
    assert.equal(isInteractiveUserOwnershipLockEnabledForUser(2), false);
    assert.equal(isInteractiveUserOwnershipLockEnabledForUser(3), false);
  });

  it("D. runtime userId=1.9 allowlist=1 -> false (no flooring runtime id)", () => {
    process.env.INTERACTIVE_USER_OWNERSHIP_LOCK_ENABLED = "1";
    process.env.INTERACTIVE_USER_OWNERSHIP_LOCK_USER_IDS = "1";
    assert.equal(isInteractiveUserOwnershipLockEnabledForUser(1.9), false);
    assert.equal(isInteractiveUserOwnershipLockEnabledForUser(1), true);
  });

  it("E. very large unsafe integer -> false", () => {
    process.env.INTERACTIVE_USER_OWNERSHIP_LOCK_ENABLED = "1";
    const unsafe = Number.MAX_SAFE_INTEGER + 1; // 9007199254740992
    process.env.INTERACTIVE_USER_OWNERSHIP_LOCK_USER_IDS = String(unsafe);
    assert.equal(isInteractiveUserOwnershipLockEnabledForUser(unsafe), false);
    // valid large safe integer still works
    process.env.INTERACTIVE_USER_OWNERSHIP_LOCK_USER_IDS = "9007199254740991";
    assert.equal(isInteractiveUserOwnershipLockEnabledForUser(9007199254740991), true);
  });

  it("extra: 0 / +1 / -1 / 01 / blank all rejected", () => {
    process.env.INTERACTIVE_USER_OWNERSHIP_LOCK_ENABLED = "1";
    process.env.INTERACTIVE_USER_OWNERSHIP_LOCK_USER_IDS = "0,+1,-1,01, ,";
    assert.equal(isInteractiveUserOwnershipLockEnabledForUser(0), false);
    assert.equal(isInteractiveUserOwnershipLockEnabledForUser(1), false);
    assert.equal(isInteractiveUserOwnershipLockEnabledForUser(10), false);
  });

  // Cleanup
  it("cleanup env", () => {
    delete process.env.INTERACTIVE_USER_OWNERSHIP_LOCK_ENABLED;
    delete process.env.INTERACTIVE_USER_OWNERSHIP_LOCK_USER_IDS;
    assert.equal(isInteractiveUserOwnershipLockEnabledForUser(1), false);
  });
});

describe("R1 — COMPACT TERMINAL OWNERSHIP ECHO (Muse-targeted admin canary)", () => {
  it("R1-A. lock ON + echo ON (interactive) → terminal echo appended AFTER body at literal tail", () => {
    const body = "…다음에 밖에 나갈 때, 네 옆에 설지 뒤에 설지. 내가 정해도 돼?";
    const w = wrapCurrentUserInput(body, {
      mode: "interactive",
      personaName: "렌",
      ownershipLockEnabled: true,
      ownershipTerminalEchoEnabled: true,
    });
    // Lock (above body) present.
    assert.ok(w.includes(INTERACTIVE_OWNERSHIP_LOCK_MARKER));
    // Body present.
    assert.ok(w.includes(body));
    // Terminal echo marker present and located AFTER the body (literal tail).
    assert.ok(w.includes(INTERACTIVE_OWNERSHIP_TERMINAL_ECHO_MARKER));
    const bodyIdx = w.indexOf(body);
    const echoIdx = w.indexOf(INTERACTIVE_OWNERSHIP_TERMINAL_ECHO_MARKER);
    assert.ok(bodyIdx >= 0 && echoIdx > bodyIdx, "echo must come AFTER the body");
    // Echo is the literal tail (nothing after the echo block's last line).
    assert.ok(w.trim().endsWith("world events."));
  });

  it("R1-B. echo OFF (lock ON) → NO terminal echo marker (legacy lock-only shape preserved)", () => {
    const body = "…이대로 가만히 있자.";
    const w = wrapCurrentUserInput(body, {
      mode: "interactive",
      personaName: "렌",
      ownershipLockEnabled: true,
      ownershipTerminalEchoEnabled: false,
    });
    assert.ok(w.includes(INTERACTIVE_OWNERSHIP_LOCK_MARKER));
    assert.ok(!w.includes(INTERACTIVE_OWNERSHIP_TERMINAL_ECHO_MARKER));
    // Ends with the body (legacy shape).
    assert.ok(w.trim().endsWith(body));
  });

  it("R1-C. lock OFF + echo ON → NO terminal echo (echo requires the strict lock active)", () => {
    const body = "…이대로 가만히 있자.";
    const w = wrapCurrentUserInput(body, {
      mode: "interactive",
      personaName: "렌",
      ownershipLockEnabled: false,
      ownershipTerminalEchoEnabled: true,
    });
    assert.ok(!w.includes(INTERACTIVE_OWNERSHIP_LOCK_MARKER));
    assert.ok(!w.includes(INTERACTIVE_OWNERSHIP_TERMINAL_ECHO_MARKER));
  });

  it("R1-D. auto_progression / ooc → NO terminal echo regardless of echo flag", () => {
    for (const mode of ["auto_progression", "ooc_user_impersonation_allowed"] as const) {
      const w = wrapCurrentUserInput(
        "…가만히 있어.",
        { mode, personaName: "렌", ownershipLockEnabled: true, ownershipTerminalEchoEnabled: true }
      );
      assert.ok(!w.includes(INTERACTIVE_OWNERSHIP_LOCK_MARKER));
      assert.ok(!w.includes(INTERACTIVE_OWNERSHIP_TERMINAL_ECHO_MARKER));
      assert.match(w, /Current mode allows limited\/full user co-narration/);
    }
  });

  it("R1-E. echo is COMPACT — tightened semantics, residual agency types, no large-block repeat", () => {
    const w = wrapCurrentUserInput("…가만히 있어.", {
      mode: "interactive",
      personaName: "렌",
      ownershipLockEnabled: true,
      ownershipTerminalEchoEnabled: true,
    });
    const echoIdx = w.indexOf(INTERACTIVE_OWNERSHIP_TERMINAL_ECHO_MARKER);
    const echo = w.slice(echoIdx);
    // A. no longer contains the ambiguous "Everything above is ... user-authored".
    assert.doesNotMatch(echo, /Everything above/i);
    // B. contains semantics equivalent to "The user's current input is complete".
    assert.match(echo, /The user's current input is complete/);
    // C. contains "facial expression" (residual agency type Muse violated).
    assert.match(echo, /facial expression/);
    // D. contains "voluntary physical reaction" (residual agency type Muse violated).
    assert.match(echo, /voluntary physical reaction/);
    // E. remains compact (<= existing 4-line limit).
    assert.ok(echo.split("\n").length <= 4, "echo must be compact (<=4 lines)");
    // Does NOT re-map [B] (no second "[B] =").
    assert.doesNotMatch(echo, /\[B\] = /);
    // Does NOT restate the full "Past history is NOT permission" bullet block.
    assert.doesNotMatch(echo, /Past history is NOT permission/);
    // No LENGTH / Terminal / prose / dialogue-quota markers.
    assert.doesNotMatch(echo, /TARGET_LENGTH|MINIMUM_FLOOR|TERMINAL|분량|길이|quota/i);
  });

  it("R1-F. idempotency preserved (already-wrapped input not double-wrapped, echo on & off)", () => {
    const body = '고개를 든다\n"안녕"';
    const once = wrapCurrentUserInput(body, {
      mode: "interactive",
      ownershipLockEnabled: true,
      ownershipTerminalEchoEnabled: true,
    });
    assert.equal(
      wrapCurrentUserInput(once, {
        mode: "interactive",
        ownershipLockEnabled: true,
        ownershipTerminalEchoEnabled: true,
      }),
      once
    );
    // Empty passthrough.
    assert.equal(
      wrapCurrentUserInput("   ", {
        mode: "interactive",
        ownershipLockEnabled: true,
        ownershipTerminalEchoEnabled: true,
      }),
      ""
    );
  });

  it("R1-G. persona name not hard-coded — two distinct personas produce distinct [B] mappings (echo references [B] only)", () => {
    const wA = wrapCurrentUserInput("…가만히 있어.", {
      mode: "interactive",
      personaName: "PersonaA",
      ownershipLockEnabled: true,
      ownershipTerminalEchoEnabled: true,
    });
    const wB = wrapCurrentUserInput("…가만히 있어.", {
      mode: "interactive",
      personaName: "PersonaB",
      ownershipLockEnabled: true,
      ownershipTerminalEchoEnabled: true,
    });
    assert.match(wA, /\[B\] = PersonaA/);
    assert.match(wB, /\[B\] = PersonaB/);
    assert.notEqual(wA, wB);
    // No test-character literal hard-coded.
    assert.doesNotMatch(wA, /라이크|에녹|렌/);
  });
});

describe("R1 gate — isInteractiveUserOwnershipTerminalEchoEnabledForUser (Muse-targeted)", () => {
  const E = isInteractiveUserOwnershipTerminalEchoEnabledForUser;
  const MUSE = "meta/muse-spark-1.1";
  const DEEPSEEK = "deepseek/deepseek-v4-pro";
  const GEMINI = "google/gemini-2.5-pro";
  const HY3 = "tencent/hy3";

  it("default OFF when env unset (all models, admin included)", () => {
    delete process.env.INTERACTIVE_USER_OWNERSHIP_TERMINAL_ECHO_ENABLED;
    delete process.env.INTERACTIVE_USER_OWNERSHIP_TERMINAL_ECHO_USER_IDS;
    delete process.env.INTERACTIVE_USER_OWNERSHIP_TERMINAL_ECHO_MODELS;
    assert.equal(E(1, MUSE), false);
    assert.equal(E(1, DEEPSEEK), false);
  });

  it("ON only for admin + Muse (default model allowlist)", () => {
    process.env.INTERACTIVE_USER_OWNERSHIP_TERMINAL_ECHO_ENABLED = "1";
    process.env.INTERACTIVE_USER_OWNERSHIP_TERMINAL_ECHO_USER_IDS = "1";
    delete process.env.INTERACTIVE_USER_OWNERSHIP_TERMINAL_ECHO_MODELS;
    assert.equal(E(1, MUSE), true);
    // Non-Muse models unchanged.
    assert.equal(E(1, DEEPSEEK), false);
    assert.equal(E(1, GEMINI), false);
    assert.equal(E(1, HY3), false);
    // Non-admin user unchanged.
    assert.equal(E(2, MUSE), false);
    assert.equal(E(null, MUSE), false);
  });

  it("OFF when enabled but user allowlist empty", () => {
    process.env.INTERACTIVE_USER_OWNERSHIP_TERMINAL_ECHO_ENABLED = "1";
    process.env.INTERACTIVE_USER_OWNERSHIP_TERMINAL_ECHO_USER_IDS = "";
    assert.equal(E(1, MUSE), false);
  });

  it("OFF when enabled flag not 1/true", () => {
    process.env.INTERACTIVE_USER_OWNERSHIP_TERMINAL_ECHO_ENABLED = "0";
    process.env.INTERACTIVE_USER_OWNERSHIP_TERMINAL_ECHO_USER_IDS = "1";
    assert.equal(E(1, MUSE), false);
  });

  it("custom model allowlist respected (e.g. gemini only)", () => {
    process.env.INTERACTIVE_USER_OWNERSHIP_TERMINAL_ECHO_ENABLED = "1";
    process.env.INTERACTIVE_USER_OWNERSHIP_TERMINAL_ECHO_USER_IDS = "1";
    process.env.INTERACTIVE_USER_OWNERSHIP_TERMINAL_ECHO_MODELS = "gemini-2.5-pro";
    assert.equal(E(1, GEMINI), true);
    assert.equal(E(1, MUSE), false);
  });

  it("strict positive-integer user ids (no flooring/coercion)", () => {
    delete process.env.INTERACTIVE_USER_OWNERSHIP_TERMINAL_ECHO_MODELS;
    process.env.INTERACTIVE_USER_OWNERSHIP_TERMINAL_ECHO_ENABLED = "1";
    process.env.INTERACTIVE_USER_OWNERSHIP_TERMINAL_ECHO_USER_IDS = "1.9,abc,01, ,7";
    assert.equal(E(1, MUSE), false); // 1 not present (only malformed tokens)
    process.env.INTERACTIVE_USER_OWNERSHIP_TERMINAL_ECHO_USER_IDS = "1,7";
    assert.equal(E(1, MUSE), true);
    assert.equal(E(7, MUSE), true);
    assert.equal(E(1.9, MUSE), false); // runtime id not floored
  });

  it("cleanup env", () => {
    delete process.env.INTERACTIVE_USER_OWNERSHIP_TERMINAL_ECHO_ENABLED;
    delete process.env.INTERACTIVE_USER_OWNERSHIP_TERMINAL_ECHO_USER_IDS;
    delete process.env.INTERACTIVE_USER_OWNERSHIP_TERMINAL_ECHO_MODELS;
    assert.equal(E(1, MUSE), false);
  });
});
