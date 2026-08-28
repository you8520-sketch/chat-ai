import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildClientScopedCastImageMetadata,
  createVisualSubjectKey,
  type ClientVisibleVisualSubject,
} from "@/lib/visualSubjects";
import type { CharacterAsset } from "@/lib/characterAssets";
import { countCharacterVisualSubjectOwnedAssets } from "@/lib/characterVisualSubjects";

function asset(url: string, tag: string, visualSubjectKey?: string): CharacterAsset {
  return { url, tag, ...(visualSubjectKey ? { visualSubjectKey } : {}) };
}

describe("chat image client privacy boundary", () => {
  it("preflight omits support registry and savedAppearance for all viewers", () => {
    const key = createVisualSubjectKey();
    const subjects = [
      {
        subjectKey: key,
        name: "비밀NPC",
        savedAppearance: "비밀 외형",
        representativeAssetUrl: "/uploads/hidden.webp",
        sourceCharacterId: null,
      },
    ];
    const assets = [asset("/uploads/main.webp", "main"), asset("/uploads/hidden.webp", "h", key)];
    const preflight = buildClientScopedCastImageMetadata({
      contentKind: "character",
      isCreator: true,
      subjects,
      assets,
      castSelectableAssets: assets.map((row) => ({
        url: row.url,
        tag: row.tag,
        visualSubjectKey: row.visualSubjectKey,
      })),
      visibleNames: [],
      scope: "preflight",
    });
    assert.deepEqual(preflight.configuredCastNames, []);
    assert.deepEqual(preflight.visualSubjects, []);
    assert.equal(
      preflight.castSelectableAssets.some((row) => row.url === "/uploads/hidden.webp"),
      false
    );
    const payload = JSON.stringify(preflight);
    assert.equal(payload.includes("savedAppearance"), false);
    assert.equal(payload.includes("sourceCharacterId"), false);
  });

  it("creator scene scope still omits savedAppearance from client identities", () => {
    const key = createVisualSubjectKey();
    const subjects = [
      {
        subjectKey: key,
        name: "태현",
        savedAppearance: "비밀",
        representativeAssetUrl: "/uploads/a.webp",
        sourceCharacterId: null,
      },
    ];
    const assets = [asset("/uploads/a.webp", "a", key)];
    const scoped = buildClientScopedCastImageMetadata({
      contentKind: "character",
      isCreator: true,
      subjects,
      assets,
      castSelectableAssets: assets.map((row) => ({
        url: row.url,
        tag: row.tag,
        visualSubjectKey: row.visualSubjectKey,
      })),
      visibleNames: ["태현"],
      scope: "source_scoped",
    });
    const clientSubject = scoped.visualSubjects[0] as ClientVisibleVisualSubject | undefined;
    assert.equal(clientSubject?.name, "태현");
    assert.equal(JSON.stringify(scoped.visualSubjects).includes("savedAppearance"), false);
  });

  it("blocks delete helper when owned assets remain", () => {
    const key = createVisualSubjectKey();
    const assets = [asset("/uploads/a.webp", "a", key)];
    assert.equal(countCharacterVisualSubjectOwnedAssets(key, assets), 1);
  });

  it("omits representativeAssetUrl when representative is not viewer-authorized", () => {
    const key = createVisualSubjectKey();
    const subjects = [
      {
        subjectKey: key,
        name: "태현",
        savedAppearance: "비밀",
        representativeAssetUrl: "/uploads/a.webp",
        sourceCharacterId: null,
      },
    ];
    const assets = [asset("/uploads/a.webp", "a", key), asset("/uploads/main.webp", "main")];
    const scoped = buildClientScopedCastImageMetadata({
      contentKind: "character",
      isCreator: false,
      subjects,
      assets,
      castSelectableAssets: [asset("/uploads/main.webp", "main")].map((row) => ({
        url: row.url,
        tag: row.tag,
        visualSubjectKey: row.visualSubjectKey,
      })),
      visibleNames: ["태현"],
      scope: "source_scoped",
    });
    const clientSubject = scoped.visualSubjects[0];
    assert.equal(clientSubject?.name, "태현");
    assert.equal(clientSubject?.representativeAssetUrl, undefined);
  });

  it("hides hidden subject name assets and savedAppearance from non-creator scope", () => {
    const keyVisible = createVisualSubjectKey();
    const keyHidden = createVisualSubjectKey();
    const subjects = [
      {
        subjectKey: keyVisible,
        name: "태현",
        savedAppearance: "공개 외형",
        representativeAssetUrl: "/uploads/a.webp",
        sourceCharacterId: null,
      },
      {
        subjectKey: keyHidden,
        name: "비밀NPC",
        savedAppearance: "숨김 외형",
        representativeAssetUrl: "/uploads/hidden.webp",
        sourceCharacterId: 42,
      },
    ];
    const assets = [
      asset("/uploads/main.webp", "main"),
      asset("/uploads/a.webp", "a", keyVisible),
      asset("/uploads/hidden.webp", "h", keyHidden),
    ];
    const scoped = buildClientScopedCastImageMetadata({
      contentKind: "character",
      isCreator: false,
      subjects,
      assets,
      castSelectableAssets: assets.map((row) => ({
        url: row.url,
        tag: row.tag,
        visualSubjectKey: row.visualSubjectKey,
      })),
      visibleNames: ["태현"],
      scope: "source_scoped",
    });
    const payload = JSON.stringify(scoped);
    assert.equal(scoped.visualSubjects.some((row) => row.name === "비밀NPC"), false);
    assert.equal(
      scoped.castSelectableAssets.some((row) => row.url === "/uploads/hidden.webp"),
      false
    );
    assert.equal(payload.includes("savedAppearance"), false);
    assert.equal(payload.includes("sourceCharacterId"), false);
    assert.equal(payload.includes("숨김 외형"), false);
  });
});
