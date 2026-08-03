import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canUseAdultSceneHandoffAdminCanary,
  detectAdultSceneHandoffPromptLeak,
  resolveAdultSceneHandoffCanaryConfig,
  resolveAdultSceneHandoffCanaryStage,
  resolveAdultSceneRoutingEnabledForRequest,
} from "./adultSceneHandoffCanary";

describe("adult scene handoff admin canary", () => {
  const config = resolveAdultSceneHandoffCanaryConfig({
    ADULT_SCENE_HANDOFF_ADMIN_CANARY: "true",
    ADULT_SCENE_HANDOFF_GENERAL_ENABLED: "false",
    ADULT_SCENE_HANDOFF_ADMIN_USER_IDS: "7, 9",
    ADULT_SCENE_HANDOFF_ADMIN_CHAT_IDS: "315, 400",
  });

  it("enables the general rollout by default after final approval", () => {
    const defaults = resolveAdultSceneHandoffCanaryConfig({});
    assert.equal(defaults.generalEnabled, true);
    assert.equal(resolveAdultSceneRoutingEnabledForRequest({
      generalEnabled: defaults.generalEnabled,
      adminCanaryAccess: false,
    }), true);
  });

  it("requires admin plus both numeric allowlists", () => {
    assert.equal(canUseAdultSceneHandoffAdminCanary({
      config,
      isAdmin: true,
      userId: 7,
      chatId: 315,
    }), true);
    assert.equal(canUseAdultSceneHandoffAdminCanary({
      config,
      isAdmin: false,
      userId: 7,
      chatId: 315,
    }), false);
    assert.equal(canUseAdultSceneHandoffAdminCanary({
      config,
      isAdmin: true,
      userId: 8,
      chatId: 315,
    }), false);
    assert.equal(canUseAdultSceneHandoffAdminCanary({
      config,
      isAdmin: true,
      userId: 7,
      chatId: 316,
    }), false);
  });

  it("keeps general users disabled while allowing the exact canary request", () => {
    assert.equal(resolveAdultSceneRoutingEnabledForRequest({
      generalEnabled: false,
      adminCanaryAccess: false,
    }), false);
    assert.equal(resolveAdultSceneRoutingEnabledForRequest({
      generalEnabled: false,
      adminCanaryAccess: true,
    }), true);
  });

  it("labels the four observable route transitions", () => {
    assert.equal(resolveAdultSceneHandoffCanaryStage({
      routeBefore: "general",
      routeAfter: "general",
    }), "T1_GENERAL");
    assert.equal(resolveAdultSceneHandoffCanaryStage({
      routeBefore: "general",
      routeAfter: "adult",
    }), "T2_ADULT_ENTRY");
    assert.equal(resolveAdultSceneHandoffCanaryStage({
      routeBefore: "adult",
      routeAfter: "adult",
    }), "T3_ADULT_STICKY");
    assert.equal(resolveAdultSceneHandoffCanaryStage({
      routeBefore: "adult",
      routeAfter: "general",
    }), "T4_GENERAL_RETURN");
  });

  it("detects private routing/control markers without inspecting user text", () => {
    assert.equal(detectAdultSceneHandoffPromptLeak("일반 RP 본문"), false);
    assert.equal(
      detectAdultSceneHandoffPromptLeak("INTERNAL CONTINUATION CONTROL"),
      true
    );
  });
});
