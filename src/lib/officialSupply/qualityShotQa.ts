import { CHAT_IMAGE_GENERATION_KNOWN_MODEL_IDS } from "@/lib/chatImageGeneration";
import { MAX_PROVIDER_ATTEMPTS } from "@/lib/openAiImageSafetyFallback";
import {
  OFFICIAL_IDENTITY_ANCHOR_REFERENCE_RULE,
  OFFICIAL_IDENTITY_THEN_STYLE_IMAGE1_LABEL,
  OFFICIAL_IDENTITY_THEN_STYLE_IMAGE2_LABEL,
  OFFICIAL_IMAGE2_STYLE_ONLY_EXTRA_BAN,
  officialIdentityThenStyleReferenceRule,
} from "@/lib/officialSupply/imagePrompt";
import {
  CLUSTER_B_PRIMARY_GENERATION_PATHS,
  CLUSTER_B_ROFAN_STYLE_PUBLIC_ROOT,
} from "@/lib/officialSupply/userOwnedRofanStyleRefs";
import {
  OFFICIAL_ASSET_DEFAULT_QUALITY,
  OFFICIAL_REPRESENTATIVE_IMAGE_PROFILE,
  OFFICIAL_RP_IMAGE_PROFILE,
  evaluateOfficialImageDimensions,
  resolveOfficialAssetImageModel,
} from "@/lib/officialSupply/imageProfile";
import { ROFAN_V4_PRODUCTION_BATCH_CONFIG } from "@/lib/officialSupply/pilotProduction";
import { PILOT_STYLE_PROOF_CANDIDATE_ID } from "@/lib/officialSupply/pilotStyleProof";
import {
  resolveOfficialSlotShot,
  type OfficialSlotShotResponsibility,
} from "@/lib/officialSupply/shotPlan";
import {
  isClusterBGraphicStyleSeed,
  resolveOfficialAssetStyleDna,
  ROFAN_CLUSTER_B_VISUAL_STYLE_DNA,
} from "@/lib/officialSupply/style";
import type {
  OfficialAppearanceLock,
  OfficialAssetSlotPlan,
  StyleReference,
  VisualStyleDna,
} from "@/lib/officialSupply/types";

export const OFFICIAL_SHOT_QA_LIVE_ENV = "OFFICIAL_QUALITY_SHOT_QA_LIVE";
export const OFFICIAL_SHOT_QA_MODE_ENV = "OFFICIAL_QUALITY_SHOT_QA_MODE";
export const OFFICIAL_SHOT_QA_REFERENCE_ENV = "OFFICIAL_QUALITY_SHOT_QA_REFERENCE_PATH";
export const OFFICIAL_SHOT_QA_STYLE_REFERENCE_ENV = "OFFICIAL_QUALITY_SHOT_QA_STYLE_REFERENCE_PATH";
export const OFFICIAL_SHOT_QA_STYLE_COST_APPROVED_ENV = "OFFICIAL_QUALITY_SHOT_QA_STYLE_COST_APPROVED";
export const OFFICIAL_SHOT_QA_ARTIFACT_ENV = "OFFICIAL_QUALITY_SHOT_QA_ARTIFACT_DIR";

export const OFFICIAL_SHOT_QA_DEFAULT_ARTIFACT_DIR = "/opt/cursor/artifacts/official-shot-qa";
export const LUCIAN_SIG4_TRIAL_ARTIFACT_DIR = `${OFFICIAL_SHOT_QA_DEFAULT_ARTIFACT_DIR}/lucian-sig4`;
export const LUCIAN_SIG4_STYLE_TRIAL_ARTIFACT_DIR = `${OFFICIAL_SHOT_QA_DEFAULT_ARTIFACT_DIR}/lucian-sig4-style`;

export const LUCIAN_SIG4_TRIAL_DRAFT_KEY = "pilot-rf-03";
export const LUCIAN_SIG4_TRIAL_SLOT_KEY = "sig4";
export const LUCIAN_V4_REPRESENTATIVE_FILE_MARKER = "official-pilot-rf-v4-03__rep";

/** Pixel-selected STYLE ONLY file for this proof — explicit b7, not catalog index 0. */
export const LUCIAN_SIG4_SELECTED_STYLE_REFERENCE_PUBLIC_PATH =
  `${CLUSTER_B_ROFAN_STYLE_PUBLIC_ROOT}/primary/b7-black-gold-uniform.webp`;
export const LUCIAN_SIG4_STYLE_REFERENCE_FILE_MARKER =
  "romance-fantasy-cluster-b-v1/primary/b7-black-gold-uniform";
export const LUCIAN_SIG4_STYLE_REFERENCE_REPO_RELATIVE = `public${LUCIAN_SIG4_SELECTED_STYLE_REFERENCE_PUBLIC_PATH}`;
export const LUCIAN_SIG4_OBSERVED_ONE_REFERENCE_PAID_USD = 0.030653;
export const LUCIAN_SIG4_STYLE_ESTIMATED_TWO_REFERENCE_PRIMARY_USD = 0.05;

