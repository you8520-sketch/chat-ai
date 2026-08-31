export type TrpgImageSceneMode = "RAW" | "AI_FOCUS";

export type TrpgAiFocusExperimentConfig = {
  adminExperimentEnabled: boolean;
  allowedAdminUserIds: ReadonlySet<number>;
  allowedCampaignIds: ReadonlySet<number>;
};

function envFlag(value: string | undefined, fallback = false): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function parseIdSet(value: string | undefined): ReadonlySet<number> {
  const ids = (value ?? "")
    .split(",")
    .map((entry) => Number.parseInt(entry.trim(), 10))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  return new Set(ids);
}

/** Single canonical owner for TRPG illustration scene-mode experiment flags. */
export function resolveTrpgAiFocusExperimentConfig(
  env: NodeJS.ProcessEnv = process.env
): TrpgAiFocusExperimentConfig {
  return {
    adminExperimentEnabled: envFlag(env.TRPG_AI_FOCUS_ADMIN_EXPERIMENT, false),
    allowedAdminUserIds: parseIdSet(env.TRPG_AI_FOCUS_ADMIN_USER_IDS),
    allowedCampaignIds: parseIdSet(env.TRPG_AI_FOCUS_ADMIN_CAMPAIGN_IDS),
  };
}

export function canUseTrpgAiFocusAdminExperiment(input: {
  config: TrpgAiFocusExperimentConfig;
  isAdmin: boolean;
  userId: number;
  campaignId: number;
}): boolean {
  if (!input.config.adminExperimentEnabled) return false;
  if (!input.isAdmin) return false;
  if (input.config.allowedAdminUserIds.size > 0 && !input.config.allowedAdminUserIds.has(input.userId)) {
    return false;
  }
  if (input.config.allowedCampaignIds.size > 0 && !input.config.allowedCampaignIds.has(input.campaignId)) {
    return false;
  }
  return true;
}

export function normalizeTrpgImageSceneMode(
  raw: unknown,
  defaultMode: TrpgImageSceneMode = "RAW"
): TrpgImageSceneMode {
  if (raw === "AI_FOCUS") return "AI_FOCUS";
  if (raw === "RAW") return "RAW";
  return defaultMode;
}

export const TRPG_IMAGE_SCENE_MODE_DEFAULT: TrpgImageSceneMode = "RAW";
