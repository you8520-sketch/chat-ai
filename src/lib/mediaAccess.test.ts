import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decidePrivateMediaAccess, decidePublicMediaAccess, projectAssetsForViewer } from "@/lib/mediaAccess";
import type { CharacterAsset } from "@/lib/characterAssets";

const user = { id: 9, email: "user@example.com" };

describe("mediaAccess", () => {
  it("denies guests and reviewers without creator/admin/unlock", () => {
    assert.equal(
      decidePrivateMediaAccess({
        user: null,
        isAdmin: false,
        owningCharacters: [{ id: 1, creator_id: 3, assets: [] }],
        unlockedByChat: false,
        uploadedByUser: false,
      }).ok,
      false
    );
    assert.equal(
      decidePrivateMediaAccess({
        user,
        isAdmin: false,
        owningCharacters: [{ id: 1, creator_id: 3, assets: [] }],
        unlockedByChat: false,
        uploadedByUser: false,
      }).ok,
      false
    );
  });

  it("grants trusted owner, admin, chat-scoped unlock, and unlinked uploader only", () => {
    assert.equal(
      decidePrivateMediaAccess({
        user,
        isAdmin: false,
        trustedOwner: true,
        owningCharacters: [{ id: 1, creator_id: 9, assets: [] }],
        unlockedByChat: false,
        uploadedByUser: true,
      }).reason,
      "creator"
    );
    assert.equal(
      decidePrivateMediaAccess({
        user,
        isAdmin: true,
        owningCharacters: [],
        unlockedByChat: false,
        uploadedByUser: false,
      }).reason,
      "admin"
    );
    assert.equal(
      decidePrivateMediaAccess({
        user,
        isAdmin: false,
        owningCharacters: [{ id: 1, creator_id: 3, assets: [] }],
        unlockedByChat: true,
        uploadedByUser: false,
        chatContext: { requestedChatId: 4, chatBelongsToUser: true, chatCharacterId: 1 },
      }).reason,
      "chat_unlock"
    );
    assert.equal(
      decidePrivateMediaAccess({
        user,
        isAdmin: false,
        owningCharacters: [],
        unlockedByChat: false,
        uploadedByUser: true,
      }).reason,
      "uploader"
    );
  });

  it("does not keep private originals or media ids in public viewer projection", () => {
    const assets: CharacterAsset[] = [
      {
        url: "/media/private/hidden.webp",
        tag: "분노",
        viewerBlur: true,
        mediaId: "hidden-id",
        publicRenditionUrl: "/media/public/hidden-public.webp",
        blurPreviewUrl: "/media/public/hidden-blur.webp",
      },
    ];
    const projected = projectAssetsForViewer(assets, { canSeeOriginals: false });
    assert.equal(projected[0]?.url, "/media/public/hidden-blur.webp");
    assert.equal(JSON.stringify(projected).includes("/media/private/"), false);
    assert.equal(JSON.stringify(projected).includes("mediaId"), false);
    assert.equal(JSON.stringify(projected).includes("-public.webp"), false);
  });

  it("serves blur for anyone and sharp public renditions only when approved", () => {
    assert.equal(
      decidePublicMediaAccess({ filename: "abc-blur.webp", approvedRepresentative: false }).ok,
      true
    );
    assert.equal(
      decidePublicMediaAccess({ filename: "abc-public.webp", approvedRepresentative: false }).ok,
      false
    );
    assert.equal(
      decidePublicMediaAccess({ filename: "abc-public.webp", approvedRepresentative: true }).ok,
      true
    );
  });
});