export const LUCIAN_SIG4_REQUIRED_SHOT = {
  faceDirection: "profile",
  cameraAngle: "high_angle",
  distance: "close_up",
} as const;

/** Existing v4 Cluster B candidate — not rf-01, and not a new style owner. */
export const LUCIAN_SIG4_TRIAL_STYLE_CANDIDATE_ID = PILOT_STYLE_PROOF_CANDIDATE_ID;

const RF01_STYLE_LEAKAGE_MARKERS = [
  "세미 리얼",
  "세미리얼",
  "아이보리, 로즈",
  "중저 대비",
  "얇은 그라데이션",
  "은은한 광택",
  "유리궁전",
] as const;

export const LUCIAN_APPEARANCE_LOCK_MARKERS = [
  "붉은 기가 도는 짙은 갈색",
  "짙은 호박색에 가까운 갈색",
  "햇볕에 그을린 구리빛 피부",
  "왼쪽 눈의 금장식 모노클",
] as const;

export type OfficialShotQaMode = "default" | "lucian-sig4" | "lucian-sig4-style";
export type LucianSig4StyleReferenceRole = "IDENTITY ONLY" | "STYLE ONLY";

export type LucianSig4StyleProviderReference = {
  index: 0 | 1;
  role: LucianSig4StyleReferenceRole;
  path: string;
};

export type OfficialShotQaImageInspect = (filePath: string) => {
  width: number;
  height: number;
} | null;

export type LucianSig4TrialCostPlan = {
  modelOwner: "resolveOfficialAssetImageModel";
  quality: typeof OFFICIAL_ASSET_DEFAULT_QUALITY;
  size: typeof OFFICIAL_RP_IMAGE_PROFILE.size;
  maxProviderCalls: typeof MAX_PROVIDER_ATTEMPTS;
  fallbackOnlyOnRecognizedSafetyRejection: true;
  reservePerAttemptUsd: number;
  planningCeilingUsd: number;
  planningCeilingKind: "internal_reserve";
  planningCeilingIsProviderHardCap: false;
};

export type LucianSig4TrialStyleOwner = {
  candidateId: typeof LUCIAN_SIG4_TRIAL_STYLE_CANDIDATE_ID;
  dnaOwner: "ROFAN_CLUSTER_B_VISUAL_STYLE_DNA";
  resolverOwner: "resolveOfficialAssetStyleDna";
  seedOwner: "buildClusterBRofanStyleSeed";
  styleCluster: "cluster_b_graphic";
  seedUrlsSentAsImage: false;
};

export type LucianSig4StyleTrialCostPlan = LucianSig4TrialCostPlan & {
  referenceCount: 2;
  observedOneReferencePaidUsd: typeof LUCIAN_SIG4_OBSERVED_ONE_REFERENCE_PAID_USD;
  estimatedTwoReferencePrimaryUsd: typeof LUCIAN_SIG4_STYLE_ESTIMATED_TWO_REFERENCE_PRIMARY_USD;
  planningCeilingUnchangedReason: string;
};

export type LucianSig4StyleTrialStyleOwner = Omit<LucianSig4TrialStyleOwner, "seedUrlsSentAsImage"> & {
  seedUrlsSentAsImage: true;
  selectedStyleReferenceMarker: typeof LUCIAN_SIG4_STYLE_REFERENCE_FILE_MARKER;
  selectedStyleReferenceRole: "STYLE ONLY";
};

export type LucianSig4StyleTrialPrepareOk = {
  ok: true;
  status: "PREPARE";
  mode: "lucian-sig4-style";
  draftKey: typeof LUCIAN_SIG4_TRIAL_DRAFT_KEY;
  slotKey: typeof LUCIAN_SIG4_TRIAL_SLOT_KEY;
  shot: Pick<OfficialSlotShotResponsibility, "faceDirection" | "cameraAngle" | "distance">;
  referenceRoleLayout: "identity_then_style";
  references: [LucianSig4StyleProviderReference, LucianSig4StyleProviderReference];
  identityReferencePath: string;
  styleReferencePath: string;
  artifactDir: string;
  persistedToProduction: false;
  identityThenStyleRulePresent: boolean;
  resolvedModel: string;
  styleOwner: LucianSig4StyleTrialStyleOwner;
  cost: LucianSig4StyleTrialCostPlan;
};

