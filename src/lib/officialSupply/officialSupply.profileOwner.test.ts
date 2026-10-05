import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { loadCompiledOfficialCharacterSource } from "@/lib/officialSupply/compiledOfficialSource";
import { buildOfficialAssetPrompts } from "@/lib/officialSupply/imagePrompt";
import { officialImageSubjectRuleForSlot, resolveOfficialImageSubjects } from "@/lib/officialSupply/imageSubjects";
import { testStyleCandidate } from "@/lib/officialSupply/officialSupply.fixtures";
import {
  OFFICIAL_CAMERA_PROMPT,
  OFFICIAL_FACE_PROMPT,
  OFFICIAL_LEGACY_LOW_ANGLE_CAMERA_CLAUSE,
  OFFICIAL_LEGACY_PROFILE_FACE_CLAUSE,
  resolveOfficialSlotShot,
} from "@/lib/officialSupply/shotPlan";
import type { OfficialAssetPlan, OfficialAssetSlotPlan, StyleReference } from "@/lib/officialSupply/types";

const CLUSTER_B_SEED: StyleReference = {
  url: "/official-supply/style-seeds/romance-fantasy-cluster-b-v1/primary/b7-black-gold-uniform.webp",
  provenance: "platform_owned",
  note: "cluster-b fixture",
  styleCluster: "cluster_b_graphic",
};

const PILOT_DIR = path.join(process.cwd(), "src/lib/officialSupply/pilot/characters");
const SHOT_PLAN_SOURCE = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/shotPlan.ts"), "utf8");
const IMAGE_PROMPT_SOURCE = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/imagePrompt.ts"), "utf8");
const STYLE_SOURCE = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/style.ts"), "utf8");

const DISTANCE_CLOSE = "close-up (face and shoulders)";
const DISTANCE_KNEE = "knee-up or full-body shot with space around the figure";

function readPilot(draftKey: string): { assetPlan: OfficialAssetPlan } {
  return JSON.parse(fs.readFileSync(path.join(PILOT_DIR, `${draftKey}.json`), "utf8")) as {
    assetPlan: OfficialAssetPlan;
  };
}

function lucianSlot(slotKey: string): OfficialAssetSlotPlan {
  const slot = readPilot("pilot-rf-03").assetPlan.slots.find((item) => item.slotKey === slotKey);
  assert.ok(slot, slotKey);
  return slot;
}

