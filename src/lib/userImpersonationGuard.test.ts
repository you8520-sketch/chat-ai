import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chatRuntimeModeAllowsUserNarration,
  isInteractiveChatRuntimeMode,
  resolveChatRuntimeMode,
} from "@/lib/chatRuntimeMode";
import {
  CURRENT_USER_INPUT_HEADER,
  wrapCurrentUserInput,
} from "@/lib/currentUserInputLabel";
import {
  EXAMPLE_DIALOG_STYLE_ONLY_NOTE,
  INTERACTIVE_USER_CONTROL_BLOCK,
  buildCompactNoGodmoddingStandardBlock,
  buildNoGodmoddingBlock,
  injectExampleDialogStyleOnlyNote,
  resolveNoGodmoddingMode,
} from "@/lib/noGodmodding";
import {
  detectInteractiveUserImpersonation,
  isUserImpersonationAutoRepairEnabled,
  maybeRepairUserImpersonation,
} from "@/lib/userImpersonationGuard";

describe("chatRuntimeMode", () => {
  it("maps continue → auto_progression", () => {
    assert.equal(resolveChatRuntimeMode({ isContinue: true }), "auto_progression");
    assert.equal(resolveChatRuntimeMode({ novelModeEnabled: true }), "auto_progression");
  });

  it("maps OOC opt-in → ooc_user_impersonation_allowed", () => {
    assert.equal(
      resolveChatRuntimeMode({ oocUserImpersonationAllowed: true }),
      "ooc_user_impersonation_allowed"
    );
  });

  it("defaults to interactive", () => {
    assert.equal(resolveChatRuntimeMode({}), "interactive");
    assert.ok(isInteractiveChatRuntimeMode("interactive"));
    assert.equal(chatRuntimeModeAllowsUserNarration("interactive"), false);
    assert.equal(chatRuntimeModeAllowsUserNarration("auto_progression"), true);
  });
});

describe("interactive user control prompt", () => {
  it("includes compact INTERACTIVE USER CONTROL rule", () => {
    const block = buildCompactNoGodmoddingStandardBlock();
    assert.match(block, /\[INTERACTIVE USER CONTROL\]/);
    assert.match(block, /분량을 채우기 위해 유저를 움직이지 않는다/);
    assert.ok(block.includes(INTERACTIVE_USER_CONTROL_BLOCK));
    assert.doesNotMatch(block, /TARGET_LENGTH/);
    assert.doesNotMatch(block, /MINIMUM_FLOOR/);
  });

  it("auto progression still allows user narration", () => {
    const block = buildNoGodmoddingBlock("체향", "유저", "novel");
    assert.match(block, /\[USER CONTROL MODE - AUTO PROGRESSION\]/);
    assert.match(block, /행동과 대사를 쓸 수 있다/);
    assert.doesNotMatch(block, /\[INTERACTIVE USER CONTROL\]/);
  });

  it("OOC co-narration mode still allows limited user writing", () => {
    const block = buildNoGodmoddingBlock("체향", "유저", "coNarration");
    assert.match(block, /LIMITED CO-NARRATION/);
    assert.match(block, /짧은 행동\/대사 보조/);
  });

  it("resolveNoGodmoddingMode keeps continue → novel via novelModeEnabled", () => {
    assert.equal(
      resolveNoGodmoddingMode({ novelModeEnabled: true, isContinue: true }),
      "novel"
    );
    assert.equal(
      resolveNoGodmoddingMode({
        novelModeEnabled: false,
        impersonationOn: true,
      }),
      "coNarration"
    );
    assert.equal(resolveNoGodmoddingMode({}), "standard");
  });
});

describe("CURRENT USER INPUT labeling", () => {
  it("wraps interactive user input", () => {
    const wrapped = wrapCurrentUserInput('고개를 든다\n"안녕"', { mode: "interactive" });
    assert.ok(wrapped.startsWith(CURRENT_USER_INPUT_HEADER));
    assert.match(wrapped, /Do not continue writing the user's future/);
    assert.match(wrapped, /completed user input/);
    assert.match(wrapped, /고개를 든다/);
  });

  it("is idempotent", () => {
    const once = wrapCurrentUserInput("hello", { mode: "interactive" });
    assert.equal(wrapCurrentUserInput(once, { mode: "interactive" }), once);
  });
});

describe("example dialog style-only note", () => {
  it("injects note near example dialogue without deleting examples", () => {
    const setting = "[예시 대화]\n유저: hi\n캐릭터: …hello";
    const out = injectExampleDialogStyleOnlyNote(setting);
    assert.ok(out.includes(EXAMPLE_DIALOG_STYLE_ONLY_NOTE));
    assert.ok(out.includes("유저: hi"));
    assert.match(out, /말투·분위기 참고용/);
  });

  it("does not inject when no example dialogue", () => {
    assert.equal(injectExampleDialogStyleOnlyNote("외형: 단발"), "외형: 단발");
  });
});

describe("interactive user impersonation detector", () => {
  it("flags user dialogue narration", () => {
    const hit = detectInteractiveUserImpersonation('[B]는 말했다. "그래."', {
      mode: "interactive",
    });
    assert.equal(hit.detected, true);
    assert.equal(hit.reason, "user_dialogue_narration");
  });

  it("flags deliberate user action", () => {
    const hit = detectInteractiveUserImpersonation("[B]는 손을 뻗었다.", {
      mode: "interactive",
    });
    assert.equal(hit.detected, true);
    assert.equal(hit.reason, "user_deliberate_action");
  });

  it("does not flag safe waiting / silence references", () => {
    const hit = detectInteractiveUserImpersonation(
      "그는 대답을 기다리며 창밖을 바라보았다. 침묵이 이어지자 숨이 멎었다.",
      { mode: "interactive", userAliases: ["민수"] }
    );
    assert.equal(hit.detected, false);
  });

  it("does not trigger API repair when USER_IMPERSONATION_AUTO_REPAIR is unset/false", async () => {
    assert.equal(isUserImpersonationAutoRepairEnabled(), false);
    const text = '[B]는 대답했다. "알겠어."';
    const result = await maybeRepairUserImpersonation({
      mode: "interactive",
      text,
    });
    assert.equal(result.detection.detected, true);
    assert.equal(result.repairAttempted, false);
    assert.equal(result.text, text);
  });

  it("skips detection in auto_progression", () => {
    const hit = detectInteractiveUserImpersonation('[B]는 말했다. "가자."', {
      mode: "auto_progression",
    });
    assert.equal(hit.detected, false);
  });
});