export type LucianSig4TrialPrepareOk = {
  ok: true;
  status: "PREPARE";
  draftKey: typeof LUCIAN_SIG4_TRIAL_DRAFT_KEY;
  slotKey: typeof LUCIAN_SIG4_TRIAL_SLOT_KEY;
  shot: Pick<OfficialSlotShotResponsibility, "faceDirection" | "cameraAngle" | "distance">;
  referencePath: string;
  artifactDir: string;
  persistedToProduction: false;
  identityAnchorRulePresent: boolean;
  resolvedModel: string;
  styleOwner: LucianSig4TrialStyleOwner;
  cost: LucianSig4TrialCostPlan;
};

export type LucianSig4TrialPrepareStop = {
  ok: false;
  status: "STOP";
  reason: string;
  persistedToProduction: false;
  providerCalls: 0;
  resolvedModel?: string;
};

export function resolveOfficialShotQaMode(
  raw: string | null | undefined
): { ok: true; mode: OfficialShotQaMode } | { ok: false; reason: string } {
  const mode = (raw ?? "default").trim() || "default";
  switch (mode) {
    case "default":
    case "lucian-sig4":
    case "lucian-sig4-style":
      return { ok: true, mode };
    default:
      return { ok: false, reason: `unknown ${OFFICIAL_SHOT_QA_MODE_ENV} "${mode}"` };
  }
}

export function officialShotQaArtifactDir(
  mode: OfficialShotQaMode,
  override?: string | null
): string {
  const explicit = override?.trim();
  if (explicit) return explicit;
  switch (mode) {
    case "lucian-sig4-style":
      return LUCIAN_SIG4_STYLE_TRIAL_ARTIFACT_DIR;
    case "lucian-sig4":
      return LUCIAN_SIG4_TRIAL_ARTIFACT_DIR;
    case "default":
      return OFFICIAL_SHOT_QA_DEFAULT_ARTIFACT_DIR;
    default: {
      const exhaustive: never = mode;
      throw new Error(`Unknown official shot QA mode ${String(exhaustive)}`);
    }
  }
}

export function lucianSig4TrialCostPlan(): LucianSig4TrialCostPlan {
  const reservePerAttemptUsd = ROFAN_V4_PRODUCTION_BATCH_CONFIG.reservePerImageUsd;
  return {
    modelOwner: "resolveOfficialAssetImageModel",
    quality: OFFICIAL_ASSET_DEFAULT_QUALITY,
    size: OFFICIAL_RP_IMAGE_PROFILE.size,
    maxProviderCalls: MAX_PROVIDER_ATTEMPTS,
    fallbackOnlyOnRecognizedSafetyRejection: true,
    reservePerAttemptUsd,
    planningCeilingUsd: Number((reservePerAttemptUsd * MAX_PROVIDER_ATTEMPTS).toFixed(2)),
    planningCeilingKind: "internal_reserve",
    planningCeilingIsProviderHardCap: false,
  };
}

export function lucianSig4TrialStyleOwner(): LucianSig4TrialStyleOwner {
  return {
    candidateId: LUCIAN_SIG4_TRIAL_STYLE_CANDIDATE_ID,
    dnaOwner: "ROFAN_CLUSTER_B_VISUAL_STYLE_DNA",
    resolverOwner: "resolveOfficialAssetStyleDna",
    seedOwner: "buildClusterBRofanStyleSeed",
    styleCluster: "cluster_b_graphic",
    seedUrlsSentAsImage: false,
  };
}

function prepareStop(reason: string, resolvedModel?: string): LucianSig4TrialPrepareStop {
  return {
    ok: false,
    status: "STOP",
    reason,
    persistedToProduction: false,
    providerCalls: 0,
    ...(resolvedModel ? { resolvedModel } : {}),
  };
}

/** Official dated snapshot suffix only: `-YYYY-MM-DD`. Arbitrary prefixes/suffixes stay unknown. */
const LUCIAN_SIG4_PROOF_DATED_SNAPSHOT_SUFFIX_RE = /^-\d{4}-\d{2}-\d{2}$/;

export function isLucianSig4ProofSupportedImageModel(modelId: string): boolean {
  const trimmed = modelId.trim();
  if (!trimmed) return false;
  return CHAT_IMAGE_GENERATION_KNOWN_MODEL_IDS.some((base) => {
    if (trimmed === base) return true;
    return (
      trimmed.startsWith(`${base}-`) &&
      LUCIAN_SIG4_PROOF_DATED_SNAPSHOT_SUFFIX_RE.test(trimmed.slice(base.length))
    );
  });
}

export function resolveLucianSig4ProofImageModel(
  env: NodeJS.ProcessEnv = process.env
): { ok: true; model: string } | { ok: false; reason: string; model: string } {
  const model = resolveOfficialAssetImageModel(env);
  if (!isLucianSig4ProofSupportedImageModel(model)) {
    return {
      ok: false,
      model,
      reason: `lucian-sig4 proof refuses unsupported resolved image model "${model}"`,
    };
  }
  return { ok: true, model };
}

