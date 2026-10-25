/**
 * Live-admin production-equivalent gate.
 * Admin chat must not use a different prompt/routing path than ordinary chat.
 */

export type AdminParityLoader = {
  name:
    | "context_builder"
    | "character_loader"
    | "persona_loader"
    | "speech_lock"
    | "world_canon_loader"
    | "memory_history_assembly";
  sameCodePath: true;
};

export type AdminSpecialPath = {
  id:
    | "admin_forced_adult_flag"
    | "admin_handoff_canary_routing_enablement"
    | "admin_canary_glm_policy_override"
    | "admin_glm_fallback_is_admin_gate";
  changesPrompt: boolean;
  changesRouting: boolean;
  detail: string;
};

export type AdminHandoffParityReport = {
  ADMIN_PARITY_PROVEN: false;
  LIVE_ADMIN_CAPTURE_ALLOWED: false;
  DEEPSEEK_CALLS: 0;
  MODEL_CALLS_GENERATING_USER_TURNS: 0;
  promptLoaders: readonly AdminParityLoader[];
  specialPaths: readonly AdminSpecialPath[];
  blockers: readonly string[];
  reason: "admin_special_routing_path";
};

export const ADMIN_HANDOFF_PARITY_PROMPT_LOADERS: readonly AdminParityLoader[] = [
  { name: "context_builder", sameCodePath: true },
  { name: "character_loader", sameCodePath: true },
  { name: "persona_loader", sameCodePath: true },
  { name: "speech_lock", sameCodePath: true },
  { name: "world_canon_loader", sameCodePath: true },
  { name: "memory_history_assembly", sameCodePath: true },
] as const;

export const ADMIN_HANDOFF_SPECIAL_PATHS: readonly AdminSpecialPath[] = [
  {
    id: "admin_forced_adult_flag",
    changesPrompt: false,
    changesRouting: true,
    detail:
      "getSessionUser() forces is_adult=1 for admins, which changes userAdultVerified and adult-handoff eligibility versus an ordinary unverified user.",
  },
  {
    id: "admin_handoff_canary_routing_enablement",
    changesPrompt: false,
    changesRouting: true,
    detail:
      "chat/route.ts overwrites adultRoutingConfig.enabled with generalEnabled || adminCanaryAccess. Default ADULT_SCENE_HANDOFF_GENERAL_ENABLED=false, so an allowlisted admin canary chat can receive adult handoff while ordinary chats cannot.",
  },
  {
    id: "admin_canary_glm_policy_override",
    changesPrompt: false,
    changesRouting: true,
    detail:
      "When adultHandoffCanaryAccess is true, adultModelPolicyConfig is rewritten to glmHardFailureFallbackEnabled=true and adminOnly=false.",
  },
  {
    id: "admin_glm_fallback_is_admin_gate",
    changesPrompt: false,
    changesRouting: true,
    detail:
      "shouldFallbackToGlm() still reads isAdmin when ADULT_SCENE_MODEL_POLICY_ADMIN_ONLY is true.",
  },
] as const;

export function evaluateAdminHandoffParity(): AdminHandoffParityReport {
  return {
    ADMIN_PARITY_PROVEN: false,
    LIVE_ADMIN_CAPTURE_ALLOWED: false,
    DEEPSEEK_CALLS: 0,
    MODEL_CALLS_GENERATING_USER_TURNS: 0,
    promptLoaders: ADMIN_HANDOFF_PARITY_PROMPT_LOADERS,
    specialPaths: ADMIN_HANDOFF_SPECIAL_PATHS,
    blockers: ADMIN_HANDOFF_SPECIAL_PATHS.map((path) => path.id),
    reason: "admin_special_routing_path",
  };
}
