import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CharacterAsset } from "@/lib/characterAssets";
import { createVisualSubjectKey } from "@/lib/visualSubjects";
import { resolveServerVisualSubjectScope } from "@/lib/chatImageCastManifest";

function asset(url: string, tag: string, visualSubjectKey?: string): CharacterAsset {
  return { url, tag, ...(visualSubjectKey ? { visualSubjectKey } : {}) };
}

describe("resolveServerVisualSubjectScope", () => {
  it("scopes non-creator trusted subjects to canonical source names only", () => {
    const keyVisible = createVisualSubjectKey();
    const keyHidden = createVisualSubjectKey();
    const subjects = [
      {
        subjectKey: keyVisible,
        name: "태현",
        savedAppearance: "공개",
        representativeAssetUrl: "/uploads/a.webp",
        sourceCharacterId: null,
      },
      {
        subjectKey: keyHidden,
        name: "비밀NPC",
        savedAppearance: "숨김",
        representativeAssetUrl: "/uploads/hidden.webp",
        sourceCharacterId: null,
      },
    ];
    const assets = [
      asset("/uploads/main.webp", "main"),
      asset("/uploads/a.webp", "a", keyVisible),
      asset("/uploads/hidden.webp", "h", keyHidden),
    ];
    const scope = resolveServerVisualSubjectScope({
      contentKind: "character",
      isCreator: false,
      allSubjects: subjects,
      assets,
      allCastSelectableAssets: assets.map((row) => ({
        url: row.url,
        tag: row.tag,
        visualSubjectKey: row.visualSubjectKey,
      })),
      configuredNames: ["태현", "비밀NPC"],
      canonicalSourceTexts: ["태현이 등장한다"],
    });
    assert.equal(scope.trustedSubjects.length, 1);
    assert.equal(scope.trustedSubjects[0]?.name, "태현");
    assert.equal(scope.clientSubjects.some((row) => row.name === "비밀NPC"), false);
    assert.equal(
      scope.viewerSelectableAssets.some((row) => row.url === "/uploads/hidden.webp"),
      false
    );
  });

  it("does not elevate hidden subjects from manual preview source for non-creator", () => {
    const keyHidden = createVisualSubjectKey();
    const subjects = [
      {
        subjectKey: keyHidden,
        name: "비밀NPC",
        savedAppearance: "숨김",
        representativeAssetUrl: "/uploads/hidden.webp",
        sourceCharacterId: null,
      },
    ];
    const assets = [asset("/uploads/hidden.webp", "h", keyHidden)];
    const scope = resolveServerVisualSubjectScope({
      contentKind: "character",
      isCreator: false,
      allSubjects: subjects,
      assets,
      allCastSelectableAssets: assets.map((row) => ({
        url: row.url,
        tag: row.tag,
        visualSubjectKey: row.visualSubjectKey,
      })),
      configuredNames: ["비밀NPC"],
      canonicalSourceTexts: [],
    });
    assert.equal(scope.trustedSubjects.length, 0);
    assert.equal(scope.clientSubjects.length, 0);
  });
});
