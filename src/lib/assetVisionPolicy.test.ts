import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAssetVisionPrompt, ASSET_VISION_REJECT_RULES } from "@/lib/assetVisionPolicy";
import { decideCharacterListing } from "@/lib/characterListingModeration";
import type { CharacterAsset } from "@/lib/characterAssets";

describe("assetVisionPolicy", () => {
  it("reject policy is genitals and hard violations only", () => {
    assert.match(ASSET_VISION_REJECT_RULES, /성기·항문 노출/);
    assert.match(ASSET_VISION_REJECT_RULES, /reject=false.*등짝/s);
  });

  it("prompt states adult meta is for all-ages upload filter only", () => {
    const prompt = buildAssetVisionPrompt();
    assert.match(prompt, /일반 캐릭터 업로드 필터 전용/);
    assert.match(prompt, /성인용 캐릭터 공개/);
  });
});

describe("nsfw listing uses reject only", () => {
  const suggestive: CharacterAsset = {
    url: "/uploads/back.webp",
    tag: "등짝",
    adultFlagged: true,
    moderationReject: false,
  };

  it("approves nsfw public listing when only adult metadata is set", () => {
    const decided = decideCharacterListing({
      requestedVisibility: "public",
      nsfw: true,
      assets: [suggestive],
    });
    assert.equal(decided.moderationStatus, "approved");
    assert.equal(decided.awaitingAdmin, false);
  });

  it("rejects nsfw public listing only on moderationReject", () => {
    const decided = decideCharacterListing({
      requestedVisibility: "public",
      nsfw: true,
      assets: [{ ...suggestive, moderationReject: true, moderationReason: "성기 노출" }],
    });
    assert.equal(decided.moderationStatus, "rejected");
    assert.equal(decided.finalVisibility, "private");
  });
});
