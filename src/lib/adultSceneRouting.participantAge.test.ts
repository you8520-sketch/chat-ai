import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assessParticipantAdultStatus,
  buildCharacterParticipantIdentityDescription,
  classifySceneMode,
  decideAdultModelRoute,
  DEFAULT_MODEL_ROUTE_STATE,
  normalizeAdultDialogueProfile,
  parseModelRouteState,
  resolveAdultEligibility,
  resolveAdultRoutingConfig,
} from "./adultSceneRouting";
import {
  resolveAdultSceneHandoffCanaryConfig,
  resolveAdultSceneRoutingEnabledForRequest,
} from "./adultSceneHandoffCanary";

describe("participant adult status — historical vs current age evidence", () => {
  it("A. confirmed adult + historical 5살 때 => confirmed", () => {
    assert.equal(
      assessParticipantAdultStatus({
        adultStatus: "confirmed",
        description: "S급 센티넬. 5살 때 바다 사고를 겪었다.",
      }),
      "confirmed"
    );
  });

  it("B. confirmed adult + 어린아이였던 시절 => confirmed", () => {
    assert.equal(
      assessParticipantAdultStatus({
        adultStatus: "confirmed",
        description: "현역 요원. 어린아이였던 시절의 기억이 희미하다.",
      }),
      "confirmed"
    );
  });

  it("C. current adult + 고등학생 때 => confirmed", () => {
    assert.equal(
      assessParticipantAdultStatus({
        adultStatus: "confirmed",
        description: "28세 직장인. 고등학생 때 있었던 일을 회상한다.",
      }),
      "confirmed"
    );
  });

  it("D. route identity assembly excludes world/system_prompt/simulation_cast", () => {
    const identity = buildCharacterParticipantIdentityDescription({
      adultStatus: "confirmed",
      description: "S급 센티넬. 28세 성인.",
      systemPrompt: "과거: 5살 때 바다 사고. 어린아이 구조 임무.",
      world: "세계관: 재난 현장에서 어린아이를 구조하는 임무가 자주 발생한다.",
      simulationCast: "NPC: 12세 초등학생 조연",
    });
    assert.equal(identity, "confirmed\nS급 센티넬. 28세 성인.");
    assert.doesNotMatch(identity, /어린아이|5살|12세|초등학생/);
    assert.equal(
      assessParticipantAdultStatus({
        adultStatus: "confirmed",
        description: identity,
      }),
      "confirmed"
    );
  });

  it("K1. 현재 미성년자 => minor", () => {
    assert.equal(
      assessParticipantAdultStatus({ description: "현재 미성년자" }),
      "minor"
    );
  });

  it("K2. 미성년자였던 시절 + confirmed adult => confirmed", () => {
    assert.equal(
      assessParticipantAdultStatus({
        adultStatus: "confirmed",
        description: "28세 요원. 미성년자였던 시절의 기억.",
      }),
      "confirmed"
    );
  });

  it("K3. 17살이었을 때 + confirmed adult => confirmed", () => {
    assert.equal(
      assessParticipantAdultStatus({
        adultStatus: "confirmed",
        description: "성인 캐릭터. 17살이었을 때의 일화.",
      }),
      "confirmed"
    );
  });

  it("K4. 17세이던 시절 + confirmed adult => confirmed", () => {
    assert.equal(
      assessParticipantAdultStatus({
        adultStatus: "confirmed",
        description: "29세. 17세이던 시절을 회상한다.",
      }),
      "confirmed"
    );
  });

  it("K5. 고등학생이었던 시절 + confirmed adult => confirmed", () => {
    assert.equal(
      assessParticipantAdultStatus({
        adultStatus: "confirmed",
        description: "직장인. 고등학생이었던 시절의 추억.",
      }),
      "confirmed"
    );
  });

  it("K6. 중학생이던 때 + confirmed adult => confirmed", () => {
    assert.equal(
      assessParticipantAdultStatus({
        adultStatus: "confirmed",
        description: "성인. 중학생이던 때의 기억.",
      }),
      "confirmed"
    );
  });

  it("K7. 현재 17살 => minor", () => {
    assert.equal(
      assessParticipantAdultStatus({ description: "현재 17살" }),
      "minor"
    );
  });

  it("K8. 현재 고등학생 => minor", () => {
    assert.equal(
      assessParticipantAdultStatus({ description: "현재 고등학생" }),
      "minor"
    );
  });

  it("E. current 17살 => minor", () => {
    assert.equal(
      assessParticipantAdultStatus({
        description: "현재 17살 고등학생.",
      }),
      "minor"
    );
  });

  it("F. 나이: 16세 => minor", () => {
    assert.equal(
      assessParticipantAdultStatus({
        description: "이름: 민수\n나이: 16세",
      }),
      "minor"
    );
  });

  it("G. structured age=17 => minor", () => {
    assert.equal(
      assessParticipantAdultStatus({
        age: 17,
        description: "가상 캐릭터",
      }),
      "minor"
    );
  });

  it("H. adultStatus=minor => minor", () => {
    assert.equal(
      assessParticipantAdultStatus({
        adultStatus: "minor",
        description: "캐릭터 소개",
      }),
      "minor"
    );
  });

  it("I. explicit adult + explicit current minor => conflict", () => {
    assert.equal(
      assessParticipantAdultStatus({
        adultStatus: "confirmed",
        description: "성인이지만 현재 17살이라고 설정됨",
      }),
      "conflict"
    );
  });

  it("J. no reliable adult/minor evidence => unknown", () => {
    assert.equal(
      assessParticipantAdultStatus({
        description: "말수가 적고 긴 머리를 한 현장 요원",
      }),
      "unknown"
    );
  });
});