export function pickLucianSig4TrialStyleCandidate<T extends { candidateId: string }>(
  candidates: readonly T[]
): { ok: true; candidate: T } | { ok: false; reason: string } {
  const candidate = candidates.find((item) => item.candidateId === LUCIAN_SIG4_TRIAL_STYLE_CANDIDATE_ID);
  if (!candidate) {
    return {
      ok: false,
      reason: `lucian-sig4 reuses existing style candidate ${LUCIAN_SIG4_TRIAL_STYLE_CANDIDATE_ID}`,
    };
  }
  return { ok: true, candidate };
}

export function resolveLucianSig4TrialStyle(input: {
  candidateId: string;
  candidateDna: VisualStyleDna;
  styleSeed?: StyleReference | null;
}): { ok: true; style: VisualStyleDna; styleSeed: StyleReference | null } | { ok: false; reason: string } {
  if (input.candidateId !== LUCIAN_SIG4_TRIAL_STYLE_CANDIDATE_ID) {
    return {
      ok: false,
      reason: `lucian-sig4 reuses existing style candidate ${LUCIAN_SIG4_TRIAL_STYLE_CANDIDATE_ID}, refusing ${input.candidateId}`,
    };
  }
  if (input.styleSeed && !isClusterBGraphicStyleSeed(input.styleSeed)) {
    return { ok: false, reason: "lucian-sig4 refuses a non-Cluster-B style seed" };
  }
  const style = input.styleSeed
    ? resolveOfficialAssetStyleDna(input.candidateDna, input.styleSeed)
    : ROFAN_CLUSTER_B_VISUAL_STYLE_DNA;
  if (style.rendering !== "cel" || style.contrast !== "high" || style.lightSoftness !== "hard") {
    return { ok: false, reason: "lucian-sig4 resolved style is not the existing Cluster B graphic DNA" };
  }
  return { ok: true, style, styleSeed: input.styleSeed ?? null };
}

export function lucianSig4TrialPromptIntegrityError(input: {
  prompt: string;
  expression: string;
  pose: string;
}): string | null {
  if (!input.prompt.includes(OFFICIAL_IDENTITY_ANCHOR_REFERENCE_RULE)) {
    return "assembled prompt is missing IDENTITY ANCHOR ONLY";
  }
  if (!input.prompt.includes("rendering: cel") || !input.prompt.includes("contrast: high")) {
    return "assembled prompt is missing Cluster B graphic/cel/high-contrast direction";
  }
  if (!/웹툰|그래픽/.test(input.prompt)) {
    return "assembled prompt is missing Cluster B webtoon/graphic grammar";
  }
  if (/(?:^|\n)framing:/.test(input.prompt)) {
    return "assembled prompt reintroduced DNA framing after #1382";
  }
  const leak = RF01_STYLE_LEAKAGE_MARKERS.find((marker) => input.prompt.includes(marker));
  if (leak) {
    return `assembled prompt leaks rf-01 style (${leak})`;
  }
  if (!input.prompt.includes(input.expression) || !input.prompt.includes(input.pose)) {
    return "assembled prompt is missing sig4 slot.expression or slot.pose";
  }
  return null;
}

export function appearanceLockMatchesLucian(appearance: OfficialAppearanceLock): string | null {
  const blob = [
    appearance.identity.hairColor,
    appearance.identity.eyeColor,
    appearance.identity.skinTone,
    appearance.identity.identifyingFeatures.join(" "),
    appearance.outfit.defaultOutfit,
    appearance.forbiddenDrift.join(" "),
  ].join("\n");
  const missing = LUCIAN_APPEARANCE_LOCK_MARKERS.filter((marker) => !blob.includes(marker));
  if (missing.length) {
    return `Appearance Lock is missing Lucian identity markers: ${missing.join(", ")}`;
  }
  if (appearance.identity.heightCm !== 184) {
    return `Appearance Lock heightCm ${appearance.identity.heightCm} is not Lucian's 184`;
  }
  return null;
}

export function validateLucianV4IdentityReference(input: {
  referencePath: string | null | undefined;
  appearance: OfficialAppearanceLock;
  inspectImage: OfficialShotQaImageInspect;
}): { ok: true; path: string } | { ok: false; reason: string } {
  const lockError = appearanceLockMatchesLucian(input.appearance);
  if (lockError) return { ok: false, reason: lockError };

  const referencePath = input.referencePath?.trim() ?? "";
  if (!referencePath) {
    return {
      ok: false,
      reason: `${OFFICIAL_SHOT_QA_REFERENCE_ENV} is required for lucian-sig4; refusing a style-only substitute`,
    };
  }
  if (!referencePath.includes(LUCIAN_V4_REPRESENTATIVE_FILE_MARKER)) {
    return {
      ok: false,
      reason: `identity reference must be the approved v4 representative (${LUCIAN_V4_REPRESENTATIVE_FILE_MARKER})`,
    };
  }

  const dims = input.inspectImage(referencePath);
  if (!dims) {
    return { ok: false, reason: `identity reference is missing or unreadable: ${referencePath}` };
  }
  if (evaluateOfficialImageDimensions(OFFICIAL_REPRESENTATIVE_IMAGE_PROFILE, dims.width, dims.height) !== "exact") {
    return {
      ok: false,
      reason: `identity reference ${dims.width}x${dims.height} is not the representative ${OFFICIAL_REPRESENTATIVE_IMAGE_PROFILE.size}`,
    };
  }
  return { ok: true, path: referencePath };
}

