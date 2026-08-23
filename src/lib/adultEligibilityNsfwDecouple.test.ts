import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decideAdultModelRoute,
  DEFAULT_MODEL_ROUTE_STATE,
  classifySceneMode,
  resolveAdultEligibility,
  resolveAdultRoutingConfig,
  resolveEffectiveConsentMode,
  type AdultConsentMode,
} from "./adultSceneRouting";

const config = resolveAdultRoutingConfig({
  ADULT_SCENE_ROUTING_ENABLED: "true",
});

const CONSENSUAL_ADULT_INPUT =
  "합의된 노골적인 성적 대사를 이어간다. 옷을 벗기고 삽입하는 성인 장면을 계속한다.";
const CNC_OPT_IN_INPUT =
  "OOC: CNC 강압 역할극에 사전 동의한다. 세이프워드는 레드다.";

const confirmedAdult = {
  adultStatus: "confirmed" as const,
  age: 27,
  description: "27세 가상 성인",
};

function eligibility(input: {
  userAdultVerified: boolean;
  adultContentVisibilityEnabled: boolean;
  nsfw: 0 | 1;
  participants: Parameters<typeof resolveAdultEligibility>[0]["participants"];
}) {
  void input.nsfw;
  return resolveAdultEligibility({
    userAdultVerified: input.userAdultVerified,
    adultContentVisibilityEnabled: input.adultContentVisibilityEnabled,
    participants: input.participants,
  });
}

function handoffDecision(
  adultEligibility: ReturnType<typeof resolveAdultEligibility>,
  currentInput = CONSENSUAL_ADULT_INPUT,
  consentMode: AdultConsentMode = "standard"
) {
  const classification = classifySceneMode({
    currentInput,
    previousSceneMode: "normal",
    recentRawText: "둘 다 27세 가상 성인이다.",
    adultDialogueProfile: "auto",
    activeConsentMode: consentMode,
  });
  return decideAdultModelRoute({
    config,
    state: DEFAULT_MODEL_ROUTE_STATE,
    classification,
    eligibility: adultEligibility,
    adultDialogueProfile: "auto",
    selectedModelId: "gpt-5.6-terra",
  });
}

