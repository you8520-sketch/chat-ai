import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { CHAT_IMAGE_GENERATION_DEFAULT_MODEL } from "@/lib/chatImageGeneration";
import { MAX_PROVIDER_ATTEMPTS } from "@/lib/openAiImageSafetyFallback";
import { evaluateAppearanceLock } from "@/lib/officialSupply/appearance";
import { evaluateAssetPlan } from "@/lib/officialSupply/assetPlan";
import { loadCompiledOfficialCharacterSource } from "@/lib/officialSupply/compiledOfficialSource";
import {
  officialImageSubjectRuleForSlot,
  OFFICIAL_SOLO_FOREGROUND_CLAUSE,
  OFFICIAL_USER_PARTNER_PARTIAL_CLAUSE,
  resolveOfficialImageSubjects,
} from "@/lib/officialSupply/imageSubjects";
import {
  OFFICIAL_ASSET_DEFAULT_QUALITY,
  OFFICIAL_REPRESENTATIVE_IMAGE_PROFILE,
  resolveOfficialAssetImageModel,
} from "@/lib/officialSupply/imageProfile";
import { testStyleCandidate } from "@/lib/officialSupply/officialSupply.fixtures";
import { ROFAN_V4_PRODUCTION_BATCH_CONFIG } from "@/lib/officialSupply/pilotProduction";
import { PILOT_STYLE_PROOF_CANDIDATE_ID } from "@/lib/officialSupply/pilotStyleProof";
import {
  LUCIAN_SIG4_OBSERVED_ONE_REFERENCE_PAID_USD,
  LUCIAN_SIG4_STYLE_REFERENCE_REPO_RELATIVE,
  officialQaClusterBPrimaryStyleLocalPath,
} from "@/lib/officialSupply/qualityShotQa";
import { resolveOfficialGenerationReferencePlan } from "@/lib/officialSupply/generationReferences";
import { composeOfficialSlotGeneration } from "@/lib/officialSupply/runner";
import { resolveOfficialSlotShot } from "@/lib/officialSupply/shotPlan";
import type { OfficialCharacterRecord } from "@/lib/officialSupply/store";
import { ROFAN_CLUSTER_B_VISUAL_STYLE_DNA } from "@/lib/officialSupply/style";
import type { OfficialAssetPlan, OfficialAssetSlotPlan } from "@/lib/officialSupply/types";
import {
  CLUSTER_B_COMPANION_STYLE_PATHS,
  CLUSTER_B_PRIMARY_GENERATION_PATHS,
  CLUSTER_B_PRIMARY_STYLE_PATH,
  buildClusterBRofanStyleSeed,
} from "@/lib/officialSupply/userOwnedRofanStyleRefs";

const PILOT_DIR = path.join(process.cwd(), "src/lib/officialSupply/pilot/characters");
const WOLFGANG_KEY = "pilot-rf-02";
const LUCIAN_KEY = "pilot-rf-03";
const ENV = { NEXTAUTH_URL: "https://example.test" } as NodeJS.ProcessEnv;
const ARTIFACT_PATH = path.join(os.tmpdir(), "wolfgang-rep-preflight.json");

type PilotFile = {
  bible: {
    publicProfile: { tagline: string; description: string; detailedDescription: string };
    greeting: string;
    identity: { worldRole: string };
  };
  assetPlan: OfficialAssetPlan;
};

function readPilot(draftKey: string): PilotFile {
  return JSON.parse(fs.readFileSync(path.join(PILOT_DIR, `${draftKey}.json`), "utf8")) as PilotFile;
}

function slotOf(plan: OfficialAssetPlan, slotKey: string): OfficialAssetSlotPlan {
  const slot = plan.slots.find((item) => item.slotKey === slotKey);
  assert.ok(slot, slotKey);
  return slot;
}

