import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COMMON_PROSE_EMOTION_CUE_CANDIDATE,
  COMMON_PROSE_EMOTION_CUE_BASELINE,
} from "@/lib/advancedProseNsfwGuidelines";
import { buildBodyCueReviewPacket } from "./mainRpBodyCuePreflight";
import { buildCanonicalRpQualificationCases } from "./rpModelQualificationFixture";

describe("Main RP body-cue preflight", () => {
  const packet = buildBodyCueReviewPacket();

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
    assert.equal(packet.scenes[0]?.baseline.systemFlatSha256, packet.scenes[1]?.baseline.systemFlatSha256);
    assert.equal(packet.source.characterName, "라이크");
    assert.equal(packet.source.personaName, "렌");
  });

  it("changes only the emotion-cue clause on the pinned character request", () => {
    const expectedDelta =
      COMMON_PROSE_EMOTION_CUE_CANDIDATE.length - COMMON_PROSE_EMOTION_CUE_BASELINE.length;
    for (const scene of packet.scenes) {
      assert.equal(scene.soleAllowedDiff, true, scene.id);
      assert.equal(scene.flatCharDelta, expectedDelta, scene.id);
      assert.equal(scene.baseline.cached.join(), "true,true,false", scene.id);
      assert.equal(scene.candidate.cached.join(), "true,true,false", scene.id);
      assert.doesNotMatch(scene.currentUserMessage, /권태현|에녹|솔|플러드|로코/);
      assert.match(scene.currentUserMessage, /다른 인물은 없다/);
    }
  });

  it("prices four uncached DeepSeek calls from the published charge formula", () => {
    const cost = packet.costCeiling;
    assert.equal(cost.calls, 4);
    assert.equal(cost.cacheReadTokens, 0);
    assert.equal(cost.inputUsdPerMillion, 0.3);
    assert.equal(cost.outputUsdPerMillion, 1.2);
    assert.equal(cost.targetMargin, 0.6);
    assert.equal(cost.outputTokenCeiling, 8192);
    assert.equal(cost.promptTokenCeiling, cost.largerPromptChars * 2);
    const perCall =
      (cost.promptTokenCeiling / 1_000_000) * 0.3 + (8192 / 1_000_000) * 1.2;
    assert.equal(cost.providerUsd, perCall * 4);
    assert.equal(
      cost.userChargeKrw,
      (cost.providerUsd * cost.fx.effectiveKrwPerUsd) / (1 - 0.6)
    );
    assert.ok(cost.providerUsd < 1);
    assert.ok(cost.userChargeKrw < 5000);
  });
});
