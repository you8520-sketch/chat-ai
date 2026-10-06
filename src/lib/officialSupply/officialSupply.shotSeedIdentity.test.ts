import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { loadCompiledOfficialCharacterSource } from "@/lib/officialSupply/compiledOfficialSource";
import {
  buildOfficialAssetPrompts,
  OFFICIAL_CAMERA_PROMPT,
  OFFICIAL_FACE_PROMPT,
} from "@/lib/officialSupply/imagePrompt";
import {
  LUCIAN_DRAFT_KEY,
  LUCIAN_PUBLISHED_PREDECESSOR_DRAFT_KEY,
  resolveCanonicalOfficialDraftKey,
} from "@/lib/officialSupply/officialDraftIdentity";
import { testStyleCandidate } from "@/lib/officialSupply/officialSupply.fixtures";
import { LUCIAN_SIG4_REQUIRED_SHOT } from "@/lib/officialSupply/qualityShotQa";
import { composeOfficialSlotGeneration } from "@/lib/officialSupply/runner";
import {
  officialShotSeed,
  resolveOfficialSlotShot,
  type OfficialSlotShotResponsibility,
} from "@/lib/officialSupply/shotPlan";
import type { OfficialCharacterRecord } from "@/lib/officialSupply/store";
import type { OfficialAssetPlan, OfficialAssetSlotKind, OfficialAssetSlotPlan } from "@/lib/officialSupply/types";
import { buildClusterBRofanStyleSeed } from "@/lib/officialSupply/userOwnedRofanStyleRefs";

const PILOT_DIR = path.join(process.cwd(), "src/lib/officialSupply/pilot/characters");
const LUCIAN_SLOTS: ReadonlyArray<{ slotKey: string; kind: OfficialAssetSlotKind }> = [
  { slotKey: "rep", kind: "representative" },
  { slotKey: "sig1", kind: "signature" },
  { slotKey: "sig2", kind: "signature" },
  { slotKey: "sig3", kind: "signature" },
  { slotKey: "sig4", kind: "signature" },
  { slotKey: "emo1", kind: "emotion" },
  { slotKey: "emo2", kind: "emotion" },
  { slotKey: "emo3", kind: "emotion" },
  { slotKey: "emo4", kind: "emotion" },
  { slotKey: "emo5", kind: "emotion" },
  { slotKey: "emo6", kind: "emotion" },
  { slotKey: "scene1", kind: "scene" },
  { slotKey: "scene2", kind: "scene" },
  { slotKey: "scene3", kind: "scene" },
];