function promptsFor(
  slot: OfficialAssetSlotPlan,
  referenceRoleLayout: "slot_default" | "identity_then_style" = "slot_default"
) {
  const lucian = loadCompiledOfficialCharacterSource("pilot-rf-03");
  return buildOfficialAssetPrompts({
    draft: lucian.draft,
    appearance: lucian.appearanceLock,
    style: testStyleCandidate("c1").dna,
    slot,
    styleSeed: CLUSTER_B_SEED,
    referenceRoleLayout,
  });
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe("official faceDirection owner (#profile)", () => {
  it("keeps one canonical profile clause and does not revive the semantic label", () => {
    assert.equal(
      OFFICIAL_FACE_PROMPT.profile,
      "side-face silhouette with the head rotated 90 degrees from the camera, only one eye visible, and the nose and lips seen from the side"
    );
    assert.equal(OFFICIAL_FACE_PROMPT.front, "face toward camera, near-frontal");
    assert.equal(OFFICIAL_FACE_PROMPT.left_three_quarter, "head turned left three-quarter view");
    assert.equal(OFFICIAL_FACE_PROMPT.right_three_quarter, "head turned right three-quarter view");
    assert.equal(OFFICIAL_LEGACY_PROFILE_FACE_CLAUSE, "clear profile / side-face view");
    assert.equal(count(SHOT_PLAN_SOURCE, "profile:"), 1);
    assert.equal(count(SHOT_PLAN_SOURCE, OFFICIAL_LEGACY_PROFILE_FACE_CLAUSE), 1);
    assert.doesNotMatch(SHOT_PLAN_SOURCE, /profile:\s*"clear profile \/ side-face view"/);
    assert.doesNotMatch(IMAGE_PROMPT_SOURCE, /side-face silhouette/);
    assert.doesNotMatch(IMAGE_PROMPT_SOURCE, /clear profile \/ side-face view/);
  });

  it("leaves camera and distance owners unchanged", () => {
    assert.equal(
      OFFICIAL_CAMERA_PROMPT.low_angle,
      "low-angle camera placed below the subject looking up, with visible upward perspective"
    );
    assert.equal(OFFICIAL_CAMERA_PROMPT.high_angle, "high-angle camera looking slightly down");
    assert.equal(OFFICIAL_CAMERA_PROMPT.eye_level, "eye-level camera");
    assert.match(SHOT_PLAN_SOURCE, new RegExp(OFFICIAL_LEGACY_LOW_ANGLE_CAMERA_CLAUSE));
    assert.equal(count(SHOT_PLAN_SOURCE, "low_angle:"), 1);
  });

  it("applies the profile owner once on Lucian sig4 and scene2, primary and fallback", () => {
    for (const slotKey of ["sig4", "scene2"] as const) {
      const slot = lucianSlot(slotKey);
      assert.equal(resolveOfficialSlotShot(slot, "pilot-rf-03").faceDirection, "profile");
      for (const layout of ["slot_default", "identity_then_style"] as const) {
        const { primaryPrompt, strictFallbackPrompt } = promptsFor(slot, layout);
        assert.equal(count(primaryPrompt, OFFICIAL_FACE_PROMPT.profile), 1, `${slotKey}/${layout}`);
        assert.equal(count(strictFallbackPrompt, OFFICIAL_FACE_PROMPT.profile), 1, `${slotKey}/${layout}`);
        assert.doesNotMatch(primaryPrompt, new RegExp(OFFICIAL_LEGACY_PROFILE_FACE_CLAUSE));
        assert.doesNotMatch(strictFallbackPrompt, new RegExp(OFFICIAL_LEGACY_PROFILE_FACE_CLAUSE));
        assert.equal(
          count(primaryPrompt, OFFICIAL_FACE_PROMPT.profile),
          count(strictFallbackPrompt, OFFICIAL_FACE_PROMPT.profile)
        );
      }
    }
  });

  it("keeps sig4 high_angle + close_up and scene2 low_angle + knee_or_full", () => {
    const sig4 = lucianSlot("sig4");
    const scene2 = lucianSlot("scene2");
    const sig4Shot = resolveOfficialSlotShot(sig4, "pilot-rf-03");
    const scene2Shot = resolveOfficialSlotShot(scene2, "pilot-rf-03");
    assert.equal(sig4Shot.cameraAngle, "high_angle");
    assert.equal(sig4Shot.distance, "close_up");
    assert.equal(scene2Shot.cameraAngle, "low_angle");
    assert.equal(scene2Shot.distance, "knee_or_full");

    const sig4Prompt = promptsFor(sig4, "identity_then_style").primaryPrompt;
    const scene2Prompt = promptsFor(scene2, "identity_then_style").primaryPrompt;
    assert.equal(count(sig4Prompt, OFFICIAL_FACE_PROMPT.profile), 1);
    assert.equal(count(sig4Prompt, OFFICIAL_CAMERA_PROMPT.high_angle), 1);
    assert.equal(count(sig4Prompt, DISTANCE_CLOSE), 1);
    assert.doesNotMatch(sig4Prompt, /low-angle camera/);
    assert.equal(count(scene2Prompt, OFFICIAL_FACE_PROMPT.profile), 1);
    assert.equal(count(scene2Prompt, OFFICIAL_CAMERA_PROMPT.low_angle), 1);
    assert.equal(count(scene2Prompt, DISTANCE_KNEE), 1);
    assert.doesNotMatch(scene2Prompt, new RegExp(OFFICIAL_LEGACY_LOW_ANGLE_CAMERA_CLAUSE));
  });

  it("does not let style DNA own faceDirection", () => {
    assert.match(STYLE_SOURCE, /atmosphere: "국내 여성향 로판 웹툰풍 — 선명, 고대비, 그래픽, 얼굴-first"/);
    assert.doesNotMatch(STYLE_SOURCE, /side-face silhouette/);
    const { primaryPrompt, strictFallbackPrompt } = promptsFor(lucianSlot("sig4"), "identity_then_style");
    assert.doesNotMatch(primaryPrompt, /(?:^|\n)framing:/);
    assert.doesNotMatch(strictFallbackPrompt, /(?:^|\n)framing:/);
    assert.match(primaryPrompt, /ART STYLE describes rendering language, color, and illustration grammar only/);
    assert.match(primaryPrompt, /Camera, face direction, and crop follow SHOT RESPONSIBILITY/);
  });

  it("leaves participant imageSubjects unchanged", () => {
    assert.equal(resolveOfficialImageSubjects(lucianSlot("scene1")).foreground, "character_plus_required_partner");
    assert.equal(resolveOfficialImageSubjects(lucianSlot("scene2")).foreground, "solo_character");
    assert.equal(resolveOfficialImageSubjects(lucianSlot("scene3")).foreground, "character_plus_required_partner");
    const scene2 = promptsFor(lucianSlot("scene2"));
    assert.equal(
      officialImageSubjectRuleForSlot(lucianSlot("scene2")),
      scene2.primaryPrompt.split("\n").find((row) => row.includes("FOREGROUND CAST:"))
    );
    assert.match(scene2.primaryPrompt, /exactly one foreground person/);
    assert.doesNotMatch(scene2.primaryPrompt, /required foreground interaction partner/);
  });
});
