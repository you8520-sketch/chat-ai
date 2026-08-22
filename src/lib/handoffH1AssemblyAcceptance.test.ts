import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  appendAdultHandoffPrompt,
  buildSceneContinuityPacket,
  DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION,
  extractHandoffContinuityFromAssistantText,
} from "@/lib/adultSceneRouting";
import {
  CURRENT_USER_AGENCY_REINFORCEMENT_OWNER,
  wrapCurrentUserInput,
} from "@/lib/currentUserInputLabel";
import {
  COLLABORATIVE_INTERACTIVE_OWNER_BLOCK,
  STANDARD_AGENCY_ALLOWED_EXCEPTIONS,
  STANDARD_AGENCY_CANONICAL_OWNER,
  STANDARD_AGENCY_FORBIDDEN_NEW_B,
  buildNoGodmoddingBlock,
} from "@/lib/noGodmodding";

const ROOT = process.cwd();
const EVIDENCE = path.join(ROOT, "data/ds0813-phase-h1-handoff-authority");

function loadFrozen560() {
  const currentUser = JSON.parse(
    readFileSync(path.join(EVIDENCE, "source-fixtures/current-user.json"), "utf8")
  ) as { text: string };
  const t2 = readFileSync(
    path.join(EVIDENCE, "gemini-history/T2_GEMINI.txt"),
    "utf8"
  ).replace(/\r/g, "");
  return { currentUserText: currentUser.text, t2 };
}

describe("H1 frozen #560 assembly acceptance (no provider)", () => {
  it("drops stale heuristic packet fields on the exact #560 T2 + current user", () => {
    const { currentUserText, t2 } = loadFrozen560();
    const extracted = extractHandoffContinuityFromAssistantText({
      text: t2,
      characterName: "라이크",
      personaName: "렌",
      currentUserText,
    });
    const packet = buildSceneContinuityPacket({
      previousSceneMode: "normal",
      sexualContextActive: true,
      activeConsentMode: "standard",
      charactersPresent: ["라이크", "렌"],
      currentPov: "third_person",
      sceneReset: false,
      ...extracted,
    });
    assert.equal("location" in packet, false);
    assert.equal("positions" in packet, false);
    assert.equal("unfinishedAction" in packet, false);
    assert.equal("currentSpeechState" in packet, false);
    const rendered = JSON.stringify(packet);
    assert.doesNotMatch(rendered, /벽면의 안내판을 훑고 지나갔다/);
    assert.doesNotMatch(rendered, /같이 갈래\?/);
    assert.doesNotMatch(rendered, /형광 라인이 긴 복도/);
  });

  it("handoff contract cannot rewind or outrank the current user turn", () => {
    const { currentUserText, t2 } = loadFrozen560();
    const extracted = extractHandoffContinuityFromAssistantText({
      text: t2,
      characterName: "라이크",
      personaName: "렌",
      currentUserText,
    });
    const packet = buildSceneContinuityPacket({
      previousSceneMode: "normal",
      sexualContextActive: true,
      activeConsentMode: "standard",
      charactersPresent: ["라이크", "렌"],
      currentPov: "third_person",
      ...extracted,
    });
    const system = appendAdultHandoffPrompt(
      COLLABORATIVE_INTERACTIVE_OWNER_BLOCK,
      packet
    );
    const wrapper = wrapCurrentUserInput(currentUserText, { mode: "interactive" });
    assert.equal(wrapper.includes(currentUserText), true);
    assert.match(system, /현재 사용자 턴 전체가 최신 장면 상태다/);
    assert.match(system, /사용자 턴을 자르거나 다시 해석하지 않는다/);
    assert.doesNotMatch(system, /직전 assistant 출력의 바로 다음 순간부터/);
    assert.doesNotMatch(system, /최대한 유지/);
    assert.doesNotMatch(system, /완료되지 않은 행동이나 대화가 있다면/);
    assert.doesNotMatch(
      DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION,
      /직전 출력의 바로 다음 순간/
    );
    assert.equal(STANDARD_AGENCY_CANONICAL_OWNER, "[USER CONTROL — COLLABORATIVE INTERACTIVE]");
    assert.equal(CURRENT_USER_AGENCY_REINFORCEMENT_OWNER, "CURRENT_USER_COLLABORATIVE_WRAPPER");
    assert.equal(system.includes(STANDARD_AGENCY_FORBIDDEN_NEW_B), true);
    assert.equal(wrapper.includes(STANDARD_AGENCY_FORBIDDEN_NEW_B), true);
    assert.equal(system.includes(STANDARD_AGENCY_ALLOWED_EXCEPTIONS), true);
    assert.equal(wrapper.includes(STANDARD_AGENCY_ALLOWED_EXCEPTIONS), true);
    assert.doesNotMatch(system, /사소한 이동·접촉·물건 수취·일상 행동은 공동 서술할 수 있다/);
    assert.doesNotMatch(wrapper, /사소한 이동·접촉·물건 수취·일상 행동은 공동 서술할 수 있다/);
    assert.doesNotMatch(wrapper, /small movement\/contact\/object-handling\/daily continuity may be co-narrated/);
    const coauthor = buildNoGodmoddingBlock("", "", "currentTurnDelegated", {
      currentTurnDelegation: {
        active: true,
        allowDialogue: true,
        allowMajorActions: true,
        source: "explicit_ooc",
        duration: "persistent",
      },
    });
    assert.match(coauthor, /CURRENT-TURN OOC DELEGATION/);
    assert.doesNotMatch(coauthor, /\[USER CONTROL — COLLABORATIVE INTERACTIVE\]/);
  });
});
