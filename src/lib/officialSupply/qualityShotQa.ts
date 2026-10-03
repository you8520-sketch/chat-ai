import { MAX_PROVIDER_ATTEMPTS } from "@/lib/openAiImageSafetyFallback";
import { OFFICIAL_IDENTITY_ANCHOR_REFERENCE_RULE } from "@/lib/officialSupply/imagePrompt";
import {
  OFFICIAL_ASSET_DEFAULT_QUALITY,
  OFFICIAL_REPRESENTATIVE_IMAGE_PROFILE,
  OFFICIAL_RP_IMAGE_PROFILE,
  evaluateOfficialImageDimensions,
} from "@/lib/officialSupply/imageProfile";
import { ROFAN_V4_PRODUCTION_BATCH_CONFIG } from "@/lib/officialSupply/pilotProduction";
import {
  resolveOfficialSlotShot,
  type OfficialSlotShotResponsibility,
} from "@/lib/officialSupply/shotPlan";
import type { OfficialAppearanceLock, OfficialAssetSlotPlan } from "@/lib/officialSupply/types";

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
  cost: LucianSig4TrialCostPlan;
};

export type LucianSig4TrialPrepareStop = {
  ok: false;
  status: "STOP";
  reason: string;
  persistedToProduction: false;
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
  };
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
}): LucianSig4TrialPrepareOk | LucianSig4TrialPrepareStop {
  const slotResult = pickLucianSig4TrialSlot(input.slots, input.draftKey);
  if (!slotResult.ok) {
    return { ok: false, status: "STOP", reason: slotResult.reason, persistedToProduction: false };
  }
  const reference = validateLucianV4IdentityReference({
    referencePath: input.referencePath,
    appearance: input.appearance,
    inspectImage: input.inspectImage,
  });
  if (!reference.ok) {
    return { ok: false, status: "STOP", reason: reference.reason, persistedToProduction: false };
  }
  const prompt = input.identityAnchorPrompt ?? "";
  if (prompt && !prompt.includes(OFFICIAL_IDENTITY_ANCHOR_REFERENCE_RULE)) {
    return {
      ok: false,
      status: "STOP",
      reason: "assembled prompt is missing IDENTITY ANCHOR ONLY",
      persistedToProduction: false,
    };
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
