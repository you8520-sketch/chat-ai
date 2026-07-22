import {
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_GEMINI_25_PRO_MODEL,
  OPENROUTER_MUSE_SPARK_11_MODEL,
  OPENROUTER_TENCENT_HY3_MODEL,
} from "@/lib/chatModels";
import {
  isDeepSeekMasterCanaryEnabled,
  parseDeepSeekCanaryPercent,
  resolveDeepSeekCohortEligibility,
  type DeepSeekCohortContext,
} from "@/lib/canonInjectionCohort";
import { isDeepSeekOpenRouterModel } from "@/lib/openRouterClient";

export type { DeepSeekCohortContext };

export type CanonInjectionMode = "FULL_LEGACY" | "LAYERED";
export type ArchiveInjectionMode = "FULL_ALWAYS" | "SELECTIVE";
export type CanonRolloutStage = "D0" | "D1" | "D2" | "D3" | "D4";

export type CanonInjectionPolicy = {
  modelId: string;
  injectionEnabled: boolean;
  shadowOnly: boolean;
  canonMode: CanonInjectionMode;
  archiveMode: ArchiveInjectionMode;
  rolloutStage: CanonRolloutStage;
  forceFullLegacy: boolean;
  /** Explicit canary gate — D1/D2 actual injection suppressed unless this is true. */
  canaryActualInjection: boolean;
  /** Actual canon mode applied this turn (FULL_LEGACY when shadow-only or kill switch). */
  actualCanonMode: CanonInjectionMode;
  /** Actual archive mode applied this turn (FULL_ALWAYS when shadow-only or kill switch). */
  actualArchiveMode: ArchiveInjectionMode;
  /** Master boolean canary flag (CANON_INJECTION_DEEPSEEK_CANARY). */
  masterCanaryEnabled: boolean;
  /** Parsed CANON_INJECTION_DEEPSEEK_CANARY_PERCENT (0–100, fail-safe 0). */
  canaryPercent: number;
  /** This request passed cohort gating (allowlist or percent bucket). */
  cohortEligible: boolean;
  /** Deterministic bucket 0..9999 when cohort key exists; null otherwise. */
  cohortBucket: number | null;
  /** Cohort eligibility reason (no raw user id). */
  cohortEligibilityReason: string;
};

