/**
 * G10-SD1 API=0 matrix — Scene Pacing Controller.
 * No LLM calls. No production wire.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyScenePacingArmToMessages,
  isExternalCooldownActive,
  progressionTypesForCommit,
  renderCompactScenePacingCue,
  resolveScenePacingDecision,
  stripGenreSceneModePacingHint,
  type ScenePacingDecision,
} from "@/lib/scenePacingController";

function decide(
  partial: Parameters<typeof resolveScenePacingDecision>[0]
): ScenePacingDecision {
  return resolveScenePacingDecision(partial);
}

describe("G10-SD1 Scene Pacing Controller API=0", () => {
  it("A. standard single_primary calm → DYAD HOLD/AMBIENT, external ineligible", () => {
    const d = decide({
      contentKind: "character",
      primaryCharacterName: "에녹",
      currentUserMessage:
        "*렌이 소파 등받이에 기대며 컵을 내려놓는다.* 오늘은 좀 조용하네. 잠깐 이대로 있어도 돼?",
      recentMessages: [
        { role: "user", content: "여기 당분간 괜찮은 거지?" },
        {
          role: "assistant",
          content: "문은 잠겼다. 지금은 이동할 이유 없어.",
        },
      ],
      currentTurn: 5,
      progressionHistory: [],
    });
    assert.equal(d.pacingMode, "DYAD");
    assert.ok(d.motionLevel === "HOLD" || d.motionLevel === "AMBIENT");
    assert.equal(d.externalEligible, false);
    assert.equal(d.meaningfulBeatBudget, 1);
    assert.ok(!d.reasonCodes.includes("trigger_priority"));
  });

  it("B. established relationship → DYAD", () => {
    const d = decide({
      contentKind: "character",
      primaryCharacterName: "에녹",
      currentUserMessage: "고마워. 너도 잠깐은 숨 고를 수 있는 거야?",
      recentMessages: [
        { role: "user", content: "물 고마워" },
        { role: "assistant", content: "고르는 게 아니다. 질문은 나중에." },
      ],
      currentTurn: 4,
    });
    assert.equal(d.pacingMode, "DYAD");
  });

  it("C. private intimate scene → intimate DYAD, generated external ineligible", () => {
    const d = decide({
      contentKind: "character",
      primaryCharacterName: "에녹",
      adultModeEnabled: true,
      currentUserMessage: "*렌이 에녹의 입술에 가볍게 키스한다.* …이대로 있어도 돼?",
      recentMessages: [
        {
          role: "assistant",
          content: "에녹은 렌의 허리를 끌어당겨 밀착했다. 침대 옆 공기가 뜨거웠다.",
        },
      ],
      currentTurn: 6,
    });
    assert.equal(d.intimateDyad, true);
    assert.equal(d.pacingMode, "DYAD");
    assert.ok(d.motionLevel === "HOLD" || d.motionLevel === "AMBIENT");
    assert.equal(d.externalEligible, false);
    assert.ok(d.reasonCodes.includes("intimate_external_ineligible"));
  });

  it("adultMode alone does not force intimate dyad", () => {
    const d = decide({
      contentKind: "character",
      primaryCharacterName: "에녹",
      adultModeEnabled: true,
      currentUserMessage: "지도 다시 볼래?",
      recentMessages: [{ role: "assistant", content: "에녹은 지도를 펼쳤다." }],
      currentTurn: 3,
    });
    assert.equal(d.intimateDyad, false);
  });

  it("D. investigation → EXPLORATION, LOCAL eligible", () => {
    const d = decide({
      contentKind: "character",
      primaryCharacterName: "에녹",
      currentUserMessage:
        "*렌이 골목 입구의 안개 농도를 가늠하며 목소리를 낮춘다.* 이 쪽은… 좀 더 옅어 보이는데. 이쪽 괜찮아?",
      recentMessages: [
        { role: "user", content: "어디로 빠져나가?" },
        {
          role: "assistant",
          content: "말은 나중에. 발소리만 따라와. 저쪽 바람결이 바뀌었다.",
        },
      ],
      currentTurn: 5,
      progressionHistory: [{ turn: 4, types: ["relationship"] }],
    });
    assert.equal(d.pacingMode, "EXPLORATION");
    assert.ok(d.motionLevel === "LOCAL" || d.motionLevel === "EXTERNAL");
    assert.equal(d.meaningfulBeatBudget, 1);
  });

  it("E. active operation → OPERATION LOCAL/EXTERNAL", () => {
    const d = decide({
      contentKind: "character",
      primaryCharacterName: "에녹",
      currentUserMessage: "습격이다! 엄호해!",
      recentMessages: [
        {
          role: "assistant",
          content: "경보가 울렸다. 에녹은 전투 태세로 몸을 낮췄다.",
        },
      ],
      currentTurn: 8,
      progressionHistory: [],
    });
    assert.equal(d.pacingMode, "OPERATION");
    assert.ok(d.motionLevel === "LOCAL" || d.motionLevel === "EXTERNAL");
  });

  it("F. simulation → ENSEMBLE multi-beat freedom", () => {
    const d = decide({
      contentKind: "simulation",
      primaryCharacterName: "지휘관",
      establishedActiveCastNames: ["병사A", "병사B", "정찰대"],
      currentUserMessage: "전원 위치로.",
      currentTurn: 2,
    });
    assert.equal(d.pacingMode, "ENSEMBLE");
    assert.ok(d.meaningfulBeatBudget >= 2);
    assert.equal(d.externalEligible, true);
  });

  it("G. explicit triggered event → trigger priority preserved", () => {
    const d = decide({
      contentKind: "character",
      primaryCharacterName: "에녹",
      currentUserMessage: "소파에서 쉬자.",
      triggeredEventText: "트리거: 외부 습격 경보가 울린다. NPC 경비 출동.",
      currentTurn: 5,
      progressionHistory: [],
    });
    assert.equal(d.triggerActive, true);
    assert.ok(d.reasonCodes.includes("trigger_priority"));
    assert.ok(d.motionLevel === "LOCAL" || d.motionLevel === "EXTERNAL");
    assert.equal(d.primaryProgression, "consequence");
  });

  it("H. external cooldown N → N+1/N+2/N+3 blocked → N+4 eligible", () => {
    assert.equal(
      isExternalCooldownActive([{ turn: 10, types: ["world_reaction"] }], 11),
      true
    );
    assert.equal(
      isExternalCooldownActive([{ turn: 10, types: ["world_reaction"] }], 12),
      true
    );
    assert.equal(
      isExternalCooldownActive([{ turn: 10, types: ["world_reaction"] }], 13),
      true
    );
    assert.equal(
      isExternalCooldownActive([{ turn: 10, types: ["world_reaction"] }], 14),
      false
    );

    const blocked = decide({
      contentKind: "character",
      primaryCharacterName: "에녹",
      currentUserMessage: "습격 경로를 추적하자.",
      recentMessages: [
        { role: "assistant", content: "전투 흔적이 남아 있다. 추적을 이어간다." },
      ],
      currentTurn: 11,
      progressionHistory: [{ turn: 10, types: ["npc_action"] }],
    });
    assert.equal(blocked.externalCooldownActive, true);
    assert.notEqual(blocked.motionLevel, "EXTERNAL");

    const eligible = decide({
      contentKind: "character",
      primaryCharacterName: "에녹",
      currentUserMessage: "습격 경로를 추적하자.",
      recentMessages: [
        { role: "assistant", content: "전투 흔적이 남아 있다. 추적을 이어간다." },
      ],
      currentTurn: 14,
      progressionHistory: [{ turn: 10, types: ["npc_action"] }],
    });
    assert.equal(eligible.externalCooldownActive, false);
  });

  it("I. genre independence — apocalypse dinner DYAD/HOLD; romance attack OPERATION", () => {
    const dinner = decide({
      contentKind: "character",
      primaryCharacterName: "에녹",
      // Genre is NOT an input — apocalypse safe dinner from scene text only.
      currentUserMessage: "*렌이 식탁에 앉아 수프를 젓는다.* 오늘 저녁은 좀 괜찮네.",
      recentMessages: [
        {
          role: "assistant",
          content: "은신처 식탁에서 에녹은 수프를 밀어주었다. 바깥 안개는 먼 이야기였다.",
        },
      ],
      currentTurn: 3,
    });
    assert.equal(dinner.pacingMode, "DYAD");
    assert.ok(dinner.motionLevel === "HOLD" || dinner.motionLevel === "AMBIENT");

    const attack = decide({
      contentKind: "character",
      primaryCharacterName: "카엘",
      currentUserMessage: "적이 공격해 와!",
      recentMessages: [
        {
          role: "assistant",
          content: "경보가 울리고 습격이 시작됐다.",
        },
      ],
      currentTurn: 3,
    });
    assert.equal(attack.pacingMode, "OPERATION");
  });

  it("HOLD is valid — no forced external floor; commit has no EXTERNAL markers", () => {
    const d = decide({
      contentKind: "character",
      primaryCharacterName: "에녹",
      currentUserMessage: "잠깐 이대로 있어도 돼?",
      recentMessages: [
        { role: "assistant", content: "문은 잠겼다. 소파에 앉아 숨을 고른다." },
      ],
      currentTurn: 2,
    });
    assert.equal(d.motionLevel, "HOLD");
    const committed = progressionTypesForCommit(d);
    assert.ok(!committed.includes("npc_action"));
    assert.ok(!committed.includes("world_reaction"));
  });

  it("DYAD stagnation does not promote EXTERNAL", () => {
    const msgs = [
      { role: "user" as const, content: "응." },
      { role: "assistant" as const, content: "괜찮아. 걱정하지 마. 말하지 않아도 돼." },
      { role: "user" as const, content: "…" },
      { role: "assistant" as const, content: "미안. 괜찮으니까. 침묵해도 돼." },
      { role: "user" as const, content: "응." },
      { role: "assistant" as const, content: "걱정하지 마. 괜찮아." },
      { role: "user" as const, content: "응." },
      { role: "assistant" as const, content: "말하지 않아도 돼. 괜찮으니까." },
    ];
    const d = decide({
      contentKind: "character",
      primaryCharacterName: "에녹",
      currentUserMessage: "그냥 옆에 있을게.",
      recentMessages: msgs,
      currentTurn: 9,
    });
    assert.equal(d.pacingMode, "DYAD");
    assert.notEqual(d.motionLevel, "EXTERNAL");
    assert.equal(d.externalEligible, false);
  });

  it("compact renderer has no legacy BASE engine pressure / no negative list", () => {
    const d = decide({
      contentKind: "character",
      primaryCharacterName: "에녹",
      currentUserMessage: "잠깐 이대로 있어도 돼?",
      currentTurn: 1,
    });
    const cue = renderCompactScenePacingCue(d);
    assert.match(cue, /\[SCENE PACING\]/);
    assert.doesNotMatch(cue, /추천 강도|피해야|다음 비트/);
    assert.doesNotMatch(cue, /사건 만들지|위기 금지|전투 금지/);
    assert.doesNotMatch(
      cue,
      /관계, 단서, 환경, NPC, 세계 반응/
    );
  });

  it("genre SCENE MODE strip for candidate", () => {
    const src = `[RUNTIME STYLE]
[genre_tone] 아포칼립스: cold survival.
[SCENE MODE] 아포칼립스 → tension (pacing hint for [SCENE FLOW] only — not a cue to shorten).

[IMMERSIVE PROSE]
ok`;
    const stripped = stripGenreSceneModePacingHint(src);
    assert.doesNotMatch(stripped, /\[SCENE MODE\]/);
    assert.match(stripped, /\[IMMERSIVE PROSE\]/);
  });

  it("Arm P inserts compact cue; Arm A untouched; no legacy verbose block", () => {
    const d = decide({
      contentKind: "character",
      primaryCharacterName: "에녹",
      currentUserMessage: "잠깐 이대로 있어도 돼?",
      currentTurn: 1,
    });
    const base = [
      {
        role: "system",
        content: `[CORE RP]\nok\n[SCENE FLOW]\npace\n[IMMERSIVE PROSE]\nimm`,
      },
      { role: "user", content: "hi" },
    ];
    const A = applyScenePacingArmToMessages({
      messages: base,
      arm: "A",
      decision: d,
    });
    const P = applyScenePacingArmToMessages({
      messages: base,
      arm: "P",
      decision: d,
    });
    assert.equal(A.insertedCue, false);
    assert.equal(P.insertedCue, true);
    assert.match(P.systemText, /\[SCENE PACING\]/);
    assert.doesNotMatch(P.systemText, /PRIVATE SCENE ENGINE RULE/);
    assert.equal(A.systemText.includes("[SCENE PACING]"), false);
  });

  it("single_primary meaningful beat budget is max 1", () => {
    const d = decide({
      contentKind: "character",
      primaryCharacterName: "에녹",
      currentUserMessage: "골목 쪽 단서를 조사하자.",
      currentTurn: 2,
    });
    assert.equal(d.castMode, "single_primary");
    assert.equal(d.meaningfulBeatBudget, 1);
  });
});
