import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  resolveCurrentTurnUserAuthoringDelegation,
} from "@/lib/currentTurnUserAuthoringDelegation";
import {
  POST_DELEGATION_AUTHORING_BOUNDARY,
  wrapCurrentUserInput,
} from "@/lib/currentUserInputLabel";
import {
  buildNoGodmoddingBlock,
  COLLABORATIVE_INTERACTIVE_OWNER_TITLE,
  CURRENT_TURN_OOC_DELEGATION_OWNER_TITLE,
  POST_DELEGATION_RESTORED_OWNER_TITLE,
  resolveNoGodmoddingMode,
} from "@/lib/noGodmodding";
import { resolveEffectiveUserAuthoring } from "@/lib/userCoauthorState";
import { buildContext } from "@/services/contextBuilder";

const H4_TURN_B =
  "OOC: 이번 턴만 유저 페르소나 말투로 내 대사를 써주고,\n내가 그녀를 끌어안으며 키스하는 장면과 이어서 행동도 진행해.\n캐릭터의 반응도 서술해줘.";
const H4_TURN_C = "*잠시 숨을 고르고 얼굴을 바라본다.* 괜찮아? 너무 빨랐으면 말해.";
const STARTED_WALK = "*손을 잡고 걷기 시작한다.*";
const WRAP_MANUAL_SHA =
  "1f3e645d965bcefb7cf47bd1ec2774e97408e990c6c4cd952572d509ac83369f";

