import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ASSET_VISION_REJECT_RULES,
  ASSET_VISION_REVIEW_RULES,
  buildAssetVisionPrompt,
  isAssetHardRejected,
  isAssetNeedsAdminReview,
} from "@/lib/assetVisionPolicy";
import { decideCharacterListing } from "@/lib/characterListingModeration";
import type { CharacterAsset } from "@/lib/characterAssets";

describe("assetVisionPolicy", () => {
  it("reject tier is nipples and genitals only", () => {
    assert.match(ASSET_VISION_REJECT_RULES, /여성 유두/);
    assert.match(ASSET_VISION_REJECT_RULES, /성기·항문/);
  });

  it("review tier is ambiguous suggestive (not back-only)", () => {
    const reviewTrueLine = ASSET_VISION_REVIEW_RULES.split("\n")[0] ?? "";
    assert.match(reviewTrueLine, /애매/);
    assert.doesNotMatch(reviewTrueLine, /등짝/);
    assert.match(ASSET_VISION_REVIEW_RULES, /후면 등짝/);
  });

  it("prompt documents three-tier flow and person/background split", () => {
    const prompt = buildAssetVisionPrompt();
    assert.match(prompt, /관리자 검수/);
    assert.match(prompt, /성인용·일반용 공통/);
    assert.match(prompt, /imageType="person"/);
    assert.match(prompt, /PERSON_TAGS:/);
    assert.match(prompt, /키스\+부끄러움→키스/);
    assert.match(prompt, /tag 선택이 adult\/reject를 자동으로 정하지 않는다/);
    assert.doesNotMatch(prompt, /좋은 예:/);
  });

  it("documents adult-RP tag semantics without changing moderation rules", () => {
    assert.equal(ASSET_VISION_REJECT_RULES.includes("여성 유두"), true);
    assert.equal(ASSET_VISION_REVIEW_RULES.includes("키스"), true);
    const prompt = buildAssetVisionPrompt();
    assert.match(prompt, /키스 = 입맞춤이 명확히 보임/);
    assert.match(prompt, /애정 = 다정함·사랑스러움/);
    assert.match(prompt, /로맨틱=장면 전체 분위기/);
  });

  it("helpers distinguish hard reject vs admin review", () => {
    assert.equal(isAssetHardRejected({ moderationReject: true }), true);
    assert.equal(isAssetNeedsAdminReview({ adultFlagged: true }), true);
    assert.equal(
      isAssetNeedsAdminReview({ adultFlagged: true, moderationReject: true }),
      false
    );
  });
});

describe("three-tier listing policy", () => {
  const clear: CharacterAsset = {
    url: "/uploads/clear.webp",
    tag: "미소",
    adultFlagged: false,
    moderationReject: false,
  };
  const ambiguous: CharacterAsset = {
    url: "/uploads/back.webp",
    tag: "등짝",
    adultFlagged: true,
    moderationReject: false,
  };
  const hardReject: CharacterAsset = {
    url: "/uploads/bad.webp",
    tag: "반려",
    adultFlagged: false,
    moderationReject: true,
    moderationReason: "유두 노출",
  };

  it("NSFW + clear → immediate approve", () => {
    const decided = decideCharacterListing({
      requestedVisibility: "public",
      nsfw: true,
      assets: [clear],
    });
    assert.equal(decided.moderationStatus, "approved");
    assert.equal(decided.awaitingAdmin, false);
  });

  it("NSFW + ambiguous → admin pending", () => {
    const decided = decideCharacterListing({
      requestedVisibility: "public",
      nsfw: true,
      assets: [ambiguous],
    });
    assert.equal(decided.moderationStatus, "pending");
    assert.equal(decided.awaitingAdmin, true);
  });

  it("NSFW + nipples/genitals → hard reject", () => {
    const decided = decideCharacterListing({
      requestedVisibility: "public",
      nsfw: true,
      assets: [hardReject],
    });
    assert.equal(decided.moderationStatus, "rejected");
    assert.equal(decided.finalVisibility, "private");
  });

  it("all-ages + ambiguous → admin pending (not upload block at save)", () => {
    const decided = decideCharacterListing({
      requestedVisibility: "public",
      nsfw: false,
      assets: [ambiguous],
    });
    assert.equal(decided.moderationStatus, "pending");
    assert.equal(decided.awaitingAdmin, true);
  });

  it("all-ages + clear → immediate approve", () => {
    const decided = decideCharacterListing({
      requestedVisibility: "public",
      nsfw: false,
      assets: [clear],
    });
    assert.equal(decided.moderationStatus, "approved");
  });
});
