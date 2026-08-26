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
  it("documents back-only adult=false in vision.ts", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("./vision.ts", import.meta.url), "utf8");
    assert.match(src, /등짝 노출 포함/);
    assert.match(src, /normalizeVisionModerationFlags/);
    assert.doesNotMatch(src, /adult=true: 성인용으로 보이는 노출/);
  });
});
