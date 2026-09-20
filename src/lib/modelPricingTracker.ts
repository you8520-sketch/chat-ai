/**
 * Model pricing tracker — daily OBSERVE_ONLY orchestrator.
 * Canonical owner: snapshot → classify → log (no BASE mutation, no notices in Phase A).
 */

import type Database from "better-sqlite3";
import {
  resolveCheaperInferenceCatalogPricing,
  type CheaperInferenceCatalogPricing,
} from "@/lib/cheaperInferenceCatalogPricing";
import { refreshCheaperInferenceCatalogPricing } from "@/lib/cheaperInferenceCatalogPricing.server";
import {
  MODEL_PRICING_TRACKER_PHASE,
  MODEL_PRICING_TRACKER_TIMEZONE,
  type ModelPricingTrackerPhase,
} from "@/lib/modelPricingTrackingConfig";
import {
  classifyCiCurrentChange,
  classifyCiReferenceChange,
  classifyParserFailure,
  classifySourceConflict,
  type ClassifiedPriceChange,
} from "@/lib/modelPriceChangeClassifier";
import {
  getModelPricingPolicyWithPublished,
  listTrackedModelIds,
} from "@/lib/modelPricingPolicy";
import {
  buildCiCurrentSnapshot,
  buildCiReferenceSnapshot,
  buildPublishedBaselineSnapshot,
} from "@/lib/modelPriceSnapshot";
import { getPublishedPricingVersion } from "@/lib/publishedModelPricing";
import { resolveProcurementCostFromCatalog } from "@/lib/procurementCost";
import { getEffectiveKrwPerUsd } from "@/lib/exchangeRate";
import {
  ensureTrackerSchema,
  findTrackerRunByDateKey,
  finishTrackerRun,
  insertAdminEvent,
  insertClassifiedEvent,
  insertPriceSnapshot,
  insertTrackerRun,
  readLatestSnapshot,
} from "@/lib/modelPricingTrackerPersistence";

export type ModelPricingTrackerResult = {
  runId: number | null;
  runDateKey: string;
  phase: ModelPricingTrackerPhase;
  status: "completed" | "failed" | "skipped_duplicate";
  snapshotCount: number;
  eventCount: number;
  events: ClassifiedPriceChange[];
  marginFloorBreaches: string[];
  errors: string[];
};

function kstDateKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MODEL_PRICING_TRACKER_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function isoNow(): string {
  return new Date().toISOString();
}

