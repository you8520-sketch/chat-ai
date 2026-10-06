import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { MAX_PROVIDER_ATTEMPTS } from "@/lib/openAiImageSafetyFallback";
import {
  buildOfficialAssetPrompts,
  OFFICIAL_IDENTITY_ANCHOR_REFERENCE_RULE,
  OFFICIAL_IDENTITY_THEN_STYLE_IMAGE1_LABEL,
  OFFICIAL_IDENTITY_THEN_STYLE_IMAGE2_LABEL,
  OFFICIAL_IMAGE2_STYLE_ONLY_EXTRA_BAN,
  OFFICIAL_STYLE_COPY_FORBIDDEN_CLAUSE,
} from "@/lib/officialSupply/imagePrompt";
import { loadCompiledOfficialCharacterSource } from "@/lib/officialSupply/compiledOfficialSource";
import { CHAT_IMAGE_GENERATION_DEFAULT_MODEL } from "@/lib/chatImageGeneration";
import { resolveOfficialAssetImageModel } from "@/lib/officialSupply/imageProfile";
import { ROFAN_V4_PRODUCTION_BATCH_CONFIG } from "@/lib/officialSupply/pilotProduction";
import { PILOT_STYLE_PROOF_CANDIDATE_ID } from "@/lib/officialSupply/pilotStyleProof";
import {
  LUCIAN_SIG4_OBSERVED_ONE_REFERENCE_PAID_USD,
  LUCIAN_SIG4_REQUIRED_SHOT,
  LUCIAN_SIG4_STYLE_ESTIMATED_TWO_REFERENCE_PRIMARY_USD,
  LUCIAN_SIG4_SELECTED_STYLE_REFERENCE_PUBLIC_PATH,
  LUCIAN_SIG4_STYLE_REFERENCE_FILE_MARKER,
  LUCIAN_SIG4_STYLE_REFERENCE_REPO_RELATIVE,
  LUCIAN_SIG4_STYLE_TRIAL_ARTIFACT_DIR,
  LUCIAN_SIG4_TRIAL_ARTIFACT_DIR,
  LUCIAN_SIG4_TRIAL_DRAFT_KEY,
  LUCIAN_SIG4_TRIAL_SLOT_KEY,
  LUCIAN_SIG4_TRIAL_STYLE_CANDIDATE_ID,
  LUCIAN_V4_REPRESENTATIVE_FILE_MARKER,
  appearanceLockMatchesLucian,
  assembleLucianSig4StyleProviderReferences,
  isLucianSig4ProofSupportedImageModel,
  lucianSig4SelectedStyleReferenceIsInClusterBCatalog,
  lucianSig4StyleLiveCostApprovalError,
  lucianSig4StyleProviderCallDecision,
  lucianSig4StyleProviderReferenceOrderError,
  lucianSig4StyleTrialCostPlan,
  lucianSig4TrialCostPlan,
  pickDefaultOfficialShotQaSlots,
  pickLucianSig4TrialSlot,
  pickLucianSig4TrialStyleCandidate,
  prepareLucianSig4StyleTrial,
  prepareLucianSig4Trial,
  resolveLucianSig4TrialStyle,
  resolveOfficialShotQaMode,
  validateLucianSig4StyleReference,
  validateLucianV4IdentityReference,
} from "@/lib/officialSupply/qualityShotQa";
import { officialSlotGenerationReferences } from "@/lib/officialSupply/runner";
import { OFFICIAL_FACE_PROMPT } from "@/lib/officialSupply/shotPlan";
import { testAppearance } from "@/lib/officialSupply/officialSupply.fixtures";

