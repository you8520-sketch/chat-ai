import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CharacterAsset } from "@/lib/characterAssets";
import { createVisualSubjectKey } from "@/lib/visualSubjects";
import {
  groundCastIntent,
  type GroundCastContext,
} from "@/lib/chatImageCastManifest";
import type { ChatImageCastIntentManifest } from "@/lib/chatImageCast";

const PERSONA_URL = "/uploads/persona.webp";
const MAIN_URL = "/uploads/main.webp";
const SUPPORT_A_URL = "/uploads/support-a.webp";
const SUPPORT_B_URL = "/uploads/support-b.webp";

function asset(url: string, tag: string, visualSubjectKey?: string): CharacterAsset {
  return { url, tag, ...(visualSubjectKey ? { visualSubjectKey } : {}) };
}

function characterGroundCtx(opts: {
  keyA: string;
  keyB?: string;
  appearanceA?: string;
}): GroundCastContext {
  const assets = [
    asset(MAIN_URL, "main"),
    asset(SUPPORT_A_URL, "A", opts.keyA),
    ...(opts.keyB ? [asset(SUPPORT_B_URL, "B", opts.keyB)] : []),
  ];
  return {
    persona: {
      name: "유저",
      gender: "female",
      referenceImageUrl: PERSONA_URL,
      savedAppearance: "단발",
      appearanceMode: "image_plus_saved",
    },
    mainCharacter: {
      name: "주인공",
      gender: "male",
      referenceImageUrl: MAIN_URL,
      savedAppearance: "검은 머리",
      appearanceMode: "image_plus_saved",
    },
    selectableAssets: assets.map((row) => ({
      url: row.url,
      tag: row.tag,
      visualSubjectKey: row.visualSubjectKey,
    })),
    visualSubjects: [
      {
        subjectKey: opts.keyA,
        name: "조연A",
        savedAppearance: opts.appearanceA ?? "은발",
        representativeAssetUrl: SUPPORT_A_URL,
        sourceCharacterId: null,
      },
      ...(opts.keyB
        ? [
            {
              subjectKey: opts.keyB,
              name: "조연B",
              savedAppearance: "",
              representativeAssetUrl: null,
              sourceCharacterId: null,
            },
          ]
        : []),
    ],
    characterAssets: assets,
  };
}

function trioIntent(requestedUrl?: string, supportName = "조연A"): ChatImageCastIntentManifest {
  return {
    compositionGoal: "trio_group",
    subjects: [
      {
        key: "persona",
        role: "persona",
        name: "유저",
        included: true,
        importance: "primary",
        visibility: "required_visible",
      },
      {
        key: "main_character",
        role: "main_character",
        name: "주인공",
        included: true,
        importance: "primary",
        visibility: "required_visible",
      },
      {
        key: "support:a",
        role: "supporting_character",
        name: supportName,
        included: true,
        importance: "secondary",
        visibility: "preferred_visible",
        requestedReferenceAssetUrl: requestedUrl,
      },
    ],
  };
}

describe("chatImageCharacterSupportCast", () => {
  it("passes configured support with own asset", () => {
    const keyA = createVisualSubjectKey();
    const grounded = groundCastIntent(trioIntent(SUPPORT_A_URL), characterGroundCtx({ keyA }), undefined, "character");
    assert.equal(grounded.ok, true);
    if (!grounded.ok) throw new Error("expected pass");
    const support = grounded.manifest.subjects.find((row) => row.role === "supporting_character");
    assert.equal(support?.referenceImageUrl, SUPPORT_A_URL);
    assert.equal(support?.savedAppearance, "은발");
    assert.equal(support?.trustedSavedAppearance, true);
  });

  it("rejects cross-subject and main asset references", () => {
    const keyA = createVisualSubjectKey();
    const keyB = createVisualSubjectKey();
    const ctx = characterGroundCtx({ keyA, keyB });
    assert.equal(groundCastIntent(trioIntent(SUPPORT_B_URL), ctx, undefined, "character").ok, false);
    assert.equal(groundCastIntent(trioIntent(MAIN_URL), ctx, undefined, "character").ok, false);
  });

  it("leaves unconfigured support without trusted saved appearance or ref", () => {
    const keyA = createVisualSubjectKey();
    const grounded = groundCastIntent(
      trioIntent(undefined, "미등록NPC"),
      characterGroundCtx({ keyA }),
      undefined,
      "character"
    );
    assert.equal(grounded.ok, true);
    if (!grounded.ok) throw new Error("expected pass");
    const support = grounded.manifest.subjects.find((row) => row.name === "미등록NPC");
    assert.equal(support?.referenceImageUrl, undefined);
    assert.equal(support?.savedAppearance, undefined);
    assert.equal(support?.trustedSavedAppearance, false);
  });

  it("rejects configured ref request for unconfigured support when URL is not whitelisted", () => {
    const keyA = createVisualSubjectKey();
    const result = groundCastIntent(
      trioIntent("https://evil.example/x.png", "미등록NPC"),
      characterGroundCtx({ keyA }),
      undefined,
      "character"
    );
    assert.equal(result.ok, false);
  });

  it("keeps persona and main character unchanged", () => {
    const keyA = createVisualSubjectKey();
    const grounded = groundCastIntent(trioIntent(SUPPORT_A_URL), characterGroundCtx({ keyA }), undefined, "character");
    assert.equal(grounded.ok, true);
    if (!grounded.ok) throw new Error("expected pass");
    const persona = grounded.manifest.subjects.find((row) => row.role === "persona");
    const main = grounded.manifest.subjects.find((row) => row.role === "main_character");
    assert.equal(persona?.referenceImageUrl, PERSONA_URL);
    assert.equal(main?.referenceImageUrl, MAIN_URL);
  });
});
