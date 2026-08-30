import type { PostTurnEnrichmentTurnConfig, PostTurnPlannedInitialCall } from "./types";

/** Mirrors route.ts gating for post-turn enrichment (without DB/settings side effects). */
export function resolvePostTurnEnrichmentEligibility(
  config: PostTurnEnrichmentTurnConfig
): {
  statusWidgetExtractEligible: boolean;
  suggestedRepliesEligible: boolean;
  statusMetaEligible: boolean;
} {
  const statusWidgetExtractEligible =
    config.statusWidgetActive &&
    !config.htmlFlashOnlyTurn &&
    !config.oocSceneRenderTurn &&
    config.hasAssistantProse &&
    (config.needsCharacterWidgetExtract || config.needsUserWidgetExtract);

  const suggestedRepliesEligible =
    config.suggestedRepliesEnabled &&
    !config.htmlFlashOnlyTurn &&
    !config.oocSceneRenderTurn &&
    config.hasAssistantProse;

  const statusMetaEligible = config.statusMetaEnabled && config.hasAssistantProse;

  return { statusWidgetExtractEligible, suggestedRepliesEligible, statusMetaEligible };
}

/**
 * Current-main planned INITIAL provider reads of completed assistant prose (no coalescing).
 * Repair/retry calls are domain-specific and excluded from this baseline plan.
 */
export function planCurrentMainPostTurnInitialCalls(
  config: PostTurnEnrichmentTurnConfig
): PostTurnPlannedInitialCall[] {
  const elig = resolvePostTurnEnrichmentEligibility(config);
  const planned: PostTurnPlannedInitialCall[] = [];

  if (elig.statusWidgetExtractEligible) {
    const combined =
      config.needsCharacterWidgetExtract && config.needsUserWidgetExtract;
    planned.push({
      family: combined ? "status_widget_combined_initial" : "status_widget_initial",
      owner: "extractStatusWidgetValuesForTurn",
      requestKind: combined
        ? "background-status-widget-extract-combined"
        : "background-status-widget-extract",
      syncOrAsync: "sync_await",
      billingClass: "user_billed_aux",
    });
  }

  if (elig.suggestedRepliesEligible) {
    planned.push({
      family: "suggested_replies_initial",
      owner: "scheduleSuggestedRepliesExtraction",
      requestKind: "background-suggested-replies-extract",
      syncOrAsync: "async_fire_forget",
      billingClass: "platform_funded",
    });
  }

  if (elig.statusMetaEligible) {
    planned.push({
      family: "status_meta_initial",
      owner: "scheduleStatusMetaExtraction",
      requestKind: "background-status-meta-extract",
      syncOrAsync: "async_fire_forget",
      billingClass: "platform_funded",
    });
  }

  return planned;
}

export function countAssistantProseInitialReads(planned: PostTurnPlannedInitialCall[]): number {
  return planned.filter((p) =>
    [
      "status_widget_initial",
      "status_widget_combined_initial",
      "suggested_replies_initial",
      "status_meta_initial",
    ].includes(p.family)
  ).length;
}
