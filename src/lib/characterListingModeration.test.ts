import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { characterAdultTextBlob, findAdultTermsInText } from "./characterAdultText";
import {
  allAgesAssetChangeRequest,
  allAgesListingBlockReason,
  decideCharacterListing,
  partitionAllAgesTaggingBatch,
} from "./characterListingModeration";
import type { CharacterAsset } from "./characterAssets";

const cleanAsset: CharacterAsset = {
  url: "/uploads/face.webp",
  tag: "무표정",
  adultFlagged: false,
  moderationReject: false,
};
const adultAsset: CharacterAsset = {
  url: "/uploads/nsfw.webp",
  tag: "침실",
  adultFlagged: true,
  moderationReject: false,
};
const rejectedAsset: CharacterAsset = {
  url: "/uploads/reject.webp",
  tag: "반려",
  adultFlagged: false,
  moderationReject: true,
  moderationReason: "정책 위반",
};
const legacyUnknownAsset: CharacterAsset = {
  url: "/uploads/legacy.webp",
  tag: "기쁨",
};

describe("character adult text filter", () => {
  it("flags explicit adult fiction terms and ignores mild romance", () => {
    assert.ok(findAdultTermsInText("첫 만남에서 섹스를 한다").includes("섹스"));
    assert.deepEqual(findAdultTermsInText("키스하고 설레는 데이트"), []);
    assert.ok(findAdultTermsInText("this scene has a blowjob").includes("blowjob"));
  });

  it("scans public listing fields only via the blob helper", () => {
    const blob = characterAdultTextBlob({
      name: "렌",
      tagline: "한 줄",
      description: "본문 섹스",
      greeting: "안녕",
    });
    assert.ok(findAdultTermsInText(blob).includes("섹스"));
  });
});

describe("character listing moderation", () => {
  it("lets all-ages characters go live after a clean text check", () => {
    assert.equal(
      allAgesListingBlockReason({
        nsfw: false,
        visibility: "public",
        adultTextHits: [],
        assets: [cleanAsset],
      }),
      null
    );
    const decided = decideCharacterListing({
      requestedVisibility: "public",
      nsfw: false,
      assets: [cleanAsset],
    });
    assert.equal(decided.moderationStatus, "approved");
    assert.equal(decided.awaitingAdmin, false);
  });

  it("blocks all-ages public listing when the text has adult words", () => {
    const reason = allAgesListingBlockReason({
      nsfw: false,
      visibility: "public",
      adultTextHits: ["섹스"],
      assets: [cleanAsset],
    });
    assert.match(reason ?? "", /성인물 표현/);
  });

  it("does not run or apply a text filter on adult characters", () => {
    assert.equal(
      allAgesListingBlockReason({
        nsfw: true,
        visibility: "public",
        adultTextHits: ["섹스", "정액"],
        assets: [cleanAsset],
      }),
      null
    );
    const decided = decideCharacterListing({
      requestedVisibility: "public",
      nsfw: true,
      assets: [cleanAsset],
    });
    assert.equal(decided.moderationStatus, "approved");
  });

  it("queues adult characters for admin when tagging flags the asset as adult", () => {
    const decided = decideCharacterListing({
      requestedVisibility: "public",
      nsfw: true,
      assets: [adultAsset],
    });
    assert.equal(decided.moderationStatus, "pending");
    assert.equal(decided.finalVisibility, "public");
    assert.equal(decided.awaitingAdmin, true);
  });

  it("asks all-ages creators to change assets flagged adult at tagging", () => {
    const reason = allAgesListingBlockReason({
      nsfw: false,
      visibility: "public",
      adultTextHits: [],
      assets: [adultAsset],
    });
    assert.match(reason ?? "", /바꿔 주세요/);
    const split = partitionAllAgesTaggingBatch([cleanAsset, adultAsset], false);
    assert.deepEqual(
      split.accepted.map((a) => a.url),
      [cleanAsset.url]
    );
    assert.equal(split.rejected.length, 1);
    assert.match(allAgesAssetChangeRequest(1), /바꿔 주세요/);
    assert.deepEqual(partitionAllAgesTaggingBatch([adultAsset], true).accepted, [adultAsset]);
  });

  it("1. nsfw + adultFlagged=true public request is adult-image pending", () => {
    const decided = decideCharacterListing({
      requestedVisibility: "public",
      nsfw: true,
      assets: [adultAsset],
    });
    assert.equal(decided.moderationStatus, "pending");
    assert.equal(decided.awaitingAdmin, true);
    assert.match(decided.moderationNote, /성인 에셋 검열/);
  });

  it("2. nsfw + adultFlagged=false public request is approved", () => {
    const decided = decideCharacterListing({
      requestedVisibility: "public",
      nsfw: true,
      assets: [cleanAsset],
    });
    assert.equal(decided.moderationStatus, "approved");
    assert.equal(decided.awaitingAdmin, false);
  });

  it("3. nsfw + legacy unknown adultFlagged is not fake adult-image pending", () => {
    const decided = decideCharacterListing({
      requestedVisibility: "public",
      nsfw: true,
      assets: [legacyUnknownAsset],
    });
    assert.equal(decided.moderationStatus, "approved");
    assert.equal(decided.awaitingAdmin, false);
    assert.doesNotMatch(decided.moderationNote, /성인 에셋 검열/);
    assert.match(decided.moderationNote, /레거시/);
  });

  it("4. private-skip approved must not bypass adult review on public switch", () => {
    const decided = decideCharacterListing({
      requestedVisibility: "public",
      nsfw: true,
      assets: [adultAsset],
      existing: {
        shareSlug: null,
        visibility: "private",
        moderationStatus: "approved",
        moderationNote: "비공개 — 검수 생략",
        imageUrls: [adultAsset.url],
        nsfw: true,
      },
    });
    assert.equal(decided.moderationStatus, "pending");
    assert.equal(decided.awaitingAdmin, true);
  });

  it("4b. public prior image approval is still reusable for the same assets", () => {
    const decided = decideCharacterListing({
      requestedVisibility: "public",
      nsfw: true,
      assets: [cleanAsset],
      existing: {
        shareSlug: "abc",
        visibility: "public",
        moderationStatus: "approved",
        moderationNote: "관리자 승인",
        imageUrls: [cleanAsset.url],
        nsfw: true,
      },
    });
    assert.equal(decided.moderationStatus, "approved");
    assert.equal(decided.awaitingAdmin, false);
  });

  it("5. changed image list does not reuse the old approval", () => {
    const decided = decideCharacterListing({
      requestedVisibility: "public",
      nsfw: true,
      assets: [adultAsset],
      existing: {
        shareSlug: null,
        visibility: "private",
        moderationStatus: "approved",
        imageUrls: [cleanAsset.url],
        nsfw: true,
      },
    });
    assert.equal(decided.moderationStatus, "pending");
    assert.equal(decided.awaitingAdmin, true);
  });

  it("6. moderationReject keeps the existing rejection behavior", () => {
    const decided = decideCharacterListing({
      requestedVisibility: "public",
      nsfw: true,
      assets: [rejectedAsset],
    });
    assert.equal(decided.moderationStatus, "rejected");
    assert.equal(decided.finalVisibility, "private");
    assert.equal(decided.awaitingAdmin, false);
    assert.equal(decided.moderationNote, "정책 위반");
  });

  it("official characters never enter ordinary adult-image pending", () => {
    const decided = decideCharacterListing({
      requestedVisibility: "public",
      nsfw: true,
      official: true,
      assets: [adultAsset],
    });
    assert.equal(decided.moderationStatus, "approved");
    assert.equal(decided.awaitingAdmin, false);
  });
});