export function pickLucianSig4TrialSlot(
  slots: readonly OfficialAssetSlotPlan[],
  draftKey: string
): { ok: true; slot: OfficialAssetSlotPlan; shot: OfficialSlotShotResponsibility } | { ok: false; reason: string } {
  const slot = slots.find((item) => item.slotKey === LUCIAN_SIG4_TRIAL_SLOT_KEY);
  if (!slot || slot.kind !== "signature") {
    return { ok: false, reason: `${LUCIAN_SIG4_TRIAL_SLOT_KEY} signature slot is missing` };
  }
  if (draftKey !== LUCIAN_SIG4_TRIAL_DRAFT_KEY) {
    return { ok: false, reason: `lucian-sig4 trial is locked to ${LUCIAN_SIG4_TRIAL_DRAFT_KEY}` };
  }
  const shot = resolveOfficialSlotShot(slot, draftKey);
  if (
    shot.faceDirection !== LUCIAN_SIG4_REQUIRED_SHOT.faceDirection ||
    shot.cameraAngle !== LUCIAN_SIG4_REQUIRED_SHOT.cameraAngle ||
    shot.distance !== LUCIAN_SIG4_REQUIRED_SHOT.distance
  ) {
    return {
      ok: false,
      reason: `${LUCIAN_SIG4_TRIAL_SLOT_KEY} resolved ${shot.faceDirection}/${shot.cameraAngle}/${shot.distance}, expected profile/high_angle/close_up`,
    };
  }
  return { ok: true, slot, shot };
}

export function prepareLucianSig4Trial(input: {
  draftKey: string;
  slots: readonly OfficialAssetSlotPlan[];
  appearance: OfficialAppearanceLock;
  referencePath: string | null | undefined;
  inspectImage: OfficialShotQaImageInspect;
  artifactDir?: string | null;
  identityAnchorPrompt?: string;
  styleCandidateId: string;
  style: VisualStyleDna;
  styleSeed?: StyleReference | null;
  env?: NodeJS.ProcessEnv;
}): LucianSig4TrialPrepareOk | LucianSig4TrialPrepareStop {
  const slotResult = pickLucianSig4TrialSlot(input.slots, input.draftKey);
  if (!slotResult.ok) {
    return prepareStop(slotResult.reason);
  }
  const reference = validateLucianV4IdentityReference({
    referencePath: input.referencePath,
    appearance: input.appearance,
    inspectImage: input.inspectImage,
  });
  if (!reference.ok) {
    return prepareStop(reference.reason);
  }
  const styleResult = resolveLucianSig4TrialStyle({
    candidateId: input.styleCandidateId,
    candidateDna: input.style,
    styleSeed: input.styleSeed,
  });
  if (!styleResult.ok) {
    return prepareStop(styleResult.reason);
  }
  const modelResult = resolveLucianSig4ProofImageModel(input.env);
  if (!modelResult.ok) {
    return prepareStop(modelResult.reason, modelResult.model);
  }
  const prompt = input.identityAnchorPrompt ?? "";
  if (prompt) {
    const promptError = lucianSig4TrialPromptIntegrityError({
      prompt,
      expression: slotResult.slot.expression,
      pose: slotResult.slot.pose,
    });
    if (promptError) {
      return prepareStop(promptError, modelResult.model);
    }
  }
  return {
    ok: true,
    status: "PREPARE",
    draftKey: LUCIAN_SIG4_TRIAL_DRAFT_KEY,
    slotKey: LUCIAN_SIG4_TRIAL_SLOT_KEY,
    shot: {
      faceDirection: slotResult.shot.faceDirection,
      cameraAngle: slotResult.shot.cameraAngle,
      distance: slotResult.shot.distance,
    },
    referencePath: reference.path,
    artifactDir: officialShotQaArtifactDir("lucian-sig4", input.artifactDir),
    persistedToProduction: false,
    identityAnchorRulePresent: !prompt || prompt.includes(OFFICIAL_IDENTITY_ANCHOR_REFERENCE_RULE),
    resolvedModel: modelResult.model,
    styleOwner: lucianSig4TrialStyleOwner(),
    cost: lucianSig4TrialCostPlan(),
  };
}