describe("nsfw listing is not adult RP eligibility", () => {
  it("A: nsfw=0 confirmed adult is eligible when user+chat adult mode are on", () => {
    const adultEligibility = eligibility({
      userAdultVerified: true,
      adultContentVisibilityEnabled: true,
      nsfw: 0,
      participants: [confirmedAdult],
    });
    assert.equal(adultEligibility.eligible, true);
    assert.equal(adultEligibility.allowedByAdultContentPolicy, true);
    assert.equal(adultEligibility.blockReason, undefined);

    const decision = handoffDecision(adultEligibility);
    assert.equal(decision.shouldBlock, false);
    assert.equal(decision.activeRoute, "general");
    assert.equal(decision.refusalBufferRecommended, true);
  });

  it("B: chat adult mode OFF blocks handoff but keeps the general model", () => {
    const adultEligibility = eligibility({
      userAdultVerified: true,
      adultContentVisibilityEnabled: false,
      nsfw: 0,
      participants: [confirmedAdult],
    });
    assert.equal(adultEligibility.eligible, false);
    assert.equal(adultEligibility.blockReason, "adult_visibility_off");
    assert.equal(adultEligibility.allowedByAdultContentPolicy, true);

    const decision = handoffDecision(adultEligibility);
    assert.equal(decision.activeRoute, "general");
    assert.equal(decision.shouldBlock, false);
  });

  it("C: unverified user cannot enter adult RP even if chat adult mode is on", () => {
    const adultEligibility = eligibility({
      userAdultVerified: false,
      adultContentVisibilityEnabled: true,
      nsfw: 1,
      participants: [confirmedAdult],
    });
    assert.equal(adultEligibility.eligible, false);
    assert.equal(adultEligibility.blockReason, "user_not_verified");
  });

  it("D: confirmed minor stays blocked regardless of nsfw=0", () => {
    const adultEligibility = eligibility({
      userAdultVerified: true,
      adultContentVisibilityEnabled: true,
      nsfw: 0,
      participants: [
        {
          adultStatus: "minor",
          age: 17,
          description: "17세",
        },
      ],
    });
    assert.equal(adultEligibility.eligible, false);
    assert.equal(adultEligibility.blockReason, "participant_minor");
  });

  it("E: nsfw=1 does not override unknown participant age", () => {
    const adultEligibility = eligibility({
      userAdultVerified: true,
      adultContentVisibilityEnabled: true,
      nsfw: 1,
      participants: [
        {
          adultStatus: "unknown",
          description: "정체를 알 수 없는 인물",
        },
      ],
    });
    assert.equal(adultEligibility.eligible, false);
    assert.equal(adultEligibility.blockReason, "participant_unknown");
  });

  it("F: general adult character uses standard consent", () => {
    const adultEligibility = eligibility({
      userAdultVerified: true,
      adultContentVisibilityEnabled: true,
      nsfw: 0,
      participants: [confirmedAdult],
    });
    assert.equal(adultEligibility.eligible, true);
    const effective = resolveEffectiveConsentMode({
      requested: "standard",
      previous: "standard",
      currentInput: CONSENSUAL_ADULT_INPUT,
      allowedConsentModes: ["standard"],
    });
    assert.equal(effective, "standard");
  });

  it("G: CNC request on standard-only allowlist stays eligible and clamps to standard", () => {
    const adultEligibility = eligibility({
      userAdultVerified: true,
      adultContentVisibilityEnabled: true,
      nsfw: 0,
      participants: [confirmedAdult],
    });
    assert.equal(adultEligibility.eligible, true);
    const effective = resolveEffectiveConsentMode({
      requested: "cnc_opt_in",
      previous: "standard",
      currentInput: CNC_OPT_IN_INPUT,
      allowedConsentModes: ["standard"],
    });
    assert.equal(effective, "standard");
  });

  it("H: CNC-enabled adult character can resolve cnc_opt_in on explicit current-turn opt-in", () => {
    const adultEligibility = eligibility({
      userAdultVerified: true,
      adultContentVisibilityEnabled: true,
      nsfw: 1,
      participants: [confirmedAdult],
    });
    assert.equal(adultEligibility.eligible, true);
    const effective = resolveEffectiveConsentMode({
      requested: "cnc_opt_in",
      previous: "standard",
      currentInput: CNC_OPT_IN_INPUT,
      allowedConsentModes: ["standard", "cnc_opt_in"],
    });
    assert.equal(effective, "cnc_opt_in");
  });

  it("강이현: general listing + confirmed adult allows standard adult RP and clamps CNC", () => {
    const kang = {
      adultStatus: "confirmed" as const,
      age: 27,
      description: "강이현",
    };
    const adultEligibility = eligibility({
      userAdultVerified: true,
      adultContentVisibilityEnabled: true,
      nsfw: 0,
      participants: [kang],
    });
    assert.equal(adultEligibility.eligible, true);
    assert.equal(
      resolveEffectiveConsentMode({
        requested: "standard",
        previous: "standard",
        currentInput: CONSENSUAL_ADULT_INPUT,
        allowedConsentModes: ["standard"],
      }),
      "standard"
    );
    assert.equal(
      resolveEffectiveConsentMode({
        requested: "cnc_opt_in",
        previous: "standard",
        currentInput: CNC_OPT_IN_INPUT,
        allowedConsentModes: ["standard"],
      }),
      "standard"
    );
  });

  it("ignores a leftover characterAdultContentEnabled=false listing flag", () => {
    const adultEligibility = resolveAdultEligibility({
      userAdultVerified: true,
      adultContentVisibilityEnabled: true,
      characterAdultContentEnabled: false,
      participants: [confirmedAdult],
    });
    assert.equal(adultEligibility.eligible, true);
    assert.notEqual(adultEligibility.blockReason, "character_adult_disabled");
  });
});
