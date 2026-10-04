import { MAX_PROVIDER_ATTEMPTS } from "@/lib/openAiImageSafetyFallback";
import { OFFICIAL_IDENTITY_ANCHOR_REFERENCE_RULE } from "@/lib/officialSupply/imagePrompt";
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
export const OFFICIAL_SHOT_QA_ARTIFACT_ENV = "OFFICIAL_QUALITY_SHOT_QA_ARTIFACT_DIR";

export const OFFICIAL_SHOT_QA_DEFAULT_ARTIFACT_DIR = "/opt/cursor/artifacts/official-shot-qa";
export const LUCIAN_SIG4_TRIAL_ARTIFACT_DIR = `${OFFICIAL_SHOT_QA_DEFAULT_ARTIFACT_DIR}/lucian-sig4`;

export const LUCIAN_SIG4_TRIAL_DRAFT_KEY = "pilot-rf-03";
export const LUCIAN_SIG4_TRIAL_SLOT_KEY = "sig4";
export const LUCIAN_V4_REPRESENTATIVE_FILE_MARKER = "official-pilot-rf-v4-03__rep";

export const LUCIAN_SIG4_REQUIRED_SHOT = {
  faceDirection: "profile",
  cameraAngle: "high_angle",
  distance: "close_up",
} as const;

/** Existing v4 Cluster B candidate — not rf-01, and not a new style owner. */
export const LUCIAN_SIG4_TRIAL_STYLE_CANDIDATE_ID = PILOT_STYLE_PROOF_CANDIDATE_ID;

const LUCIAN_SIG4_PROOF_IMAGE_MODEL_BASES = [
  "gpt-image-2.5-sunburst",
  "gpt-image-2.5-flare",
  "gpt-image-2",
] as const;

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

export type OfficialShotQaMode = "default" | "lucian-sig4";

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
  return mode === "lucian-sig4" ? LUCIAN_SIG4_TRIAL_ARTIFACT_DIR : OFFICIAL_SHOT_QA_DEFAULT_ARTIFACT_DIR;
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

export function isLucianSig4ProofSupportedImageModel(modelId: string): boolean {
  const trimmed = modelId.trim();
  if (!trimmed) return false;
  return LUCIAN_SIG4_PROOF_IMAGE_MODEL_BASES.some(
    (base) => trimmed === base || trimmed.startsWith(`${base}-`)
  );
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
