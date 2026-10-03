import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import { COMMON_PROSE_BLOCK } from "@/lib/advancedProseNsfwGuidelines";
import { buildChatOocRpContinuingUserPrompt } from "@/lib/chatOocPriority";
import { resolveOpenRouterMaxTokens } from "@/lib/openRouterClient";
import { resolveEffectiveUserAuthoring } from "@/lib/userCoauthorState";
import {
  COMMON_PROSE_EMOTION_CUE_CANDIDATE,
  liveCommonProseEmotionCueBaseline,
} from "@/lib/mainRpFinalWireAudit";
import {
  BODY_CUE_PROPOSED_APPROVAL,
  bodyCueNextCallAllowed,
  buildBodyCueReviewPacket,
} from "./mainRpBodyCuePreflight";
import { buildCanonicalRpQualificationCases } from "./rpModelQualificationFixture";

describe("Main RP body-cue preflight", () => {
  const packet = buildBodyCueReviewPacket();

  it("keeps the candidate clause out of the production prose owner", () => {
    const source = fs.readFileSync("src/lib/advancedProseNsfwGuidelines.ts", "utf8");
    assert.equal(source.includes("COMMON_PROSE_EMOTION_CUE_CANDIDATE"), false);
    assert.equal(source.includes("COMMON_PROSE_EMOTION_CUE_BASELINE"), false);
    assert.equal(source.includes("COMMON_PROSE_FORWARD_MOTION"), false);
    assert.equal(source.includes("replaceCommonProseEmotionCue"), false);
    assert.equal(COMMON_PROSE_BLOCK.includes(liveCommonProseEmotionCueBaseline()), true);
    assert.equal(COMMON_PROSE_BLOCK.includes(COMMON_PROSE_EMOTION_CUE_CANDIDATE), false);
  });

  it("keeps the qualification case list and adds two review scenes beside it", () => {
    assert.deepEqual(
      buildCanonicalRpQualificationCases().map((entry) => entry.id),
      [
        "production_midchat_t1",
        "persona_grounded_reaction",
        "agency_boundary",
        "false_canon_trap",
        "memory_current_state_priority",
        "memory_false_shared_event",
      ]
    );
    assert.deepEqual(
      packet.scenes.map((scene) => scene.id),
      ["quiet_window_safe", "relationship_turn_safe"]
    );
    assert.equal(packet.providerCalls, 0);
    assert.equal(packet.modelId, "deepseek-v4.1-flash");
    assert.equal(packet.authoringLevel, "NORMAL");
    assert.equal(packet.nsfw, false);
    assert.notEqual(packet.scenes[0]?.userTurnSha256, packet.scenes[1]?.userTurnSha256);
    assert.notEqual(packet.scenes[0]?.promptUserSha256, packet.scenes[1]?.promptUserSha256);
    assert.equal(packet.source.characterName, "라이크");
    assert.equal(packet.source.sourceCharacterId, 10);
    assert.equal(packet.source.personaName, "렌");
    assert.equal(packet.liveIdentity.status, "LIVE_IDENTITY_UNVERIFIED");
    assert.equal(packet.liveIdentity.rowRead, false);
    assert.equal(packet.liveIdentity.proseOwnerUnchanged, true);
  });

  it("sends the two OOC scenes through the live continuing-prompt owner", () => {
    for (const scene of packet.scenes) {
      assert.equal(scene.productionTurn.intent, "rp_continuing", scene.id);
      assert.equal(
        scene.productionTurn.promptUserMessage,
        buildChatOocRpContinuingUserPrompt(scene.currentUserMessage),
        scene.id
      );
      assert.equal(scene.productionTurn.policyUserMessage, scene.currentUserMessage, scene.id);
      assert.equal(scene.sceneControlMatchesPolicy, true, scene.id);
      assert.equal(scene.assembledUserCarriesScene, true, scene.id);
      assert.match(scene.productionTurn.promptUserMessage, /^\[SYSTEM: CHAT OOC/);
      assert.match(scene.productionTurn.promptUserMessage, /OOC:/);
      const normalDelegation = resolveEffectiveUserAuthoring({
        persistentMode: "OFF",
        baseLevel: "NORMAL",
        currentUserInput: "렌은 창을 본다.",
      }).delegation;
      assert.deepEqual(scene.productionTurn.delegation, normalDelegation, scene.id);
      assert.equal(scene.productionTurn.delegation.source, "chat_setting", scene.id);
      assert.equal(scene.productionTurn.runtimeMode, "current_turn_ooc_delegated", scene.id);
    }
  });

  it("changes only the emotion-cue clause on the pinned character request", () => {
    const expectedDelta =
      COMMON_PROSE_EMOTION_CUE_CANDIDATE.length - liveCommonProseEmotionCueBaseline().length;
    for (const scene of packet.scenes) {
      assert.equal(scene.soleAllowedDiff, true, scene.id);
      assert.equal(scene.flatCharDelta, expectedDelta, scene.id);
      assert.equal(scene.baseline.cached.join(), "true,true,false", scene.id);
      assert.equal(scene.candidate.cached.join(), "true,true,false", scene.id);
      assert.doesNotMatch(scene.currentUserMessage, /권태현|에녹|솔|플러드|로코/);
      assert.match(scene.currentUserMessage, /다른 인물은 없다/);
    }
  });

  it("separates the budget estimate from the ungranted stop check", () => {
    const cost = packet.cost.budgetEstimate;
    assert.equal(cost.kind, "budget_estimate");
    assert.equal(cost.enforceable, false);
    assert.equal(cost.calls, 4);
    assert.equal(cost.cacheReadTokens, 0);
    assert.equal(cost.inputUsdPerMillion, 0.3);
    assert.equal(cost.outputUsdPerMillion, 1.2);
    assert.equal(cost.cacheReadUsdPerMillion, 0.006);
    assert.equal(cost.targetMargin, 0.6);
    assert.equal(cost.publishedAt, "2026-09-21T00:00:00.000Z");
    assert.equal(cost.outputTokenCeiling, 8192);
    assert.equal(cost.promptTokenCeiling, cost.largerPromptChars * 2);
    assert.equal(cost.maxTokensSent, false);
    assert.equal(resolveOpenRouterMaxTokens(3200, undefined, packet.modelId), undefined);
    const perCall =
      (cost.promptTokenCeiling / 1_000_000) * 0.3 + (8192 / 1_000_000) * 1.2;
    assert.equal(cost.providerUsd, perCall * 4);
    assert.equal(
      cost.userChargeKrw,
      (cost.providerUsd * cost.fx.effectiveKrwPerUsd) / (1 - 0.6)
    );
    assert.equal(packet.cost.supplierRoute.provider, "cheaperinference");
    assert.equal(packet.cost.supplierRoute.expectedProviderModelId, "deepseek-v4.1-flash");
    assert.equal(packet.cost.supplierRoute.liveCatalogFetched, false);
    assert.equal(packet.cost.approvalBound.granted, false);
    assert.equal(packet.cost.stop.productionMaxTokensOmitted, true);
    assert.equal(packet.cost.stop.singleCallCanExceedBound, true);
    assert.equal(
      bodyCueNextCallAllowed({
        approvedProviderUsd: null,
        observedProviderUsd: 0,
        nextCallWorstCaseUsd: perCall,
      }),
      false
    );
    assert.equal(
      bodyCueNextCallAllowed({
        approvedProviderUsd: BODY_CUE_PROPOSED_APPROVAL.providerUsd,
        observedProviderUsd: 0,
        nextCallWorstCaseUsd: perCall,
      }),
      true
    );
    assert.equal(
      bodyCueNextCallAllowed({
        approvedProviderUsd: BODY_CUE_PROPOSED_APPROVAL.providerUsd,
        observedProviderUsd: 0.99,
        nextCallWorstCaseUsd: perCall,
      }),
      false
    );
  });
});
