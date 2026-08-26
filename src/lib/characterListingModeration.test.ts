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
const ambiguousAsset: CharacterAsset = {
  url: "/uploads/back.webp",
  tag: "등짝",
  adultFlagged: true,
  moderationReject: false,
};
const rejectedAsset: CharacterAsset = {
  url: "/uploads/reject.webp",
  tag: "반려",
  adultFlagged: false,
  moderationReject: true,
  moderationReason: "유두 노출",
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
  it("lets all-ages characters go live when assets are clear", () => {
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
  });

  it("queues NSFW and all-ages public saves when assets are ambiguous", () => {
    for (const nsfw of [true, false]) {
      const decided = decideCharacterListing({
        requestedVisibility: "public",
        nsfw,
        assets: [ambiguousAsset],
      });
      assert.equal(decided.moderationStatus, "pending", `nsfw=${nsfw}`);
      assert.equal(decided.awaitingAdmin, true);
      assert.match(decided.moderationNote, /애매한 선정성/);
    }
  });

  it("approves NSFW immediately when assets are clear", () => {
    const decided = decideCharacterListing({
      requestedVisibility: "public",
      nsfw: true,
      assets: [cleanAsset],
    });
    assert.equal(decided.moderationStatus, "approved");
    assert.equal(decided.awaitingAdmin, false);
  });

  it("allows ambiguous assets on all-ages upload but hard-rejects nipples/genitals", () => {
    assert.equal(
      allAgesListingBlockReason({
        nsfw: false,
        visibility: "public",
        adultTextHits: [],
        assets: [ambiguousAsset],
      }),
      null
    );
    const split = partitionAllAgesTaggingBatch([cleanAsset, ambiguousAsset, rejectedAsset], false);
    assert.deepEqual(
      split.accepted.map((a) => a.url),
      [cleanAsset.url, ambiguousAsset.url]
    );
    assert.equal(split.rejected.length, 1);
    assert.match(allAgesAssetChangeRequest(1), /유두·성기·항문/);
    assert.deepEqual(partitionAllAgesTaggingBatch([ambiguousAsset], true).accepted, [ambiguousAsset]);
  });

  it("legacy unknown adultFlagged does not fake admin pending", () => {
    const decided = decideCharacterListing({
      requestedVisibility: "public",
      nsfw: true,
      assets: [legacyUnknownAsset],
    });
    assert.equal(decided.moderationStatus, "approved");
    assert.equal(decided.awaitingAdmin, false);
    assert.match(decided.moderationNote, /레거시/);
  });

  it("private to public re-evaluates ambiguous assets into pending", () => {
    const decided = decideCharacterListing({
      requestedVisibility: "public",
      nsfw: true,
      assets: [ambiguousAsset],
      existing: {
        shareSlug: null,
        visibility: "private",
        moderationStatus: "approved",
        moderationNote: "비공개 — 검수 생략",
        imageUrls: [ambiguousAsset.url],
        nsfw: true,
      },
    });
    assert.equal(decided.moderationStatus, "pending");
    assert.equal(decided.awaitingAdmin, true);
  });

  it("reuses prior public approval for unchanged clear assets", () => {
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

  it("moderationReject keeps hard rejection for both ratings", () => {
    for (const nsfw of [true, false]) {
      const decided = decideCharacterListing({
        requestedVisibility: "public",
        nsfw,
        assets: [rejectedAsset],
      });
      assert.equal(decided.moderationStatus, "rejected");
      assert.equal(decided.finalVisibility, "private");
      assert.equal(decided.awaitingAdmin, false);
    }
  });

  it("official characters never enter ordinary admin pending", () => {
    const decided = decideCharacterListing({
      requestedVisibility: "public",
      nsfw: true,
      official: true,
      assets: [ambiguousAsset],
    });
    assert.equal(decided.moderationStatus, "approved");
    assert.equal(decided.awaitingAdmin, false);
  });
});
