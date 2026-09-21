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
  claimTrackerRun,
  countEventsForAttempt,
  finishTrackerRun,
  insertAdminEvent,
  insertClassifiedEvent,
  insertPriceSnapshot,
  readLatestSnapshot,
} from "@/lib/modelPricingTrackerPersistence";

export type ModelPricingTrackerResult = {
  runId: number | null;
  attemptId: number | null;
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

/** Persist a classified event; append to `events` only when the row is inserted. */
function persistClassifiedEvent(
  db: Database.Database,
  attemptId: number,
  modelId: string,
  event: ClassifiedPriceChange,
  events: ClassifiedPriceChange[]
): boolean {
  const inserted = insertClassifiedEvent(db, attemptId, modelId, event, getPublishedPricingVersion(modelId));
  if (inserted) events.push(event);
  return inserted;
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

  // Atomic daily-run claim + fresh immutable run ATTEMPT identity:
  // claimTrackerRun returns distinct attempt ids for a failed attempt and its
  // same-day retry, so append-only evidence never mixes two runs.
  const claim = claimTrackerRun(db, { runDateKey, phase, startedAt });
  if (claim.outcome === "SKIPPED_DUPLICATE") {
    return {
      runId: claim.runId,
      attemptId: null,
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
  const runId = claim.runId;
  const attemptId = claim.attemptId;
  let snapshotCount = 0;
  let freshCiCatalog: boolean;

  try {
    if (params?.skipCatalogRefresh === true) {
      // TEST-ONLY seam: the fixture asserts the seeded in-memory catalog IS the
      // fresh observation (its fetchedAt is the authoritative source time).
      // Production callers never pass it.
      freshCiCatalog = true;
    } else {
      const refreshed = await refreshCheaperInferenceCatalogPricing();
      if (!refreshed) {
        errors.push("ci_catalog_refresh_failed");
        insertAdminEvent(db, {
          attemptId,
          adminEventType: "PARSER_FAILED",
          modelId: null,
          source: "cheaper_inference_models",
          classification: "catalog_refresh_failed",
          decision: "fail_closed_keep_active_price",
        });
      }
      // A resilient stale in-memory cache must never be written as today's
      // observation: without a confirmed fresh refresh the run fails closed
      // and records failure evidence only.
      freshCiCatalog = refreshed === true;
    }
    if (!freshCiCatalog) {
      finishTrackerRun(db, {
        attemptId,
        status: "failed",
        finishedAt: isoNow(),
        errorSummary: errors.join("; "),
      });
      return {
        runId,
        attemptId,
        runDateKey,
        phase,
        status: "failed",
        snapshotCount: 0,
        eventCount: countEventsForAttempt(db, attemptId),
        events: [],
        marginFloorBreaches: [],
        errors,
      };
    }

    const effectiveKrwPerUsdFallback = 1530;
    let effectiveKrwPerUsd = effectiveKrwPerUsdFallback;
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
          runDateKey,
        });
        persistClassifiedEvent(db, attemptId, modelId, parserEvent, events);
        insertAdminEvent(db, {
          attemptId,
          adminEventType: "PARSER_FAILED",
          modelId,
          source: "cheaper_inference_models",
          classification: parserEvent.classification,
          decision: parserEvent.decision,
          pricingVersion: getPublishedPricingVersion(modelId),
        });
        continue;
      }

      // `observed_at` on a CI snapshot is the SOURCE observation time — the
      // catalog's own fetchedAt from the live /v1/models response — never the
      // tracker start time or the persistence time. The published-code baseline
      // is not a source observation, so it records the attempt start time.
      const sourceObservedAt = new Date(catalog.fetchedAt).toISOString();
      const publishedSnapshot = buildPublishedBaselineSnapshot({ policy, published, observedAt: startedAt });
      insertPriceSnapshot(db, attemptId, publishedSnapshot);
      snapshotCount += 1;

      const ciCurrent = buildCiCurrentSnapshot({ policy, catalog, observedAt: sourceObservedAt });
      const prevCurrent = readLatestSnapshot(db, modelId, "cheaper_inference_models_current");
      insertPriceSnapshot(db, attemptId, ciCurrent);
      snapshotCount += 1;

      for (const event of classifyCiCurrentChange({
        modelId,
        previous: prevCurrent,
        current: ciCurrent,
      })) {
        persistClassifiedEvent(db, attemptId, modelId, event, events);
        insertAdminEvent(db, {
          attemptId,
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

      const ciReference = buildCiReferenceSnapshot({ policy, catalog, observedAt: sourceObservedAt });
      if (ciReference) {
        const prevReference = readLatestSnapshot(db, modelId, "cheaper_inference_models_reference");
        insertPriceSnapshot(db, attemptId, ciReference);
        snapshotCount += 1;

        const conflict = classifySourceConflict({
          modelId,
          ciReference,
          publishedBaseline: publishedSnapshot,
          runDateKey,
        });
        if (conflict) {
          persistClassifiedEvent(db, attemptId, modelId, conflict, events);
          insertAdminEvent(db, {
            attemptId,
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
        })) {
          persistClassifiedEvent(db, attemptId, modelId, event, events);
          // CI reference evidence is never a provider baseline event: it is
          // either a routing mismatch (held) or an UNVERIFIED CI quote change
          // awaiting official provider corroboration.
          const adminType =
            event.eventType === "MODEL_ROUTING_CHANGED"
              ? "MODEL_ROUTING_CHANGE_HELD"
              : "CI_REFERENCE_CHANGE_HELD";
          insertAdminEvent(db, {
            attemptId,
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
          attemptId,
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
      attemptId,
      status: "completed",
      finishedAt: isoNow(),
      errorSummary: errors.join("; "),
    });

    const persistedEventCount = countEventsForAttempt(db, attemptId);
    return {
      runId,
      attemptId,
      runDateKey,
      phase,
      status: "completed",
      snapshotCount,
      eventCount: persistedEventCount,
      events,
      marginFloorBreaches,
      errors,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(message);
    finishTrackerRun(db, {
      attemptId,
      status: "failed",
      finishedAt: isoNow(),
      errorSummary: message,
    });
    const persistedEventCount = countEventsForAttempt(db, attemptId);
    return {
      runId,
      attemptId,
      runDateKey,
      phase,
      status: "failed",
      snapshotCount,
      eventCount: persistedEventCount,
      events,
      marginFloorBreaches,
      errors,
    };
  }
}