/** Previous owner: FNV over the raw storage key. Kept as evidence, not production. */
function legacyRawOfficialShotSeed(draftKey: string): number {
  let hash = 2166136261;
  for (let i = 0; i < draftKey.length; i += 1) {
    hash ^= draftKey.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function shotFields(shot: OfficialSlotShotResponsibility) {
  return {
    faceDirection: shot.faceDirection,
    cameraAngle: shot.cameraAngle,
    distance: shot.distance,
    poseFamily: shot.poseFamily,
    expressionFamily: shot.expressionFamily,
    background: shot.background,
  };
}

function readPilotPlan(): OfficialAssetPlan {
  return (
    JSON.parse(fs.readFileSync(path.join(PILOT_DIR, `${LUCIAN_DRAFT_KEY}.json`), "utf8")) as {
      assetPlan: OfficialAssetPlan;
    }
  ).assetPlan;
}

function lucianSlot(slotKey: string): OfficialAssetSlotPlan {
  const slot = readPilotPlan().slots.find((item) => item.slotKey === slotKey);
  assert.ok(slot, slotKey);
  return slot;
}

describe("official shot seed canonical identity", () => {
  it("A. hashes the same semantic key for the published predecessor and compile draft", () => {
    assert.equal(officialShotSeed(LUCIAN_PUBLISHED_PREDECESSOR_DRAFT_KEY), officialShotSeed(LUCIAN_DRAFT_KEY));
    assert.equal(officialShotSeed(LUCIAN_DRAFT_KEY), legacyRawOfficialShotSeed(LUCIAN_DRAFT_KEY));
    assert.notEqual(
      officialShotSeed(LUCIAN_PUBLISHED_PREDECESSOR_DRAFT_KEY),
      legacyRawOfficialShotSeed(LUCIAN_PUBLISHED_PREDECESSOR_DRAFT_KEY),
      "raw storage alias must not be the shot-seed input"
    );
    assert.equal(
      officialShotSeed(LUCIAN_PUBLISHED_PREDECESSOR_DRAFT_KEY),
      legacyRawOfficialShotSeed(resolveCanonicalOfficialDraftKey(LUCIAN_PUBLISHED_PREDECESSOR_DRAFT_KEY))
    );
    for (const slot of LUCIAN_SLOTS) {
      assert.deepEqual(
        shotFields(resolveOfficialSlotShot(slot, LUCIAN_PUBLISHED_PREDECESSOR_DRAFT_KEY)),
        shotFields(resolveOfficialSlotShot(slot, LUCIAN_DRAFT_KEY)),
        slot.slotKey
      );
    }
  });

  it("B. resolves Lucian sig4 to the QA-proven profile / high_angle / close_up for both keys", () => {
    for (const draftKey of [LUCIAN_DRAFT_KEY, LUCIAN_PUBLISHED_PREDECESSOR_DRAFT_KEY]) {
      const shot = resolveOfficialSlotShot({ slotKey: "sig4", kind: "signature" }, draftKey);
      assert.equal(shot.faceDirection, "profile", draftKey);
      assert.equal(shot.cameraAngle, "high_angle", draftKey);
      assert.equal(shot.distance, "close_up", draftKey);
      assert.equal(shot.faceDirection, LUCIAN_SIG4_REQUIRED_SHOT.faceDirection, draftKey);
      assert.equal(shot.cameraAngle, LUCIAN_SIG4_REQUIRED_SHOT.cameraAngle, draftKey);
      assert.equal(shot.distance, LUCIAN_SIG4_REQUIRED_SHOT.distance, draftKey);
    }
  });

  it("C. preserves the Lucian scene-family shots that already matched by coincidence", () => {
    const expected = {
      scene1: { faceDirection: "right_three_quarter", cameraAngle: "high_angle", distance: "knee_or_full" },
      scene2: { faceDirection: "profile", cameraAngle: "low_angle", distance: "knee_or_full" },
      scene3: { faceDirection: "left_three_quarter", cameraAngle: "eye_level", distance: "medium" },
    } as const;
    for (const draftKey of [LUCIAN_DRAFT_KEY, LUCIAN_PUBLISHED_PREDECESSOR_DRAFT_KEY]) {
      for (const [slotKey, shot] of Object.entries(expected)) {
        const resolved = resolveOfficialSlotShot({ slotKey, kind: "scene" }, draftKey);
        assert.equal(resolved.faceDirection, shot.faceDirection, `${draftKey}/${slotKey}`);
        assert.equal(resolved.cameraAngle, shot.cameraAngle, `${draftKey}/${slotKey}`);
        assert.equal(resolved.distance, shot.distance, `${draftKey}/${slotKey}`);
      }
    }
  });

  it("D. leaves unaliased official draft keys on the previous raw-key seed", () => {
    for (const key of ["pilot-rf-01", "pilot-rf-02", "pilot-rf-v4-01", "parity-1"]) {
      assert.equal(resolveCanonicalOfficialDraftKey(key), key, key);
      assert.equal(officialShotSeed(key), legacyRawOfficialShotSeed(key), key);
    }
    const lucianSig4 = resolveOfficialSlotShot({ slotKey: "sig4", kind: "signature" }, LUCIAN_DRAFT_KEY);
    const otherSig4 = resolveOfficialSlotShot({ slotKey: "sig4", kind: "signature" }, "pilot-rf-01");
    assert.notDeepEqual(shotFields(lucianSig4), shotFields(otherSig4));
  });

  it("E. keeps the representative card bust for both Lucian keys", () => {
    for (const draftKey of [LUCIAN_DRAFT_KEY, LUCIAN_PUBLISHED_PREDECESSOR_DRAFT_KEY, "pilot-rf-01", ""]) {
      const shot = resolveOfficialSlotShot({ slotKey: "rep", kind: "representative" }, draftKey);
      assert.equal(shot.faceDirection, "front");
      assert.equal(shot.cameraAngle, "eye_level");
      assert.equal(shot.distance, "bust");
    }
  });

  it("F. writes the same canonical shot responsibility into predecessor primary and fallback prompts", () => {
    const lucian = loadCompiledOfficialCharacterSource(LUCIAN_DRAFT_KEY);
    const slot = lucianSlot("sig4");
    const shot = resolveOfficialSlotShot(slot, LUCIAN_PUBLISHED_PREDECESSOR_DRAFT_KEY);
    const prompts = buildOfficialAssetPrompts({
      draft: { ...lucian.draft, draftKey: LUCIAN_PUBLISHED_PREDECESSOR_DRAFT_KEY },
      appearance: lucian.appearanceLock,
      style: testStyleCandidate("rf-02").dna,
      slot,
    });
    for (const text of [prompts.primaryPrompt, prompts.strictFallbackPrompt]) {
      assert.match(text, new RegExp(OFFICIAL_FACE_PROMPT[shot.faceDirection].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.match(text, new RegExp(OFFICIAL_CAMERA_PROMPT[shot.cameraAngle].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.match(text, /close-up \(face and shoulders\)/);
    }
    const sourcePrompts = buildOfficialAssetPrompts({
      draft: lucian.draft,
      appearance: lucian.appearanceLock,
      style: testStyleCandidate("rf-02").dna,
      slot,
    });
    assert.equal(prompts.primaryPrompt, sourcePrompts.primaryPrompt);
    assert.equal(prompts.strictFallbackPrompt, sourcePrompts.strictFallbackPrompt);
  });

  it("G. composeOfficialSlotGeneration for the published predecessor uses the QA/source sig4 shot", () => {
    const lucian = loadCompiledOfficialCharacterSource(LUCIAN_DRAFT_KEY);
    const styleSeed = buildClusterBRofanStyleSeed({ NEXTAUTH_URL: "https://example.test" });
    const candidate = testStyleCandidate("rf-02");
    const character: OfficialCharacterRecord = {
      draftKey: LUCIAN_PUBLISHED_PREDECESSOR_DRAFT_KEY,
      batchKey: "pilot-romance-fantasy-04-cluster-b",
      worldKey: lucian.worldKey,
      styleKey: lucian.draft.styleKey,
      stage: "published",
      draft: { ...lucian.draft, draftKey: LUCIAN_PUBLISHED_PREDECESSOR_DRAFT_KEY },
      textLockHash: null,
      appearance: lucian.appearanceLock,
      appearanceLockHash: null,
      assetPlan: readPilotPlan(),
      isStyleProof: false,
      stagedCharacterId: 50,
    };
    const composed = composeOfficialSlotGeneration({
      character,
      style: {
        styleKey: lucian.draft.styleKey,
        genre: "로맨스 판타지",
        stage: "style_locked",
        candidates: [candidate],
        approvedCandidateId: candidate.candidateId,
        styleSeed,
        proofAssetLimit: 1,
      },
      slotKey: "sig4",
      representativeUrl: "/uploads/official-pilot-rf-v4-03__rep-a1.webp",
      env: { OPENAI_IMAGE_MODEL: "gpt-image-2.5-sunburst" },
    });
    assert.equal(composed.ok, true);
    if (!composed.ok) return;
    const shot = resolveOfficialSlotShot(lucianSlot("sig4"), character.draft.draftKey);
    assert.equal(shot.faceDirection, LUCIAN_SIG4_REQUIRED_SHOT.faceDirection);
    assert.equal(shot.cameraAngle, LUCIAN_SIG4_REQUIRED_SHOT.cameraAngle);
    assert.equal(shot.distance, LUCIAN_SIG4_REQUIRED_SHOT.distance);
    assert.match(
      composed.primaryPrompt,
      new RegExp(OFFICIAL_FACE_PROMPT.profile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    );
    assert.match(
      composed.strictFallbackPrompt,
      new RegExp(OFFICIAL_FACE_PROMPT.profile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    );
    const sourceShot = resolveOfficialSlotShot(lucianSlot("sig4"), lucian.draft.draftKey);
    assert.deepEqual(shotFields(shot), shotFields(sourceShot));
  });
});