import { ROFAN_CLUSTER_B_VISUAL_STYLE_DNA } from "@/lib/officialSupply/style";
import {
  buildClusterBRofanStyleSeed,
  CLUSTER_B_PRIMARY_GENERATION_PATHS,
  CLUSTER_B_PRIMARY_STYLE_PATH,
} from "@/lib/officialSupply/userOwnedRofanStyleRefs";
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
    assert.ok(prompts.primaryPrompt.includes(OFFICIAL_FACE_PROMPT.profile));
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
    assert.equal(isLucianSig4ProofSupportedImageModel("gpt-image-2-2026-04-21"), true);
    assert.equal(isLucianSig4ProofSupportedImageModel("gpt-image-2.5-sunburst"), true);
    assert.equal(isLucianSig4ProofSupportedImageModel("gpt-image-2.5-sunburst-2026-09-08"), true);
    assert.equal(isLucianSig4ProofSupportedImageModel("gpt-image-2.5-flare"), true);
    assert.equal(isLucianSig4ProofSupportedImageModel("gpt-image-2.5-flare-2026-06-01"), true);
    assert.equal(isLucianSig4ProofSupportedImageModel("gpt-image-2-custom"), false);
    assert.equal(isLucianSig4ProofSupportedImageModel("gpt-image-2.5-sunburst-experimental"), false);
    assert.equal(isLucianSig4ProofSupportedImageModel("gpt-image-2-20260501"), false);
    assert.equal(isLucianSig4ProofSupportedImageModel("gpt-image-2.5-flare-latest"), false);
    assert.equal(isLucianSig4ProofSupportedImageModel("custom-image-x"), false);
    assert.equal(isLucianSig4ProofSupportedImageModel("dall-e-3"), false);

    const { prompts } = buildSig4Prompt();
    for (const model of [
      "gpt-image-2-custom",
      "gpt-image-2.5-sunburst-experimental",
      "gpt-image-2-20260501",
      "gpt-image-2.5-flare-latest",
      "custom-image-x",
    ]) {
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
        env: { OPENAI_IMAGE_MODEL: model } as NodeJS.ProcessEnv,
      });
      assert.equal(stopped.ok, false, model);
      if (stopped.ok) continue;
      assert.equal(stopped.status, "STOP", model);
      assert.equal(stopped.providerCalls, 0, model);
      assert.equal(stopped.persistedToProduction, false, model);
      assert.equal(stopped.resolvedModel, model, model);
    }

    for (const model of [
      "gpt-image-2",
      "gpt-image-2-2026-04-21",
      "gpt-image-2.5-sunburst",
      "gpt-image-2.5-sunburst-2026-09-08",
      "gpt-image-2.5-flare",
      "gpt-image-2.5-flare-2026-06-01",
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
    assert.deepEqual(resolveOfficialShotQaMode("lucian-sig4-style"), { ok: true, mode: "lucian-sig4-style" });
    const unknown = resolveOfficialShotQaMode("regen-all");
    assert.equal(unknown.ok, false);
    if (unknown.ok) return;
    assert.match(unknown.reason, /unknown/);
  });
});

const STYLE_PATH = `/tmp/${LUCIAN_SIG4_STYLE_REFERENCE_FILE_MARKER}.webp`;
const inspectAny = () => ({ width: 1024, height: 1536 });
const STYLE_BYTES = Buffer.from("canonical-cluster-b-b7");

function buildSig4StylePrompt(
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
      referenceRoleLayout: "identity_then_style",
    }),
  };
}

