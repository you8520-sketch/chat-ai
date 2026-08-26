import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeVisionModerationFlags } from "@/lib/visionModerationNormalize";

describe("normalizeVisionModerationFlags", () => {
  it("clears adult for back-only exposure hints", () => {
    const out = normalizeVisionModerationFlags({
      tag: "등짝",
      adultFlagged: true,
      moderationReject: false,
      moderationReason: "등 노출",
    });
    assert.equal(out.adultFlagged, false);
    assert.equal(out.moderationReject, false);
  });

  it("clears adult for rear-view tags without sexual surfaces", () => {
    const out = normalizeVisionModerationFlags({
      tag: "뒤돌아섬",
      adultFlagged: true,
      moderationReject: false,
      moderationReason: "후면 전신",
    });
    assert.equal(out.adultFlagged, false);
  });

  it("keeps adult when front chest exposure is mentioned", () => {
    const out = normalizeVisionModerationFlags({
      tag: "부끄러움",
      adultFlagged: true,
      moderationReject: false,
      moderationReason: "전면 가슴 노출",
    });
    assert.equal(out.adultFlagged, true);
  });

  it("never clears hard rejects", () => {
    const out = normalizeVisionModerationFlags({
      tag: "등짝",
      adultFlagged: true,
      moderationReject: true,
      moderationReason: "성기 노출",
    });
    assert.equal(out.moderationReject, true);
    assert.equal(out.adultFlagged, true);
  });

  it("keeps adult for suggestive pose even with back tag", () => {
    const out = normalizeVisionModerationFlags({
      tag: "등짝",
      adultFlagged: true,
      moderationReject: false,
      moderationReason: "엉덩이 강조 포즈",
    });
    assert.equal(out.adultFlagged, true);
  });
});

describe("vision prompt policy wiring", () => {
  it("documents three-tier policy in shared asset vision module", async () => {
    const fs = await import("node:fs");
    const policy = fs.readFileSync(new URL("./assetVisionPolicy.ts", import.meta.url), "utf8");
    const vision = fs.readFileSync(new URL("./vision.ts", import.meta.url), "utf8");
    assert.match(policy, /여성 유두/);
    assert.match(policy, /관리자 검수/);
    assert.doesNotMatch(policy, /ASSET_VISION_ADULT_META/);
    assert.match(vision, /buildAssetVisionPrompt/);
    assert.match(vision, /normalizeVisionModerationFlags/);
  });
});