const REPRESENTATIVE_WORKLOAD = {
  promptTokens: 10_000,
  outputTokens: 2_000,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

function checkMarginFloorBreach(params: {
  modelId: string;
  catalog: CheaperInferenceCatalogPricing;
  minimumMarginFloor: number;
  effectiveKrwPerUsd: number;
  publishedInputUsdPerMillion: number;
  publishedOutputUsdPerMillion: number;
  targetMargin: number;
}): boolean {
  const procurement = resolveProcurementCostFromCatalog({
    modelId: params.modelId,
    promptTokens: REPRESENTATIVE_WORKLOAD.promptTokens,
    outputTokens: REPRESENTATIVE_WORKLOAD.outputTokens,
    cacheReadTokens: REPRESENTATIVE_WORKLOAD.cacheReadTokens,
    cacheWriteTokens: REPRESENTATIVE_WORKLOAD.cacheWriteTokens,
    effectiveKrwPerUsd: params.effectiveKrwPerUsd,
    catalog: params.catalog,
  });
  if (!procurement) return false;

  const billingRefUsd =
    (REPRESENTATIVE_WORKLOAD.promptTokens / 1_000_000) * params.publishedInputUsdPerMillion +
    (REPRESENTATIVE_WORKLOAD.outputTokens / 1_000_000) * params.publishedOutputUsdPerMillion;
  const billingRefKrw = billingRefUsd * params.effectiveKrwPerUsd;
  const userChargeKrw = billingRefKrw / (1 - params.targetMargin);
  if (!Number.isFinite(userChargeKrw) || userChargeKrw <= 0) return false;

  const realizedMargin = (userChargeKrw - procurement.procurementCostKrw) / userChargeKrw;
  return realizedMargin < params.minimumMarginFloor;
}

export async function runModelPricingTracker(params?: {
  db: Database.Database;
  now?: Date;
  phase?: ModelPricingTrackerPhase;
  skipCatalogRefresh?: boolean;
}): Promise<ModelPricingTrackerResult> {
  const db = params!.db;
  const now = params?.now ?? new Date();
  const phase = params?.phase ?? MODEL_PRICING_TRACKER_PHASE;
  const runDateKey = kstDateKey(now);
  const startedAt = isoNow();
  const events: ClassifiedPriceChange[] = [];
  const marginFloorBreaches: string[] = [];
  const errors: string[] = [];

  ensureTrackerSchema(db);

  const existing = findTrackerRunByDateKey(db, runDateKey);
  if (existing?.status === "completed") {
    return {
      runId: existing.id,
      runDateKey,
      phase,
      status: "skipped_duplicate",
      snapshotCount: 0,
      eventCount: 0,
      events: [],
      marginFloorBreaches: [],
      errors: [],
    };
  }

  const runId = insertTrackerRun(db, { runDateKey, phase, startedAt });
  let snapshotCount = 0;

  try {
    if (!params?.skipCatalogRefresh) {
      const refreshed = await refreshCheaperInferenceCatalogPricing();
      if (!refreshed) {
        errors.push("ci_catalog_refresh_failed");
        insertAdminEvent(db, {
          runId,
          adminEventType: "PARSER_FAILED",
          modelId: null,
          source: "cheaper_inference_models",
          classification: "catalog_refresh_failed",
          decision: "fail_closed_keep_active_price",
        });
      }
    }

    const observedAt = isoNow();
    let effectiveKrwPerUsd = 1530;
    try {
      effectiveKrwPerUsd = await getEffectiveKrwPerUsd();
    } catch {
      errors.push("fx_lookup_failed_using_fallback");
    }

    for (const modelId of listTrackedModelIds()) {
      const bundle = getModelPricingPolicyWithPublished(modelId);
      if (!bundle) continue;
      const { policy, published } = bundle;
      const catalog = resolveCheaperInferenceCatalogPricing(modelId);

      if (!catalog) {
        const parserEvent = classifyParserFailure({
          modelId,
          sourceKind: "cheaper_inference_models",
          reason: "model_missing_from_ci_catalog",
        });
        events.push(parserEvent);
        insertClassifiedEvent(db, runId, modelId, parserEvent, getPublishedPricingVersion(modelId));
        insertAdminEvent(db, {
          runId,
          adminEventType: "PARSER_FAILED",
          modelId,
          source: "cheaper_inference_models",
          classification: parserEvent.classification,
          decision: parserEvent.decision,
          pricingVersion: getPublishedPricingVersion(modelId),
        });
        continue;
      }

      const publishedSnapshot = buildPublishedBaselineSnapshot({ policy, published, observedAt });
      insertPriceSnapshot(db, runId, publishedSnapshot);
      snapshotCount += 1;

      const ciCurrent = buildCiCurrentSnapshot({ policy, catalog, observedAt });
      const prevCurrent = readLatestSnapshot(db, modelId, "cheaper_inference_models_current");
      insertPriceSnapshot(db, runId, ciCurrent);
      snapshotCount += 1;

      for (const event of classifyCiCurrentChange({
        modelId,
        previous: prevCurrent,
        current: ciCurrent,
      })) {
        events.push(event);
        insertClassifiedEvent(db, runId, modelId, event, getPublishedPricingVersion(modelId));
        insertAdminEvent(db, {
          runId,
          adminEventType:
            event.eventType === "CI_MARKET_DISCOUNT_CHANGED"
              ? "PROCUREMENT_DISCOUNT_CHANGED_NO_USER_IMPACT"
              : "PROCUREMENT_TIER_CHANGED_NO_USER_IMPACT",
          modelId,
          source: "cheaper_inference_models_current",
          classification: event.classification,
          decision: event.decision,
          oldValues: event.oldValues,
          newValues: event.newValues,
          pricingVersion: getPublishedPricingVersion(modelId),
        });
      }

      const ciReference = buildCiReferenceSnapshot({ policy, catalog, observedAt });
      if (ciReference) {
        const prevReference = readLatestSnapshot(db, modelId, "cheaper_inference_models_reference");
        insertPriceSnapshot(db, runId, ciReference);
        snapshotCount += 1;

        const conflict = classifySourceConflict({
          modelId,
          ciReference,
          publishedBaseline: publishedSnapshot,
        });
        if (conflict) {
          events.push(conflict);
          insertClassifiedEvent(db, runId, modelId, conflict, getPublishedPricingVersion(modelId));
          insertAdminEvent(db, {
            runId,
            adminEventType: "SOURCE_CONFLICT_HELD",
            modelId,
            source: "ci_reference_vs_published",
            classification: conflict.classification,
            decision: conflict.decision,
            oldValues: conflict.oldValues,
            newValues: conflict.newValues,
            pricingVersion: getPublishedPricingVersion(modelId),
          });
        }

        for (const event of classifyCiReferenceChange({
          policy,
          published,
          previous: prevReference,
          current: ciReference,
          phase,
        })) {
          events.push(event);
          insertClassifiedEvent(db, runId, modelId, event, getPublishedPricingVersion(modelId));
          const adminType =
            event.eventType === "MODEL_ROUTING_CHANGED"
              ? "MODEL_ROUTING_CHANGE_HELD"
              : event.action === "OBSERVE_ONLY_LOG"
                ? "PRICE_CHANGED_OBSERVE_ONLY"
                : event.eventType === "PROVIDER_NORMAL_BASELINE_CHANGED" ||
                    event.eventType === "PROVIDER_SCHEDULED_BASELINE_CHANGED"
                  ? "PRICE_CHANGED_AUTO_APPLIED"
                  : "SOURCE_CONFLICT_HELD";
          insertAdminEvent(db, {
            runId,
            adminEventType: adminType,
            modelId,
            source: "cheaper_inference_models_reference",
            classification: event.classification,
            decision: event.decision,
            oldValues: event.oldValues,
            newValues: event.newValues,
            pricingVersion: getPublishedPricingVersion(modelId),
          });
        }
      }

      if (
        checkMarginFloorBreach({
          modelId,
          catalog,
          minimumMarginFloor: published.minimumMarginFloor,
          effectiveKrwPerUsd,
          publishedInputUsdPerMillion: published.billingReferenceInputUsdPerMillion,
          publishedOutputUsdPerMillion: published.billingReferenceOutputUsdPerMillion,
          targetMargin: published.targetMargin,
        })
      ) {
        marginFloorBreaches.push(modelId);
        insertAdminEvent(db, {
          runId,
          adminEventType: "MARGIN_FLOOR_BREACH",
          modelId,
          source: "procurement_vs_published_baseline",
          classification: "realized_margin_below_minimum_floor",
          decision: "admin_alert_no_silent_user_price_change",
          newValues: {
            minimumMarginFloor: published.minimumMarginFloor,
            targetMargin: published.targetMargin,
            ciDiscountPercent: catalog.discountPercent ?? null,
          },
          pricingVersion: getPublishedPricingVersion(modelId),
        });
      }
    }

    finishTrackerRun(db, {
      runId,
      status: "completed",
      finishedAt: isoNow(),
      snapshotCount,
      eventCount: events.length,
      errorSummary: errors.join("; "),
    });

    return {
      runId,
      runDateKey,
      phase,
      status: "completed",
      snapshotCount,
      eventCount: events.length,
      events,
      marginFloorBreaches,
      errors,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(message);
    finishTrackerRun(db, {
      runId,
      status: "failed",
      finishedAt: isoNow(),
      snapshotCount,
      eventCount: events.length,
      errorSummary: message,
    });
    return {
      runId,
      runDateKey,
      phase,
      status: "failed",
      snapshotCount,
      eventCount: events.length,
      events,
      marginFloorBreaches,
      errors,
    };
  }
}