function sha(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function ownerTitles(text: string): string[] {
  const titles = [
    COLLABORATIVE_INTERACTIVE_OWNER_TITLE,
    CURRENT_TURN_OOC_DELEGATION_OWNER_TITLE,
    POST_DELEGATION_RESTORED_OWNER_TITLE,
    "[INTERACTIVE USER OWNERSHIP — ABSOLUTE]",
  ];
  return titles.filter((title) => text.includes(title));
}

describe("H4.6 T1–T10 post-delegation restored owner", () => {
  it("T1 — ordinary STANDARD with no delegation history uses STANDARD only", () => {
    const applied = resolveEffectiveUserAuthoring({
      persistentMode: "OFF",
      currentUserInput: "안녕.",
    });
    assert.equal(applied.currentMode, "OFF");
    assert.equal(applied.postDelegationBoundary, false);
    assert.equal(
      resolveNoGodmoddingMode({ currentTurnDelegation: applied.delegation }),
      "standard"
    );
    const wrapped = wrapCurrentUserInput("안녕.", { mode: "interactive" });
    assert.equal(sha(wrapped), WRAP_MANUAL_SHA);
    assert.equal(wrapped.includes(POST_DELEGATION_RESTORED_OWNER_TITLE), false);
    assert.equal(wrapped.includes(POST_DELEGATION_AUTHORING_BOUNDARY), false);
    const owner = buildNoGodmoddingBlock("A", "B", "standard");
    assert.deepEqual(ownerTitles(owner), [COLLABORATIVE_INTERACTIVE_OWNER_TITLE]);
  });

  it("T2 — persistent FULL uses COAUTHOR only", () => {
    const next = resolveEffectiveUserAuthoring({
      persistentMode: "FULL",
      currentUserInput: H4_TURN_C,
      previousUserInput: "OOC: 내 대사랑 행동도 알아서 써줘.",
    });
    assert.equal(next.currentMode, "FULL");
    assert.equal(next.postDelegationBoundary, false);
    assert.equal(
      resolveNoGodmoddingMode({ currentTurnDelegation: next.delegation }),
      "currentTurnDelegated"
    );
    const owner = buildNoGodmoddingBlock("A", "B", "currentTurnDelegated", {
      currentTurnDelegation: next.delegation,
    });
    assert.deepEqual(ownerTitles(owner), [CURRENT_TURN_OOC_DELEGATION_OWNER_TITLE]);
    const wrapped = wrapCurrentUserInput(H4_TURN_C, {
      mode: "current_turn_ooc_delegated",
      coauthorDuration: "persistent",
    });
    assert.equal(wrapped.includes(POST_DELEGATION_RESTORED_OWNER_TITLE), false);
  });

  it("T3 — turn-only FULL current turn uses COAUTHOR only", () => {
    const grant = resolveEffectiveUserAuthoring({
      persistentMode: "OFF",
      currentUserInput: H4_TURN_B,
    });
    assert.equal(grant.currentMode, "FULL");
    assert.equal(grant.directive.duration, "turn");
    assert.equal(grant.postDelegationBoundary, false);
    assert.equal(
      resolveNoGodmoddingMode({ currentTurnDelegation: grant.delegation }),
      "currentTurnDelegated"
    );
    const wrapped = wrapCurrentUserInput(H4_TURN_B, {
      mode: "current_turn_ooc_delegated",
      coauthorDuration: "turn",
    });
    assert.match(wrapped, /This delegation applies to THIS TURN only/);
    assert.equal(wrapped.includes(POST_DELEGATION_RESTORED_OWNER_TITLE), false);
  });

  it("T4 — first ordinary OFF after turn-only uses RESTORED only", () => {
    const next = resolveEffectiveUserAuthoring({
      persistentMode: "OFF",
      currentUserInput: H4_TURN_C,
      previousUserInput: H4_TURN_B,
    });
    assert.equal(next.currentMode, "OFF");
    assert.equal(next.postDelegationBoundary, true);
    assert.equal(
      resolveNoGodmoddingMode({ currentTurnDelegation: next.delegation }),
      "postDelegationRestored"
    );
    const built = buildContext({
      charName: "테스트_AI_캐릭터",
      chunks: [],
      userNickname: "테스트_유저_캐릭터",
      userPersona: "이름/호칭: 테스트_유저_캐릭터",
      shortTermHistory: [],
      currentUserMessage: H4_TURN_C,
      currentTurnAuthoringDelegation: next.delegation,
      nsfw: false,
      provider: "openrouter",
      isContinue: false,
      novelModeEnabled: false,
      userImpersonation: false,
      personaDisplayName: "테스트_유저_캐릭터",
      completedTurns: 2,
    });
    assert.deepEqual(ownerTitles(built.systemPrompt), [POST_DELEGATION_RESTORED_OWNER_TITLE]);
    const last = built.history[built.history.length - 1]?.content ?? "";
    assert.equal(last.includes(POST_DELEGATION_RESTORED_OWNER_TITLE), true);
    assert.equal(last.includes(POST_DELEGATION_AUTHORING_BOUNDARY), false);
    assert.doesNotMatch(last, /COLLABORATIVE INTERACTIVE/);
  });

  it("T5 — second ordinary OFF after turn-only returns to STANDARD only", () => {
    const second = resolveEffectiveUserAuthoring({
      persistentMode: "OFF",
      currentUserInput: "응. 천천히 해도 돼.",
      previousUserInput: H4_TURN_C,
    });
    assert.equal(second.currentMode, "OFF");
    assert.equal(second.postDelegationBoundary, false);
    assert.equal(
      resolveNoGodmoddingMode({ currentTurnDelegation: second.delegation }),
      "standard"
    );
    const wrapped = wrapCurrentUserInput("응. 천천히 해도 돼.", { mode: "interactive" });
    assert.equal(wrapped.includes(POST_DELEGATION_RESTORED_OWNER_TITLE), false);
    assert.equal(sha(wrapCurrentUserInput("안녕.", { mode: "interactive" })), WRAP_MANUAL_SHA);
  });

  it("T6 — current-user-started walk still allows natural completion on the transition turn", () => {
    const next = resolveEffectiveUserAuthoring({
      persistentMode: "OFF",
      currentUserInput: STARTED_WALK,
      previousUserInput: H4_TURN_B,
    });
    assert.equal(next.postDelegationBoundary, true);
    const wrapped = wrapCurrentUserInput(STARTED_WALK, {
      mode: "interactive",
      postDelegationBoundary: true,
    });
    assert.match(wrapped, /natural completion of an action explicitly begun/);
    assert.match(wrapped, /손을 잡고 걷기 시작한다/);
    assert.equal(wrapped.includes(POST_DELEGATION_RESTORED_OWNER_TITLE), true);
    const owner = buildNoGodmoddingBlock("A", "B", "postDelegationRestored");
    assert.match(owner, /natural completion of an action explicitly begun by the user/);
  });

  it("T7 — [A] initiative remains allowed on the restored owner", () => {
    const owner = buildNoGodmoddingBlock("A", "B", "postDelegationRestored");
    assert.match(owner, /\[A\] remains active and may speak, approach, touch, pull, kiss, propose/);
    assert.doesNotMatch(owner, /Never describe \[B\]/);
    assert.doesNotMatch(owner, /INTERACTIVE USER OWNERSHIP — ABSOLUTE/);
  });

  it("T8 — explicit revoke stays on the existing STANDARD path", () => {
    const applied = resolveEffectiveUserAuthoring({
      persistentMode: "FULL",
      currentUserInput: "OOC: 이제 내 대사나 행동은 쓰지 마.\n" + H4_TURN_C,
    });
    assert.equal(applied.currentMode, "OFF");
    assert.equal(applied.persistentAfter, "OFF");
    assert.equal(applied.postDelegationBoundary, false);
    assert.equal(
      resolveNoGodmoddingMode({ currentTurnDelegation: applied.delegation }),
      "standard"
    );
    const wrapped = wrapCurrentUserInput(
      "OOC: 이제 내 대사나 행동은 쓰지 마.\n" + H4_TURN_C,
      { mode: "interactive" }
    );
    assert.equal(wrapped.includes(POST_DELEGATION_RESTORED_OWNER_TITLE), false);
  });

  it("T9 — new persistent grant on a would-be transition turn wins as COAUTHOR", () => {
    const applied = resolveEffectiveUserAuthoring({
      persistentMode: "OFF",
      currentUserInput: "OOC: 앞으로 내 캐릭터 대사랑 행동도 알아서 써줘.",
      previousUserInput: H4_TURN_B,
    });
    assert.equal(applied.currentMode, "FULL");
    assert.equal(applied.persistentAfter, "FULL");
    assert.equal(applied.postDelegationBoundary, false);
    assert.equal(applied.delegation.active, true);
    assert.equal(
      resolveNoGodmoddingMode({ currentTurnDelegation: applied.delegation }),
      "currentTurnDelegated"
    );
  });

  it("T10 — new turn-only grant on a would-be transition turn wins as COAUTHOR", () => {
    const applied = resolveEffectiveUserAuthoring({
      persistentMode: "OFF",
      currentUserInput: "OOC: 이번 턴만 내 대사랑 행동도 알아서 써줘.",
      previousUserInput: H4_TURN_B,
    });
    assert.equal(applied.currentMode, "FULL");
    assert.equal(applied.persistentAfter, "OFF");
    assert.equal(applied.directive.duration, "turn");
    assert.equal(applied.postDelegationBoundary, false);
    assert.equal(
      resolveCurrentTurnUserAuthoringDelegation({
        currentUserInput: "OOC: 이번 턴만 내 대사랑 행동도 알아서 써줘.",
      }).active,
      true
    );
    assert.equal(
      resolveNoGodmoddingMode({ currentTurnDelegation: applied.delegation }),
      "currentTurnDelegated"
    );
  });
});
