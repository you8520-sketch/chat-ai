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

const EVIDENCE = path.join(process.cwd(), "data/ds0813-phase-h1r-handoff-seam");

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

describe("H1R frozen #560 handoff assembly (no provider)", () => {
  it("omits stale heuristic packet fields on exact T2 + current user", () => {
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
    assert.equal("location" in packet, false);
    assert.equal("positions" in packet, false);
    assert.equal("unfinishedAction" in packet, false);
    assert.equal("currentSpeechState" in packet, false);
    const system = appendAdultHandoffPrompt("SYSTEM", packet);
    assert.match(system, /보이는 이야기 연속이다/);
    assert.match(system, /현재 사용자 턴 전체가 최신 장면 상태다/);
    assert.doesNotMatch(system, /잘못된 의상/);
    assert.doesNotMatch(system, /직전 assistant 출력의 바로 다음 순간부터/);
    assert.equal(
      (system.match(/현재 사용자 턴 전체가 최신 장면 상태다/g) ?? []).length,
      1
    );
    assert.equal(DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION.length < 900, true);
  });
});
