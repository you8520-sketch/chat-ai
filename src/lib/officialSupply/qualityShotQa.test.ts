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
import { PILOT_STYLE_PROOF_CANDIDATE_ID } from "@/lib/officialSupply/pilotStyleProof";
import {
  LUCIAN_SIG4_REQUIRED_SHOT,
  LUCIAN_SIG4_TRIAL_ARTIFACT_DIR,
  LUCIAN_SIG4_TRIAL_DRAFT_KEY,
  LUCIAN_SIG4_TRIAL_SLOT_KEY,
  LUCIAN_SIG4_TRIAL_STYLE_CANDIDATE_ID,
  LUCIAN_V4_REPRESENTATIVE_FILE_MARKER,
  appearanceLockMatchesLucian,
  isLucianSig4ProofSupportedImageModel,
  lucianSig4TrialCostPlan,
  pickDefaultOfficialShotQaSlots,
  pickLucianSig4TrialSlot,
  pickLucianSig4TrialStyleCandidate,
  prepareLucianSig4Trial,
  resolveLucianSig4ProofImageModel,
  resolveLucianSig4TrialStyle,
  resolveOfficialShotQaMode,
  validateLucianV4IdentityReference,
} from "@/lib/officialSupply/qualityShotQa";
import { testAppearance } from "@/lib/officialSupply/officialSupply.fixtures";

import { ROFAN_CLUSTER_B_VISUAL_STYLE_DNA } from "@/lib/officialSupply/style";
import { buildClusterBRofanStyleSeed } from "@/lib/officialSupply/userOwnedRofanStyleRefs";
import type {
  OfficialAppearanceLock,
  OfficialAssetPlan,
  StyleReference,
  VisualStyleCandidate,
  VisualStyleDna,
} from "@/lib/officialSupply/types";

const PILOT = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/pilot/characters/pilot-rf-03.json"), "utf8")
) as { appearance: OfficialAppearanceLock; assetPlan: OfficialAssetPlan };

const STYLE_CANDIDATES = (
  JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/pilot/style-candidates.json"), "utf8")
  ) as { candidates: VisualStyleCandidate[] }
).candidates;

const RF02 = STYLE_CANDIDATES.find((candidate) => candidate.candidateId === PILOT_STYLE_PROOF_CANDIDATE_ID)!;
const RF01 = STYLE_CANDIDATES.find((candidate) => candidate.candidateId === "rf-01")!;
const CLUSTER_B_SEED = buildClusterBRofanStyleSeed({ NEXTAUTH_URL: "https://example.test" });
const EMPTY_IMAGE_ENV = {} as NodeJS.ProcessEnv;

const REP_PATH = `/tmp/${LUCIAN_V4_REPRESENTATIVE_FILE_MARKER}-a1.webp`;
const inspectRep = () => ({ width: 1024, height: 1536 });

