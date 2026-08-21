import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import {
  resolveCurrentTurnUserAuthoringDelegation,
} from "@/lib/currentTurnUserAuthoringDelegation";
import {
  buildCurrentUserInputWrapper,
  POST_DELEGATION_AUTHORING_BOUNDARY,
  wrapCurrentUserInput,
} from "@/lib/currentUserInputLabel";
import {
  buildNoGodmoddingBlock,
  COLLABORATIVE_INTERACTIVE_OWNER_TITLE,
  CURRENT_INPUT_OVERRIDES_PRIOR_ASSISTANT_LINE,
  CURRENT_TURN_OOC_DELEGATION_OWNER_TITLE,
} from "@/lib/noGodmodding";
import {
  applyUserCoauthorDirective,
  recomputeAndPersistUserCoauthorMode,
  recomputeUserCoauthorModeFromUserMessages,
  resolveEffectiveUserAuthoring,
  resolveEffectiveUserAuthoringFromHistory,
  type UserCoauthorMode,
} from "@/lib/userCoauthorState";
import { resolveUserCoauthorDirective } from "@/lib/userCoauthorDirective";
import { buildContext } from "@/services/contextBuilder";

const H4_TURN_B =
  "OOC: 이번 턴만 유저 페르소나 말투로 내 대사를 써주고,\n내가 그녀를 끌어안으며 키스하는 장면과 이어서 행동도 진행해.\n캐릭터의 반응도 서술해줘.";
const H4_TURN_C = "*잠시 숨을 고르고 얼굴을 바라본다.* 괜찮아? 너무 빨랐으면 말해.";
const STARTED_WALK = "*손을 잡고 문 쪽으로 걷기 시작한다.* 같이 가자.";

function modeOf(applied: { currentMode: UserCoauthorMode; persistentAfter: UserCoauthorMode }) {
  return { current: applied.currentMode, persistent: applied.persistentAfter };
}