export function lucianSig4StyleLiveCostApprovalError(
  live: boolean,
  costApprovedRaw: string | null | undefined
): string | null {
  if (!live) return null;
  if (costApprovedRaw?.trim() === "1") return null;
  return `${OFFICIAL_SHOT_QA_STYLE_COST_APPROVED_ENV}=1 is required before lucian-sig4-style LIVE; refusing inherited ${OFFICIAL_SHOT_QA_LIVE_ENV}`;
}

export type LucianSig4StyleProviderCallDecision =
  | { action: "prepare"; providerCalls: 0 }
  | { action: "stop"; providerCalls: 0; reason: string }
  | { action: "allow_provider" };

/** Executable LIVE gate for lucian-sig4-style — decide before any provider function. */
export function lucianSig4StyleProviderCallDecision(input: {
  live: boolean;
  costApprovedRaw: string | null | undefined;
}): LucianSig4StyleProviderCallDecision {
  if (!input.live) {
    return { action: "prepare", providerCalls: 0 };
  }
  const reason = lucianSig4StyleLiveCostApprovalError(true, input.costApprovedRaw);
  if (reason) {
    return { action: "stop", providerCalls: 0, reason };
  }
  return { action: "allow_provider" };
}

export function lucianSig4StyleTrialCostPlan(): LucianSig4StyleTrialCostPlan {
  const base = lucianSig4TrialCostPlan();
  return {
    ...base,
    referenceCount: 2,
    observedOneReferencePaidUsd: LUCIAN_SIG4_OBSERVED_ONE_REFERENCE_PAID_USD,
    estimatedTwoReferencePrimaryUsd: LUCIAN_SIG4_STYLE_ESTIMATED_TWO_REFERENCE_PRIMARY_USD,
    planningCeilingUnchangedReason:
      "second STYLE ONLY image adds image-input tokens only; 2-ref primary stays far under the existing 2 * reserve internal ceiling",
  };
}

export function lucianSig4StyleTrialStyleOwner(): LucianSig4StyleTrialStyleOwner {
  return {
    candidateId: LUCIAN_SIG4_TRIAL_STYLE_CANDIDATE_ID,
    dnaOwner: "ROFAN_CLUSTER_B_VISUAL_STYLE_DNA",
    resolverOwner: "resolveOfficialAssetStyleDna",
    seedOwner: "buildClusterBRofanStyleSeed",
    styleCluster: "cluster_b_graphic",
    seedUrlsSentAsImage: true,
    selectedStyleReferenceMarker: LUCIAN_SIG4_STYLE_REFERENCE_FILE_MARKER,
    selectedStyleReferenceRole: "STYLE ONLY",
  };
}

export function lucianSig4SelectedStyleReferenceIsInClusterBCatalog(): boolean {
  return (CLUSTER_B_PRIMARY_GENERATION_PATHS as readonly string[]).includes(
    LUCIAN_SIG4_SELECTED_STYLE_REFERENCE_PUBLIC_PATH
  );
}

export function selectedClusterBStyleReferenceMatchesCanonical(pathValue: string): boolean {
  return (
    pathValue.includes(LUCIAN_SIG4_STYLE_REFERENCE_FILE_MARKER) &&
    lucianSig4SelectedStyleReferenceIsInClusterBCatalog()
  );
}

function requiredStyleBytes(
  value: Buffer | null | undefined
): value is Buffer {
  return Buffer.isBuffer(value) && value.length > 0;
}

export function validateLucianSig4StyleReference(input: {
  styleReferencePath: string | null | undefined;
  inspectImage: OfficialShotQaImageInspect;
  canonicalBundleBytes?: Buffer | null;
  candidateBytes?: Buffer | null;
}): { ok: true; path: string } | { ok: false; reason: string } {
  const stylePath = input.styleReferencePath?.trim() ?? "";
  if (!stylePath) {
    return {
      ok: false,
      reason: `${OFFICIAL_SHOT_QA_STYLE_REFERENCE_ENV} is required for lucian-sig4-style`,
    };
  }
  if (!selectedClusterBStyleReferenceMatchesCanonical(stylePath)) {
    return {
      ok: false,
      reason: `style reference must be the selected canonical Cluster B file (${LUCIAN_SIG4_STYLE_REFERENCE_FILE_MARKER})`,
    };
  }
  const dims = input.inspectImage(stylePath);
  if (!dims) {
    return { ok: false, reason: `style reference is missing or unreadable: ${stylePath}` };
  }
  if (!requiredStyleBytes(input.canonicalBundleBytes)) {
    return { ok: false, reason: "canonical Cluster B b7 bytes are required for lucian-sig4-style" };
  }
  if (!requiredStyleBytes(input.candidateBytes)) {
    return { ok: false, reason: "candidate Cluster B style bytes are required for lucian-sig4-style" };
  }
  if (!input.canonicalBundleBytes.equals(input.candidateBytes)) {
    return {
      ok: false,
      reason: "style reference bytes do not match the canonical Cluster B bundle file",
    };
  }
  return { ok: true, path: stylePath };
}

