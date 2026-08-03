import {
  CHEAPER_INFERENCE_AION_20_MODEL,
  CHEAPER_INFERENCE_GLM_52_MODEL,
  OPENROUTER_QWEN_37_MAX_MODEL,
} from "@/lib/chatModels";

export const ADULT_SCENE_MODEL_POLICY = {
  primaryModelId: CHEAPER_INFERENCE_AION_20_MODEL,
  hardFailureFallbackModelId: CHEAPER_INFERENCE_GLM_52_MODEL,
  heldModelId: OPENROUTER_QWEN_37_MAX_MODEL,
  maximumFallbackAttempts: 1,
} as const;

export type AdultSceneHardFailureReason =
  | "http_error"
  | "provider_5xx"
  | "timeout"
  | "empty_stream"
  | "no_visible_content"
  | "model_refusal"
  | "stream_parse_failure";

export type AdultSceneModelPolicyConfig = {
  aionPrimaryEnabled: boolean;
  glmHardFailureFallbackEnabled: boolean;
  adminOnly: boolean;
};

function envFlag(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: boolean
): boolean {
  const value = env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export function resolveAdultSceneModelPolicyConfig(
  env: NodeJS.ProcessEnv = process.env
): AdultSceneModelPolicyConfig {
  return {
    aionPrimaryEnabled: envFlag(env, "ADULT_SCENE_AION_PRIMARY_ENABLED", true),
    glmHardFailureFallbackEnabled: envFlag(
      env,
      "ADULT_SCENE_GLM_HARD_FAILURE_FALLBACK_ENABLED",
      true
    ),
    adminOnly: envFlag(env, "ADULT_SCENE_MODEL_POLICY_ADMIN_ONLY", false),
  };
}

export function isAdultSceneModelPolicyActive(input: {
  config: AdultSceneModelPolicyConfig;
  isAdmin: boolean;
}): boolean {
  return (
    input.config.aionPrimaryEnabled &&
    (!input.config.adminOnly || input.isAdmin)
  );
}

export function shouldFallbackToGlm(input: {
  config: AdultSceneModelPolicyConfig;
  isAdmin: boolean;
  reason: AdultSceneHardFailureReason | null;
  fallbackAttemptCount: number;
}): boolean {
  return (
    isAdultSceneModelPolicyActive(input) &&
    input.config.glmHardFailureFallbackEnabled &&
    input.reason != null &&
    input.fallbackAttemptCount < ADULT_SCENE_MODEL_POLICY.maximumFallbackAttempts
  );
}

export function classifyAdultSceneHardFailure(input: {
  error?: unknown;
  status?: number | null;
  text?: string | null;
  finishReason?: string | null;
  refusalDetected?: boolean;
}): AdultSceneHardFailureReason | null {
  if (input.refusalDetected) return "model_refusal";
  if (input.status != null && input.status >= 500) return "provider_5xx";

  const text = input.text?.trim() ?? "";
  const errorText = input.error instanceof Error
    ? `${input.error.name} ${input.error.message}`
    : String(input.error ?? "");
  const normalized = errorText.toLowerCase();

  if (/timeout|timed out|aborterror/.test(normalized)) return "timeout";
  if (/parse|invalid json|unexpected end/.test(normalized)) return "stream_parse_failure";
  if (/\b5\d\d\b|bad gateway|service unavailable/.test(normalized)) return "provider_5xx";
  if (input.error != null) return "http_error";
  if (!text && input.finishReason === "empty_stream") return "empty_stream";
  if (!text) return "no_visible_content";
  return null;
}
