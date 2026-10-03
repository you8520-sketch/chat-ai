import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import {
  countRepresentativeSelections,
  getCharacterRepresentativePublicUrls,
  listingImageUrls,
  normalizeCharacterAssets,
  representativeSelectionError,
} from "@/lib/characterAssets";
import { canPublishAsRepresentative } from "@/lib/assetVisionPolicy";
import {
  bindTrustedCharacterMedia,
  decidePrivateMediaAccess,
  decidePublicMediaAccess,
  projectAssetsForViewer,
} from "@/lib/mediaAccess";
import {
  publicMediaUrl,
  readMediaManifest,
  resolveExistingPublicMediaPath,
  storePrivateMedia,
  writeMediaManifest,
} from "@/lib/mediaStorage";

const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const viewer = { id: 9, email: "user@example.com" };

describe("review #1345 MUST FIX fixtures", () => {
  const previous = process.env.DATA_DIR;
  let dataDir = "";

  before(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hav-media-acl-"));
    process.env.DATA_DIR = dataDir;
  });

  after(() => {
    if (previous == null) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("1. non-representative sharp public rendition is not issued or served", async () => {
    const stored = await storePrivateMedia(PIXEL_PNG, "image/png", 42);
    assert.equal(resolveExistingPublicMediaPath(`${stored.mediaId}-public.webp`), null);
    assert.ok(resolveExistingPublicMediaPath(`${stored.mediaId}-blur.webp`));
    assert.equal(
      decidePublicMediaAccess({
        filename: `${stored.mediaId}-public.webp`,
        approvedRepresentative: false,
      }).ok,
      false
    );
    assert.equal(
      decidePublicMediaAccess({
        filename: `${stored.mediaId}-blur.webp`,
        approvedRepresentative: false,
      }).ok,
      true
    );
  });

  it("2. attaching another user's private mediaId is rejected and does not grant creator GET", async () => {
    const victim = await storePrivateMedia(PIXEL_PNG, "image/png", 7);
    const stolen = bindTrustedCharacterMedia(
      [
        {
          url: victim.url,
          tag: "분노",
          mediaId: victim.mediaId,
          publicRenditionUrl: victim.publicRenditionUrl,
          blurPreviewUrl: victim.blurPreviewUrl,
        },
      ],
      9
    );
    assert.equal(stolen.ok, false);

    const decision = decidePrivateMediaAccess({
      user: viewer,
      isAdmin: false,
      trustedOwner: false,
      unlockedByChat: false,
      uploadedByUser: false,
      owningCharacters: [
        {
          id: 88,
          creator_id: 9,
          assets: [{ url: victim.url, tag: "분노", mediaId: victim.mediaId }],
        },
      ],
    });
    assert.equal(decision.ok, false);
  });

  it("3. client-stripped moderation flags cannot publish a ledger-rejected representative", async () => {
    const stored = await storePrivateMedia(PIXEL_PNG, "image/png", 9);
    const filename = `${stored.mediaId}.webp`;
    await writeMediaManifest(filename, {
      uploadedBy: 9,
      createdAt: new Date().toISOString(),
      contentType: "image/webp",
      adultFlagged: true,
      moderationReject: true,
      moderationReason: "남성 유두 노출",
    });
    const bound = bindTrustedCharacterMedia(
      [
        {
          url: stored.url,
          tag: "대표",
          mediaId: stored.mediaId,
          representativeRank: 1,
          adultFlagged: false,
          moderationReject: false,
        },
      ],
      9
    );
    assert.equal(bound.ok, true);
    if (!bound.ok) return;
    assert.equal(canPublishAsRepresentative(bound.assets[0]!).ok, false);
    assert.match(bound.assets[0]?.moderationReason ?? "", /유두/);
  });

  it("3b. uncertain adultFlagged hold blocks public rendition, not private save", async () => {
    const stored = await storePrivateMedia(PIXEL_PNG, "image/png", 9);
    await writeMediaManifest(`${stored.mediaId}.webp`, {
      uploadedBy: 9,
      createdAt: new Date().toISOString(),
      contentType: "image/webp",
      adultFlagged: true,
      moderationReject: false,
      moderationReason: "경계",
    });
    const bound = bindTrustedCharacterMedia(
      [
        {
          url: stored.url,
          tag: "대표",
          mediaId: stored.mediaId,
          representativeRank: 1,
          adultFlagged: false,
        },
      ],
      9
    );
    assert.equal(bound.ok, true);
    if (!bound.ok) return;
    assert.equal(bound.assets[0]?.adultFlagged, true);
    assert.equal(canPublishAsRepresentative(bound.assets[0]!).ok, false);
    assert.equal(
      decidePublicMediaAccess({
        filename: `${stored.mediaId}-public.webp`,
        approvedRepresentative: canPublishAsRepresentative(bound.assets[0]!).ok,
      }).ok,
      false
    );
  });

  it("4. public/chat projection is an allowlist and unlock is chat-scoped", () => {
    const hidden = {
      url: "/media/private/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa.webp",
      tag: "분노",
      viewerBlur: true,
      mediaId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
      publicRenditionUrl: "/media/public/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa-public.webp",
      blurPreviewUrl: "/media/public/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa-blur.webp",
    };
    const projected = projectAssetsForViewer([hidden], { canSeeOriginals: false });
    const payload = JSON.stringify(projected);
    assert.equal(payload.includes("/media/private/"), false);
    assert.equal(payload.includes("mediaId"), false);
    assert.equal(payload.includes("-public.webp"), false);
    assert.equal(projected[0]?.url, hidden.blurPreviewUrl);

    const missingChat = decidePrivateMediaAccess({
      user: viewer,
      isAdmin: false,
      trustedOwner: false,
      unlockedByChat: true,
      uploadedByUser: false,
      owningCharacters: [{ id: 1, creator_id: 3, assets: [hidden] }],
      chatContext: { requestedChatId: null, chatBelongsToUser: false, chatCharacterId: null },
    });
    assert.equal(missingChat.ok, false);

    const otherUsersChat = decidePrivateMediaAccess({
      user: viewer,
      isAdmin: false,
      trustedOwner: false,
      unlockedByChat: true,
      uploadedByUser: false,
      owningCharacters: [{ id: 1, creator_id: 3, assets: [hidden] }],
      chatContext: { requestedChatId: 99, chatBelongsToUser: false, chatCharacterId: 1 },
    });
    assert.equal(otherUsersChat.ok, false);

    const otherRoom = decidePrivateMediaAccess({
      user: viewer,
      isAdmin: false,
      trustedOwner: false,
      unlockedByChat: false,
      uploadedByUser: false,
      owningCharacters: [{ id: 1, creator_id: 3, assets: [hidden] }],
      chatContext: { requestedChatId: 5, chatBelongsToUser: true, chatCharacterId: 1 },
    });
    assert.equal(otherRoom.ok, false);

    const sameRoom = decidePrivateMediaAccess({
      user: viewer,
      isAdmin: false,
      trustedOwner: false,
      unlockedByChat: true,
      uploadedByUser: false,
      owningCharacters: [{ id: 1, creator_id: 3, assets: [hidden] }],
      chatContext: { requestedChatId: 5, chatBelongsToUser: true, chatCharacterId: 1 },
    });
    assert.equal(sameRoom.ok, true);
    if (sameRoom.ok) assert.equal(sameRoom.reason, "chat_unlock");
  });

  it("5. NSFW chat_unlock reuses canAccessAdultContent and denies non-admin viewers", () => {
    const mediaAccess = fs.readFileSync(path.join(process.cwd(), "src/lib/mediaAccess.ts"), "utf8");
    const adultOnThisBranch = fs.readFileSync(
      path.join(process.cwd(), "src/lib/adultVerification.ts"),
      "utf8"
    );
    assert.match(mediaAccess, /from ["']@\/lib\/adultVerification["']/);
    assert.match(mediaAccess, /canAccessAdultContent\s*\(/);
    assert.doesNotMatch(mediaAccess, /canUseCreatorTools\s*\(/);
    assert.match(adultOnThisBranch, /export function canAccessAdultContent/);
    const nsfwAssets = [{ url: "/media/private/x.webp", tag: "분노", viewerBlur: true }];
    const unlockWithoutAdultGate = decidePrivateMediaAccess({
      user: viewer,
      isAdmin: false,
      trustedOwner: false,
      unlockedByChat: true,
      uploadedByUser: false,
      owningCharacters: [
        {
          id: 2,
          creator_id: 3,
          nsfw: 1,
          assets: nsfwAssets,
        },
      ],
      chatContext: { requestedChatId: 8, chatBelongsToUser: true, chatCharacterId: 2 },
    });
    assert.equal(unlockWithoutAdultGate.ok, false);
    const adminUnlock = decidePrivateMediaAccess({
      user: { id: 1, email: "admin@example.com", is_admin: 1 },
      isAdmin: true,
      trustedOwner: false,
      unlockedByChat: true,
      uploadedByUser: false,
      owningCharacters: [
        {
          id: 2,
          creator_id: 3,
          nsfw: 1,
          assets: nsfwAssets,
        },
      ],
      chatContext: { requestedChatId: 8, chatBelongsToUser: true, chatCharacterId: 2 },
    });
    assert.equal(adminUnlock.ok, true);
    if (adminUnlock.ok) assert.equal(adminUnlock.reason, "admin");
  });

  it("6. API 0 and 6 representative selections error; 1-5 persist in order", () => {
    const zero = [{ url: "/uploads/a.webp", tag: "기본" }];
    assert.equal(countRepresentativeSelections(zero), 0);
    assert.match(representativeSelectionError(zero) ?? "", /1장 이상/);
    assert.deepEqual(listingImageUrls(normalizeCharacterAssets(zero)), ["/uploads/a.webp"]);

    const six = [1, 2, 3, 4, 5, 6].map((n) => ({
      url: `/uploads/${n}.webp`,
      tag: String(n),
      representativeRank: n,
    }));
    assert.equal(countRepresentativeSelections(six), 6);
    assert.match(representativeSelectionError(six) ?? "", /최대 5장/);
    assert.equal(representativeSelectionError(six.slice(0, 5)), null);

    const ordered = normalizeCharacterAssets([
      { url: "/uploads/c.webp", tag: "c", representativeRank: 3, publicRenditionUrl: "/media/public/c-public.webp" },
      { url: "/uploads/a.webp", tag: "a", representativeRank: 1, publicRenditionUrl: "/media/public/a-public.webp" },
      { url: "/uploads/b.webp", tag: "b", representativeRank: 2, publicRenditionUrl: "/media/public/b-public.webp" },
    ]);
    assert.deepEqual(getCharacterRepresentativePublicUrls(JSON.stringify(ordered)), [
      "/media/public/a-public.webp",
      "/media/public/b-public.webp",
      "/media/public/c-public.webp",
    ]);
  });

  it("trusted uploader still binds their own unlinked media", async () => {
    const stored = await storePrivateMedia(PIXEL_PNG, "image/png", 9);
    const bound = bindTrustedCharacterMedia(
      [{ url: stored.url, tag: "미소", mediaId: stored.mediaId, representativeRank: 1 }],
      9
    );
    assert.equal(bound.ok, true);
    if (!bound.ok) return;
    assert.equal(bound.assets[0]?.mediaId, stored.mediaId);
    assert.equal(readMediaManifest(`${stored.mediaId}.webp`)?.uploadedBy, 9);
    assert.equal(bound.assets[0]?.publicRenditionUrl, publicMediaUrl(`${stored.mediaId}-public.webp`));
  });
});
