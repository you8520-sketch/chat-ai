/** Post-turn enrichment audit — shared types. Orchestration only; domain parsers stay in statusWidget/suggestedReplies. */

export type PostTurnSyncMode = "sync_await" | "async_fire_forget";

export type PostTurnBillingClass =
  | "user_billed_aux"
  | "platform_funded"
  | "main_rp_billed"
  | "none";

export type PostTurnCallFamilyId =
  | "main_rp"
  | "main_rp_retry_fallback"
  | "length_continuation"
  | "length_recovery"
  | "status_widget_initial"
  | "status_widget_combined_initial"
  | "status_widget_repair"
  | "status_widget_fallback"
  | "suggested_replies_initial"
  | "suggested_replies_retry"
  | "status_meta_initial"
  | "status_meta_retry"
  | "memory_update"
  | "rolling_summary"
  | "lorebook_compaction"
  | "html_visual_recovery"
  | "prompt_translation"
  | "scene_evidence"
  | "persona_secret_discovery";

export type PostTurnCallFamilySpec = {
  id: PostTurnCallFamilyId;
  trigger: string;
  callSite: string;
  canonicalOwner: string;
  modelResolutionOwner: string;
  requestKindPattern: string;
  syncOrAsync: PostTurnSyncMode;
  inputContext: string;
  runsEveryTurn: boolean;
  retryOwner: string;
  maxLogicalAttempts: number;
  fallbackOwner: string;
  userBilled: PostTurnBillingClass;
  platformFunded: boolean;
  usagePreserved: boolean;
  exactProviderCostPreserved: boolean;
  persistedBeforeReceipt: boolean;
  canRunAfterMainReceiptSnapshot: boolean;
  sameTurnContextDuplicatedWith: PostTurnCallFamilyId[];
  safeToCoalesceWith: PostTurnCallFamilyId[];
};

export type PostTurnEnrichmentTurnConfig = {
  statusWidgetActive: boolean;
  needsCharacterWidgetExtract: boolean;
  needsUserWidgetExtract: boolean;
  suggestedRepliesEnabled: boolean;
  statusMetaEnabled: boolean;
  htmlFlashOnlyTurn: boolean;
  oocSceneRenderTurn: boolean;
  hasAssistantProse: boolean;
};

export type PostTurnPlannedInitialCall = {
  family: PostTurnCallFamilyId;
  owner: string;
  requestKind: string;
  syncOrAsync: PostTurnSyncMode;
  billingClass: PostTurnBillingClass;
};

export type PostTurnCallGraphSnapshot = {
  mainProviderCallCount: number;
  statusWidgetProviderCallCount: number;
  suggestedRepliesProviderCallCount: number;
  statusMetaProviderCallCount: number;
  otherAuxProviderCallCount: number;
  totalPostTurnBackgroundProviderCallCount: number;
  plannedInitialCalls: PostTurnPlannedInitialCall[];
};

export type BillingAllocationGateResult =
  | { status: "PASS"; reason: string; allocationOwner: string }
  | { status: "BLOCKED"; reason: string; options: string[] };
