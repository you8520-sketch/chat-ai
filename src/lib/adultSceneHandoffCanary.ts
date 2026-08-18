import type Database from "better-sqlite3";

export type AdultSceneHandoffCanaryConfig = {
  adminCanaryEnabled: boolean;
  generalEnabled: boolean;
  allowedAdminUserIds: ReadonlySet<number>;
  allowedChatIds: ReadonlySet<number>;
};

export type AdultSceneHandoffCanaryStage =
  | "T1_GENERAL"
  | "T2_ADULT_ENTRY"
  | "T3_ADULT_STICKY"
  | "T4_GENERAL_RETURN";

function envFlag(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseIdSet(value: string | undefined): ReadonlySet<number> {
  const ids = (value ?? "")
    .split(",")
    .map((entry) => Number.parseInt(entry.trim(), 10))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  return new Set(ids);
}

export function resolveAdultSceneHandoffCanaryConfig(
  env: NodeJS.ProcessEnv = process.env
): AdultSceneHandoffCanaryConfig {
  return {
    adminCanaryEnabled: envFlag(
      env.ADULT_SCENE_HANDOFF_ADMIN_CANARY,
      false
    ),
    // Default OFF until separate general-user activation approval.
    generalEnabled: envFlag(
      env.ADULT_SCENE_HANDOFF_GENERAL_ENABLED,
      false
    ),
    allowedAdminUserIds: parseIdSet(
      env.ADULT_SCENE_HANDOFF_ADMIN_USER_IDS
    ),
    allowedChatIds: parseIdSet(env.ADULT_SCENE_HANDOFF_ADMIN_CHAT_IDS),
  };
}

export function canUseAdultSceneHandoffAdminCanary(input: {
  config: AdultSceneHandoffCanaryConfig;
  isAdmin: boolean;
  userId: number;
  chatId: number;
}): boolean {
  return (
    input.config.adminCanaryEnabled &&
    input.isAdmin &&
    input.config.allowedAdminUserIds.has(input.userId) &&
    input.config.allowedChatIds.has(input.chatId)
  );
}

export function resolveAdultSceneRoutingEnabledForRequest(input: {
  generalEnabled: boolean;
  adminCanaryAccess: boolean;
  /** Chat-room 「성인모드」 — user-facing adult model handoff switch. */
  chatAdultHandoffEnabled?: boolean;
}): boolean {
  return (
    input.generalEnabled ||
    input.adminCanaryAccess ||
    input.chatAdultHandoffEnabled === true
  );
}

export function resolveAdultSceneHandoffCanaryStage(input: {
  routeBefore: "general" | "adult";
  routeAfter: "general" | "adult";
}): AdultSceneHandoffCanaryStage {
  if (input.routeBefore === "general" && input.routeAfter === "adult") {
    return "T2_ADULT_ENTRY";
  }
  if (input.routeBefore === "adult" && input.routeAfter === "adult") {
    return "T3_ADULT_STICKY";
  }
  if (input.routeBefore === "adult" && input.routeAfter === "general") {
    return "T4_GENERAL_RETURN";
  }
  return "T1_GENERAL";
}

export function detectAdultSceneHandoffPromptLeak(text: string): boolean {
  return /(?:INTERNAL AION|INTERNAL CONTINUATION|SceneMode|routeTriggerReason|<<<STATUS_VALUES>>>|\[SYSTEM PROMPT\])/i.test(
    text
  );
}

export type AdultSceneHandoffCanaryLog = {
  userId: number;
  chatId: number;
  userMessageId: number;
  assistantMessageId: number;
  canaryStage: AdultSceneHandoffCanaryStage;
  detectedSceneModeBefore: string;
  detectedSceneModeAfter: string;
  selectedModel: string;
  selectedProvider: string;
  routingReason?: string;
  fallbackAttempted: boolean;
  fallbackReason?: string;
  visibleCharacters: number;
  finishReason?: string;
  assistantRowsWritten: number;
  pointChargeCount: number;
  chargedPoints: number;
  promptLeakDetected: boolean;
  duplicateStreamDetected: boolean;
  totalLatencyMs: number;
};

export function recordAdultSceneHandoffCanaryLog(
  db: Database.Database,
  log: AdultSceneHandoffCanaryLog
): void {
  db.prepare(`
    INSERT INTO adult_scene_handoff_canary_logs (
      user_id, chat_id, user_message_id, assistant_message_id, canary_stage,
      detected_scene_mode_before, detected_scene_mode_after,
      selected_model, selected_provider, routing_reason,
      fallback_attempted, fallback_reason, visible_characters, finish_reason,
      assistant_rows_written, point_charge_count, charged_points,
      prompt_leak_detected, duplicate_stream_detected, total_latency_ms
    ) VALUES (
      @userId, @chatId, @userMessageId, @assistantMessageId, @canaryStage,
      @detectedSceneModeBefore, @detectedSceneModeAfter,
      @selectedModel, @selectedProvider, @routingReason,
      @fallbackAttempted, @fallbackReason, @visibleCharacters, @finishReason,
      @assistantRowsWritten, @pointChargeCount, @chargedPoints,
      @promptLeakDetected, @duplicateStreamDetected, @totalLatencyMs
    )
  `).run({
    ...log,
    routingReason: log.routingReason ?? null,
    fallbackReason: log.fallbackReason ?? null,
    finishReason: log.finishReason ?? null,
    fallbackAttempted: log.fallbackAttempted ? 1 : 0,
    promptLeakDetected: log.promptLeakDetected ? 1 : 0,
    duplicateStreamDetected: log.duplicateStreamDetected ? 1 : 0,
  });
}
