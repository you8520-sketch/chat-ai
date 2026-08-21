import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractLeadingOocSegment,
  resolveCurrentTurnUserAuthoringDelegation,
} from "@/lib/currentTurnUserAuthoringDelegation";

const PERSONA_TRAIT = "상대에게 '네가 알아서 해'라고 자주 말한다.";

describe("resolveCurrentTurnUserAuthoringDelegation", () => {
  it("TEST A — ordinary manual input is inactive", () => {
    const d = resolveCurrentTurnUserAuthoringDelegation({ currentUserInput: "안녕." });
    assert.equal(d.active, false);
    assert.equal(d.allowDialogue, false);
    assert.equal(d.allowMajorActions, false);
    assert.equal(d.source, null);
  });

  it("TEST B — dialogue-only current-turn OOC", () => {
    const d = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: "OOC: 내 대사도 페르소나에 맞춰서 써줘.\n*그를 바라본다.*",
    });
    assert.equal(d.active, true);
    assert.equal(d.allowDialogue, true);
    assert.equal(d.allowMajorActions, false);
    assert.equal(d.source, "explicit_ooc");
  });

  it("TEST C — action-only current-turn OOC", () => {
    const d = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: "OOC: 내 행동도 알아서 진행해.",
    });
    assert.equal(d.active, true);
    assert.equal(d.allowDialogue, false);
    assert.equal(d.allowMajorActions, true);
  });

  it("TEST D — dialogue + action current-turn OOC", () => {
    const d = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput:
        "OOC: 유저대사를 유저페르소나 성격에 맞춰서\n자동서술하며 턴을 진행한다.",
    });
    assert.equal(d.active, true);
    assert.equal(d.allowDialogue, true);
    assert.equal(d.allowMajorActions, true);
  });

  it("TEST E — in-character dialogue is not delegation", () => {
    const d = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: '"네가 알아서 해."',
    });
    assert.equal(d.active, false);
    assert.equal(d.source, null);
  });

  it("TEST F — OOC without authoring intent is inactive", () => {
    const d = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: "OOC: 지금 장면은 낮이야.",
    });
    assert.equal(d.active, false);
  });

  it("TEST H — no persistence across turns", () => {
    const turnN = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: "OOC: 내 대사랑 행동도 알아서 써줘.",
    });
    const turnN1 = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: "고개를 끄덕인다.",
    });
    assert.equal(turnN.active, true);
    assert.equal(turnN.allowDialogue, true);
    assert.equal(turnN.allowMajorActions, true);
    assert.equal(turnN1.active, false);
  });

  it("critical negative — persona trait text is never a delegation signal", () => {
    assert.equal(
      resolveCurrentTurnUserAuthoringDelegation({ currentUserInput: PERSONA_TRAIT }).active,
      false
    );
    assert.equal(
      resolveCurrentTurnUserAuthoringDelegation({ currentUserInput: "안녕." }).active,
      false
    );
    assert.equal(extractLeadingOocSegment(PERSONA_TRAIT), null);
  });

  it("does not infer from ordinary IC phrases", () => {
    for (const input of [
      "네가 알아서 해.",
      "마음대로 해.",
      "네가 정해.",
      "하고 싶은 대로 해.",
    ]) {
      assert.equal(
        resolveCurrentTurnUserAuthoringDelegation({ currentUserInput: input }).active,
        false,
        input
      );
    }
  });

  it("does not activate from 대사/행동/페르소나 without authoring verbs", () => {
    assert.equal(
      resolveCurrentTurnUserAuthoringDelegation({
        currentUserInput: "OOC: 내 대사 톤은 짧게.",
      }).active,
      false
    );
    assert.equal(
      resolveCurrentTurnUserAuthoringDelegation({
        currentUserInput: "OOC: 행동 묘사는 천천히.",
      }).active,
      false
    );
    assert.equal(
      resolveCurrentTurnUserAuthoringDelegation({
        currentUserInput: "OOC: 페르소나 성격 유지.",
      }).active,
      false
    );
  });

  it("does not scan non-leading RP OOC", () => {
    const d = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: '*그를 바라본다.*\nOOC: 내 대사도 써줘.',
    });
    assert.equal(d.active, false);
  });

  it("recognizes common leading OOC markers", () => {
    const bodies = [
      "OOC: 내 대사도 써줘.",
      "OOC： 내 대사도 써줘.",
      "[OOC] 내 대사도 써줘.",
      "(OOC) 내 대사도 써줘.",
      "【OOC】 내 대사도 써줘.",
      "  OOC: 내 대사도 써줘.",
    ];
    for (const input of bodies) {
      const d = resolveCurrentTurnUserAuthoringDelegation({ currentUserInput: input });
      assert.equal(d.active, true, input);
      assert.equal(d.allowDialogue, true, input);
      assert.equal(d.allowMajorActions, false, input);
    }
  });

  it("scope A — dialogue-only with retained actions", () => {
    const d = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: "OOC: 내 대사만 페르소나대로 써줘.\n행동은 내가 할게.",
    });
    assert.deepEqual(
      { active: d.active, allowDialogue: d.allowDialogue, allowMajorActions: d.allowMajorActions },
      { active: true, allowDialogue: true, allowMajorActions: false }
    );
  });

  it("scope B — action-only with retained dialogue", () => {
    const d = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: "OOC: 내 행동만 알아서 진행해.\n대사는 내가 쓸게.",
    });
    assert.deepEqual(
      { active: d.active, allowDialogue: d.allowDialogue, allowMajorActions: d.allowMajorActions },
      { active: true, allowDialogue: false, allowMajorActions: true }
    );
  });

  it("scope C — explicit action denial", () => {
    const d = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: "OOC: 내 대사는 써줘. 행동은 쓰지 마.",
    });
    assert.deepEqual(
      { active: d.active, allowDialogue: d.allowDialogue, allowMajorActions: d.allowMajorActions },
      { active: true, allowDialogue: true, allowMajorActions: false }
    );
  });

  it("scope D — explicit dialogue denial", () => {
    const d = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: "OOC: 내 행동은 진행해줘. 대사는 쓰지 마.",
    });
    assert.deepEqual(
      { active: d.active, allowDialogue: d.allowDialogue, allowMajorActions: d.allowMajorActions },
      { active: true, allowDialogue: false, allowMajorActions: true }
    );
  });

  it("full delegation still grants both scopes", () => {
    for (const input of [
      "OOC: 내 대사랑 행동도 알아서 진행해.",
      "OOC: 유저 페르소나도 네가 알아서 진행해.",
      "OOC: 유저대사를 유저페르소나 성격에 맞춰서\n자동서술하며 턴을 진행한다.",
    ]) {
      const d = resolveCurrentTurnUserAuthoringDelegation({ currentUserInput: input });
      assert.deepEqual(
        { active: d.active, allowDialogue: d.allowDialogue, allowMajorActions: d.allowMajorActions },
        { active: true, allowDialogue: true, allowMajorActions: true },
        input
      );
    }
  });

  it("TEST J — action delegated, dialogue retained with 대사만 내가", () => {
    const d = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: "OOC: 내 행동은 네가 알아서 진행해.\n대사만 내가 쓸게.",
    });
    assert.deepEqual(
      { active: d.active, allowDialogue: d.allowDialogue, allowMajorActions: d.allowMajorActions },
      { active: true, allowDialogue: false, allowMajorActions: true }
    );
  });

  it("TEST K — dialogue delegated, action retained with 행동만 내가", () => {
    const d = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: "OOC: 내 대사는 네가 알아서 써줘.\n행동만 내가 할게.",
    });
    assert.deepEqual(
      { active: d.active, allowDialogue: d.allowDialogue, allowMajorActions: d.allowMajorActions },
      { active: true, allowDialogue: true, allowMajorActions: false }
    );
  });

  it("TEST L — full persona grant, dialogue retained", () => {
    const d = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: "OOC: 유저 페르소나도 네가 알아서 진행해.\n대사만 내가 쓸게.",
    });
    assert.deepEqual(
      { active: d.active, allowDialogue: d.allowDialogue, allowMajorActions: d.allowMajorActions },
      { active: true, allowDialogue: false, allowMajorActions: true }
    );
  });

  it("TEST M — full persona grant, action retained", () => {
    const d = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: "OOC: 유저 페르소나도 네가 알아서 진행해.\n행동만 내가 할게.",
    });
    assert.deepEqual(
      { active: d.active, allowDialogue: d.allowDialogue, allowMajorActions: d.allowMajorActions },
      { active: true, allowDialogue: true, allowMajorActions: false }
    );
  });

  it("TEST N — 내 대사만 네가 써줘 is AI dialogue exclusive", () => {
    const d = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: "OOC: 내 대사만 네가 써줘.",
    });
    assert.equal(d.active, true);
    assert.equal(d.allowDialogue, true);
    assert.equal(d.allowMajorActions, false);
  });

  it("TEST O — 내 행동만 네가 진행해 is AI action exclusive", () => {
    const d = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: "OOC: 내 행동만 네가 진행해.",
    });
    assert.equal(d.active, true);
    assert.equal(d.allowDialogue, false);
    assert.equal(d.allowMajorActions, true);
  });

  it("TEST P — 대사만 내가 쓸게 is retain-only, no delegation", () => {
    const d = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: "OOC: 대사만 내가 쓸게.",
    });
    assert.equal(d.active, false);
    assert.equal(d.allowDialogue, false);
    assert.equal(d.allowMajorActions, false);
  });

  it("TEST Q — 행동만 내가 할게 is retain-only, no delegation", () => {
    const d = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: "OOC: 행동만 내가 할게.",
    });
    assert.equal(d.active, false);
    assert.equal(d.allowDialogue, false);
    assert.equal(d.allowMajorActions, false);
  });

  it("supports listed dialogue / action / full scopes", () => {
    const dialogue = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: "OOC: 렌 대사는 네가 알아서 해.",
    });
    assert.deepEqual(
      { active: dialogue.active, allowDialogue: dialogue.allowDialogue, allowMajorActions: dialogue.allowMajorActions },
      { active: true, allowDialogue: true, allowMajorActions: false }
    );

    const actions = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: "OOC: 렌 행동은 네가 써줘.",
    });
    assert.deepEqual(
      { active: actions.active, allowDialogue: actions.allowDialogue, allowMajorActions: actions.allowMajorActions },
      { active: true, allowDialogue: false, allowMajorActions: true }
    );

    const both = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: "OOC: 유저 페르소나도 네가 알아서 진행해.",
    });
    assert.deepEqual(
      { active: both.active, allowDialogue: both.allowDialogue, allowMajorActions: both.allowMajorActions },
      { active: true, allowDialogue: true, allowMajorActions: true }
    );
  });

  it("H1 — natural-Korean 출력/서술 OOC with specified user action", () => {
    const d = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput:
        "OOC: 유저의 대사를 페르소나 참고해서 출력해주고 유저가 캐릭터에게 삽입하는 장면과 캐릭터의 반응을 서술하라",
    });
    assert.equal(d.active, true);
    assert.equal(d.allowDialogue, true);
    assert.equal(d.allowMajorActions, true);
  });

  it("H1 — 페르소나 참고만 해 is not delegation", () => {
    assert.equal(
      resolveCurrentTurnUserAuthoringDelegation({
        currentUserInput: "OOC: 페르소나를 참고만 해.",
      }).active,
      false
    );
  });
});