export function assembleLucianSig4StyleProviderReferences(input: {
  identityPath: string;
  stylePath: string;
}):
  | { ok: true; references: [LucianSig4StyleProviderReference, LucianSig4StyleProviderReference] }
  | { ok: false; reason: string } {
  const identityPath = input.identityPath.trim();
  const stylePath = input.stylePath.trim();
  if (!identityPath.includes(LUCIAN_V4_REPRESENTATIVE_FILE_MARKER)) {
    return { ok: false, reason: "identity representative is not the approved v4 Lucian representative" };
  }
  if (!selectedClusterBStyleReferenceMatchesCanonical(stylePath)) {
    return { ok: false, reason: "style reference is not the selected canonical Cluster B image" };
  }
  if (identityPath === stylePath) {
    return { ok: false, reason: "identity and style references must be two distinct files" };
  }
  return {
    ok: true,
    references: [
      { index: 0, role: "IDENTITY ONLY", path: identityPath },
      { index: 1, role: "STYLE ONLY", path: stylePath },
    ],
  };
}

export function lucianSig4StyleProviderReferenceOrderError(
  references: ReadonlyArray<{ role?: string; path: string }>
): string | null {
  if (references.length !== 2) {
    return `expected exactly 2 provider references, got ${references.length}`;
  }
  const first = references[0]!;
  const second = references[1]!;
  if (!first.path.includes(LUCIAN_V4_REPRESENTATIVE_FILE_MARKER)) {
    return "provider reference[0] must be the Lucian identity representative";
  }
  if (!selectedClusterBStyleReferenceMatchesCanonical(second.path)) {
    return "provider reference[1] must be the selected Cluster B STYLE ONLY image";
  }
  if (first.role && first.role !== "IDENTITY ONLY") {
    return "provider reference[0] role must be IDENTITY ONLY";
  }
  if (second.role && second.role !== "STYLE ONLY") {
    return "provider reference[1] role must be STYLE ONLY";
  }
  return null;
}

export function lucianSig4StyleTrialPromptIntegrityError(input: {
  prompt: string;
  expression: string;
  pose: string;
}): string | null {
  if (!input.prompt.includes(OFFICIAL_IDENTITY_THEN_STYLE_IMAGE1_LABEL)) {
    return "assembled prompt is missing Image 1 IDENTITY ONLY";
  }
  if (!input.prompt.includes(OFFICIAL_IDENTITY_THEN_STYLE_IMAGE2_LABEL)) {
    return "assembled prompt is missing Image 2 STYLE ONLY";
  }
  if (input.prompt.includes(OFFICIAL_IDENTITY_ANCHOR_REFERENCE_RULE)) {
    return "assembled prompt must use identity_then_style roles, not IDENTITY ANCHOR ONLY alone";
  }
  if (!input.prompt.includes(OFFICIAL_IMAGE2_STYLE_ONLY_EXTRA_BAN)) {
    return "assembled prompt is missing Image 2 gender/camera/scene/palette extra ban";
  }
  if (!input.prompt.includes("rendering: cel") || !input.prompt.includes("contrast: high")) {
    return "assembled prompt is missing Cluster B graphic/cel/high-contrast direction";
  }
  if (!/웹툰|그래픽/.test(input.prompt)) {
    return "assembled prompt is missing Cluster B webtoon/graphic grammar";
  }
  if (/(?:^|\n)framing:/.test(input.prompt)) {
    return "assembled prompt reintroduced DNA framing after #1382";
  }
  const leak = RF01_STYLE_LEAKAGE_MARKERS.find((marker) => input.prompt.includes(marker));
  if (leak) {
    return `assembled prompt leaks rf-01 style (${leak})`;
  }
  if (!input.prompt.includes(input.expression) || !input.prompt.includes(input.pose)) {
    return "assembled prompt is missing sig4 slot.expression or slot.pose";
  }
  const expectedRule = officialIdentityThenStyleReferenceRule({
    url: `https://example.test${LUCIAN_SIG4_SELECTED_STYLE_REFERENCE_PUBLIC_PATH}`,
    provenance: "platform_owned",
    note: "STYLE ONLY integrity check — Cluster B graphic extras only",
    styleCluster: "cluster_b_graphic",
  });
  if (!input.prompt.includes(expectedRule)) {
    return "assembled prompt is missing the canonical identity_then_style reference rule";
  }
  return null;
}