function buildSig4Prompt(
  style: VisualStyleDna = RF02.dna,
  styleSeed: StyleReference | null = CLUSTER_B_SEED
) {
  const lucian = loadCompiledOfficialCharacterSource(LUCIAN_SIG4_TRIAL_DRAFT_KEY);
  const slot = PILOT.assetPlan.slots.find((item) => item.slotKey === LUCIAN_SIG4_TRIAL_SLOT_KEY)!;
  return {
    lucian,
    slot,
    prompts: buildOfficialAssetPrompts({
      draft: lucian.draft,
      appearance: lucian.appearanceLock,
      style,
      slot,
      styleSeed,
    }),
  };
}

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

  it("prepares a private one-slot plan with Cluster B style and current model/cost owners", () => {
    const { slot, prompts } = buildSig4Prompt();
    const plan = prepareLucianSig4Trial({
      draftKey: LUCIAN_SIG4_TRIAL_DRAFT_KEY,
      slots: PILOT.assetPlan.slots,
      appearance: PILOT.appearance,
      referencePath: REP_PATH,
      inspectImage: inspectRep,
      identityAnchorPrompt: prompts.primaryPrompt,
      styleCandidateId: LUCIAN_SIG4_TRIAL_STYLE_CANDIDATE_ID,
      style: RF02.dna,
      styleSeed: CLUSTER_B_SEED,
      env: EMPTY_IMAGE_ENV,
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.status, "PREPARE");
    assert.equal(plan.slotKey, "sig4");
    assert.equal(plan.persistedToProduction, false);
    assert.equal(plan.artifactDir, LUCIAN_SIG4_TRIAL_ARTIFACT_DIR);
    assert.equal(plan.identityAnchorRulePresent, true);
    assert.equal(plan.resolvedModel, "gpt-image-2");
    assert.equal(plan.styleOwner.candidateId, "rf-02");
    assert.equal(plan.styleOwner.dnaOwner, "ROFAN_CLUSTER_B_VISUAL_STYLE_DNA");
    assert.equal(plan.styleOwner.seedUrlsSentAsImage, false);
    assert.match(prompts.primaryPrompt, /clear profile \/ side-face view/);
    assert.match(prompts.primaryPrompt, /high-angle camera looking slightly down/);
    assert.match(prompts.primaryPrompt, /close-up \(face and shoulders\)/);
    assert.equal(prompts.primaryPrompt.includes(OFFICIAL_IDENTITY_ANCHOR_REFERENCE_RULE), true);
    assert.match(prompts.primaryPrompt, /rendering: cel/);
    assert.match(prompts.primaryPrompt, /contrast: high/);
    assert.match(prompts.primaryPrompt, /웹툰|그래픽/);
    assert.doesNotMatch(prompts.primaryPrompt, /(?:^|\n)framing:/);
    assert.ok(prompts.primaryPrompt.includes(slot.expression));
    assert.ok(prompts.primaryPrompt.includes(slot.pose));
    assert.doesNotMatch(prompts.primaryPrompt, /세미 리얼|세미리얼|아이보리, 로즈|중저 대비/);

    const cost = lucianSig4TrialCostPlan();
    assert.equal(cost.maxProviderCalls, MAX_PROVIDER_ATTEMPTS);
    assert.equal(cost.maxProviderCalls, 2);
    assert.equal(cost.quality, "medium");
    assert.equal(cost.size, "1536x1024");
    assert.equal(cost.fallbackOnlyOnRecognizedSafetyRejection, true);
    assert.equal(cost.reservePerAttemptUsd, ROFAN_V4_PRODUCTION_BATCH_CONFIG.reservePerImageUsd);
    assert.equal(cost.planningCeilingUsd, 0.24);
    assert.equal(cost.planningCeilingKind, "internal_reserve");
    assert.equal(cost.planningCeilingIsProviderHardCap, false);
    assert.equal(resolveOfficialAssetImageModel(EMPTY_IMAGE_ENV), CHAT_IMAGE_GENERATION_DEFAULT_MODEL);
    assert.equal(CHAT_IMAGE_GENERATION_DEFAULT_MODEL, "gpt-image-2");
  });

  it("reuses Cluster B DNA and refuses rf-01 style leakage", () => {
    assert.equal(LUCIAN_SIG4_TRIAL_STYLE_CANDIDATE_ID, "rf-02");
    assert.equal(pickLucianSig4TrialStyleCandidate(STYLE_CANDIDATES).ok, true);
    assert.equal(pickLucianSig4TrialStyleCandidate([{ candidateId: "rf-01" }]).ok, false);

    const withCluster = resolveLucianSig4TrialStyle({
      candidateId: "rf-02",
      candidateDna: RF02.dna,
      styleSeed: CLUSTER_B_SEED,
    });
    assert.equal(withCluster.ok, true);
    if (withCluster.ok) {
      assert.deepEqual(withCluster.style, ROFAN_CLUSTER_B_VISUAL_STYLE_DNA);
    }
    assert.equal(
      resolveLucianSig4TrialStyle({
        candidateId: "rf-01",
        candidateDna: RF01.dna,
        styleSeed: CLUSTER_B_SEED,
      }).ok,
      false
    );
    assert.equal(
      resolveLucianSig4TrialStyle({
        candidateId: "rf-02",
        candidateDna: RF02.dna,
        styleSeed: { url: "https://example.test/style.webp", provenance: "platform_owned" },
      }).ok,
      false
    );

    const leaked = buildSig4Prompt(RF01.dna, null);
    const leakedPlan = prepareLucianSig4Trial({
      draftKey: LUCIAN_SIG4_TRIAL_DRAFT_KEY,
      slots: PILOT.assetPlan.slots,
      appearance: PILOT.appearance,
      referencePath: REP_PATH,
      inspectImage: inspectRep,
      identityAnchorPrompt: leaked.prompts.primaryPrompt,
      styleCandidateId: "rf-02",
      style: RF02.dna,
      styleSeed: CLUSTER_B_SEED,
      env: EMPTY_IMAGE_ENV,
    });
    assert.equal(leakedPlan.ok, false);
    if (leakedPlan.ok) return;
    assert.equal(leakedPlan.providerCalls, 0);
    assert.match(leakedPlan.reason, /rf-01 style|Cluster B/);
    assert.ok(leaked.prompts.primaryPrompt.includes("세미 리얼") || leaked.prompts.primaryPrompt.includes("중저 대비"));
  });

  it("fail-closes unknown OPENAI_IMAGE_MODEL and accepts supported GPT Image ids", () => {
    assert.equal(isLucianSig4ProofSupportedImageModel("gpt-image-2"), true);
    assert.equal(isLucianSig4ProofSupportedImageModel("gpt-image-2-20260501"), true);
    assert.equal(isLucianSig4ProofSupportedImageModel("gpt-image-2.5-sunburst"), true);
    assert.equal(isLucianSig4ProofSupportedImageModel("gpt-image-2.5-sunburst-20260801"), true);
    assert.equal(isLucianSig4ProofSupportedImageModel("gpt-image-2.5-flare"), true);
    assert.equal(isLucianSig4ProofSupportedImageModel("gpt-image-2.5-flare-20260601"), true);
    assert.equal(isLucianSig4ProofSupportedImageModel("custom-image-x"), false);
    assert.equal(isLucianSig4ProofSupportedImageModel("dall-e-3"), false);

    const unknown = resolveLucianSig4ProofImageModel({
      OPENAI_IMAGE_MODEL: "custom-image-x",
    } as NodeJS.ProcessEnv);
    assert.equal(unknown.ok, false);
    if (unknown.ok) return;
    assert.equal(unknown.model, "custom-image-x");

    const { prompts } = buildSig4Prompt();
    const stopped = prepareLucianSig4Trial({
      draftKey: LUCIAN_SIG4_TRIAL_DRAFT_KEY,
      slots: PILOT.assetPlan.slots,
      appearance: PILOT.appearance,
      referencePath: REP_PATH,
      inspectImage: inspectRep,
      identityAnchorPrompt: prompts.primaryPrompt,
      styleCandidateId: "rf-02",
      style: RF02.dna,
      styleSeed: CLUSTER_B_SEED,
      env: { OPENAI_IMAGE_MODEL: "custom-image-x" } as NodeJS.ProcessEnv,
    });
    assert.equal(stopped.ok, false);
    if (stopped.ok) return;
    assert.equal(stopped.status, "STOP");
    assert.equal(stopped.providerCalls, 0);
    assert.equal(stopped.persistedToProduction, false);
    assert.equal(stopped.resolvedModel, "custom-image-x");

    for (const model of [
      "gpt-image-2",
      "gpt-image-2-20260501",
      "gpt-image-2.5-sunburst",
      "gpt-image-2.5-flare-20260601",
    ]) {
      const prepared = prepareLucianSig4Trial({
        draftKey: LUCIAN_SIG4_TRIAL_DRAFT_KEY,
        slots: PILOT.assetPlan.slots,
        appearance: PILOT.appearance,
        referencePath: REP_PATH,
        inspectImage: inspectRep,
        identityAnchorPrompt: prompts.primaryPrompt,
        styleCandidateId: "rf-02",
        style: RF02.dna,
        styleSeed: CLUSTER_B_SEED,
        env: { OPENAI_IMAGE_MODEL: model } as NodeJS.ProcessEnv,
      });
      assert.equal(prepared.ok, true, model);
      if (!prepared.ok) continue;
      assert.equal(prepared.resolvedModel, model);
    }
  });

  it("keeps missing-reference STOP at providerCalls 0", () => {
    const { prompts } = buildSig4Prompt();
    const stopped = prepareLucianSig4Trial({
      draftKey: LUCIAN_SIG4_TRIAL_DRAFT_KEY,
      slots: PILOT.assetPlan.slots,
      appearance: PILOT.appearance,
      referencePath: "",
      inspectImage: inspectRep,
      identityAnchorPrompt: prompts.primaryPrompt,
      styleCandidateId: "rf-02",
      style: RF02.dna,
      styleSeed: CLUSTER_B_SEED,
      env: EMPTY_IMAGE_ENV,
    });
    assert.equal(stopped.ok, false);
    if (stopped.ok) return;
    assert.equal(stopped.providerCalls, 0);
    assert.equal(stopped.persistedToProduction, false);
    assert.match(stopped.reason, /refusing a style-only substitute/);
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
