import { episodicMemoryRecallEnabled } from "@/lib/episodicMemoryFacts";
import {
  resolveEpisodicSemanticRuntime,
} from "@/lib/memory/memory-episodic-semantic-config";
import {
  MEMORY_POLICY_ID,
  RAW_HISTORY_COMPLETE_EXCHANGES,
  ROLLING_SUMMARY_INTERVAL,
} from "@/lib/memory/memory-constants";
import { isMemoryFeatureEnabledIn } from "@/lib/memory/memory-feature";

export type AdminMemoryRuntimeStatus = {
  memoryFeatureEnabled: boolean;
  episodicRecallEnabled: boolean;
  semantic: {
    enabled: boolean;
    configuredModelKey: string | null;
    activeModelId: string | null;
    configVersion: string | null;
    reason:
      | "ACTIVE"
      | "memory_feature_off"
      | "episodic_recall_off"
      | "flag_off"
      | "unknown_model"
      | "config_provisional_live_benchmark_pending";
  };
  policy: {
    id: typeof MEMORY_POLICY_ID;
    rollingSummaryInterval: number;
    rawRecentExchanges: number;
  };
};

/**
 * Read-only admin projection of the exact production memory gates.
 *
 * Important: the 5+4 policy is code-owned by memory-constants. Legacy envs
 * such as MEMORY_5PLUS4_ENABLED are intentionally ignored here because they
 * no longer own production policy.
 */
export function buildAdminMemoryRuntimeStatus(
  env: NodeJS.ProcessEnv = process.env
): AdminMemoryRuntimeStatus {
  const memoryFeatureEnabled = isMemoryFeatureEnabledIn(env);
  const episodicRecallIsEnabled = episodicMemoryRecallEnabled(env);
  const semantic = resolveEpisodicSemanticRuntime(env);
  const configuredModelKey = env.EPISODIC_SEMANTIC_MODEL?.trim() || null;

  const effectiveSemantic = !memoryFeatureEnabled
    ? {
        enabled: false as const,
        configuredModelKey,
        activeModelId: null,
        configVersion: null,
        reason: "memory_feature_off" as const,
      }
    : !episodicRecallIsEnabled
      ? {
          enabled: false as const,
          configuredModelKey,
          activeModelId: null,
          configVersion: null,
          reason: "episodic_recall_off" as const,
        }
      : semantic.enabled
        ? {
            enabled: true as const,
            configuredModelKey,
            activeModelId: semantic.model.modelId,
            configVersion: semantic.model.configVersion,
            reason: "ACTIVE" as const,
          }
        : {
            enabled: false as const,
            configuredModelKey,
            activeModelId: null,
            configVersion: null,
            reason: semantic.reason,
          };

  return {
    memoryFeatureEnabled,
    episodicRecallEnabled: episodicRecallIsEnabled,
    semantic: effectiveSemantic,
    policy: {
      id: MEMORY_POLICY_ID,
      rollingSummaryInterval: ROLLING_SUMMARY_INTERVAL,
      rawRecentExchanges: RAW_HISTORY_COMPLETE_EXCHANGES,
    },
  };
}