export function prepareLucianSig4StyleTrial(input: {
  draftKey: string;
  slots: readonly OfficialAssetSlotPlan[];
  appearance: OfficialAppearanceLock;
  identityReferencePath: string | null | undefined;
  styleReferencePath: string | null | undefined;
  inspectImage: OfficialShotQaImageInspect;
  artifactDir?: string | null;
  identityThenStylePrompt?: string;
  styleCandidateId: string;
  style: VisualStyleDna;
  styleSeed?: StyleReference | null;
  canonicalStyleBytes?: Buffer | null;
  candidateStyleBytes?: Buffer | null;
  env?: NodeJS.ProcessEnv;
}): LucianSig4StyleTrialPrepareOk | LucianSig4TrialPrepareStop {
  const slotResult = pickLucianSig4TrialSlot(input.slots, input.draftKey);
  if (!slotResult.ok) {
    return prepareStop(slotResult.reason);
  }
  const identity = validateLucianV4IdentityReference({
    referencePath: input.identityReferencePath,
    appearance: input.appearance,
    inspectImage: input.inspectImage,
  });
  if (!identity.ok) {
    return prepareStop(identity.reason);
  }
  const styleRef = validateLucianSig4StyleReference({
    styleReferencePath: input.styleReferencePath,
    inspectImage: input.inspectImage,
    canonicalBundleBytes: input.canonicalStyleBytes,
    candidateBytes: input.candidateStyleBytes,
  });
  if (!styleRef.ok) {
    return prepareStop(styleRef.reason);
  }
  const assembled = assembleLucianSig4StyleProviderReferences({
    identityPath: identity.path,
    stylePath: styleRef.path,
  });
  if (!assembled.ok) {
    return prepareStop(assembled.reason);
  }
  const orderError = lucianSig4StyleProviderReferenceOrderError(assembled.references);
  if (orderError) {
    return prepareStop(orderError);
  }
  const styleResult = resolveLucianSig4TrialStyle({
    candidateId: input.styleCandidateId,
    candidateDna: input.style,
    styleSeed: input.styleSeed,
  });
  if (!styleResult.ok) {
    return prepareStop(styleResult.reason);
  }
  const modelResult = resolveLucianSig4ProofImageModel(input.env);
  if (!modelResult.ok) {
    return prepareStop(modelResult.reason, modelResult.model);
  }
  const prompt = input.identityThenStylePrompt ?? "";
  if (prompt) {
    const promptError = lucianSig4StyleTrialPromptIntegrityError({
      prompt,
      expression: slotResult.slot.expression,
      pose: slotResult.slot.pose,
    });
    if (promptError) {
      return prepareStop(promptError, modelResult.model);
    }
  }
  return {
    ok: true,
    status: "PREPARE",
    mode: "lucian-sig4-style",
    draftKey: LUCIAN_SIG4_TRIAL_DRAFT_KEY,
    slotKey: LUCIAN_SIG4_TRIAL_SLOT_KEY,
    shot: {
      faceDirection: slotResult.shot.faceDirection,
      cameraAngle: slotResult.shot.cameraAngle,
      distance: slotResult.shot.distance,
    },
    referenceRoleLayout: "identity_then_style",
    references: assembled.references,
    identityReferencePath: identity.path,
    styleReferencePath: styleRef.path,
    artifactDir: officialShotQaArtifactDir("lucian-sig4-style", input.artifactDir),
    persistedToProduction: false,
    identityThenStyleRulePresent: !prompt || prompt.includes(OFFICIAL_IDENTITY_THEN_STYLE_IMAGE1_LABEL),
    resolvedModel: modelResult.model,
    styleOwner: lucianSig4StyleTrialStyleOwner(),
    cost: lucianSig4StyleTrialCostPlan(),
  };
}

const DEFAULT_QA_MAX_SLOTS = 6;

/** Existing multi-slot QA picker — unchanged behavior for mode=default. */
export function pickDefaultOfficialShotQaSlots(
  slots: readonly OfficialAssetSlotPlan[],
  draftKey: string
): OfficialAssetSlotPlan[] {
  const scored = slots
    .filter((slot) => slot.kind !== "representative")
    .map((slot) => ({ slot, shot: resolveOfficialSlotShot(slot, draftKey) }));
  const pick = (pred: (row: (typeof scored)[number]) => boolean) => scored.find(pred)?.slot;
  const chosen = [
    pick((row) => row.shot.faceDirection.includes("three_quarter")),
    pick((row) => row.shot.faceDirection === "profile"),
    pick((row) => row.shot.cameraAngle === "high_angle"),
    pick((row) => row.shot.cameraAngle === "low_angle"),
    pick((row) => row.shot.distance === "medium" || row.shot.distance === "knee_or_full"),
    pick((row) => row.slot.kind === "scene"),
  ].filter((slot): slot is OfficialAssetSlotPlan => Boolean(slot));
  return [...new Map(chosen.map((slot) => [slot.slotKey, slot])).values()].slice(0, DEFAULT_QA_MAX_SLOTS);
}