describe("official shot QA lucian-sig4-style dual-reference prepare", () => {
  it("selects explicit b7 independently of Cluster B catalog order", () => {
    assert.equal(
      LUCIAN_SIG4_SELECTED_STYLE_REFERENCE_PUBLIC_PATH,
      CLUSTER_B_PRIMARY_STYLE_PATH
    );
    assert.equal(
      CLUSTER_B_PRIMARY_STYLE_PATH,
      "/official-supply/style-seeds/romance-fantasy-cluster-b-v1/primary/b7-black-gold-uniform.webp"
    );
    assert.equal(
      LUCIAN_SIG4_STYLE_REFERENCE_REPO_RELATIVE,
      `public${LUCIAN_SIG4_SELECTED_STYLE_REFERENCE_PUBLIC_PATH}`
    );
    assert.equal(lucianSig4SelectedStyleReferenceIsInClusterBCatalog(), true);
    assert.ok(
      (CLUSTER_B_PRIMARY_GENERATION_PATHS as readonly string[]).includes(
        LUCIAN_SIG4_SELECTED_STYLE_REFERENCE_PUBLIC_PATH
      )
    );
    const reordered = [
      CLUSTER_B_PRIMARY_GENERATION_PATHS[1],
      CLUSTER_B_PRIMARY_GENERATION_PATHS[2],
      CLUSTER_B_PRIMARY_GENERATION_PATHS[0],
    ];
    assert.equal(reordered[0]!.includes("b7-black-gold-uniform"), false);
    assert.ok(reordered.includes(LUCIAN_SIG4_SELECTED_STYLE_REFERENCE_PUBLIC_PATH));
    assert.ok(fs.existsSync(path.join(process.cwd(), LUCIAN_SIG4_STYLE_REFERENCE_REPO_RELATIVE)));
    const lib = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/qualityShotQa.ts"), "utf8");
    assert.doesNotMatch(lib, /CLUSTER_B_PRIMARY_GENERATION_PATHS\[0\]/);
  });

  it("assembles exactly two provider references in identity-then-style order", () => {
    const assembled = assembleLucianSig4StyleProviderReferences({
      identityPath: REP_PATH,
      stylePath: STYLE_PATH,
    });
    assert.equal(assembled.ok, true);
    if (!assembled.ok) return;
    assert.equal(assembled.references.length, 2);
    assert.deepEqual(assembled.references[0], {
      index: 0,
      role: "IDENTITY ONLY",
      path: REP_PATH,
    });
    assert.deepEqual(assembled.references[1], {
      index: 1,
      role: "STYLE ONLY",
      path: STYLE_PATH,
    });
    assert.equal(lucianSig4StyleProviderReferenceOrderError(assembled.references), null);
    assert.match(
      lucianSig4StyleProviderReferenceOrderError([assembled.references[1]!, assembled.references[0]!]) ?? "",
      /reference\[0\] must be the Lucian identity/
    );
    assert.match(
      lucianSig4StyleProviderReferenceOrderError([assembled.references[0]!]) ?? "",
      /exactly 2/
    );
  });

  it("fail-closes missing, non-canonical, or byte-mismatched style references at providerCalls 0", () => {
    assert.match(
      validateLucianSig4StyleReference({
        styleReferencePath: "",
        inspectImage: inspectAny,
      }).reason ?? "",
      /STYLE_REFERENCE_PATH is required/
    );
    assert.match(
      validateLucianSig4StyleReference({
        styleReferencePath: "/tmp/romance-fantasy-cluster-b-v1/primary/b13-black-red-fur.webp",
        inspectImage: inspectAny,
      }).reason ?? "",
      /selected canonical Cluster B file/
    );
    assert.match(
      validateLucianSig4StyleReference({
        styleReferencePath: STYLE_PATH,
        inspectImage: () => null,
      }).reason ?? "",
      /missing or unreadable/
    );
    assert.match(
      validateLucianSig4StyleReference({
        styleReferencePath: STYLE_PATH,
        inspectImage: inspectAny,
        candidateBytes: STYLE_BYTES,
      }).reason ?? "",
      /canonical Cluster B b7 bytes are required/
    );
    assert.match(
      validateLucianSig4StyleReference({
        styleReferencePath: STYLE_PATH,
        inspectImage: inspectAny,
        canonicalBundleBytes: STYLE_BYTES,
      }).reason ?? "",
      /candidate Cluster B style bytes are required/
    );
    assert.match(
      validateLucianSig4StyleReference({
        styleReferencePath: STYLE_PATH,
        inspectImage: inspectAny,
        canonicalBundleBytes: Buffer.alloc(0),
        candidateBytes: STYLE_BYTES,
      }).reason ?? "",
      /canonical Cluster B b7 bytes are required/
    );
    assert.match(
      validateLucianSig4StyleReference({
        styleReferencePath: STYLE_PATH,
        inspectImage: inspectAny,
        canonicalBundleBytes: STYLE_BYTES,
        candidateBytes: Buffer.from("different-bytes"),
      }).reason ?? "",
      /bytes do not match/
    );
    const ok = validateLucianSig4StyleReference({
      styleReferencePath: STYLE_PATH,
      inspectImage: inspectAny,
      canonicalBundleBytes: STYLE_BYTES,
      candidateBytes: Buffer.from("canonical-cluster-b-b7"),
    });
    assert.equal(ok.ok, true);

    const missingCanonical = prepareLucianSig4StyleTrial({
      draftKey: LUCIAN_SIG4_TRIAL_DRAFT_KEY,
      slots: PILOT.assetPlan.slots,
      appearance: PILOT.appearance,
      identityReferencePath: REP_PATH,
      styleReferencePath: STYLE_PATH,
      inspectImage: inspectAny,
      styleCandidateId: "rf-02",
      style: RF02.dna,
      styleSeed: CLUSTER_B_SEED,
      candidateStyleBytes: STYLE_BYTES,
      env: EMPTY_IMAGE_ENV,
    });
    assert.equal(missingCanonical.ok, false);
    if (!missingCanonical.ok) {
      assert.equal(missingCanonical.providerCalls, 0);
      assert.match(missingCanonical.reason, /canonical Cluster B b7 bytes are required/);
    }
    const missingCandidate = prepareLucianSig4StyleTrial({
      draftKey: LUCIAN_SIG4_TRIAL_DRAFT_KEY,
      slots: PILOT.assetPlan.slots,
      appearance: PILOT.appearance,
      identityReferencePath: REP_PATH,
      styleReferencePath: STYLE_PATH,
      inspectImage: inspectAny,
      styleCandidateId: "rf-02",
      style: RF02.dna,
      styleSeed: CLUSTER_B_SEED,
      canonicalStyleBytes: STYLE_BYTES,
      env: EMPTY_IMAGE_ENV,
    });
    assert.equal(missingCandidate.ok, false);
    if (!missingCandidate.ok) {
      assert.equal(missingCandidate.providerCalls, 0);
      assert.match(missingCandidate.reason, /candidate Cluster B style bytes are required/);
    }
  });

  it("prepares the same sig4 shot with Image 1 IDENTITY ONLY and Image 2 STYLE ONLY", () => {
    const { slot, prompts } = buildSig4StylePrompt();
    const plan = prepareLucianSig4StyleTrial({
      draftKey: LUCIAN_SIG4_TRIAL_DRAFT_KEY,
      slots: PILOT.assetPlan.slots,
      appearance: PILOT.appearance,
      identityReferencePath: REP_PATH,
      styleReferencePath: STYLE_PATH,
      inspectImage: inspectAny,
      identityThenStylePrompt: prompts.primaryPrompt,
      styleCandidateId: LUCIAN_SIG4_TRIAL_STYLE_CANDIDATE_ID,
      style: RF02.dna,
      styleSeed: CLUSTER_B_SEED,
      canonicalStyleBytes: STYLE_BYTES,
      candidateStyleBytes: STYLE_BYTES,
      env: EMPTY_IMAGE_ENV,
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.mode, "lucian-sig4-style");
    assert.equal(plan.slotKey, "sig4");
    assert.deepEqual(plan.shot, LUCIAN_SIG4_REQUIRED_SHOT);
    assert.equal(plan.referenceRoleLayout, "identity_then_style");
    assert.equal(plan.references.length, 2);
    assert.equal(plan.references[0]!.path, REP_PATH);
    assert.equal(plan.references[1]!.path, STYLE_PATH);
    assert.equal(plan.persistedToProduction, false);
    assert.equal(plan.artifactDir, LUCIAN_SIG4_STYLE_TRIAL_ARTIFACT_DIR);
    assert.equal(plan.identityThenStyleRulePresent, true);
    assert.equal(plan.styleOwner.seedUrlsSentAsImage, true);
    assert.equal(plan.styleOwner.selectedStyleReferenceMarker, LUCIAN_SIG4_STYLE_REFERENCE_FILE_MARKER);
    assert.equal(plan.styleOwner.candidateId, "rf-02");
    assert.ok(prompts.primaryPrompt.includes(OFFICIAL_FACE_PROMPT.profile));
    assert.match(prompts.primaryPrompt, /high-angle camera looking slightly down/);
    assert.match(prompts.primaryPrompt, /close-up \(face and shoulders\)/);
    assert.equal(prompts.primaryPrompt.includes(OFFICIAL_IDENTITY_THEN_STYLE_IMAGE1_LABEL), true);
    assert.equal(prompts.primaryPrompt.includes(OFFICIAL_IDENTITY_THEN_STYLE_IMAGE2_LABEL), true);
    assert.equal(prompts.strictFallbackPrompt.includes(OFFICIAL_IDENTITY_THEN_STYLE_IMAGE1_LABEL), true);
    assert.equal(prompts.strictFallbackPrompt.includes(OFFICIAL_IDENTITY_THEN_STYLE_IMAGE2_LABEL), true);
    assert.equal(prompts.primaryPrompt.includes(OFFICIAL_STYLE_COPY_FORBIDDEN_CLAUSE), true);
    assert.equal(prompts.primaryPrompt.includes(OFFICIAL_IMAGE2_STYLE_ONLY_EXTRA_BAN), true);
    assert.equal(prompts.strictFallbackPrompt.includes(OFFICIAL_STYLE_COPY_FORBIDDEN_CLAUSE), true);
    assert.equal(prompts.strictFallbackPrompt.includes(OFFICIAL_IMAGE2_STYLE_ONLY_EXTRA_BAN), true);
    assert.equal(prompts.primaryPrompt.split(OFFICIAL_STYLE_COPY_FORBIDDEN_CLAUSE).length - 1, 1);
    assert.doesNotMatch(OFFICIAL_IMAGE2_STYLE_ONLY_EXTRA_BAN, /hairstyle|hair color|eye color|outfit|jewelry|pose|background/);
    assert.match(OFFICIAL_IMAGE2_STYLE_ONLY_EXTRA_BAN, /gender or body identity/);
    assert.match(OFFICIAL_IMAGE2_STYLE_ONLY_EXTRA_BAN, /camera, framing, scene/);
    assert.equal(prompts.primaryPrompt.includes(OFFICIAL_IDENTITY_ANCHOR_REFERENCE_RULE), false);
    assert.match(prompts.primaryPrompt, /rendering: cel/);
    assert.doesNotMatch(prompts.primaryPrompt, /(?:^|\n)framing:/);
    assert.ok(prompts.primaryPrompt.includes(slot.expression));
    assert.ok(prompts.primaryPrompt.includes(slot.pose));
    assert.doesNotMatch(prompts.primaryPrompt, /Pose family:|Expression register:/);

    const cost = lucianSig4StyleTrialCostPlan();
    assert.equal(cost.referenceCount, 2);
    assert.equal(cost.observedOneReferencePaidUsd, LUCIAN_SIG4_OBSERVED_ONE_REFERENCE_PAID_USD);
    assert.equal(cost.estimatedTwoReferencePrimaryUsd, LUCIAN_SIG4_STYLE_ESTIMATED_TWO_REFERENCE_PRIMARY_USD);
    assert.equal(cost.planningCeilingUsd, 0.24);
    assert.equal(cost.planningCeilingKind, "internal_reserve");
    assert.equal(cost.maxProviderCalls, MAX_PROVIDER_ATTEMPTS);
    assert.equal(cost.fallbackOnlyOnRecognizedSafetyRejection, true);
    assert.equal(cost.planningCeilingIsProviderHardCap, false);
  });

  it("promotes Cluster B variation generation to identity + approved style root", () => {
    const { prompts } = buildSig4Prompt();
    assert.equal(prompts.primaryPrompt.includes(OFFICIAL_IDENTITY_ANCHOR_REFERENCE_RULE), true);
    assert.doesNotMatch(prompts.primaryPrompt, /Image 1 IDENTITY ONLY/);
    assert.deepEqual(
      officialSlotGenerationReferences({
        kind: "signature",
        styleSeed: CLUSTER_B_SEED,
        representativeUrl: "/uploads/official-pilot-rf-v4-03__rep-a1.webp",
      }),
      ["/uploads/official-pilot-rf-v4-03__rep-a1.webp", CLUSTER_B_SEED.url]
    );
  });

  it("stops style prepare when identity, style, model, or prompt roles are wrong", () => {
    const { prompts } = buildSig4StylePrompt();
    const missingStyle = prepareLucianSig4StyleTrial({
      draftKey: LUCIAN_SIG4_TRIAL_DRAFT_KEY,
      slots: PILOT.assetPlan.slots,
      appearance: PILOT.appearance,
      identityReferencePath: REP_PATH,
      styleReferencePath: "",
      inspectImage: inspectAny,
      identityThenStylePrompt: prompts.primaryPrompt,
      styleCandidateId: "rf-02",
      style: RF02.dna,
      styleSeed: CLUSTER_B_SEED,
      env: EMPTY_IMAGE_ENV,
    });
    assert.equal(missingStyle.ok, false);
    if (!missingStyle.ok) {
      assert.equal(missingStyle.providerCalls, 0);
      assert.equal(missingStyle.persistedToProduction, false);
    }

    const wrongIdentity = prepareLucianSig4StyleTrial({
      draftKey: LUCIAN_SIG4_TRIAL_DRAFT_KEY,
      slots: PILOT.assetPlan.slots,
      appearance: PILOT.appearance,
      identityReferencePath: "/tmp/other-rep.webp",
      styleReferencePath: STYLE_PATH,
      inspectImage: inspectAny,
      identityThenStylePrompt: prompts.primaryPrompt,
      styleCandidateId: "rf-02",
      style: RF02.dna,
      styleSeed: CLUSTER_B_SEED,
      env: EMPTY_IMAGE_ENV,
    });
    assert.equal(wrongIdentity.ok, false);

    const identityOnlyPrompt = prepareLucianSig4StyleTrial({
      draftKey: LUCIAN_SIG4_TRIAL_DRAFT_KEY,
      slots: PILOT.assetPlan.slots,
      appearance: PILOT.appearance,
      identityReferencePath: REP_PATH,
      styleReferencePath: STYLE_PATH,
      inspectImage: inspectAny,
      identityThenStylePrompt: buildSig4Prompt().prompts.primaryPrompt,
      styleCandidateId: "rf-02",
      style: RF02.dna,
      styleSeed: CLUSTER_B_SEED,
      canonicalStyleBytes: STYLE_BYTES,
      candidateStyleBytes: STYLE_BYTES,
      env: EMPTY_IMAGE_ENV,
    });
    assert.equal(identityOnlyPrompt.ok, false);
    if (!identityOnlyPrompt.ok) {
      assert.match(identityOnlyPrompt.reason, /Image 1 IDENTITY ONLY|identity_then_style/);
      assert.equal(identityOnlyPrompt.providerCalls, 0);
    }

    const unknownModel = prepareLucianSig4StyleTrial({
      draftKey: LUCIAN_SIG4_TRIAL_DRAFT_KEY,
      slots: PILOT.assetPlan.slots,
      appearance: PILOT.appearance,
      identityReferencePath: REP_PATH,
      styleReferencePath: STYLE_PATH,
      inspectImage: inspectAny,
      identityThenStylePrompt: prompts.primaryPrompt,
      styleCandidateId: "rf-02",
      style: RF02.dna,
      styleSeed: CLUSTER_B_SEED,
      canonicalStyleBytes: STYLE_BYTES,
      candidateStyleBytes: STYLE_BYTES,
      env: { OPENAI_IMAGE_MODEL: "custom-image-x" } as NodeJS.ProcessEnv,
    });
    assert.equal(unknownModel.ok, false);
    if (!unknownModel.ok) {
      assert.equal(unknownModel.providerCalls, 0);
      assert.equal(unknownModel.resolvedModel, "custom-image-x");
    }
  });

  it("stops inherited LIVE before the provider function when style cost is not approved", () => {
    assert.deepEqual(lucianSig4StyleProviderCallDecision({ live: false, costApprovedRaw: undefined }), {
      action: "prepare",
      providerCalls: 0,
    });
    const inheritedLive = lucianSig4StyleProviderCallDecision({ live: true, costApprovedRaw: undefined });
    assert.equal(inheritedLive.action, "stop");
    if (inheritedLive.action !== "stop") return;
    assert.equal(inheritedLive.providerCalls, 0);
    assert.match(inheritedLive.reason, /STYLE_COST_APPROVED=1 is required/);
    const rejectedZero = lucianSig4StyleProviderCallDecision({ live: true, costApprovedRaw: "0" });
    assert.equal(rejectedZero.action, "stop");
    if (rejectedZero.action === "stop") {
      assert.equal(rejectedZero.providerCalls, 0);
    }
    assert.deepEqual(lucianSig4StyleProviderCallDecision({ live: true, costApprovedRaw: "1" }), {
      action: "allow_provider",
    });
    assert.equal(lucianSig4StyleLiveCostApprovalError(false, undefined), null);
    assert.equal(lucianSig4StyleLiveCostApprovalError(true, "1"), null);

    const script = fs.readFileSync(path.join(process.cwd(), "scripts/official-supply-quality-shot-qa.ts"), "utf8");
    const mainAt = script.indexOf("async function main(");
    const decisionCallAt = script.indexOf("lucianSig4StyleProviderCallDecision({");
    const generateCallAt = script.indexOf("await generateSlots({");
    assert.ok(mainAt >= 0 && decisionCallAt > mainAt && generateCallAt > decisionCallAt);
  });
});