function publicAssetPath(publicPath: string): string {
  return path.join(process.cwd(), "public", publicPath.replace(/^\//, ""));
}

function publicAssetBytes(publicPath: string): Buffer {
  const local = publicAssetPath(publicPath);
  assert.ok(fs.existsSync(local), local);
  const bytes = fs.readFileSync(local);
  assert.ok(bytes.length > 0, `${local} is empty`);
  return bytes;
}

function wolfgangCharacter(plan: OfficialAssetPlan): OfficialCharacterRecord {
  const compiled = loadCompiledOfficialCharacterSource(WOLFGANG_KEY);
  return {
    draftKey: WOLFGANG_KEY,
    batchKey: "pilot-romance-fantasy-04-cluster-b",
    worldKey: compiled.worldKey,
    styleKey: compiled.draft.styleKey,
    stage: "asset_plan_locked",
    draft: compiled.draft,
    textLockHash: null,
    appearance: compiled.appearanceLock,
    appearanceLockHash: null,
    assetPlan: plan,
    isStyleProof: false,
    stagedCharacterId: null,
  };
}

describe("Wolfgang representative NO_POST preflight", () => {
  const file = readPilot(WOLFGANG_KEY);
  const compiled = loadCompiledOfficialCharacterSource(WOLFGANG_KEY);
  const plan = file.assetPlan;
  const styleSeed = buildClusterBRofanStyleSeed(ENV);
  const candidate = {
    ...testStyleCandidate(PILOT_STYLE_PROOF_CANDIDATE_ID),
    dna: ROFAN_CLUSTER_B_VISUAL_STYLE_DNA,
  };

  it("drops obsolete detention/handcuff/user-partner premises from the live 14-slot plan", () => {
    const planText = JSON.stringify(plan);
    assert.doesNotMatch(planText, /수갑/);
    assert.doesNotMatch(planText, /압송/);
    assert.doesNotMatch(planText, /character_plus_required_partner/);
    assert.doesNotMatch(planText, /partnerRole/);
    assert.doesNotMatch(planText, /차가운 심문/);
    assert.doesNotMatch(planText, /봉인 상자 앞의 심문/);
    assert.equal(slotOf(plan, "emo1").tag, "기록의 모순");
    assert.equal(slotOf(plan, "emo5").pose, "검을 쥔 손을 천천히 놓고 반박 자료를 읽도록 문서를 펼쳐 둔다");
    assert.equal(slotOf(plan, "scene1").tag, "위조된 명령서의 밤");
    assert.equal(slotOf(plan, "scene2").tag, "봉인된 장부의 빈칸");
    assert.equal(slotOf(plan, "scene3").tag, "황실의 마지막 압박");
    assert.equal(slotOf(plan, "scene2").location, "판도라 대도서관 심연의 아카이브");
    assert.equal(slotOf(plan, "scene3").location, "솔라리스 유리온실 (태양궁 최상층)");
    for (const slotKey of ["rep", "emo5", "scene1", "scene2", "scene3"] as const) {
      assert.deepEqual(resolveOfficialImageSubjects(slotOf(plan, slotKey)), {
        foreground: "solo_character",
        backgroundExtras: "none",
      });
    }
    assert.equal(plan.slots.length, 14);
    assert.deepEqual(evaluateAssetPlan(compiled.draft, plan).errors, []);
    assert.deepEqual(evaluateAppearanceLock(compiled.draft, compiled.appearanceLock).errors, []);
  });

  it("keeps Lucian partner scenes and Wolfgang public-copy locks unchanged", () => {
    const lucian = readPilot(LUCIAN_KEY);
    assert.equal(resolveOfficialImageSubjects(slotOf(lucian.assetPlan, "scene1")).foreground, "character_plus_required_partner");
    assert.equal(resolveOfficialImageSubjects(slotOf(lucian.assetPlan, "scene3")).foreground, "character_plus_required_partner");
    assert.equal(resolveOfficialImageSubjects(slotOf(lucian.assetPlan, "scene2")).foreground, "solo_character");
    assert.equal(file.bible.publicProfile.tagline.length, 37);
    assert.equal(file.bible.publicProfile.description.length, 254);
    assert.equal(file.bible.publicProfile.detailedDescription.length, 1299);
    assert.equal(file.bible.greeting.length, 1547);
    assert.equal(compiled.draft.description.length, 1299);
    assert.equal(compiled.draft.greeting.length, 1547);
    assert.match(compiled.draft.description, /몸무게 약 92kg/);
    assert.doesNotMatch(file.bible.identity.worldRole, /92kg|92㎏/);
  });

  it("composes the representative slot as Cluster B style-only 2:3 with local b7 bytes and 0 POST", () => {
    const refs = resolveOfficialGenerationReferencePlan({
      kind: "representative",
      styleSeed,
      representativeUrl: "/uploads/should-not-be-used.webp",
    });
    assert.equal(refs.ok, true);
    if (!refs.ok) return;
    assert.equal(refs.plan.mode, "representative_style_only");
    assert.equal(refs.plan.references.includes("/uploads/should-not-be-used.webp"), false);
    assert.ok(refs.plan.references[0]!.includes(CLUSTER_B_PRIMARY_STYLE_PATH));
    assert.deepEqual(
      CLUSTER_B_PRIMARY_GENERATION_PATHS,
      [CLUSTER_B_PRIMARY_STYLE_PATH, ...CLUSTER_B_COMPANION_STYLE_PATHS]
    );

    const localPrimary = publicAssetBytes(CLUSTER_B_PRIMARY_STYLE_PATH);
    const companionBytes = CLUSTER_B_COMPANION_STYLE_PATHS.map((item) => ({
      path: item,
      bytes: publicAssetBytes(item).length,
    }));
    assert.equal(officialQaClusterBPrimaryStyleLocalPath(CLUSTER_B_PRIMARY_STYLE_PATH), CLUSTER_B_PRIMARY_STYLE_PATH);
    assert.equal(officialQaClusterBPrimaryStyleLocalPath(LUCIAN_SIG4_STYLE_REFERENCE_REPO_RELATIVE), LUCIAN_SIG4_STYLE_REFERENCE_REPO_RELATIVE);
    assert.ok(localPrimary.length > 0);

    const composed = composeOfficialSlotGeneration({
      character: wolfgangCharacter(plan),
      style: {
        styleKey: compiled.draft.styleKey,
        genre: "로맨스 판타지",
        stage: "style_locked",
        candidates: [candidate],
        approvedCandidateId: candidate.candidateId,
        styleSeed,
        proofAssetLimit: 1,
      },
      slotKey: "rep",
      representativeUrl: null,
      env: {},
    });
    assert.equal(composed.ok, true);
    if (!composed.ok) return;
    assert.equal(composed.model, CHAT_IMAGE_GENERATION_DEFAULT_MODEL);
    assert.equal(composed.model, "gpt-image-2");
    assert.equal(resolveOfficialAssetImageModel({}), "gpt-image-2");
    assert.equal(resolveOfficialAssetImageModel({ OPENAI_IMAGE_MODEL: "gpt-image-2.5-sunburst" }), "gpt-image-2.5-sunburst");
    assert.equal(composed.profile.aspect, "2:3");
    assert.equal(composed.profile.size, OFFICIAL_REPRESENTATIVE_IMAGE_PROFILE.size);
    assert.equal(composed.profile.size, "1024x1536");
    assert.equal(composed.referenceRoleLayout, "slot_default");
    assert.deepEqual([...composed.references], [...refs.plan.references]);
    assert.match(composed.primaryPrompt, /STYLE ONLY/i);
    assert.match(composed.primaryPrompt, /rendering: cel/);
    assert.match(composed.primaryPrompt, /contrast: high/);
    assert.match(composed.primaryPrompt, new RegExp(OFFICIAL_SOLO_FOREGROUND_CLAUSE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(composed.primaryPrompt.includes(OFFICIAL_USER_PARTNER_PARTIAL_CLAUSE), false);
    assert.match(composed.primaryPrompt, /회청색/);
    assert.match(composed.primaryPrompt, /흑회색/);
    assert.match(composed.primaryPrompt, /188/);
    assert.match(composed.primaryPrompt, /왼쪽 턱/);
    assert.doesNotMatch(composed.primaryPrompt, /수갑|압송|플레이어와 함께/);
    assert.equal(officialImageSubjectRuleForSlot(slotOf(plan, "rep")).includes("exactly one foreground person"), true);
    const shot = resolveOfficialSlotShot(slotOf(plan, "rep"), WOLFGANG_KEY);
    assert.equal(shot.faceDirection, "front");
    assert.equal(shot.cameraAngle, "eye_level");
    assert.equal(shot.distance, "bust");

    assert.equal(ROFAN_V4_PRODUCTION_BATCH_CONFIG.maxAttemptsPerSlot, 2);
    assert.equal(ROFAN_V4_PRODUCTION_BATCH_CONFIG.reservePerImageUsd, 0.12);
    assert.equal(ROFAN_V4_PRODUCTION_BATCH_CONFIG.budgetUsd.perCharacter, 2.5);
    assert.equal(ROFAN_V4_PRODUCTION_BATCH_CONFIG.quality, "medium");
    assert.equal(OFFICIAL_ASSET_DEFAULT_QUALITY, "medium");
    assert.equal(MAX_PROVIDER_ATTEMPTS, 2);

    const runner = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/runner.ts"), "utf8");
    const adapters = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/productionAdapters.ts"), "utf8");
    assert.match(runner, /retryPendingUploadWith/);
    assert.match(runner, /upload_pending/);
    assert.match(runner, /function spoolKey/);
    assert.match(adapters, /fileOfficialAssetSpool/);
    assert.match(adapters, /official-supply-spool/);

    const evidence = {
      status: "PREPARE",
      providerCalls: 0,
      persistedToProduction: false,
      draftKey: WOLFGANG_KEY,
      slotKey: "rep",
      model: composed.model,
      modelOwner: "resolveOfficialAssetImageModel",
      quality: OFFICIAL_ASSET_DEFAULT_QUALITY,
      size: composed.profile.size,
      aspect: composed.profile.aspect,
      referenceMode: refs.plan.mode,
      references: [...composed.references],
      localBytes: {
        primaryPath: CLUSTER_B_PRIMARY_STYLE_PATH,
        primaryBytes: localPrimary.length,
        companions: companionBytes,
      },
      maxAttemptsPerSlot: ROFAN_V4_PRODUCTION_BATCH_CONFIG.maxAttemptsPerSlot,
      maxProviderAttemptsPerRun: MAX_PROVIDER_ATTEMPTS,
      reservePerImageUsd: ROFAN_V4_PRODUCTION_BATCH_CONFIG.reservePerImageUsd,
      planningCeilingUsd: Number(
        (ROFAN_V4_PRODUCTION_BATCH_CONFIG.reservePerImageUsd * MAX_PROVIDER_ATTEMPTS).toFixed(2)
      ),
      planningCeilingKind: "internal_reserve",
      planningCeilingIsProviderHardCap: false,
      perCharacterCapUsd: ROFAN_V4_PRODUCTION_BATCH_CONFIG.budgetUsd.perCharacter,
      exactProviderUsd: null,
      exactProviderUsdOwner: "calculateGptImage2CostUsd",
      exactProviderUsdReason: "usage.input_tokens_details is only available after a paid POST",
      closestObservedUsd: {
        source: "lucian-sig4 one-reference paid",
        usd: LUCIAN_SIG4_OBSERVED_ONE_REFERENCE_PAID_USD,
        note: "different slot, 3:2, one identity ref — not a Wolfgang representative quote",
      },
      spoolOwner: "fileOfficialAssetSpool + retryPendingUploadWith",
      paidPost: 0,
    };
    fs.mkdirSync(path.dirname(ARTIFACT_PATH), { recursive: true });
    fs.writeFileSync(ARTIFACT_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
    assert.equal(evidence.providerCalls, 0);
    assert.equal(evidence.paidPost, 0);
  });
});
