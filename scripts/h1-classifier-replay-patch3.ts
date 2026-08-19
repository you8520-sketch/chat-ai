/**
 * Patch 3 — H1 classifier-only replay after local fixture metadata fix.
 * No provider calls. Read-only classifier path.
 */
import {
  assessParticipantAdultStatus,
  classifySceneMode,
  decideAdultModelRoute,
  normalizeAdultDialogueProfile,
  parseModelRouteState,
  resolveAdultEligibility,
  resolveAdultRoutingConfig,
} from "@/lib/adultSceneRouting";
import {
  resolveAdultSceneHandoffCanaryConfig,
  resolveAdultSceneRoutingEnabledForRequest,
} from "@/lib/adultSceneHandoffCanary";
import { getDb } from "@/lib/db";

const H1_TEXT =
  "(렌이 팔을 뻗어 서강우의 허리를 끌어안음) 왜 피해? 방금 너 좋아했잖아. 눈빛이 확 변했어. 한 번 더 해보자, 이번엔 더 세게. 너 냄새도 마음에 들고,,, *그대로 목덜미를 살짝 물며 반응을 본다 *";

const row = getDb()
  .prepare(
    "SELECT id, name, adult_status, participant_min_age, nsfw, description FROM characters WHERE id=17"
  )
  .get() as {
  id: number;
  name: string;
  adult_status: string;
  participant_min_age: number | null;
  nsfw: number;
  description: string;
};

const charParticipantStatus = assessParticipantAdultStatus({
  adultStatus: row.adult_status,
  age: row.participant_min_age,
  description: row.description,
});
const personaParticipantStatus = assessParticipantAdultStatus({
  description: "신입 S급 가이드 렌",
  isVerifiedAdultUserPersona: true,
});

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
  "바닥에서 털고 일어난 렌의 옷자락 사이로 드러난 허리선이 움직일 때마다, 좁은 통로의 공기가 한 차례 크게 뒤흔들렸다.",
  "네가 해줘 *슬쩍 붙어서며 플러드의 손을 잡고 강력한 가이딩파장을 흘린다* 이러면 기분좋다고 하던데....",
  "엘리베이터 앞의 좁은 복도는 주기적으로 웅웅거리는 공조 설비의 소음만이 바닥을 긁고 지나가고 있었다.",
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
  characterAdultContentEnabled: row.nsfw === 1,
  participants: [
    {
      adultStatus: row.adult_status,
      age: row.participant_min_age,
      description: row.description,
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
  }),
  enabled: resolveAdultSceneRoutingEnabledForRequest({
    canary: resolveAdultSceneHandoffCanaryConfig(),
    userId: 1,
    characterId: 17,
    chatId: 3,
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

console.log(
  JSON.stringify(
    {
      CHAR_PARTICIPANT_STATUS: charParticipantStatus,
      PERSONA_PARTICIPANT_STATUS: personaParticipantStatus,
      ELIGIBILITY_ALLOWED: adultEligibility.allowedByAdultContentPolicy,
      ELIGIBILITY_ELIGIBLE: adultEligibility.eligible,
      BLOCK_REASON: adultEligibility.blockReason ?? "none",
      ADULT_ROUTE_DECISION_SHOULD_BLOCK: adultRouteDecision.shouldBlock,
      PARTICIPANT_MIN_AGE: row.participant_min_age,
      ADULT_STATUS: row.adult_status,
      GEMINI_CALLS: 0,
      DEEPSEEK_CALLS: 0,
    },
    null,
    2
  )
);