function envTruthy(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function envCanonMode(name: string): CanonInjectionMode | null {
  const raw = process.env[name]?.trim().toUpperCase();
  if (raw === "FULL_LEGACY") return "FULL_LEGACY";
  if (raw === "LAYERED") return "LAYERED";
  return null;
}

function envRolloutStage(): CanonRolloutStage {
  const raw = process.env.CANON_INJECTION_ROLLOUT_STAGE?.trim().toUpperCase();
  if (raw === "D1" || raw === "D2" || raw === "D3" || raw === "D4") return raw;
  return "D0";
}

function isUnvalidatedDefaultFullLegacyModel(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  return (
    id === OPENROUTER_MUSE_SPARK_11_MODEL ||
    id === OPENROUTER_GEMINI_25_PRO_MODEL ||
    id === OPENROUTER_TENCENT_HY3_MODEL ||
    id.includes("muse-spark") ||
    id.includes("gemini-2.5-pro") ||
    id.includes("tencent/hy3")
  );
}

function resolveDeepSeekPolicy(stage: CanonRolloutStage): Pick<
  CanonInjectionPolicy,
  "canonMode" | "archiveMode" | "injectionEnabled" | "shadowOnly"
> {
  const canonOverride = envCanonMode("CANON_INJECTION_DEEPSEEK_MODE");
  const archiveSelective = envTruthy("CANON_ARCHIVE_DEEPSEEK_SELECTIVE");

  if (stage === "D0") {
    return {
      canonMode: "FULL_LEGACY",
      archiveMode: "FULL_ALWAYS",
      injectionEnabled: false,
      shadowOnly: true,
    };
  }

  if (stage === "D1") {
    return {
      canonMode: "FULL_LEGACY",
      archiveMode: archiveSelective ? "SELECTIVE" : "FULL_ALWAYS",
      injectionEnabled: true,
      shadowOnly: false,
    };
  }

  if (stage === "D2") {
    return {
      canonMode: canonOverride ?? "LAYERED",
      archiveMode: archiveSelective ? "SELECTIVE" : "FULL_ALWAYS",
      injectionEnabled: true,
      shadowOnly: false,
    };
  }

  if (stage === "D3") {
    return {
      canonMode: canonOverride ?? "LAYERED",
      archiveMode: archiveSelective ? "SELECTIVE" : "SELECTIVE",
      injectionEnabled: true,
      shadowOnly: false,
    };
  }

  // D4 — production default after acceptance; still env-overridable
  return {
    canonMode: canonOverride ?? "LAYERED",
    archiveMode: archiveSelective ? "SELECTIVE" : "SELECTIVE",
    injectionEnabled: true,
    shadowOnly: false,
  };
}

function cohortDefaults(): Pick<
  CanonInjectionPolicy,
  | "masterCanaryEnabled"
  | "canaryPercent"
  | "cohortEligible"
  | "cohortBucket"
  | "cohortEligibilityReason"
> {
  return {
    masterCanaryEnabled: false,
    canaryPercent: 0,
    cohortEligible: false,
    cohortBucket: null,
    cohortEligibilityReason: "N/A",
  };
}

/** Typed central resolver — no giant JSON env blob */
export function resolveCanonInjectionPolicy(
  modelId: string,
  cohortContext?: DeepSeekCohortContext
): CanonInjectionPolicy {
  const normalized = modelId.trim();
  const rolloutStage = envRolloutStage();
  const forceFullLegacy =
    envTruthy("CANON_INJECTION_FORCE_FULL_LEGACY") || envTruthy("CANON_INJECTION_KILL_SWITCH");
  const masterEnabled = envTruthy("CANON_INJECTION_ENABLED");

  if (forceFullLegacy) {
    return {
      modelId: normalized,
      injectionEnabled: false,
      shadowOnly: rolloutStage === "D0",
      canonMode: "FULL_LEGACY",
      archiveMode: "FULL_ALWAYS",
      rolloutStage,
      forceFullLegacy: true,
      canaryActualInjection: false,
      actualCanonMode: "FULL_LEGACY",
      actualArchiveMode: "FULL_ALWAYS",
      ...cohortDefaults(),
    };
  }

  if (isDeepSeekOpenRouterModel(normalized) || normalized === OPENROUTER_DEEPSEEK_V4_PRO_MODEL) {
    const deepSeek = resolveDeepSeekPolicy(rolloutStage);
    const masterCanaryEnabled = isDeepSeekMasterCanaryEnabled();
    const canaryPercent = parseDeepSeekCanaryPercent();
    const cohort = resolveDeepSeekCohortEligibility({
      userId: cohortContext?.userId,
      chatId: cohortContext?.chatId,
      percent: canaryPercent,
    });

    const stageEligible = rolloutStage !== "D0";
    const canaryActualInjection =
      masterEnabled && masterCanaryEnabled && stageEligible && cohort.eligible;
    const shadowOnly = !canaryActualInjection;
    const actualCanonMode: CanonInjectionMode = shadowOnly ? "FULL_LEGACY" : deepSeek.canonMode;
    const actualArchiveMode: ArchiveInjectionMode = shadowOnly ? "FULL_ALWAYS" : deepSeek.archiveMode;

    // D0: shadow compile for all when master on. D1+: side effects only for cohort-eligible requests.
    const injectionEnabled =
      masterEnabled &&
      (rolloutStage === "D0" ? deepSeek.shadowOnly : canaryActualInjection);

    return {
      modelId: normalized,
      injectionEnabled,
      shadowOnly,
      canonMode: deepSeek.canonMode,
      archiveMode: deepSeek.archiveMode,
      rolloutStage,
      forceFullLegacy: false,
      canaryActualInjection,
      actualCanonMode,
      actualArchiveMode,
      masterCanaryEnabled,
      canaryPercent,
      cohortEligible: cohort.eligible,
      cohortBucket: cohort.bucket,
      cohortEligibilityReason: cohort.reason,
    };
  }

  if (isUnvalidatedDefaultFullLegacyModel(normalized)) {
    return {
      modelId: normalized,
      injectionEnabled: masterEnabled && rolloutStage !== "D0",
      shadowOnly: rolloutStage === "D0",
      canonMode: "FULL_LEGACY",
      archiveMode: "FULL_ALWAYS",
      rolloutStage,
      forceFullLegacy: false,
      canaryActualInjection: false,
      actualCanonMode: "FULL_LEGACY",
      actualArchiveMode: "FULL_ALWAYS",
      ...cohortDefaults(),
    };
  }

  return {
    modelId: normalized,
    injectionEnabled: masterEnabled && rolloutStage !== "D0",
    shadowOnly: rolloutStage === "D0",
    canonMode: "FULL_LEGACY",
    archiveMode: "FULL_ALWAYS",
    rolloutStage,
    forceFullLegacy: false,
    canaryActualInjection: false,
    actualCanonMode: "FULL_LEGACY",
    actualArchiveMode: "FULL_ALWAYS",
    ...cohortDefaults(),
  };
}

export function isLayeredCanonPolicy(policy: CanonInjectionPolicy): boolean {
  return policy.canonMode === "LAYERED" && !policy.forceFullLegacy;
}

/** D1+ actual selective archive injection is active this turn (DeepSeek canary only). */
export function isSelectiveArchiveActive(policy: CanonInjectionPolicy): boolean {
  return policy.actualArchiveMode === "SELECTIVE" && !policy.shadowOnly;
}

/** D2+ actual LAYERED canon injection is active this turn (DeepSeek canary only). */
export function isLayeredCanonActive(policy: CanonInjectionPolicy): boolean {
  return policy.actualCanonMode === "LAYERED" && !policy.shadowOnly;
}