function sha(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function openForkDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL DEFAULT 1,
      character_id INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT ''
    );
  `);
  db.prepare("INSERT INTO chats (id) VALUES (1)").run();
  return db;
}

describe("H4.4 P1–P10 command semantics", () => {
  it("P1 — bare grant is persistent FULL and current FULL", () => {
    const applied = resolveEffectiveUserAuthoring({
      persistentMode: "OFF",
      currentUserInput: "OOC: 내 대사랑 행동도 알아서 써줘.",
    });
    assert.deepEqual(modeOf(applied), { current: "FULL", persistent: "FULL" });
    assert.equal(applied.directive.duration, "persistent");
    assert.equal(applied.delegation.active, true);
    assert.equal(applied.delegation.allowDialogue, true);
    assert.equal(applied.delegation.allowMajorActions, true);
    assert.equal(applied.delegation.duration, "persistent");
  });

  it("P2 — next ordinary IC keeps persistent FULL", () => {
    const next = resolveEffectiveUserAuthoring({
      persistentMode: "FULL",
      currentUserInput: "고개를 끄덕인다.",
      previousUserInput: "OOC: 내 대사랑 행동도 알아서 써줘.",
    });
    assert.deepEqual(modeOf(next), { current: "FULL", persistent: "FULL" });
    assert.equal(next.directive.duration, "none");
    assert.equal(next.delegation.active, true);
    assert.equal(next.postDelegationBoundary, false);
  });

  it("P3 — 이번 턴만 grant from OFF is current FULL, persistent OFF", () => {
    const applied = resolveEffectiveUserAuthoring({
      persistentMode: "OFF",
      currentUserInput: "OOC: 이번 턴만 내 대사랑 행동도 알아서 써줘.",
    });
    assert.deepEqual(modeOf(applied), { current: "FULL", persistent: "OFF" });
    assert.equal(applied.directive.duration, "turn");
    assert.equal(applied.delegation.duration, "turn");
  });

  it("P4 — next ordinary IC after P3 is OFF/OFF", () => {
    const next = resolveEffectiveUserAuthoring({
      persistentMode: "OFF",
      currentUserInput: "괜찮아?",
      previousUserInput: "OOC: 이번 턴만 내 대사랑 행동도 알아서 써줘.",
    });
    assert.deepEqual(modeOf(next), { current: "OFF", persistent: "OFF" });
    assert.equal(next.delegation.active, false);
    assert.equal(next.postDelegationBoundary, true);
  });

  it("P5 — persistent FULL + 내 대사는 내가 쓸게 → ACTIONS", () => {
    const applied = resolveEffectiveUserAuthoring({
      persistentMode: "FULL",
      currentUserInput: "OOC: 내 대사는 내가 쓸게.",
    });
    assert.deepEqual(modeOf(applied), { current: "ACTIONS", persistent: "ACTIONS" });
  });

  it("P6 — persistent FULL + 내 행동은 쓰지 마 → DIALOGUE", () => {
    const applied = resolveEffectiveUserAuthoring({
      persistentMode: "FULL",
      currentUserInput: "OOC: 내 행동은 쓰지 마.",
    });
    assert.deepEqual(modeOf(applied), { current: "DIALOGUE", persistent: "DIALOGUE" });
  });

  it("P7 — persistent FULL + 이제 내 대사나 행동은 쓰지 마 → OFF", () => {
    const applied = resolveEffectiveUserAuthoring({
      persistentMode: "FULL",
      currentUserInput: "OOC: 이제 내 대사나 행동은 쓰지 마.",
    });
    assert.deepEqual(modeOf(applied), { current: "OFF", persistent: "OFF" });
    assert.equal(applied.postDelegationBoundary, true);
  });

  it("P8 — persistent FULL + 이번 턴은 대사는 내가 쓸게 → current ACTIONS, persistent FULL", () => {
    const applied = resolveEffectiveUserAuthoring({
      persistentMode: "FULL",
      currentUserInput: "OOC: 이번 턴은 대사는 내가 쓸게.",
    });
    assert.deepEqual(modeOf(applied), { current: "ACTIONS", persistent: "FULL" });
    const next = resolveEffectiveUserAuthoring({
      persistentMode: applied.persistentAfter,
      currentUserInput: "계속하자.",
      previousUserInput: "OOC: 이번 턴은 대사는 내가 쓸게.",
    });
    assert.deepEqual(modeOf(next), { current: "FULL", persistent: "FULL" });
  });

  it("P9 — unrelated OOC does not mutate authoring state", () => {
    const applied = resolveEffectiveUserAuthoring({
      persistentMode: "OFF",
      currentUserInput: "OOC: 지금 장면은 밤이야.",
    });
    assert.equal(applied.directive.duration, "none");
    assert.deepEqual(modeOf(applied), { current: "OFF", persistent: "OFF" });
  });

  it("P10 — buried IC OOC-like text does not mutate", () => {
    const applied = resolveEffectiveUserAuthoring({
      persistentMode: "OFF",
      currentUserInput: '*웃는다.* OOC처럼 말하자면 내 행동도 써줘.',
    });
    assert.equal(applied.directive.duration, "none");
    assert.deepEqual(modeOf(applied), { current: "OFF", persistent: "OFF" });
  });
});

describe("H4.4 T1–T10 regressions", () => {
  it("T1 — original H4 이번 턴만 then next turn OFF", () => {
    const turnB = resolveEffectiveUserAuthoring({
      persistentMode: "OFF",
      currentUserInput: H4_TURN_B,
    });
    assert.equal(turnB.directive.duration, "turn");
    assert.deepEqual(modeOf(turnB), { current: "FULL", persistent: "OFF" });
    const turnC = resolveEffectiveUserAuthoring({
      persistentMode: turnB.persistentAfter,
      currentUserInput: H4_TURN_C,
      previousUserInput: H4_TURN_B,
    });
    assert.deepEqual(modeOf(turnC), { current: "OFF", persistent: "OFF" });
    assert.equal(turnC.postDelegationBoundary, true);
  });

  it("T2 — bare grant persists to the next turn", () => {
    const grant = resolveEffectiveUserAuthoringFromHistory({
      historyUserContents: [],
      currentUserInput: "OOC: 앞으로 내 캐릭터 대사랑 행동도 알아서 써줘.",
    });
    assert.deepEqual(modeOf(grant), { current: "FULL", persistent: "FULL" });
    const next = resolveEffectiveUserAuthoringFromHistory({
      historyUserContents: ["OOC: 앞으로 내 캐릭터 대사랑 행동도 알아서 써줘."],
      currentUserInput: "문을 연다.",
    });
    assert.deepEqual(modeOf(next), { current: "FULL", persistent: "FULL" });
  });

  it("T3 — persistent grant then revoke then next OFF", () => {
    const afterRevoke = recomputeUserCoauthorModeFromUserMessages([
      "OOC: 내 캐릭터도 같이 써줘.",
      "OOC: 이제 내 대사나 행동은 쓰지 마.",
    ]);
    assert.equal(afterRevoke, "OFF");
    const next = resolveEffectiveUserAuthoring({
      persistentMode: afterRevoke,
      currentUserInput: "그만하자.",
      previousUserInput: "OOC: 이제 내 대사나 행동은 쓰지 마.",
    });
    assert.deepEqual(modeOf(next), { current: "OFF", persistent: "OFF" });
  });

  it("T4 — persistent FULL + turn-only dialogue deny, following turn FULL", () => {
    const override = resolveEffectiveUserAuthoring({
      persistentMode: "FULL",
      currentUserInput: "OOC: 이번 턴은 대사는 내가 쓸게.",
    });
    assert.deepEqual(modeOf(override), { current: "ACTIONS", persistent: "FULL" });
    const next = resolveEffectiveUserAuthoring({
      persistentMode: "FULL",
      currentUserInput: "응.",
    });
    assert.deepEqual(modeOf(next), { current: "FULL", persistent: "FULL" });
  });

  it("T5 — partial persistent DIALOGUE survives ordinary IC", () => {
    const next = resolveEffectiveUserAuthoring({
      persistentMode: "DIALOGUE",
      currentUserInput: "*그녀를 끌어안는다.*",
    });
    assert.deepEqual(modeOf(next), { current: "DIALOGUE", persistent: "DIALOGUE" });
  });

  it("T6 — fork before toggle does not inherit later FULL", () => {
    const parent = [
      "안녕.",
      "OOC: 내 대사랑 행동도 알아서 써줘.",
    ];
    const beforeToggle = recomputeUserCoauthorModeFromUserMessages(parent.slice(0, 1));
    const afterToggle = recomputeUserCoauthorModeFromUserMessages(parent);
    assert.equal(beforeToggle, "OFF");
    assert.equal(afterToggle, "FULL");
  });

  it("T7 — fork after toggle inherits FULL", () => {
    const parent = [
      "OOC: 유저 페르소나까지 소설처럼 같이 진행해줘.",
      "계속해.",
    ];
    assert.equal(recomputeUserCoauthorModeFromUserMessages(parent), "FULL");
  });

  it("T8 — edit/delete of mode-changing OOC does not leave stale state", () => {
    const db = openForkDb();
    db.prepare("INSERT INTO messages (chat_id, role, content) VALUES (1,'user',?)").run(
      "OOC: 내 대사랑 행동도 알아서 써줘."
    );
    db.prepare("INSERT INTO messages (chat_id, role, content) VALUES (1,'assistant','ok')").run();
    assert.equal(recomputeAndPersistUserCoauthorMode(db, 1), "FULL");
    db.prepare("UPDATE messages SET content=? WHERE id=1").run("그냥 안녕.");
    assert.equal(recomputeAndPersistUserCoauthorMode(db, 1), "OFF");
    db.prepare("INSERT INTO messages (chat_id, role, content) VALUES (1,'user',?)").run(
      "OOC: 내 대사랑 행동도 알아서 써줘."
    );
    assert.equal(recomputeAndPersistUserCoauthorMode(db, 1), "FULL");
    db.prepare("DELETE FROM messages WHERE id=3").run();
    assert.equal(recomputeAndPersistUserCoauthorMode(db, 1), "OFF");
  });

  it("T9 — current-turn explicit user action still overrides coauthor owner", () => {
    const owner = buildNoGodmoddingBlock("", "", "currentTurnDelegated", {
      currentTurnDelegation: {
        active: true,
        allowDialogue: true,
        allowMajorActions: true,
        source: "explicit_ooc",
        duration: "persistent",
      },
    });
    assert.equal(owner.includes(CURRENT_INPUT_OVERRIDES_PRIOR_ASSISTANT_LINE), true);
    const wrapped = wrapCurrentUserInput(STARTED_WALK, {
      mode: "current_turn_ooc_delegated",
      coauthorDuration: "persistent",
    });
    assert.match(wrapped, /Current user input overrides prior assistant-authored/);
    assert.match(wrapped, /손을 잡고 문 쪽으로 걷기 시작한다/);
  });

  it("T10 — current-turn delegation parser remains false on ordinary IC", () => {
    const d = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: H4_TURN_C,
    });
    assert.equal(d.active, false);
    assert.equal(d.allowDialogue, false);
    assert.equal(d.allowMajorActions, false);
  });
});

describe("H4.4 additional product fixtures", () => {
  it("recognizes listed persistent grants and revokes", () => {
    assert.equal(
      resolveEffectiveUserAuthoring({
        currentUserInput: "OOC: 내 캐릭터도 같이 써줘.",
      }).currentMode,
      "FULL"
    );
    assert.equal(
      resolveEffectiveUserAuthoring({
        currentUserInput: "OOC: 유저캐 건드리지 마.",
        persistentMode: "FULL",
      }).currentMode,
      "OFF"
    );
    assert.equal(
      resolveEffectiveUserAuthoring({
        currentUserInput: "OOC: 내 캐릭터는 이제 내가 직접 할게.",
        persistentMode: "FULL",
      }).currentMode,
      "OFF"
    );
  });

  it("turn-only negative override from FULL is standard this turn only", () => {
    const applied = resolveEffectiveUserAuthoring({
      persistentMode: "FULL",
      currentUserInput: "OOC: 이번 턴만 내 행동이나 대사는 쓰지 마.",
    });
    assert.deepEqual(modeOf(applied), { current: "OFF", persistent: "FULL" });
    assert.equal(applied.postDelegationBoundary, true);
  });

  it("does not scan assistant history as an authoring command", () => {
    const mode = recomputeUserCoauthorModeFromUserMessages([]);
    assert.equal(mode, "OFF");
    const applied = applyUserCoauthorDirective(
      "OFF",
      resolveUserCoauthorDirective({
        currentUserInput: "OOC: 지금 장면은 밤이야.",
      })
    );
    assert.equal(applied.persistentAfter, "OFF");
  });
});

describe("H4.4 prompt owners stay mutually exclusive", () => {
  it("ordinary first-turn STANDARD wrapper is unchanged and has no post-delegation sentence", () => {
    const wrapped = wrapCurrentUserInput("안녕.", { mode: "interactive" });
    assert.equal(
      sha(wrapped),
      "1f3e645d965bcefb7cf47bd1ec2774e97408e990c6c4cd952572d509ac83369f"
    );
    assert.doesNotMatch(wrapped, new RegExp(POST_DELEGATION_AUTHORING_BOUNDARY));
    const owner = buildNoGodmoddingBlock("A", "B", "standard");
    assert.match(owner, new RegExp(COLLABORATIVE_INTERACTIVE_OWNER_TITLE.replace(/[[\]]/g, "\\$&")));
    assert.doesNotMatch(owner, /CURRENT-TURN OOC DELEGATION/);
    assert.match(owner, /능동적으로 수행한다/);
  });

  it("injects the post-delegation sentence only when flagged", () => {
    const withBoundary = buildCurrentUserInputWrapper({
      mode: "interactive",
      postDelegationBoundary: true,
    });
    const without = buildCurrentUserInputWrapper({ mode: "interactive" });
    assert.equal(withBoundary.includes(POST_DELEGATION_AUTHORING_BOUNDARY), true);
    assert.equal(without.includes(POST_DELEGATION_AUTHORING_BOUNDARY), false);
    assert.equal(withBoundary.includes(without.split("\n").slice(0, 4).join("\n")), true);
  });

  it("persistent and turn-only coauthor owners do not include the standard owner", () => {
    const persistent = buildNoGodmoddingBlock("", "", "currentTurnDelegated", {
      currentTurnDelegation: {
        active: true,
        allowDialogue: true,
        allowMajorActions: true,
        source: "explicit_ooc",
        duration: "persistent",
      },
    });
    const turnOnly = buildNoGodmoddingBlock("", "", "currentTurnDelegated", {
      currentTurnDelegation: {
        active: true,
        allowDialogue: true,
        allowMajorActions: true,
        source: "explicit_ooc",
        duration: "turn",
      },
    });
    assert.match(persistent, /철회하기 전까지/);
    assert.match(turnOnly, /이번 턴에 한해/);
    assert.doesNotMatch(persistent, /COLLABORATIVE INTERACTIVE/);
    assert.doesNotMatch(turnOnly, /COLLABORATIVE INTERACTIVE/);
    assert.doesNotMatch(persistent, /INTERACTIVE USER OWNERSHIP — ABSOLUTE/);
  });

  it("buildContext persistent next turn uses one COAUTHOR owner and no STANDARD owner", () => {
    const built = buildContext({
      charName: "테스트_AI_캐릭터",
      chunks: [],
      userNickname: "테스트_유저_캐릭터",
      userPersona: "이름/호칭: 테스트_유저_캐릭터",
      shortTermHistory: [],
      currentUserMessage: "문을 연다.",
      currentTurnAuthoringDelegation: {
        active: true,
        allowDialogue: true,
        allowMajorActions: true,
        source: "explicit_ooc",
        duration: "persistent",
      },
      nsfw: false,
      provider: "openrouter",
      isContinue: false,
      novelModeEnabled: false,
      userImpersonation: false,
      personaDisplayName: "테스트_유저_캐릭터",
      completedTurns: 2,
    });
    assert.equal(built.meta.runtimeMode, "current_turn_ooc_delegated");
    assert.match(built.systemPrompt, new RegExp(CURRENT_TURN_OOC_DELEGATION_OWNER_TITLE.replace(/[[\]]/g, "\\$&")));
    assert.doesNotMatch(built.systemPrompt, /\[USER CONTROL — COLLABORATIVE INTERACTIVE\]/);
    const last = built.history[built.history.length - 1]?.content ?? "";
    assert.match(last, /ongoing persona co-authoring until revoked/);
    assert.doesNotMatch(last, new RegExp(POST_DELEGATION_AUTHORING_BOUNDARY));
  });

  it("buildContext post-delegation STANDARD turn injects one compact sentence only", () => {
    const built = buildContext({
      charName: "테스트_AI_캐릭터",
      chunks: [],
      userNickname: "테스트_유저_캐릭터",
      userPersona: "이름/호칭: 테스트_유저_캐릭터",
      shortTermHistory: [],
      currentUserMessage: H4_TURN_C,
      currentTurnAuthoringDelegation: {
        active: false,
        allowDialogue: false,
        allowMajorActions: false,
        source: null,
        postDelegationBoundary: true,
      },
      nsfw: false,
      provider: "openrouter",
      isContinue: false,
      novelModeEnabled: false,
      userImpersonation: false,
      personaDisplayName: "테스트_유저_캐릭터",
      completedTurns: 2,
    });
    assert.equal(built.meta.runtimeMode, "interactive");
    assert.match(built.systemPrompt, /\[USER CONTROL — COLLABORATIVE INTERACTIVE\]/);
    assert.doesNotMatch(built.systemPrompt, /CURRENT-TURN OOC DELEGATION/);
    const last = built.history[built.history.length - 1]?.content ?? "";
    assert.equal(last.includes(POST_DELEGATION_AUTHORING_BOUNDARY), true);
    assert.equal(last.split(POST_DELEGATION_AUTHORING_BOUNDARY).length - 1, 1);
  });

  it("natural-completion allowance remains on STANDARD", () => {
    const wrapper = wrapCurrentUserInput(STARTED_WALK, { mode: "interactive" });
    assert.match(wrapper, /natural completion of an already-started action/);
  });
});