describe("H1 classifier-only regression — character 17 + frozen HUMAN USER #1", () => {
  it("does not block solely on historical childhood/backstory tokens", () => {
    const H1_TEXT =
      "(렌이 팔을 뻗어 서강우의 허리를 끌어안음) 왜 피해? 방금 너 좋아했잖아. 눈빛이 확 변했어. 한 번 더 해보자, 이번엔 더 세게. 너 냄새도 마음에 들고,,, *그대로 목덜미를 살짝 물며 반응을 본다 *";

    const characterParticipantDescription = [
      "unknown",
      "S급 물속성 센티넬. 키 174cm. 신인 센티넬.",
    ].join("\n");
    const systemPromptBackstory =
      "과거: 5살 때 바다 사고. 21세 무렵 어린아이 구조 상황에 개입.";

    const charStatus = assessParticipantAdultStatus({
      adultStatus: "unknown",
      description: characterParticipantDescription,
    });
    assert.equal(charStatus, "unknown");
    assert.notEqual(charStatus, "minor");
    assert.notEqual(charStatus, "conflict");

    const charStatusWithBackstoryInWrongField = assessParticipantAdultStatus({
      adultStatus: "unknown",
      description: `${characterParticipantDescription}\n${systemPromptBackstory}`,
    });
    assert.notEqual(
      charStatusWithBackstoryInWrongField,
      "minor",
      "historical ages in narrative must not classify participant as minor"
    );
    assert.notEqual(charStatusWithBackstoryInWrongField, "conflict");

    const priorModelRouteState = parseModelRouteState(
      JSON.stringify({
        activeModelRoute: "general",
        currentSceneMode: "normal",
        adultRouteMinimumTurnsRemaining: 0,
        safeSceneStreak: 1,
        activeConsentMode: "standard",
        sexualContextActive: false,
      })
    );
    const recentRaw = [
      "렌이라고 부르면 돼. 단말기...? *주머니에서 단말기를 꺼낸다*",
      "바닥에서 털고 일어난 렌의 옷자락 사이로 드러난 허리선이 움직일 때마다, 좁은 통로의 공기가 한 차례 크게 뒤흔들렸다. 환기구가 뿜어내는 기계적",
      "네가 해줘 *슬쩍 붙어서며 플러드의 손을 잡고 강력한 가이딩파장을 흘린다* 이러면 기분좋다고 하던데....",
      "엘리베이터 앞의 좁은 복도는 주기적으로 웅웅거리는 공조 설비의 소음만이 바닥을 긁고 지나가고 있었다. 서강우는 단말기의 스트랩을 펼친 채 렌이 슬쩍 붙어 손을 잡고 가이딩파장을 흘리자,",
    ].join("\n");

    const sceneClassification = classifySceneMode({
      currentInput: H1_TEXT,
      previousSceneMode: priorModelRouteState.currentSceneMode,
      recentRawText: recentRaw,
      adultDialogueProfile: normalizeAdultDialogueProfile("auto"),
      activeConsentMode: "standard",
    });

    const adultEligibility = resolveAdultEligibility({
      userAdultVerified: true,
      adultContentVisibilityEnabled: true,
      characterAdultContentEnabled: true,
      participants: [
        {
          adultStatus: "unknown",
          description: characterParticipantDescription,
        },
        {
          description: "신입 S급 가이드 렌",
          isVerifiedAdultUserPersona: true,
        },
      ],
      actualNonConsent: sceneClassification.actualNonConsent,
    });

    const adultRoutingConfig = {
      ...resolveAdultRoutingConfig({
        ADULT_SCENE_ROUTING_ENABLED: "true",
        ADULT_SCENE_HANDOFF_GENERAL_ENABLED: "false",
      }),
      enabled: resolveAdultSceneRoutingEnabledForRequest({
        generalEnabled: false,
        adminCanaryAccess: false,
        chatAdultHandoffEnabled: true,
      }),
    };

    const adultRouteDecision = decideAdultModelRoute({
      config: adultRoutingConfig,
      state: priorModelRouteState,
      classification: sceneClassification,
      eligibility: adultEligibility,
      adultDialogueProfile: normalizeAdultDialogueProfile("auto"),
      selectedModelId: "gemini-3.7-flash",
    });

    assert.equal(adultEligibility.blockReason, "participant_unknown");
    assert.notEqual(adultEligibility.blockReason, "participant_minor");
    assert.notEqual(adultRouteDecision.blockReason, "participant_minor");
    assert.notEqual(adultRouteDecision.blockReason, "participant_conflict");
    if (sceneClassification.currentInputExplicitIntent) {
      assert.equal(adultRouteDecision.shouldBlock, true);
      assert.equal(adultRouteDecision.blockReason, "participant_unknown");
    }
  });
});
