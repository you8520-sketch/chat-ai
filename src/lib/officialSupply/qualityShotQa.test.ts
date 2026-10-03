import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { MAX_PROVIDER_ATTEMPTS } from "@/lib/openAiImageSafetyFallback";
import { buildOfficialAssetPrompts, OFFICIAL_IDENTITY_ANCHOR_REFERENCE_RULE } from "@/lib/officialSupply/imagePrompt";
import { loadCompiledOfficialCharacterSource } from "@/lib/officialSupply/compiledOfficialSource";
import { CHAT_IMAGE_GENERATION_DEFAULT_MODEL } from "@/lib/chatImageGeneration";
import { resolveOfficialAssetImageModel } from "@/lib/officialSupply/imageProfile";
import { ROFAN_V4_PRODUCTION_BATCH_CONFIG } from "@/lib/officialSupply/pilotProduction";
import {
  LUCIAN_SIG4_REQUIRED_SHOT,
  LUCIAN_SIG4_TRIAL_ARTIFACT_DIR,
  LUCIAN_SIG4_TRIAL_DRAFT_KEY,
  LUCIAN_SIG4_TRIAL_SLOT_KEY,
  LUCIAN_V4_REPRESENTATIVE_FILE_MARKER,
  appearanceLockMatchesLucian,
  lucianSig4TrialCostPlan,
  pickDefaultOfficialShotQaSlots,
  pickLucianSig4TrialSlot,
  prepareLucianSig4Trial,
  resolveOfficialShotQaMode,
  validateLucianV4IdentityReference,
} from "@/lib/officialSupply/qualityShotQa";
import { testAppearance, testStyleCandidate } from "@/lib/officialSupply/officialSupply.fixtures";
import type { OfficialAppearanceLock, OfficialAssetPlan } from "@/lib/officialSupply/types";

const PILOT = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/pilot/characters/pilot-rf-03.json"), "utf8")
) as { appearance: OfficialAppearanceLock; assetPlan: OfficialAssetPlan };

const REP_PATH = `/tmp/${LUCIAN_V4_REPRESENTATIVE_FILE_MARKER}-a1.webp`;
const inspectRep = () => ({ width: 1024, height: 1536 });

