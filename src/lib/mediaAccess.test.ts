import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decidePrivateMediaAccess, projectAssetsForViewer } from "@/lib/mediaAccess";
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

  it("grants creator, admin, chat unlock, and unlinked uploader only", () => {
    assert.equal(
      decidePrivateMediaAccess({
        user,
        isAdmin: false,
        owningCharacters: [{ id: 1, creator_id: 9, assets: [] }],
        unlockedByChat: false,
        uploadedByUser: false,
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

  it("does not keep private originals in public viewer projection", () => {
    const assets: CharacterAsset[] = [
      {
        url: "/media/private/hidden.webp",
        tag: "분노",
        viewerBlur: true,
        blurPreviewUrl: "/media/public/hidden-blur.webp",
      },
    ];
    const projected = projectAssetsForViewer(assets, { canSeeOriginals: false });
    assert.equal(projected[0]?.url, "/media/public/hidden-blur.webp");
    assert.equal(JSON.stringify(projected).includes("/media/private/"), false);
  });
});
