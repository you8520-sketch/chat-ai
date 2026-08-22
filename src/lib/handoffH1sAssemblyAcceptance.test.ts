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

const EVIDENCE = path.join(process.cwd(), "data/ds0813-phase-h1s-handoff-seam");

describe("H1S frozen #560 handoff assembly (no provider)", () => {
  it("proves single-owner H1S acceptance on exact T2 + current user", () => {
    const currentUser = JSON.parse(
      readFileSync(path.join(EVIDENCE, "source-fixtures/current-user.json"), "utf8")
    ) as { text: string };
    const t2 = readFileSync(
      path.join(EVIDENCE, "gemini-history/T2_GEMINI.txt"),
      "utf8"
    ).replace(/\r/g, "");
    const extracted = extractHandoffContinuityFromAssistantText({
      text: t2,
      characterName: "라이크",
      personaName: "렌",
      currentUserText: currentUser.text,
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
    assert.equal(
      (system.match(/현재 사용자 턴 전체가 최신 장면 상태다/g) ?? []).length,
      1
    );
    assert.match(system, /보이는 이야기 연속이다/);
    assert.match(system, /일반 지배적 성인 RP 말투로 바꾸지 않는다/);
    assert.match(system, /새 의도적 \[B\] 행동 사슬을 만들지 않는다/);
    assert.match(system, /같은 턴에서 \[B\]의 대답이나 대답 행동을 쓰지 않는다/);
    assert.match(system, /기능적 장소를 확정하지 않는다/);
    assert.doesNotMatch(system, /잘못된 의상/);
    assert.doesNotMatch(system, /직전 assistant 출력의 바로 다음 순간부터/);
    assert.equal(DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION.length <= 800, true);
  });
});