describe("official shot QA lucian-sig4 trial mode", () => {
  it("resolves only sig4 and requires profile / high-angle / close-up", () => {
    const picked = pickLucianSig4TrialSlot(PILOT.assetPlan.slots, LUCIAN_SIG4_TRIAL_DRAFT_KEY);
    assert.equal(picked.ok, true);
    if (!picked.ok) return;
    assert.equal(picked.slot.slotKey, LUCIAN_SIG4_TRIAL_SLOT_KEY);
    assert.deepEqual(
      {
        faceDirection: picked.shot.faceDirection,
        cameraAngle: picked.shot.cameraAngle,
        distance: picked.shot.distance,
      },
      LUCIAN_SIG4_REQUIRED_SHOT
    );
    assert.equal(pickLucianSig4TrialSlot(PILOT.assetPlan.slots, "pilot-rf-01").ok, false);
  });

  it("stops when the v4 representative file is missing instead of using a style substitute", () => {
    assert.match(
      validateLucianV4IdentityReference({
        referencePath: "",
        appearance: PILOT.appearance,
        inspectImage: inspectRep,
      }).reason ?? "",
      /refusing a style-only substitute/
    );
    assert.match(
      validateLucianV4IdentityReference({
        referencePath: "/tmp/romance-fantasy-cluster-b-v1/primary.webp",
        appearance: PILOT.appearance,
        inspectImage: inspectRep,
      }).reason ?? "",
      /approved v4 representative/
    );
    assert.match(
      validateLucianV4IdentityReference({
        referencePath: REP_PATH,
        appearance: PILOT.appearance,
        inspectImage: () => null,
      }).reason ?? "",
      /missing or unreadable/
    );
    assert.match(
      validateLucianV4IdentityReference({
        referencePath: REP_PATH,
        appearance: PILOT.appearance,
        inspectImage: () => ({ width: 1536, height: 1024 }),
      }).reason ?? "",
      /1024x1536/
    );
  });

  it("accepts the v4 representative only when Appearance Lock is Lucian's", () => {
    assert.equal(appearanceLockMatchesLucian(PILOT.appearance), null);
    assert.match(appearanceLockMatchesLucian(testAppearance()) ?? "", /missing Lucian identity markers/);
    const ok = validateLucianV4IdentityReference({
      referencePath: REP_PATH,
      appearance: PILOT.appearance,
      inspectImage: inspectRep,
    });
    assert.equal(ok.ok, true);
  });

  it("prepares a private one-slot plan with current model/cost/fallback owners", () => {
    const lucian = loadCompiledOfficialCharacterSource(LUCIAN_SIG4_TRIAL_DRAFT_KEY);
    const slot = PILOT.assetPlan.slots.find((item) => item.slotKey === LUCIAN_SIG4_TRIAL_SLOT_KEY)!;
    const prompts = buildOfficialAssetPrompts({
      draft: lucian.draft,
      appearance: lucian.appearanceLock,
      style: testStyleCandidate("c1").dna,
      slot,
    });
    const plan = prepareLucianSig4Trial({
      draftKey: LUCIAN_SIG4_TRIAL_DRAFT_KEY,
      slots: PILOT.assetPlan.slots,
      appearance: PILOT.appearance,
      referencePath: REP_PATH,
      inspectImage: inspectRep,
      identityAnchorPrompt: prompts.primaryPrompt,
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.status, "PREPARE");
    assert.equal(plan.slotKey, "sig4");
    assert.equal(plan.persistedToProduction, false);
    assert.equal(plan.artifactDir, LUCIAN_SIG4_TRIAL_ARTIFACT_DIR);
    assert.equal(plan.identityAnchorRulePresent, true);
    assert.match(prompts.primaryPrompt, /clear profile \/ side-face view/);
    assert.match(prompts.primaryPrompt, /high-angle camera looking slightly down/);
    assert.match(prompts.primaryPrompt, /close-up \(face and shoulders\)/);
    assert.equal(prompts.primaryPrompt.includes(OFFICIAL_IDENTITY_ANCHOR_REFERENCE_RULE), true);

    const cost = lucianSig4TrialCostPlan();
    assert.equal(cost.maxProviderCalls, MAX_PROVIDER_ATTEMPTS);
    assert.equal(cost.maxProviderCalls, 2);
    assert.equal(cost.quality, "medium");
    assert.equal(cost.size, "1536x1024");
    assert.equal(cost.fallbackOnlyOnRecognizedSafetyRejection, true);
    assert.equal(cost.reservePerAttemptUsd, ROFAN_V4_PRODUCTION_BATCH_CONFIG.reservePerImageUsd);
    assert.equal(cost.planningCeilingUsd, 0.24);
    assert.equal(resolveOfficialAssetImageModel({} as NodeJS.ProcessEnv), CHAT_IMAGE_GENERATION_DEFAULT_MODEL);
    assert.equal(CHAT_IMAGE_GENERATION_DEFAULT_MODEL, "gpt-image-2");
  });

  it("keeps default multi-slot QA and rejects unknown modes", () => {
    const defaults = pickDefaultOfficialShotQaSlots(PILOT.assetPlan.slots, LUCIAN_SIG4_TRIAL_DRAFT_KEY);
    assert.ok(defaults.length >= 4);
    assert.ok(defaults.every((slot) => slot.slotKey !== "rep"));
    assert.ok(defaults.some((slot) => slot.slotKey !== LUCIAN_SIG4_TRIAL_SLOT_KEY));
    assert.deepEqual(resolveOfficialShotQaMode(undefined), { ok: true, mode: "default" });
    assert.deepEqual(resolveOfficialShotQaMode("lucian-sig4"), { ok: true, mode: "lucian-sig4" });
    const unknown = resolveOfficialShotQaMode("regen-all");
    assert.equal(unknown.ok, false);
    if (unknown.ok) return;
    assert.match(unknown.reason, /unknown/);
  });
});
