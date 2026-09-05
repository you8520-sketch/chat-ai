/**
 * G10-SD1 API=0 matrix — Scene Pacing Controller.
 * No LLM calls. No production wire.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendTerminalDialogueBudgetToUserTurn,
  applyScenePacingArmToMessages,
  countDialogueBlockOwners,
  countPacingOwners,
  countTerminalDialogueBudgetOwners,
  DIALOGUE_BLOCK_CAP_PARAGRAPH,
  isExternalCooldownActive,
  progressionTypesForCommit,
  renderCompactScenePacingCue,
  renderCompactSceneStateEnvelope,
  renderDialogueBlockCapOwner,
  renderTerminalDialogueBudgetOwner,
  resolveCommunicationDemand,
  resolveScenePacingDecision,
  resolveSceneStateAuthority,
  resolveTerminalDialogueBudget,
  stripGenreSceneModePacingHint,
  TERMINAL_DIALOGUE_BUDGET_OWNER,
  type ScenePacingDecision,
} from "@/lib/scenePacingController";
import { SCENE_FLOW_BLOCK } from "@/lib/generationProcessBeatFlow";
import { DIALOGUE_NARRATION_STRUCTURE_RULE } from "@/lib/webnovelOutputFormat";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "@/lib/responseLength";
import { CURRENT_USER_INPUT_HEADER } from "@/lib/currentUserInputLabel";

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
        content: `[CORE RP]\nok\n${SCENE_FLOW_BLOCK}\n[IMMERSIVE PROSE]\nimm`,
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
    assert.match(P.systemText, /\[SCENE FLOW\]/);
    assert.doesNotMatch(P.systemText, /PRIVATE SCENE ENGINE RULE/);
    assert.equal(A.systemText.includes("[SCENE PACING]"), false);
    assert.equal(countPacingOwners(P.systemText).pacing_sot_count, 2);
  });

  it("G10-SD2 Arm Q REPLACES SCENE FLOW — pacing SoT = 1", () => {
    const d = decide({
      contentKind: "character",
      primaryCharacterName: "에녹",
      currentUserMessage: "잠깐 이대로 있어도 돼?",
      currentTurn: 1,
    });
    const base = [
      {
        role: "system",
        content: `[CORE RP]\nok\n${SCENE_FLOW_BLOCK}\n[IMMERSIVE PROSE]\nimm`,
      },
      { role: "user", content: "hi" },
    ];
    const P = applyScenePacingArmToMessages({
      messages: base,
      arm: "P",
      decision: d,
    });
    const Q = applyScenePacingArmToMessages({
      messages: base,
      arm: "Q",
      decision: d,
    });
    const ownP = countPacingOwners(P.systemText);
    const ownQ = countPacingOwners(Q.systemText);
    assert.equal(Q.replacedSceneFlow, true);
    assert.equal(ownQ.scene_pacing, 1);
    assert.equal(ownQ.scene_flow, 0);
    assert.equal(ownQ.genre_scene_mode, 0);
    assert.equal(ownQ.pacing_sot_count, 1);
    assert.equal(ownP.pacing_sot_count, 2);
    assert.ok(Q.systemText.length <= P.systemText.length);
    // Cue wording identical (HOLD) — motion only; response-axis is terminal-owned
    assert.equal(
      renderCompactScenePacingCue(d),
      `[SCENE PACING]\n현재 두 인물의 상호작용을 중심으로 관계·내면·행동·감각을 전개한다. 주변 인물·환경의 짧은 반응이나 작은 마찰은 이 중심축에 자연스럽게 흡수한다.`
    );
    assert.doesNotMatch(renderCompactScenePacingCue(d), /여러 독립 결정/);
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

  it("G10-SD3 Arm R REPLACES SCENE FLOW with [SCENE STATE] authority envelope", () => {
    const d = decide({
      contentKind: "character",
      primaryCharacterName: "에녹",
      currentUserMessage: "잠깐 이대로 있어도 돼?",
      recentMessages: [
        { role: "assistant", content: "문은 잠겼다. 소파에 앉아 숨을 고른다." },
      ],
      currentTurn: 1,
    });
    assert.equal(d.pacingMode, "DYAD");
    assert.equal(d.motionLevel, "HOLD");
    const auth = resolveSceneStateAuthority(d);
    assert.equal(auth.externalContinuity, "PRESERVE");
    assert.equal(auth.canonRole, "POSSIBILITY_AND_CONSTRAINT");
    assert.ok(auth.transitionDomains.includes("relationship"));
    assert.ok(auth.transitionDomains.includes("ai_interior"));

    const cue = renderCompactSceneStateEnvelope(d);
    assert.match(cue, /\[SCENE STATE\]/);
    assert.doesNotMatch(cue, /\[SCENE PACING\]/);
    assert.doesNotMatch(cue, /괴물 만들지|위협 추가|NPC 등장 금지|NEVER|하지 마/);
    assert.match(cue, /정본은 가능한 세계 규칙/);
    assert.match(cue, /외부 상태: 현재 성립한 상태를 이어간다/);

    const base = [
      {
        role: "system",
        content: `[CORE RP]\nok\n${SCENE_FLOW_BLOCK}\n[IMMERSIVE PROSE]\nimm`,
      },
      { role: "user", content: "hi" },
    ];
    const Q = applyScenePacingArmToMessages({
      messages: base,
      arm: "Q",
      decision: d,
    });
    const R = applyScenePacingArmToMessages({
      messages: base,
      arm: "R",
      decision: d,
    });
    const ownQ = countPacingOwners(Q.systemText);
    const ownR = countPacingOwners(R.systemText);
    assert.equal(R.replacedSceneFlow, true);
    assert.equal(ownR.scene_state, 1);
    assert.equal(ownR.scene_pacing, 0);
    assert.equal(ownR.scene_flow, 0);
    assert.equal(ownR.genre_scene_mode, 0);
    assert.equal(ownR.pacing_sot_count, 1);
    assert.equal(ownQ.scene_pacing, 1);
    assert.equal(ownQ.scene_state, 0);
    // Cue renderer differs; controller decision object is unchanged caller-side.
    assert.notEqual(Q.systemText, R.systemText);
    assert.match(R.systemText, /\[SCENE STATE\]/);
    assert.doesNotMatch(R.systemText, /\[SCENE PACING\]/);
  });

  it("G10-SD3 LOCAL envelope allows local change scope", () => {
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
    assert.equal(d.motionLevel, "LOCAL");
    const auth = resolveSceneStateAuthority(d);
    assert.equal(auth.externalContinuity, "LOCAL_CHANGE");
    const cue = renderCompactSceneStateEnvelope(d);
    assert.match(cue, /국소 변화|정보\/결과 하나/);
    assert.doesNotMatch(cue, /괴물|위협 금지/);
  });

  it("G10-D1 Arm T = Q + single_primary [대화 운용]; no % quota; SoT pacing=1", () => {
    const d = decide({
      contentKind: "character",
      primaryCharacterName: "에녹",
      currentUserMessage: "잠깐 이대로 있어도 돼?",
      recentMessages: [
        { role: "assistant", content: "문은 잠겼다. 소파에 앉아 숨을 고른다." },
      ],
      currentTurn: 1,
    });
    assert.equal(d.castMode, "single_primary");
    const owner = renderDialogueBlockCapOwner();
    assert.match(owner, /\[대화 운용\]/);
    assert.match(owner, /최대 4개/);
    assert.ok(owner.includes(DIALOGUE_BLOCK_CAP_PARAGRAPH));
    assert.doesNotMatch(owner, /대사\s*\d+\s*%|지문\s*\d+\s*%/);

    const base = [
      {
        role: "system",
        content: `[CORE RP]\nok\n${SCENE_FLOW_BLOCK}\n[IMMERSIVE PROSE]\nimm\n${DIALOGUE_NARRATION_STRUCTURE_RULE}\n[LENGTH]\nlen`,
      },
      { role: "user", content: "hi" },
    ];
    const Q = applyScenePacingArmToMessages({
      messages: base,
      arm: "Q",
      decision: d,
    });
    const T = applyScenePacingArmToMessages({
      messages: base,
      arm: "T",
      decision: d,
    });
    const ownQ = countPacingOwners(Q.systemText);
    const ownT = countPacingOwners(T.systemText);
    const dialQ = countDialogueBlockOwners(Q.systemText);
    const dialT = countDialogueBlockOwners(T.systemText);
    assert.equal(T.replacedSceneFlow, true);
    assert.equal(T.dialogueBlockCapIntegrated, true);
    assert.equal(ownT.scene_pacing, 1);
    assert.equal(ownT.scene_flow, 0);
    assert.equal(ownT.scene_state, 0);
    assert.equal(ownT.pacing_sot_count, 1);
    assert.equal(ownQ.pacing_sot_count, 1);
    assert.equal(dialT.dialogue_block_owner, 1);
    assert.equal(dialT.dialogue_narration_owner, 0);
    assert.equal(dialT.numeric_dialogue_percentage, 0);
    assert.equal(dialQ.dialogue_block_owner, 0);
    assert.equal(dialQ.dialogue_narration_owner, 1);
    assert.match(T.systemText, /\[SCENE PACING\]/);
    assert.doesNotMatch(T.systemText, /\[SCENE STATE\]/);
    assert.doesNotMatch(T.systemText, /\[DIALOGUE & NARRATION\]/);
  });

  it("G10-D1 dialogue block cap skipped for simulation / party ensemble", () => {
    const sim = decide({
      contentKind: "simulation",
      primaryCharacterName: "지휘관",
      establishedActiveCastNames: ["병사A", "병사B", "정찰대"],
      currentUserMessage: "전원 위치로.",
      currentTurn: 2,
    });
    assert.equal(sim.pacingMode, "ENSEMBLE");
    const party = decide({
      contentKind: "character",
      party: true,
      primaryCharacterName: "에녹",
      establishedActiveCastNames: ["에녹", "렌", "동료"],
      currentUserMessage: "다들 준비됐지?",
      currentTurn: 2,
    });
    assert.equal(party.pacingMode, "ENSEMBLE");

    const base = [
      {
        role: "system",
        content: `[CORE RP]\nok\n${SCENE_FLOW_BLOCK}\n${DIALOGUE_NARRATION_STRUCTURE_RULE}\n`,
      },
    ];
    const Tsim = applyScenePacingArmToMessages({
      messages: base,
      arm: "T",
      decision: sim,
    });
    const Tparty = applyScenePacingArmToMessages({
      messages: base,
      arm: "T",
      decision: party,
    });
    assert.equal(Tsim.dialogueBlockCapIntegrated, false);
    assert.equal(Tparty.dialogueBlockCapIntegrated, false);
    assert.equal(countDialogueBlockOwners(Tsim.systemText).dialogue_block_owner, 0);
    assert.equal(countDialogueBlockOwners(Tparty.systemText).dialogue_block_owner, 0);
    assert.match(Tsim.systemText, /\[DIALOGUE & NARRATION\]/);
    assert.match(Tparty.systemText, /\[DIALOGUE & NARRATION\]/);
  });

  it("G10-D2 Arm U = Q + terminal dialogue budget; system cap=0", () => {
    const d = decide({
      contentKind: "character",
      primaryCharacterName: "에녹",
      currentUserMessage: "잠깐 이대로 있어도 돼?",
      recentMessages: [
        { role: "assistant", content: "문은 잠겼다. 소파에 앉아 숨을 고른다." },
      ],
      currentTurn: 1,
    });
    assert.equal(d.castMode, "single_primary");
    assert.match(TERMINAL_DIALOGUE_BUDGET_OWNER, /\[이번 응답 대화\]/);
    assert.match(TERMINAL_DIALOGUE_BUDGET_OWNER, /최대 4개/);
    assert.doesNotMatch(TERMINAL_DIALOGUE_BUDGET_OWNER, /대사\s*\d+\s*%|지문\s*\d+\s*%|의도|function/i);

    const userBody =
      `${CURRENT_USER_INPUT_HEADER}\n` +
      `The following is the user's latest input.\n\n` +
      `*렌이 소파에 기대며 컵을 내려놓는다.* 잠깐 이대로 있어도 돼?\n\n` +
      `레이아웃: 지문과 "…" 대사 사이 빈 줄\n\n` +
      `${USER_TAIL_LENGTH_OWNER_SENTENCE}`;

    const base = [
      {
        role: "system",
        content: `[CORE RP]\nok\n${SCENE_FLOW_BLOCK}\n${DIALOGUE_NARRATION_STRUCTURE_RULE}\n`,
      },
      { role: "user", content: userBody },
    ];
    const Q = applyScenePacingArmToMessages({
      messages: base,
      arm: "Q",
      decision: d,
    });
    const U = applyScenePacingArmToMessages({
      messages: base,
      arm: "U",
      decision: d,
    });
    const dialSysU = countDialogueBlockOwners(U.systemText);
    const termQ = countTerminalDialogueBudgetOwners(Q.lastUserContent);
    const termU = countTerminalDialogueBudgetOwners(U.lastUserContent);
    assert.equal(U.replacedSceneFlow, true);
    assert.equal(U.dialogueBlockCapIntegrated, false);
    assert.equal(U.terminalDialogueBudgetAppended, true);
    assert.equal(countPacingOwners(U.systemText).scene_pacing, 1);
    assert.equal(countPacingOwners(U.systemText).scene_flow, 0);
    assert.equal(dialSysU.dialogue_block_owner, 0);
    assert.equal(dialSysU.dialogue_narration_owner, 1);
    assert.equal(termQ.terminal_dialogue_budget_owner, 0);
    assert.equal(termU.terminal_dialogue_budget_owner, 1);
    assert.equal(termU.numeric_dialogue_percentage, 0);
    // Must sit outside the user RP body, while the length owner remains the
    // absolute end of the current user turn.
    assert.ok(U.lastUserContent.includes(USER_TAIL_LENGTH_OWNER_SENTENCE));
    assert.ok(
      U.lastUserContent.indexOf("[이번 응답 대화]") <
        U.lastUserContent.indexOf(USER_TAIL_LENGTH_OWNER_SENTENCE)
    );
    assert.ok(U.lastUserContent.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE));
    assert.ok(
      U.lastUserContent.indexOf(CURRENT_USER_INPUT_HEADER) <
        U.lastUserContent.indexOf("[이번 응답 대화]")
    );
    assert.notEqual(Q.lastUserContent, U.lastUserContent);
  });

  it("G10-D2 terminal budget skipped for simulation / party", () => {
    const sim = decide({
      contentKind: "simulation",
      primaryCharacterName: "지휘관",
      establishedActiveCastNames: ["병사A", "병사B", "정찰대"],
      currentUserMessage: "전원 위치로.",
      currentTurn: 2,
    });
    const party = decide({
      contentKind: "character",
      party: true,
      primaryCharacterName: "에녹",
      establishedActiveCastNames: ["에녹", "렌", "동료"],
      currentUserMessage: "다들 준비됐지?",
      currentTurn: 2,
    });
    const userBody = `${CURRENT_USER_INPUT_HEADER}\n\nhi\n\n${USER_TAIL_LENGTH_OWNER_SENTENCE}`;
    const base = [
      {
        role: "system",
        content: `[CORE RP]\nok\n${SCENE_FLOW_BLOCK}\n`,
      },
      { role: "user", content: userBody },
    ];
    const Usim = applyScenePacingArmToMessages({
      messages: base,
      arm: "U",
      decision: sim,
    });
    const Uparty = applyScenePacingArmToMessages({
      messages: base,
      arm: "U",
      decision: party,
    });
    assert.equal(Usim.terminalDialogueBudgetAppended, false);
    assert.equal(Uparty.terminalDialogueBudgetAppended, false);
    assert.equal(
      countTerminalDialogueBudgetOwners(Usim.lastUserContent)
        .terminal_dialogue_budget_owner,
      0
    );
    assert.equal(
      countTerminalDialogueBudgetOwners(Uparty.lastUserContent)
        .terminal_dialogue_budget_owner,
      0
    );
    const skipped = appendTerminalDialogueBudgetToUserTurn({
      userContent: userBody,
      decision: sim,
      budget: {
        maxBlocks: null,
        reason: "ensemble_uncapped",
        communicationDemand: "NORMAL",
      },
    });
    assert.equal(skipped.appended, false);
  });

  it("G10-D3 API=0 matrix — dynamic dialogue budget A–I", () => {
    // A. quiet established dyad → 4
    const quiet = decide({
      contentKind: "character",
      primaryCharacterName: "에녹",
      currentUserMessage:
        "*렌이 소파 등받이에 기대며 컵을 내려놓는다.* 오늘은 좀 조용하네. 잠깐 이대로 있어도 돼?",
      recentMessages: [
        { role: "assistant", content: "문은 잠겼다. 소파에 앉아 숨을 고른다." },
      ],
      currentTurn: 3,
    });
    assert.equal(quiet.pacingMode, "DYAD");
    assert.equal(quiet.motionLevel, "HOLD");
    const quietDemand = resolveCommunicationDemand({
      currentUserMessage: "잠깐 이대로 있어도 돼?",
      recentMessages: quiet.reasonCodes
        ? [{ role: "assistant", content: "문은 잠겼다." }]
        : [],
      decision: quiet,
    });
    const quietBudget = resolveTerminalDialogueBudget({
      decision: quiet,
      communicationDemand: quietDemand,
    });
    assert.equal(quietBudget.maxBlocks, 4);
    assert.equal(quietBudget.reason, "quiet_dyad");

    // B. intimate dyad → 4
    const intimate = decide({
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
    assert.equal(intimate.intimateDyad, true);
    const intimateBudget = resolveTerminalDialogueBudget({
      decision: intimate,
      communicationDemand: "NORMAL",
    });
    assert.equal(intimateBudget.maxBlocks, 4);
    assert.equal(intimateBudget.reason, "intimate_dyad");

    // C. ordinary exploration → 5
    const explore = decide({
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
    assert.equal(explore.pacingMode, "EXPLORATION");
    const exploreBudget = resolveTerminalDialogueBudget({
      decision: explore,
      communicationDemand: "LOW",
    });
    assert.equal(exploreBudget.maxBlocks, 5);
    assert.equal(exploreBudget.reason, "exploration");

    // D. active combat/operation → 6
    const combat = decide({
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
    });
    assert.equal(combat.pacingMode, "OPERATION");
    const combatBudget = resolveTerminalDialogueBudget({
      decision: combat,
      communicationDemand: "NORMAL",
    });
    assert.equal(combatBudget.maxBlocks, 6);
    assert.equal(combatBudget.reason, "operation");

    // E. radio operation HIGH → 6
    const radioRecent = [
      {
        role: "assistant" as const,
        content:
          '무전기에서 카인의 보고가 올라왔다.\n\n"에녹, 수신되나. 남측 농도 급변."',
      },
    ];
    const radio = decide({
      contentKind: "character",
      primaryCharacterName: "에녹",
      currentUserMessage:
        "*렌이 무전기 잡음을 듣고 목소리를 낮춘다.* 카인 말대로면… 우리가 먼저 응답해야 해? 경로 보고 바꿀까?",
      recentMessages: radioRecent,
      knownSupportingCastNames: ["카인"],
      currentTurn: 5,
    });
    const radioDemand = resolveCommunicationDemand({
      currentUserMessage:
        "카인 말대로면… 우리가 먼저 응답해야 해? 경로 보고 바꿀까?",
      recentMessages: radioRecent,
      decision: radio,
      knownSupportingCastNames: ["카인"],
    });
    assert.equal(radioDemand, "HIGH");
    const radioBudget = resolveTerminalDialogueBudget({
      decision: radio,
      communicationDemand: radioDemand,
    });
    assert.equal(radioBudget.maxBlocks, 6);
    assert.equal(radioBudget.reason, "communication_heavy");

    // F. negotiation HIGH → 6
    const nego = decide({
      contentKind: "character",
      primaryCharacterName: "에녹",
      currentUserMessage: "저 담당과 협상해야 해. 내가 먼저 말할까?",
      recentMessages: [
        {
          role: "assistant",
          content: "담당 군관이 테이블 맞은편에 앉아 보고를 기다리고 있었다.",
        },
      ],
      knownSupportingCastNames: ["담당"],
      currentTurn: 4,
    });
    const negoDemand = resolveCommunicationDemand({
      currentUserMessage: "저 담당과 협상해야 해. 내가 먼저 말할까?",
      recentMessages: [
        {
          role: "assistant",
          content: "담당 군관이 테이블 맞은편에 앉아 보고를 기다리고 있었다.",
        },
      ],
      decision: nego,
      knownSupportingCastNames: ["담당"],
    });
    assert.equal(negoDemand, "HIGH");
    assert.equal(
      resolveTerminalDialogueBudget({
        decision: nego,
        communicationDemand: negoDemand,
      }).maxBlocks,
      6
    );

    // G/H. party / simulation → null
    const party = decide({
      contentKind: "character",
      party: true,
      primaryCharacterName: "에녹",
      establishedActiveCastNames: ["에녹", "렌", "동료"],
      currentUserMessage: "다들 준비됐지?",
      currentTurn: 2,
    });
    const sim = decide({
      contentKind: "simulation",
      primaryCharacterName: "지휘관",
      establishedActiveCastNames: ["병사A", "병사B"],
      currentUserMessage: "전원 위치로.",
      currentTurn: 2,
    });
    assert.equal(
      resolveTerminalDialogueBudget({
        decision: party,
        communicationDemand: "HIGH",
        party: true,
      }).maxBlocks,
      null
    );
    assert.equal(
      resolveTerminalDialogueBudget({
        decision: sim,
        communicationDemand: "HIGH",
        contentKind: "simulation",
      }).maxBlocks,
      null
    );

    // I. false positive — past radio mention in calm dyad stays max4
    const fp = decide({
      contentKind: "character",
      primaryCharacterName: "에녹",
      currentUserMessage:
        "*렌이 컵을 내려놓는다.* 어제 무전기가 고장났어. 오늘은 좀 조용하네.",
      recentMessages: [
        { role: "assistant", content: "문은 잠겼다. 소파에 앉아 숨을 고른다." },
      ],
      currentTurn: 3,
    });
    assert.equal(fp.pacingMode, "DYAD");
    const fpDemand = resolveCommunicationDemand({
      currentUserMessage:
        "어제 무전기가 고장났어. 오늘은 좀 조용하네.",
      recentMessages: [
        { role: "assistant", content: "문은 잠겼다. 소파에 앉아 숨을 고른다." },
      ],
      decision: fp,
    });
    assert.notEqual(fpDemand, "HIGH");
    const fpBudget = resolveTerminalDialogueBudget({
      decision: fp,
      communicationDemand: fpDemand,
    });
    assert.equal(fpBudget.maxBlocks, 4);

    // Terminal: dynamic ceiling + single response axis + [B] dialogue ownership
    assert.equal(
      renderTerminalDialogueBudgetOwner(5),
      "[이번 응답 대화]\nAI 측 직접 발화는 필요한 만큼 사용하되 최대 5개 블록으로 구성한다.\n유저가 반응할 질문·제안·요구는 하나의 중심축으로 모으고, [B]의 새 직접 발화·중대한 선택은 유저에게 남긴다."
    );
    assert.doesNotMatch(renderTerminalDialogueBudgetOwner(6), /1~3|DYAD|OPERATION|표|%|퍼센트/);
    assert.match(renderTerminalDialogueBudgetOwner(4), /하나의 중심축/);
    assert.doesNotMatch(
      renderCompactScenePacingCue(
        decide({
          contentKind: "character",
          primaryCharacterName: "에녹",
          currentUserMessage: "잠깐 이대로 있어도 돼?",
          currentTurn: 1,
        })
      ),
      /여러 독립 결정|중심축으로 모으/
    );

    // Arm V applies dynamic owner; system cap remains 0
    const userBody =
      `${CURRENT_USER_INPUT_HEADER}\n\n` +
      `테스트\n\n${USER_TAIL_LENGTH_OWNER_SENTENCE}`;
    const base = [
      {
        role: "system",
        content: `[CORE RP]\nok\n${SCENE_FLOW_BLOCK}\n${DIALOGUE_NARRATION_STRUCTURE_RULE}\n`,
      },
      { role: "user", content: userBody },
    ];
    const V = applyScenePacingArmToMessages({
      messages: base,
      arm: "V",
      decision: quiet,
      dialogueBudgetInput: {
        currentUserMessage: "잠깐 이대로 있어도 돼?",
        recentMessages: [
          { role: "assistant", content: "문은 잠겼다." },
        ],
        contentKind: "character",
      },
    });
    assert.equal(V.dialogueBudget?.maxBlocks, 4);
    assert.equal(V.terminalDialogueBudgetAppended, true);
    assert.equal(countDialogueBlockOwners(V.systemText).dialogue_block_owner, 0);
    assert.match(V.lastUserContent, /최대 4개 블록/);
    assert.match(V.lastUserContent, /하나의 중심축/);
    assert.match(V.lastUserContent, /\[B\]의 새 직접 발화·중대한 선택은 유저에게 남긴다/);
    assert.doesNotMatch(V.lastUserContent, /보통 1~3개면 충분/);
    assert.ok(
      V.lastUserContent.indexOf("[이번 응답 대화]") <
        V.lastUserContent.indexOf(USER_TAIL_LENGTH_OWNER_SENTENCE)
    );
    assert.ok(V.lastUserContent.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE));
    assert.equal(
      V.lastUserContent.split(USER_TAIL_LENGTH_OWNER_SENTENCE).length - 1,
      1
    );
    assert.doesNotMatch(V.systemText, /여러 독립 결정/);
    assert.match(
      renderCompactScenePacingCue(quiet),
      /주변 인물·환경의 짧은 반응이나 작은 마찰/
    );

    const Vparty = applyScenePacingArmToMessages({
      messages: base,
      arm: "V",
      decision: party,
      dialogueBudgetInput: { party: true, contentKind: "character" },
    });
    assert.equal(Vparty.dialogueBudget?.maxBlocks, null);
    assert.equal(Vparty.terminalDialogueBudgetAppended, false);
    assert.equal(
      countTerminalDialogueBudgetOwners(Vparty.lastUserContent)
        .terminal_dialogue_budget_owner,
      0
    );
  });
});
