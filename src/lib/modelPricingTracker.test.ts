import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  clearCheaperInferenceCatalogPricingForTest,
  updateCheaperInferenceCatalogPricing,
  type CheaperInferenceCatalogPricing,
} from "@/lib/cheaperInferenceCatalogPricing";
import { resetCheaperInferenceCatalogRefreshForTest } from "@/lib/cheaperInferenceCatalogPricing.server";
import {
  classifyCiCurrentChange,
  classifyCiReferenceChange,
  classifyOfficialProviderBaselineMismatch,
  classifyParserFailure,
  classifySourceConflict,
} from "@/lib/modelPriceChangeClassifier";
import {
  DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P1,
  DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P2,
} from "@/lib/deepseekOfficialProviderPricing.fixtures";
import {
  normalizeDeepSeekOfficialPricingDocument,
  resetDeepSeekOfficialProviderPricingForTest,
} from "@/lib/deepseekOfficialProviderPricing";
import {
  buildCiCurrentSnapshot,
  buildCiReferenceSnapshot,
  buildOfficialProviderPeakSnapshot,
  buildPublishedBaselineSnapshot,
} from "@/lib/modelPriceSnapshot";
import { getModelPricingPolicy } from "@/lib/modelPricingPolicy";
import {
  CACHE_RATE_PROVENANCE_UNVERIFIED,
  CHEAPER_INFERENCE_MODELS_SOURCE_URL,
  type PriceSnapshotSourceKind,
} from "@/lib/modelPricingTrackingConfig";
import { CHEAPER_INFERENCE_BASE_URL } from "@/lib/cheaperInferenceConfig";
import { readFileSync } from "node:fs";
import { ensureModelPricingTrackingSchema } from "@/lib/modelPricingTrackingSchema";
import { runModelPricingTracker } from "@/lib/modelPricingTracker";
import {
  ensureTrackerSchema,
  claimTrackerRun,
  findTrackerAttemptById,
  findTrackerRunByDateKey,
  finishTrackerRun,
  insertAdminEvent,
  insertClassifiedEvent,
  countSnapshotsForAttempt,
  insertPriceSnapshot,
  readLatestSnapshot,
} from "@/lib/modelPricingTrackerPersistence";
import {
  getPublishedPricing,
  getPublishedPricingVersion,
  listPublishedModelIds,
  _setPublishedPricingForTest,
} from "@/lib/publishedModelPricing";
import {
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
} from "@/lib/chatModels";

const GEMINI = CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL;
const DEEPSEEK = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
const FIXED_NOW = new Date("2026-09-20T03:00:00.000Z");

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  ensureModelPricingTrackingSchema(db);
  return db;
}

function seedCatalog(
  modelId: string,
  input: Partial<CheaperInferenceCatalogPricing> & {
    inputUsdPerMillion: number;
    outputUsdPerMillion: number;
  }
): CheaperInferenceCatalogPricing {
  const catalog: CheaperInferenceCatalogPricing = {
    modelId,
    inputUsdPerMillion: input.inputUsdPerMillion,
    outputUsdPerMillion: input.outputUsdPerMillion,
    cacheReadUsdPerMillion: input.cacheReadUsdPerMillion ?? input.inputUsdPerMillion * 0.1,
    cacheWriteUsdPerMillion: input.cacheWriteUsdPerMillion ?? input.inputUsdPerMillion,
    referenceInputUsdPerMillion: input.referenceInputUsdPerMillion,
    referenceOutputUsdPerMillion: input.referenceOutputUsdPerMillion,
    referenceCacheReadUsdPerMillion: input.referenceCacheReadUsdPerMillion,
    referenceCacheWriteUsdPerMillion: input.referenceCacheWriteUsdPerMillion,
    discountPercent: input.discountPercent,
    inputTokenPriceThreshold: input.inputTokenPriceThreshold,
    aboveThreshold: input.aboveThreshold,
    fetchedAt: input.fetchedAt ?? Date.now(),
  };
  updateCheaperInferenceCatalogPricing(catalog);
  return catalog;
}

before(() => {
  clearCheaperInferenceCatalogPricingForTest();
  resetDeepSeekOfficialProviderPricingForTest();
});

describe("model pricing tracker regression fixtures", () => {
  it("A: CI discount 30→60 classifies procurement-only; published baseline unchanged", () => {
    const policy = getModelPricingPolicy(GEMINI)!;
    const publishedBefore = getPublishedPricing(GEMINI);
    const observedAt = FIXED_NOW.toISOString();

    const prev = buildCiCurrentSnapshot({
      policy,
      catalog: seedCatalog(GEMINI, {
        inputUsdPerMillion: 1.4,
        outputUsdPerMillion: 8.4,
        referenceInputUsdPerMillion: 2,
        referenceOutputUsdPerMillion: 12,
        discountPercent: 30,
      }),
      observedAt,
    });
    const next = buildCiCurrentSnapshot({
      policy,
      catalog: seedCatalog(GEMINI, {
        inputUsdPerMillion: 0.8,
        outputUsdPerMillion: 4.8,
        referenceInputUsdPerMillion: 2,
        referenceOutputUsdPerMillion: 12,
        discountPercent: 60,
      }),
      observedAt,
    });

    const events = classifyCiCurrentChange({ modelId: GEMINI, previous: prev, current: next });
    assert.equal(events.length, 1);
    assert.equal(events[0]?.eventType, "CI_MARKET_DISCOUNT_CHANGED");
    assert.equal(events[0]?.action, "PROCUREMENT_ONLY");
    assert.deepEqual(getPublishedPricing(GEMINI), publishedBefore);
  });

  it("B: provider baseline +20% yields OBSERVE_ONLY candidate; pricingVersion unchanged in Phase A", () => {
    const policy = getModelPricingPolicy(GEMINI)!;
    const published = getPublishedPricing(GEMINI);
    const versionBefore = getPublishedPricingVersion(GEMINI);
    const observedAt = FIXED_NOW.toISOString();

    const prev = buildCiReferenceSnapshot({
      policy,
      catalog: seedCatalog(GEMINI, {
        inputUsdPerMillion: 1.4,
        outputUsdPerMillion: 8.4,
        referenceInputUsdPerMillion: 2,
        referenceOutputUsdPerMillion: 12,
        discountPercent: 30,
      }),
      observedAt,
    })!;
    const next = buildCiReferenceSnapshot({
      policy,
      catalog: seedCatalog(GEMINI, {
        inputUsdPerMillion: 1.4,
        outputUsdPerMillion: 8.4,
        referenceInputUsdPerMillion: 2.4,
        referenceOutputUsdPerMillion: 14.4,
        discountPercent: 30,
      }),
      observedAt,
    })!;

    const events = classifyCiReferenceChange({
      policy,
      published,
      previous: prev,
      current: next,
    });
    // CI reference evidence is never a provider baseline event: it stays
    // UNVERIFIED and held in Phase A. Invariants preserved: no auto-apply, and
    // the published pricing catalog (and its pricingVersion) is untouched.
    assert.ok(events.some((e) => e.eventType === "CI_REFERENCE_CHANGED_UNVERIFIED"));
    assert.ok(events.every((e) => e.action === "HOLD"));
    assert.ok(events.every((e) => e.eventType !== "PROVIDER_NORMAL_BASELINE_CHANGED"));
    assert.ok(events.every((e) => e.eventType !== "PROVIDER_SCHEDULED_BASELINE_CHANGED"));
    assert.ok(events.every((e) => e.action !== "AUTO_APPLY_BASE"));
    assert.equal(getPublishedPricingVersion(GEMINI), versionBefore);
  });

  it("D: DeepSeek tier threshold change is procurement-only", () => {
    const policy = getModelPricingPolicy(DEEPSEEK)!;
    const observedAt = FIXED_NOW.toISOString();
    const prev = buildCiCurrentSnapshot({
      policy,
      catalog: seedCatalog(DEEPSEEK, {
        inputUsdPerMillion: 0.5,
        outputUsdPerMillion: 1.5,
        referenceInputUsdPerMillion: 0.66,
        referenceOutputUsdPerMillion: 1.98,
        discountPercent: 25,
        inputTokenPriceThreshold: 128_000,
      }),
      observedAt,
    });
    const next = buildCiCurrentSnapshot({
      policy,
      catalog: seedCatalog(DEEPSEEK, {
        inputUsdPerMillion: 0.3,
        outputUsdPerMillion: 0.9,
        referenceInputUsdPerMillion: 0.66,
        referenceOutputUsdPerMillion: 1.98,
        discountPercent: 55,
        inputTokenPriceThreshold: 128_000,
      }),
      observedAt,
    });

    const events = classifyCiCurrentChange({ modelId: DEEPSEEK, previous: prev, current: next });
    assert.ok(events.some((e) => e.eventType === "CI_MARKET_DISCOUNT_CHANGED"));
    assert.ok(events.every((e) => e.action === "PROCUREMENT_ONLY"));
    assert.equal(getModelPricingPolicy(DEEPSEEK)?.baselineMode, "PROVIDER_PEAK");
  });

  it("G: CI procurement_reference vs published baseline mismatch → no SOURCE_CONFLICT (different semantic domains)", () => {
    const policy = getModelPricingPolicy(GEMINI)!;
    const published = getPublishedPricing(GEMINI);
    const observedAt = FIXED_NOW.toISOString();
    const publishedBaseline = buildPublishedBaselineSnapshot({ policy, published, observedAt });
    const ciReference = buildCiReferenceSnapshot({
      policy,
      catalog: seedCatalog(GEMINI, {
        inputUsdPerMillion: 1,
        outputUsdPerMillion: 6,
        referenceInputUsdPerMillion: 99,
        referenceOutputUsdPerMillion: 999,
      }),
      observedAt,
    })!;

    const conflict = classifySourceConflict({
      modelId: GEMINI,
      ciReference,
      publishedBaseline,
      runDateKey: "2026-09-20",
    });
    assert.equal(conflict, null);
  });

  it("H: provider model identity change → MODEL_ROUTING_CHANGED hold", () => {
    const policy = getModelPricingPolicy(GEMINI)!;
    const published = getPublishedPricing(GEMINI);
    const observedAt = FIXED_NOW.toISOString();
    const prev = buildCiReferenceSnapshot({
      policy,
      catalog: seedCatalog(GEMINI, {
        inputUsdPerMillion: 1.4,
        outputUsdPerMillion: 8.4,
        referenceInputUsdPerMillion: 2,
        referenceOutputUsdPerMillion: 12,
      }),
      observedAt,
    })!;
    const next = buildCiReferenceSnapshot({
      policy,
      catalog: seedCatalog("gemini-3.7-flash", {
        inputUsdPerMillion: 0.3,
        outputUsdPerMillion: 1.5,
        referenceInputUsdPerMillion: 0.375,
        referenceOutputUsdPerMillion: 1.875,
      }),
      observedAt,
    })!;
    next.modelId = GEMINI;
    next.providerModelId = "gemini-3.7-flash";

    const events = classifyCiReferenceChange({
      policy,
      published,
      previous: prev,
      current: next,
      phase: "OBSERVE_ONLY",
    });
    assert.equal(events[0]?.eventType, "MODEL_ROUTING_CHANGED");
    assert.equal(events[0]?.action, "HOLD");
  });

  it("I: missing catalog → PARSER_FAILURE; published catalog untouched", () => {
    clearCheaperInferenceCatalogPricingForTest();
    const versionsBefore = listPublishedModelIds().map((id) => getPublishedPricingVersion(id));
    const event = classifyParserFailure({
      modelId: GEMINI,
      sourceKind: "cheaper_inference_models",
      reason: "model_missing_from_ci_catalog",
      runDateKey: "2026-09-20",
    });
    assert.equal(event.eventType, "PARSER_FAILURE");
    assert.equal(event.action, "ADMIN_ALERT");
    const versionsAfter = listPublishedModelIds().map((id) => getPublishedPricingVersion(id));
    assert.deepEqual(versionsAfter, versionsBefore);
  });

  it("F: duplicate daily run is idempotent (one run row per KST date)", async () => {
    const db = makeDb();
    seedCatalog(GEMINI, {
      inputUsdPerMillion: 1.4,
      outputUsdPerMillion: 8.4,
      referenceInputUsdPerMillion: 2,
      referenceOutputUsdPerMillion: 12,
      discountPercent: 30,
    });
    seedCatalog(DEEPSEEK, {
      inputUsdPerMillion: 0.5,
      outputUsdPerMillion: 1.5,
      referenceInputUsdPerMillion: 0.66,
      referenceOutputUsdPerMillion: 1.98,
      discountPercent: 25,
    });
    seedCatalog("gemini-3.7-flash", {
      inputUsdPerMillion: 0.22,
      outputUsdPerMillion: 1.1,
      referenceInputUsdPerMillion: 0.375,
      referenceOutputUsdPerMillion: 1.875,
      discountPercent: 40,
    });
    seedCatalog("gpt-5.6-terra", {
      inputUsdPerMillion: 1.4,
      outputUsdPerMillion: 8.4,
      referenceInputUsdPerMillion: 2,
      referenceOutputUsdPerMillion: 12,
      discountPercent: 30,
    });

    const first = await runModelPricingTracker({
      db,
      now: FIXED_NOW,
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      skipOfficialProviderRefresh: true,
    });
    assert.equal(first.status, "completed");
    assert.ok(first.attemptId != null);

    const second = await runModelPricingTracker({
      db,
      now: FIXED_NOW,
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      skipOfficialProviderRefresh: true,
    });
    assert.equal(second.status, "skipped_duplicate");

    const run = findTrackerRunByDateKey(db, "2026-09-20");
    assert.ok(run);
    assert.equal(run?.status, "completed");

    const eventCountAfterFirst = db
      .prepare(`SELECT COUNT(*) AS c FROM model_price_change_events WHERE attempt_id = ?`)
      .get(first.attemptId) as { c: number };
    const eventCountAfterSecond = db
      .prepare(`SELECT COUNT(*) AS c FROM model_price_change_events`)
      .get() as { c: number };
    assert.equal(eventCountAfterFirst.c, eventCountAfterSecond.c);
  });

  it("snapshots are append-only across runs", async () => {
    const db = makeDb();
    const observedAt = FIXED_NOW.toISOString();
    seedCatalog(GEMINI, {
      inputUsdPerMillion: 1.4,
      outputUsdPerMillion: 8.4,
      referenceInputUsdPerMillion: 2,
      referenceOutputUsdPerMillion: 12,
      discountPercent: 30,
    });
    seedCatalog(DEEPSEEK, {
      inputUsdPerMillion: 0.5,
      outputUsdPerMillion: 1.5,
      referenceInputUsdPerMillion: 0.66,
      referenceOutputUsdPerMillion: 1.98,
    });
    seedCatalog("gemini-3.7-flash", {
      inputUsdPerMillion: 0.22,
      outputUsdPerMillion: 1.1,
      referenceInputUsdPerMillion: 0.375,
      referenceOutputUsdPerMillion: 1.875,
    });
    seedCatalog("gpt-5.6-terra", {
      inputUsdPerMillion: 1.4,
      outputUsdPerMillion: 8.4,
      referenceInputUsdPerMillion: 2,
      referenceOutputUsdPerMillion: 12,
    });

    await runModelPricingTracker({
      db,
      now: FIXED_NOW,
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      skipOfficialProviderRefresh: true,
    });

    seedCatalog(GEMINI, {
      inputUsdPerMillion: 0.8,
      outputUsdPerMillion: 4.8,
      referenceInputUsdPerMillion: 2,
      referenceOutputUsdPerMillion: 12,
      discountPercent: 60,
    });

    await runModelPricingTracker({
      db,
      now: new Date("2026-09-21T03:00:00.000Z"),
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      skipOfficialProviderRefresh: true,
    });

    const count = db.prepare(`SELECT COUNT(*) AS c FROM model_price_snapshots`).get() as { c: number };
    assert.ok(count.c > 0);
    const latest = readLatestSnapshot(db, GEMINI, "cheaper_inference_models_current");
    assert.ok(latest);
    assert.equal(latest?.rates.discountPercent, 60);
    assert.notEqual(latest?.observedAt, observedAt);
  });

  it("unexpected large baseline change holds without mutating published catalog", () => {
    const policy = getModelPricingPolicy(GEMINI)!;
    const published = getPublishedPricing(GEMINI);
    const observedAt = FIXED_NOW.toISOString();
    const prev = buildCiReferenceSnapshot({
      policy,
      catalog: seedCatalog(GEMINI, {
        inputUsdPerMillion: 1.4,
        outputUsdPerMillion: 8.4,
        referenceInputUsdPerMillion: 2,
        referenceOutputUsdPerMillion: 12,
      }),
      observedAt,
    })!;
    const next = buildCiReferenceSnapshot({
      policy,
      catalog: seedCatalog(GEMINI, {
        inputUsdPerMillion: 1.4,
        outputUsdPerMillion: 8.4,
        referenceInputUsdPerMillion: 3,
        referenceOutputUsdPerMillion: 18,
      }),
      observedAt,
    })!;

    const events = classifyCiReferenceChange({
      policy,
      published,
      previous: prev,
      current: next,
      phase: "OBSERVE_ONLY",
    });
    assert.ok(events.some((e) => e.classification === "UNEXPECTED_LARGE_CHANGE"));
    assert.equal(getPublishedPricing(GEMINI).billingReferenceInputUsdPerMillion, published.billingReferenceInputUsdPerMillion);
  });
});

describe("PR #992 correction fixtures (provenance + run-claim atomicity)", () => {
  it("A: DeepSeek policy baseline stays PROVIDER_PEAK while CI reference records source semantics", () => {
    assert.equal(getModelPricingPolicy(DEEPSEEK)?.baselineMode, "PROVIDER_PEAK");
    const policy = getModelPricingPolicy(DEEPSEEK)!;
    const reference = buildCiReferenceSnapshot({
      policy,
      catalog: seedCatalog(DEEPSEEK, {
        inputUsdPerMillion: 0.5,
        outputUsdPerMillion: 1.5,
        referenceInputUsdPerMillion: 0.66,
        referenceOutputUsdPerMillion: 1.98,
        discountPercent: 25,
      }),
      observedAt: FIXED_NOW.toISOString(),
    })!;
    assert.equal(reference.rates.inputUsdPerMillion, 0.66);
    assert.equal(reference.rates.outputUsdPerMillion, 1.98);
    // Product policy (official PEAK target) must never be written onto an
    // observed CI reference value as provenance.
    assert.notEqual(reference.pricingMode, "provider_peak");
    assert.equal(reference.pricingMode, "procurement_reference");
  });

  it("B: provider_peak / provider_standard are only reachable via official provider evidence", () => {
    const policy = getModelPricingPolicy(DEEPSEEK)!;
    const observedAt = FIXED_NOW.toISOString();
    const current = buildCiCurrentSnapshot({
      policy,
      catalog: seedCatalog(DEEPSEEK, {
        inputUsdPerMillion: 1.32,
        outputUsdPerMillion: 3.96,
        referenceInputUsdPerMillion: 0.66,
        referenceOutputUsdPerMillion: 1.98,
        discountPercent: 0,
      }),
      observedAt,
    });
    const reference = buildCiReferenceSnapshot({
      policy,
      catalog: seedCatalog(DEEPSEEK, {
        inputUsdPerMillion: 1.32,
        outputUsdPerMillion: 3.96,
        referenceInputUsdPerMillion: 0.66,
        referenceOutputUsdPerMillion: 1.98,
        discountPercent: 0,
      }),
      observedAt,
    })!;
    assert.equal(current.pricingMode, "procurement_current");
    assert.equal(reference.pricingMode, "procurement_reference");
  });

  it("C: published baseline provenance without source evidence is unknown, not provider_standard", () => {
    const policy = getModelPricingPolicy(DEEPSEEK)!;
    const snapshot = buildPublishedBaselineSnapshot({
      policy,
      published: getPublishedPricing(DEEPSEEK),
      observedAt: FIXED_NOW.toISOString(),
    });
    assert.equal(snapshot.sourceKind, "published_billing_baseline");
    assert.equal(snapshot.pricingMode, "unknown");
  });

  it("H: snapshot source URL is the actual runtime CI /v1/models endpoint", () => {
    assert.equal(CHEAPER_INFERENCE_MODELS_SOURCE_URL, `${CHEAPER_INFERENCE_BASE_URL}/models`);
    const policy = getModelPricingPolicy(DEEPSEEK)!;
    const observedAt = FIXED_NOW.toISOString();
    const catalog = seedCatalog(DEEPSEEK, {
      inputUsdPerMillion: 0.5,
      outputUsdPerMillion: 1.5,
      referenceInputUsdPerMillion: 0.66,
      referenceOutputUsdPerMillion: 1.98,
    });
    assert.equal(
      buildCiCurrentSnapshot({ policy, catalog, observedAt }).sourceUrl,
      CHEAPER_INFERENCE_MODELS_SOURCE_URL
    );
    assert.equal(
      buildCiReferenceSnapshot({ policy, catalog, observedAt })?.sourceUrl,
      CHEAPER_INFERENCE_MODELS_SOURCE_URL
    );
  });

  it("D: two run claims for the same KST day — exactly one owner, no UNIQUE exception", () => {
    const db = makeDb();
    ensureTrackerSchema(db);
    const startedAt = FIXED_NOW.toISOString();
    // Both replicas observe no row first (the historical pre-check race shape).
    assert.equal(findTrackerRunByDateKey(db, "2026-09-20"), null);
    const first = claimTrackerRun(db, { runDateKey: "2026-09-20", phase: "OBSERVE_ONLY", startedAt });
    const second = claimTrackerRun(db, { runDateKey: "2026-09-20", phase: "OBSERVE_ONLY", startedAt });
    assert.equal(first.outcome, "CLAIMED");
    assert.equal(first.reclaimed, false);
    assert.equal(second.outcome, "SKIPPED_DUPLICATE");
    if (second.outcome === "SKIPPED_DUPLICATE") {
      assert.equal(second.existingStatus, "running");
    }
    const rows = db
      .prepare(`SELECT COUNT(*) AS c FROM model_pricing_tracker_runs WHERE run_date_key = ?`)
      .get("2026-09-20") as { c: number };
    assert.equal(rows.c, 1);
  });

  it("E: a FAILED row is atomically reclaimed exactly once for a same-day retry", () => {
    const db = makeDb();
    ensureTrackerSchema(db);
    const startedAt = FIXED_NOW.toISOString();
    const failed = claimTrackerRun(db, { runDateKey: "2026-09-20", phase: "OBSERVE_ONLY", startedAt });
    assert.equal(failed.outcome, "CLAIMED");
    finishTrackerRun(db, {
      attemptId: failed.attemptId,
      status: "failed",
      finishedAt: startedAt,
      errorSummary: "boom",
    });

    // Two replicas race the reclaim; exactly one wins, the other skips.
    const reclaimA = claimTrackerRun(db, { runDateKey: "2026-09-20", phase: "OBSERVE_ONLY", startedAt });
    const reclaimB = claimTrackerRun(db, { runDateKey: "2026-09-20", phase: "OBSERVE_ONLY", startedAt });
    const reclaimed = [reclaimA, reclaimB].filter((c) => c.outcome === "CLAIMED");
    assert.equal(reclaimed.length, 1);
    assert.ok(reclaimed[0].reclaimed);
    assert.equal(
      [reclaimA, reclaimB].find((c) => c.outcome === "SKIPPED_DUPLICATE")?.outcome,
      "SKIPPED_DUPLICATE"
    );
    const retried = claimTrackerRun(db, { runDateKey: "2026-09-20", phase: "OBSERVE_ONLY", startedAt });
    assert.equal(retried.outcome, "SKIPPED_DUPLICATE");

    finishTrackerRun(db, {
      attemptId: reclaimed[0].attemptId,
      status: "completed",
      finishedAt: startedAt,
      errorSummary: "",
    });
    const row = findTrackerRunByDateKey(db, "2026-09-20");
    assert.equal(row?.status, "completed");
  });

  it("G: a RUNNING row blocks duplicate same-day claims", async () => {
    const db = makeDb();
    seedCatalog(GEMINI, {
      inputUsdPerMillion: 1.4,
      outputUsdPerMillion: 8.4,
      referenceInputUsdPerMillion: 2,
      referenceOutputUsdPerMillion: 12,
      discountPercent: 30,
    });
    seedCatalog(DEEPSEEK, {
      inputUsdPerMillion: 0.5,
      outputUsdPerMillion: 1.5,
      referenceInputUsdPerMillion: 0.66,
      referenceOutputUsdPerMillion: 1.98,
      discountPercent: 25,
    });
    seedCatalog("gemini-3.7-flash", {
      inputUsdPerMillion: 0.22,
      outputUsdPerMillion: 1.1,
      referenceInputUsdPerMillion: 0.375,
      referenceOutputUsdPerMillion: 1.875,
      discountPercent: 40,
    });
    seedCatalog("gpt-5.6-terra", {
      inputUsdPerMillion: 1.4,
      outputUsdPerMillion: 8.4,
      referenceInputUsdPerMillion: 2,
      referenceOutputUsdPerMillion: 12,
      discountPercent: 30,
    });

    const claim = claimTrackerRun(db, { runDateKey: "2026-09-20", phase: "OBSERVE_ONLY", startedAt: FIXED_NOW.toISOString() });
    assert.equal(claim.outcome, "CLAIMED");

    const result = await runModelPricingTracker({
      db,
      now: FIXED_NOW,
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      skipOfficialProviderRefresh: true,
    });
    assert.equal(result.status, "skipped_duplicate");
    assert.equal(result.runId, claim.runId);
    const snapshots = db.prepare(`SELECT COUNT(*) AS c FROM model_price_snapshots`).get() as { c: number };
    assert.equal(snapshots.c, 0);
  });

  it("I: OBSERVE_ONLY run leaves published pricing and version untouched", async () => {
    const db = makeDb();
    seedCatalog(GEMINI, {
      inputUsdPerMillion: 1.4,
      outputUsdPerMillion: 8.4,
      referenceInputUsdPerMillion: 2,
      referenceOutputUsdPerMillion: 12,
      discountPercent: 30,
    });
    seedCatalog(DEEPSEEK, {
      inputUsdPerMillion: 0.5,
      outputUsdPerMillion: 1.5,
      referenceInputUsdPerMillion: 0.66,
      referenceOutputUsdPerMillion: 1.98,
      discountPercent: 25,
    });
    seedCatalog("gemini-3.7-flash", {
      inputUsdPerMillion: 0.22,
      outputUsdPerMillion: 1.1,
      referenceInputUsdPerMillion: 0.375,
      referenceOutputUsdPerMillion: 1.875,
      discountPercent: 40,
    });
    seedCatalog("gpt-5.6-terra", {
      inputUsdPerMillion: 1.4,
      outputUsdPerMillion: 8.4,
      referenceInputUsdPerMillion: 2,
      referenceOutputUsdPerMillion: 12,
      discountPercent: 30,
    });

    const deepseekBefore = getPublishedPricing(DEEPSEEK);
    const versionsBefore = listPublishedModelIds().map((id) => getPublishedPricingVersion(id));

    const result = await runModelPricingTracker({
      db,
      now: FIXED_NOW,
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      skipOfficialProviderRefresh: true,
    });
    assert.equal(result.status, "completed");
    assert.ok(result.events.every((e) => e.action !== "AUTO_APPLY_BASE"));
    assert.deepEqual(getPublishedPricing(DEEPSEEK), deepseekBefore);
    assert.deepEqual(
      listPublishedModelIds().map((id) => getPublishedPricingVersion(id)),
      versionsBefore
    );
  });
});

describe("PR #992 final correction fixtures (attempt identity + forensic freshness)", () => {
  const SOURCE_URL = CHEAPER_INFERENCE_MODELS_SOURCE_URL;

  function partialSnapshot(fingerprint: string, observedAt: string) {
    return {
      provider: "cheaperinference" as const,
      modelId: DEEPSEEK,
      providerModelId: DEEPSEEK,
      pricingMode: "procurement_current" as const,
      sourceKind: "cheaper_inference_models_current" as const,
      sourceUrl: SOURCE_URL,
      rates: {
        inputUsdPerMillion: 0.11,
        outputUsdPerMillion: 0.22,
        cacheReadUsdPerMillion: 0.011,
        cacheWriteUsdPerMillion: 0.11,
        tierThreshold: null as number | null,
        discountPercent: 25,
      },
      rawFingerprint: fingerprint,
      observedAt,
      validFrom: null,
      validUntil: null,
    };
  }

  it("J: a partial FAILED attempt keeps its own identity and evidence, and the retry is separated", () => {
    const db = makeDb();
    ensureTrackerSchema(db);
    const startedAt = FIXED_NOW.toISOString();

    // ATTEMPT 1 — partial snapshots/events then failure
    const a1 = claimTrackerRun(db, { runDateKey: "2026-09-20", phase: "OBSERVE_ONLY", startedAt });
    assert.equal(a1.outcome, "CLAIMED");
    insertPriceSnapshot(db, a1.attemptId, partialSnapshot("failed-partial-1", startedAt));
    insertClassifiedEvent(db, a1.attemptId, DEEPSEEK, {
      eventType: "PARSER_FAILURE",
      action: "ADMIN_ALERT",
      decision: "d1",
      classification: "c1",
      oldFingerprint: null,
      newFingerprint: null,
      oldValues: {},
      newValues: {},
      effectiveAt: null,
      eventFingerprint: "j-failed-attempt-event",
    }, null);
    insertAdminEvent(db, {
      attemptId: a1.attemptId,
      adminEventType: "PARSER_FAILED",
      modelId: null,
      source: "test",
      classification: "catalog_refresh_failed",
      decision: "fail_closed_keep_active_price",
    });
    finishTrackerRun(db, { attemptId: a1.attemptId, status: "failed", finishedAt: startedAt, errorSummary: "partial" });

    // ATTEMPT 2 — same-day retry gets a NEW immutable attempt identity
    const a2 = claimTrackerRun(db, { runDateKey: "2026-09-20", phase: "OBSERVE_ONLY", startedAt });
    assert.equal(a2.outcome, "CLAIMED");
    assert.ok(a2.reclaimed);
    // Daily claim identity is shared; run attempt identity is distinct.
    assert.equal(a2.runId, a1.runId);
    assert.notEqual(a2.attemptId, a1.attemptId);
    insertPriceSnapshot(db, a2.attemptId, partialSnapshot("retry-evidence", startedAt));
    finishTrackerRun(db, { attemptId: a2.attemptId, status: "completed", finishedAt: startedAt, errorSummary: "" });

    // Failed evidence preserved (append-only), retry evidence separated.
    assert.equal(
      (db.prepare(`SELECT COUNT(*) c FROM model_price_snapshots WHERE attempt_id = ?`).get(a1.attemptId) as { c: number }).c,
      1
    );
    assert.equal(
      (db.prepare(`SELECT COUNT(*) c FROM model_price_change_events WHERE attempt_id = ?`).get(a1.attemptId) as { c: number }).c,
      1
    );
    assert.equal(
      (db.prepare(`SELECT COUNT(*) c FROM model_pricing_admin_events WHERE attempt_id = ?`).get(a1.attemptId) as { c: number }).c,
      1
    );
    assert.equal(
      (db.prepare(`SELECT COUNT(*) c FROM model_price_snapshots WHERE attempt_id = ?`).get(a2.attemptId) as { c: number }).c,
      1
    );
    const failedRow = db
      .prepare(`SELECT snapshot_count, error_summary FROM model_pricing_tracker_attempts WHERE id = ?`)
      .get(a1.attemptId) as { snapshot_count: number; error_summary: string };
    assert.equal(failedRow.snapshot_count, 1);
    assert.equal(failedRow.error_summary, "partial");
  });

  it("K: completed attempt counters match the exact persisted row count", async () => {
    const db = makeDb();
    seedCatalog(GEMINI, {
      inputUsdPerMillion: 1.4,
      outputUsdPerMillion: 8.4,
      referenceInputUsdPerMillion: 2,
      referenceOutputUsdPerMillion: 12,
      discountPercent: 30,
    });
    seedCatalog(DEEPSEEK, {
      inputUsdPerMillion: 0.5,
      outputUsdPerMillion: 1.5,
      referenceInputUsdPerMillion: 0.66,
      referenceOutputUsdPerMillion: 1.98,
      discountPercent: 25,
    });
    seedCatalog("gemini-3.7-flash", {
      inputUsdPerMillion: 0.22,
      outputUsdPerMillion: 1.1,
      referenceInputUsdPerMillion: 0.375,
      referenceOutputUsdPerMillion: 1.875,
      discountPercent: 40,
    });
    seedCatalog("gpt-5.6-terra", {
      inputUsdPerMillion: 1.4,
      outputUsdPerMillion: 8.4,
      referenceInputUsdPerMillion: 2,
      referenceOutputUsdPerMillion: 12,
      discountPercent: 30,
    });

    const result = await runModelPricingTracker({
      db,
      now: FIXED_NOW,
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      skipOfficialProviderRefresh: true,
    });
    assert.equal(result.status, "completed");
    assert.ok(result.attemptId != null);
    const attempt = findTrackerAttemptById(db, result.attemptId)!;
    assert.equal(attempt.status, "completed");
    assert.equal(
      attempt.snapshot_count,
      (db.prepare(`SELECT COUNT(*) c FROM model_price_snapshots WHERE attempt_id = ?`).get(result.attemptId) as { c: number }).c
    );
    assert.equal(
      attempt.event_count,
      (db.prepare(`SELECT COUNT(*) c FROM model_price_change_events WHERE attempt_id = ?`).get(result.attemptId) as { c: number }).c
    );
    assert.equal(attempt.snapshot_count, result.snapshotCount);
    assert.equal(result.eventCount, attempt.event_count);
  });

  it("L: a failed partial snapshot is never consumed as previous-day source truth", async () => {
    const db = makeDb();
    seedCatalog(GEMINI, {
      inputUsdPerMillion: 1.4,
      outputUsdPerMillion: 8.4,
      referenceInputUsdPerMillion: 2,
      referenceOutputUsdPerMillion: 12,
      discountPercent: 30,
    });
    seedCatalog(DEEPSEEK, {
      inputUsdPerMillion: 0.5,
      outputUsdPerMillion: 1.5,
      referenceInputUsdPerMillion: 0.66,
      referenceOutputUsdPerMillion: 1.98,
      discountPercent: 55,
    });
    seedCatalog("gemini-3.7-flash", {
      inputUsdPerMillion: 0.22,
      outputUsdPerMillion: 1.1,
      referenceInputUsdPerMillion: 0.375,
      referenceOutputUsdPerMillion: 1.875,
      discountPercent: 40,
    });
    seedCatalog("gpt-5.6-terra", {
      inputUsdPerMillion: 1.4,
      outputUsdPerMillion: 8.4,
      referenceInputUsdPerMillion: 2,
      referenceOutputUsdPerMillion: 12,
      discountPercent: 30,
    });

    const day1 = await runModelPricingTracker({
      db,
      now: new Date("2026-09-19T03:00:00.000Z"),
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      skipOfficialProviderRefresh: true,
    });
    assert.equal(day1.status, "completed");

    // Simulate a failed partial attempt that recorded the NEW (tainted) value.
    const failedAttempt = claimTrackerRun(db, { runDateKey: "2026-09-20", phase: "OBSERVE_ONLY", startedAt: FIXED_NOW.toISOString() });
    assert.equal(failedAttempt.outcome, "CLAIMED");
    const tainted = buildCiCurrentSnapshot({
      policy: getModelPricingPolicy(DEEPSEEK)!,
      catalog: seedCatalog(DEEPSEEK, {
        inputUsdPerMillion: 0.11,
        outputUsdPerMillion: 0.22,
        referenceInputUsdPerMillion: 0.66,
        referenceOutputUsdPerMillion: 1.98,
        discountPercent: 55,
      }),
      observedAt: FIXED_NOW.toISOString(),
    });
    insertPriceSnapshot(db, failedAttempt.attemptId, tainted);
    finishTrackerRun(db, { attemptId: failedAttempt.attemptId, status: "failed", finishedAt: FIXED_NOW.toISOString(), errorSummary: "tainted" });

    // Same-day retry: previous truth must come from the COMPLETED day-1
    // attempt (discount 55), NOT from the failed attempt's tainted partial.
    const retry = await runModelPricingTracker({
      db,
      now: FIXED_NOW,
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      skipOfficialProviderRefresh: true,
    });
    assert.equal(retry.status, "completed");
    // The tainted partial evidence is preserved append-only...
    const storedTainted = db
      .prepare(`SELECT COUNT(*) c FROM model_price_snapshots WHERE raw_fingerprint = ?`)
      .get(tainted.rawFingerprint) as { c: number };
    assert.ok(storedTainted.c >= 1);
    // ...but it is NOT previous source truth: the retry must observe the
    // A(0.5/1.5) -> tainted(0.11/0.22) procurement change from the completed
    // day-1 attempt. If the failed partial were used as previous truth, the
    // rates would compare equal and no change event would be recorded.
    assert.ok(
      retry.events.some(
        (e) => e.eventType === "CI_MARKET_DISCOUNT_CHANGED" && e.classification === "ci_current_rates_changed"
      )
    );
    const latest = readLatestSnapshot(db, DEEPSEEK, "cheaper_inference_models_current");
    assert.equal(latest?.rawFingerprint, tainted.rawFingerprint);
  });

  it("M: a failed refresh never writes the stale cache as today's CI observation", async () => {
    const db = makeDb();
    // Stale, previously-cached in-memory catalog exists.
    seedCatalog(DEEPSEEK, {
      inputUsdPerMillion: 0.5,
      outputUsdPerMillion: 1.5,
      referenceInputUsdPerMillion: 0.66,
      referenceOutputUsdPerMillion: 1.98,
      discountPercent: 25,
    });

    // Force a live refresh attempt without credentials so the tracker fails closed
    // instead of treating stale in-memory cache as today's observation.
    const savedCiKey = process.env.CHEAPER_INFERENCE_API_KEY;
    delete process.env.CHEAPER_INFERENCE_API_KEY;
    resetCheaperInferenceCatalogRefreshForTest();
    let result;
    try {
      result = await runModelPricingTracker({
        db,
        now: FIXED_NOW,
        phase: "OBSERVE_ONLY",
        skipOfficialProviderRefresh: true,
      });
    } finally {
      if (savedCiKey != null) process.env.CHEAPER_INFERENCE_API_KEY = savedCiKey;
    }

    assert.equal(result!.status, "failed");
    assert.ok(result!.errors.includes("ci_catalog_refresh_failed"));
    assert.ok(result!.events.length === 0, "no CI price-change classification without a fresh source");
    assert.equal(result!.eventCount, 0);
    const failedRun = findTrackerRunByDateKey(db, "2026-09-20");
    assert.equal(failedRun?.status, "failed");

    // Same-day retry is reachable through the FAILED reclaim owner.
    seedCatalog(GEMINI, {
      inputUsdPerMillion: 1.4,
      outputUsdPerMillion: 8.4,
      referenceInputUsdPerMillion: 2,
      referenceOutputUsdPerMillion: 12,
      discountPercent: 30,
    });
    seedCatalog(DEEPSEEK, {
      inputUsdPerMillion: 0.5,
      outputUsdPerMillion: 1.5,
      referenceInputUsdPerMillion: 0.66,
      referenceOutputUsdPerMillion: 1.98,
      discountPercent: 25,
    });
    seedCatalog("gemini-3.7-flash", {
      inputUsdPerMillion: 0.22,
      outputUsdPerMillion: 1.1,
      referenceInputUsdPerMillion: 0.375,
      referenceOutputUsdPerMillion: 1.875,
      discountPercent: 40,
    });
    seedCatalog("gpt-5.6-terra", {
      inputUsdPerMillion: 1.4,
      outputUsdPerMillion: 8.4,
      referenceInputUsdPerMillion: 2,
      referenceOutputUsdPerMillion: 12,
      discountPercent: 30,
    });
    const retry = await runModelPricingTracker({
      db,
      now: FIXED_NOW,
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      skipOfficialProviderRefresh: true,
    });
    assert.equal(retry.status, "completed");
    assert.equal(findTrackerRunByDateKey(db, "2026-09-20")?.status, "completed");
    // The failed attempt must not write CI snapshots from stale cache.
    const failedCiSnapshots = db
      .prepare(
        `SELECT COUNT(*) c FROM model_price_snapshots s
         JOIN model_pricing_tracker_attempts a ON a.id = s.attempt_id
         WHERE s.source_kind IN ('cheaper_inference_models_current','cheaper_inference_models_reference')
           AND a.run_date_key = '2026-09-20' AND a.status = 'failed'`
      )
      .get() as { c: number };
    assert.equal(failedCiSnapshots.c, 0);
    const retryCiSnapshots = db
      .prepare(
        `SELECT COUNT(*) c FROM model_price_snapshots s
         JOIN model_pricing_tracker_attempts a ON a.id = s.attempt_id
         WHERE s.source_kind IN ('cheaper_inference_models_current','cheaper_inference_models_reference')
           AND a.run_date_key = '2026-09-20' AND a.status = 'completed'`
      )
      .get() as { c: number };
    assert.ok(retryCiSnapshots.c > 0, "retry with confirmed fresh observation writes CI snapshots");
    // The failure evidence exists as an admin event.
    const adminFailures = db
      .prepare(
        `SELECT COUNT(*) c FROM model_pricing_admin_events
         WHERE classification = 'catalog_refresh_failed' AND created_at >= date('now','-1 day')`
      )
      .get() as { c: number };
    assert.ok(adminFailures.c >= 1);
  });

  it("N: a CI reference change stays CI_REFERENCE_CHANGED_UNVERIFIED and holds", () => {
    const policy = getModelPricingPolicy(DEEPSEEK)!;
    const published = getPublishedPricing(DEEPSEEK);
    const observedAt = FIXED_NOW.toISOString();
    const previous = buildCiReferenceSnapshot({
      policy,
      catalog: seedCatalog(DEEPSEEK, {
        inputUsdPerMillion: 0.5,
        outputUsdPerMillion: 1.5,
        referenceInputUsdPerMillion: 0.66,
        referenceOutputUsdPerMillion: 1.98,
        discountPercent: 25,
      }),
      observedAt,
    })!;
    const next = buildCiReferenceSnapshot({
      policy,
      catalog: seedCatalog(DEEPSEEK, {
        inputUsdPerMillion: 0.5,
        outputUsdPerMillion: 1.5,
        referenceInputUsdPerMillion: 0.792,
        referenceOutputUsdPerMillion: 2.376,
        discountPercent: 25,
      }),
      observedAt,
    })!;

    const events = classifyCiReferenceChange({ policy, published, previous, current: next });
    assert.equal(events.length, 1);
    assert.equal(events[0]?.eventType, "CI_REFERENCE_CHANGED_UNVERIFIED");
    assert.equal(events[0]?.action, "HOLD");
    assert.ok(events.every((e) => e.eventType !== "PROVIDER_NORMAL_BASELINE_CHANGED"));
    assert.ok(events.every((e) => e.eventType !== "PROVIDER_SCHEDULED_BASELINE_CHANGED"));

    // Numeric coincidence with published PEAK baseline must not suppress a prior
    // CI reference transition when the reference actually moved.
    const peakAligned = buildCiReferenceSnapshot({
      policy,
      catalog: seedCatalog(DEEPSEEK, {
        inputUsdPerMillion: 0.5,
        outputUsdPerMillion: 1.5,
        referenceInputUsdPerMillion: 1.32,
        referenceOutputUsdPerMillion: 3.96,
        discountPercent: 0,
      }),
      observedAt,
    })!;
    const peakAlignedEvents = classifyCiReferenceChange({
      policy,
      published,
      previous,
      current: peakAligned,
    });
    assert.equal(peakAlignedEvents.length, 1);
    assert.equal(peakAlignedEvents[0]?.eventType, "CI_REFERENCE_CHANGED_UNVERIFIED");
    assert.equal(peakAlignedEvents[0]?.action, "HOLD");

    const cachePrevious = buildCiReferenceSnapshot({
      policy,
      catalog: seedCatalog(DEEPSEEK, {
        inputUsdPerMillion: 0.5,
        outputUsdPerMillion: 1.5,
        referenceInputUsdPerMillion: 0.66,
        referenceOutputUsdPerMillion: 1.98,
        referenceCacheReadUsdPerMillion: 0.02,
        discountPercent: 25,
      }),
      observedAt,
    })!;
    const cacheNext = buildCiReferenceSnapshot({
      policy,
      catalog: seedCatalog(DEEPSEEK, {
        inputUsdPerMillion: 0.5,
        outputUsdPerMillion: 1.5,
        referenceInputUsdPerMillion: 0.66,
        referenceOutputUsdPerMillion: 1.98,
        referenceCacheReadUsdPerMillion: 0.025,
        discountPercent: 25,
      }),
      observedAt,
    })!;
    const cacheOnlyEvents = classifyCiReferenceChange({
      policy,
      published,
      previous: cachePrevious,
      current: cacheNext,
    });
    assert.equal(cacheOnlyEvents.length, 1);
    assert.equal(cacheOnlyEvents[0]?.eventType, "CI_REFERENCE_CHANGED_UNVERIFIED");
    assert.equal(cacheOnlyEvents[0]?.action, "HOLD");

    // A large CI move away from published baseline stays CI-unverified/HOLD.
    const large = buildCiReferenceSnapshot({
      policy,
      catalog: seedCatalog(DEEPSEEK, {
        inputUsdPerMillion: 0.5,
        outputUsdPerMillion: 1.5,
        referenceInputUsdPerMillion: 1.4,
        referenceOutputUsdPerMillion: 4.2,
        discountPercent: 0,
      }),
      observedAt,
    })!;
    const largeEvents = classifyCiReferenceChange({ policy, published, previous, current: large });
    assert.ok(largeEvents.every((e) => e.eventType === "CI_REFERENCE_CHANGED_UNVERIFIED"));
    assert.ok(largeEvents.some((e) => e.classification === "UNEXPECTED_LARGE_CHANGE"));
    assert.ok(largeEvents.every((e) => e.action === "HOLD"));
  });

  it("O: Phase A has no reachable auto-apply branch", () => {
    const classifierSource = readFileSync("src/lib/modelPriceChangeClassifier.ts", "utf8");
    const trackerSource = readFileSync("src/lib/modelPricingTracker.ts", "utf8");
    const configSource = readFileSync("src/lib/modelPricingTrackingConfig.ts", "utf8");
    const schemaSource = readFileSync("src/lib/modelPricingTrackingSchema.ts", "utf8");
    for (const token of ["AUTO_APPLY_BASE", "AUTO_APPLY_SAFE_EVENTS", "PRICE_CHANGED_AUTO_APPLIED"]) {
      assert.ok(!classifierSource.includes(token), `classifier contains ${token}`);
      assert.ok(!trackerSource.includes(token), `tracker contains ${token}`);
      assert.ok(!configSource.includes(token), `config contains ${token}`);
      assert.ok(!schemaSource.includes(token), `schema contains ${token}`);
    }
    void CACHE_RATE_PROVENANCE_UNVERIFIED;
  });

  it("P: CI snapshot observed_at is the source fetch timestamp, not the run clock", async () => {
    const db = makeDb();
    const sourceMs = FIXED_NOW.getTime() - 90_000;
    seedCatalog(DEEPSEEK, {
      inputUsdPerMillion: 0.5,
      outputUsdPerMillion: 1.5,
      referenceInputUsdPerMillion: 0.66,
      referenceOutputUsdPerMillion: 1.98,
      discountPercent: 25,
      fetchedAt: sourceMs,
    });
    seedCatalog(GEMINI, {
      inputUsdPerMillion: 1.4,
      outputUsdPerMillion: 8.4,
      referenceInputUsdPerMillion: 2,
      referenceOutputUsdPerMillion: 12,
      discountPercent: 30,
      fetchedAt: sourceMs,
    });
    seedCatalog("gemini-3.7-flash", {
      inputUsdPerMillion: 0.22,
      outputUsdPerMillion: 1.1,
      referenceInputUsdPerMillion: 0.375,
      referenceOutputUsdPerMillion: 1.875,
      discountPercent: 40,
      fetchedAt: sourceMs,
    });
    seedCatalog("gpt-5.6-terra", {
      inputUsdPerMillion: 1.4,
      outputUsdPerMillion: 8.4,
      referenceInputUsdPerMillion: 2,
      referenceOutputUsdPerMillion: 12,
      discountPercent: 30,
      fetchedAt: sourceMs,
    });

    const startedAt = FIXED_NOW.toISOString();
    const result = await runModelPricingTracker({
      db,
      now: FIXED_NOW,
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      skipOfficialProviderRefresh: true,
    });
    assert.equal(result.status, "completed");

    const attemptRow = db
      .prepare(`SELECT started_at FROM model_pricing_tracker_attempts WHERE id = ?`)
      .get(result.attemptId) as { started_at: string };

    const ciCurrent = readLatestSnapshot(db, DEEPSEEK, "cheaper_inference_models_current");
    assert.equal(ciCurrent?.observedAt, new Date(sourceMs).toISOString());

    const published = db
      .prepare(
        `SELECT observed_at FROM model_price_snapshots
         WHERE source_kind = 'published_billing_baseline' AND attempt_id = ?
         ORDER BY id DESC LIMIT 1`
      )
      .get(result.attemptId) as { observed_at: string };
    // The published-code baseline is a code constant, not a source observation:
    // it anchors to the attempt start, while CI rows anchor to the source fetch.
    assert.equal(published.observed_at, attemptRow.started_at);
  });
});

describe("PR #992 event-history integrity fixtures (Q1–Q8)", () => {
  function seedAllTracked(fetchedAt?: number) {
    seedCatalog(GEMINI, {
      inputUsdPerMillion: 1.4,
      outputUsdPerMillion: 8.4,
      referenceInputUsdPerMillion: 2,
      referenceOutputUsdPerMillion: 12,
      discountPercent: 30,
      fetchedAt,
    });
    seedCatalog("gemini-3.7-flash", {
      inputUsdPerMillion: 0.22,
      outputUsdPerMillion: 1.1,
      referenceInputUsdPerMillion: 0.375,
      referenceOutputUsdPerMillion: 1.875,
      discountPercent: 40,
      fetchedAt,
    });
    seedCatalog("gpt-5.6-terra", {
      inputUsdPerMillion: 1.4,
      outputUsdPerMillion: 8.4,
      referenceInputUsdPerMillion: 2,
      referenceOutputUsdPerMillion: 12,
      discountPercent: 30,
      fetchedAt,
    });
  }

  function countRateChangeEvents(db: Database.Database, modelId: string): number {
    return (
      db
        .prepare(
          `SELECT COUNT(*) c FROM model_price_change_events
           WHERE model_id = ? AND event_type = 'CI_MARKET_DISCOUNT_CHANGED'
             AND classification = 'ci_current_rates_changed'`
        )
        .get(modelId) as { c: number }
    ).c;
  }

  function countTierChangeEvents(db: Database.Database, modelId: string): number {
    return (
      db
        .prepare(
          `SELECT COUNT(*) c FROM model_price_change_events
           WHERE model_id = ? AND event_type = 'PROCUREMENT_TIER_CHANGED'`
        )
        .get(modelId) as { c: number }
    ).c;
  }

  function countReferenceChangeEvents(db: Database.Database, modelId: string): number {
    return (
      db
        .prepare(
          `SELECT COUNT(*) c FROM model_price_change_events
           WHERE model_id = ? AND event_type = 'CI_REFERENCE_CHANGED_UNVERIFIED'`
        )
        .get(modelId) as { c: number }
    ).c;
  }

  it("Q1: current rate A→B event persists", async () => {
    const db = makeDb();
    seedAllTracked(Date.parse("2026-09-18T03:00:00.000Z"));
    seedCatalog(DEEPSEEK, {
      inputUsdPerMillion: 0.5,
      outputUsdPerMillion: 1.5,
      referenceInputUsdPerMillion: 0.66,
      referenceOutputUsdPerMillion: 1.98,
      discountPercent: 25,
      fetchedAt: Date.parse("2026-09-18T03:00:00.000Z"),
    });
    await runModelPricingTracker({
      db,
      now: new Date("2026-09-18T03:00:00.000Z"),
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      skipOfficialProviderRefresh: true,
    });

    seedCatalog(DEEPSEEK, {
      inputUsdPerMillion: 0.8,
      outputUsdPerMillion: 2.4,
      referenceInputUsdPerMillion: 0.66,
      referenceOutputUsdPerMillion: 1.98,
      discountPercent: 25,
      fetchedAt: Date.parse("2026-09-19T03:00:00.000Z"),
    });
    const day2 = await runModelPricingTracker({
      db,
      now: new Date("2026-09-19T03:00:00.000Z"),
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      skipOfficialProviderRefresh: true,
    });
    assert.equal(day2.status, "completed");
    assert.equal(countRateChangeEvents(db, DEEPSEEK), 1);
  });

  it("Q2: next-day B→C also persists (timeline rows = 2)", async () => {
    const db = makeDb();
    seedAllTracked(Date.parse("2026-09-18T03:00:00.000Z"));
    seedCatalog(DEEPSEEK, {
      inputUsdPerMillion: 0.5,
      outputUsdPerMillion: 1.5,
      referenceInputUsdPerMillion: 0.66,
      referenceOutputUsdPerMillion: 1.98,
      discountPercent: 25,
      fetchedAt: Date.parse("2026-09-18T03:00:00.000Z"),
    });
    await runModelPricingTracker({
      db,
      now: new Date("2026-09-18T03:00:00.000Z"),
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      skipOfficialProviderRefresh: true,
    });

    seedCatalog(DEEPSEEK, {
      inputUsdPerMillion: 0.8,
      outputUsdPerMillion: 2.4,
      referenceInputUsdPerMillion: 0.66,
      referenceOutputUsdPerMillion: 1.98,
      discountPercent: 25,
      fetchedAt: Date.parse("2026-09-19T03:00:00.000Z"),
    });
    await runModelPricingTracker({
      db,
      now: new Date("2026-09-19T03:00:00.000Z"),
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      skipOfficialProviderRefresh: true,
    });

    seedCatalog(DEEPSEEK, {
      inputUsdPerMillion: 1.1,
      outputUsdPerMillion: 3.3,
      referenceInputUsdPerMillion: 0.66,
      referenceOutputUsdPerMillion: 1.98,
      discountPercent: 25,
      fetchedAt: Date.parse("2026-09-20T03:00:00.000Z"),
    });
    const day3 = await runModelPricingTracker({
      db,
      now: FIXED_NOW,
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      skipOfficialProviderRefresh: true,
    });
    assert.equal(day3.status, "completed");
    assert.equal(countRateChangeEvents(db, DEEPSEEK), 2);
  });

  it("Q3: oscillation A→B→A preserves both legitimate occurrences", async () => {
    const db = makeDb();
    seedAllTracked(Date.parse("2026-09-17T03:00:00.000Z"));
    seedCatalog(DEEPSEEK, {
      inputUsdPerMillion: 0.5,
      outputUsdPerMillion: 1.5,
      referenceInputUsdPerMillion: 0.66,
      referenceOutputUsdPerMillion: 1.98,
      discountPercent: 25,
      fetchedAt: Date.parse("2026-09-17T03:00:00.000Z"),
    });
    await runModelPricingTracker({
      db,
      now: new Date("2026-09-17T03:00:00.000Z"),
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      skipOfficialProviderRefresh: true,
    });

    seedCatalog(DEEPSEEK, {
      inputUsdPerMillion: 0.8,
      outputUsdPerMillion: 2.4,
      referenceInputUsdPerMillion: 0.66,
      referenceOutputUsdPerMillion: 1.98,
      discountPercent: 25,
      fetchedAt: Date.parse("2026-09-18T03:00:00.000Z"),
    });
    await runModelPricingTracker({
      db,
      now: new Date("2026-09-18T03:00:00.000Z"),
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      skipOfficialProviderRefresh: true,
    });

    seedCatalog(DEEPSEEK, {
      inputUsdPerMillion: 0.5,
      outputUsdPerMillion: 1.5,
      referenceInputUsdPerMillion: 0.66,
      referenceOutputUsdPerMillion: 1.98,
      discountPercent: 25,
      fetchedAt: Date.parse("2026-09-19T03:00:00.000Z"),
    });
    await runModelPricingTracker({
      db,
      now: new Date("2026-09-19T03:00:00.000Z"),
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      skipOfficialProviderRefresh: true,
    });

    assert.equal(countRateChangeEvents(db, DEEPSEEK), 2);
  });

  it("Q4: duplicate processing of the exact same source observation yields one canonical occurrence", () => {
    const db = makeDb();
    ensureTrackerSchema(db);
    const policy = getModelPricingPolicy(DEEPSEEK)!;
    const observedAt = "2026-09-20T03:00:00.000Z";
    const previous = buildCiCurrentSnapshot({
      policy,
      catalog: seedCatalog(DEEPSEEK, {
        inputUsdPerMillion: 0.5,
        outputUsdPerMillion: 1.5,
        referenceInputUsdPerMillion: 0.66,
        referenceOutputUsdPerMillion: 1.98,
        discountPercent: 25,
        fetchedAt: Date.parse("2026-09-19T03:00:00.000Z"),
      }),
      observedAt: "2026-09-19T03:00:00.000Z",
    });
    const current = buildCiCurrentSnapshot({
      policy,
      catalog: seedCatalog(DEEPSEEK, {
        inputUsdPerMillion: 0.8,
        outputUsdPerMillion: 2.4,
        referenceInputUsdPerMillion: 0.66,
        referenceOutputUsdPerMillion: 1.98,
        discountPercent: 25,
        fetchedAt: Date.parse(observedAt),
      }),
      observedAt,
    });
    const event = classifyCiCurrentChange({ modelId: DEEPSEEK, previous, current })[0]!;
    const claim = claimTrackerRun(db, { runDateKey: "2026-09-20", phase: "OBSERVE_ONLY", startedAt: observedAt });
    assert.equal(insertClassifiedEvent(db, claim.attemptId, DEEPSEEK, event, 1), true);
    assert.equal(insertClassifiedEvent(db, claim.attemptId, DEEPSEEK, event, 1), false);
    assert.equal(
      (db.prepare(`SELECT COUNT(*) c FROM model_price_change_events`).get() as { c: number }).c,
      1
    );
  });

  it("Q5: CI reference X→Y→X preserves both real occurrences", () => {
    const db = makeDb();
    ensureTrackerSchema(db);
    const policy = getModelPricingPolicy(DEEPSEEK)!;
    const published = getPublishedPricing(DEEPSEEK);

    const xObserved = "2026-09-18T03:00:00.000Z";
    const yObserved = "2026-09-19T03:00:00.000Z";
    const xReturnObserved = "2026-09-20T03:00:00.000Z";

    const refX = buildCiReferenceSnapshot({
      policy,
      catalog: seedCatalog(DEEPSEEK, {
        inputUsdPerMillion: 0.5,
        outputUsdPerMillion: 1.5,
        referenceInputUsdPerMillion: 0.7,
        referenceOutputUsdPerMillion: 2.1,
        discountPercent: 25,
        fetchedAt: Date.parse(xObserved),
      }),
      observedAt: xObserved,
    })!;
    const refY = buildCiReferenceSnapshot({
      policy,
      catalog: seedCatalog(DEEPSEEK, {
        inputUsdPerMillion: 0.5,
        outputUsdPerMillion: 1.5,
        referenceInputUsdPerMillion: 0.85,
        referenceOutputUsdPerMillion: 2.55,
        discountPercent: 25,
        fetchedAt: Date.parse(yObserved),
      }),
      observedAt: yObserved,
    })!;
    const refXReturn = buildCiReferenceSnapshot({
      policy,
      catalog: seedCatalog(DEEPSEEK, {
        inputUsdPerMillion: 0.5,
        outputUsdPerMillion: 1.5,
        referenceInputUsdPerMillion: 0.7,
        referenceOutputUsdPerMillion: 2.1,
        discountPercent: 25,
        fetchedAt: Date.parse(xReturnObserved),
      }),
      observedAt: xReturnObserved,
    })!;

    const claim1 = claimTrackerRun(db, { runDateKey: "2026-09-19", phase: "OBSERVE_ONLY", startedAt: yObserved });
    const event1 = classifyCiReferenceChange({ policy, published, previous: refX, current: refY })[0]!;
    assert.equal(insertClassifiedEvent(db, claim1.attemptId, DEEPSEEK, event1, 1), true);

    const claim2 = claimTrackerRun(db, { runDateKey: "2026-09-20", phase: "OBSERVE_ONLY", startedAt: xReturnObserved });
    const event2 = classifyCiReferenceChange({ policy, published, previous: refY, current: refXReturn })[0]!;
    assert.equal(insertClassifiedEvent(db, claim2.attemptId, DEEPSEEK, event2, 1), true);

    assert.equal(countReferenceChangeEvents(db, DEEPSEEK), 2);
  });

  it("Q6: tier T1→T2→T1 preserves both real occurrences", () => {
    const db = makeDb();
    ensureTrackerSchema(db);
    const policy = getModelPricingPolicy(DEEPSEEK)!;

    const t1Observed = "2026-09-18T03:00:00.000Z";
    const t2Observed = "2026-09-19T03:00:00.000Z";
    const t1ReturnObserved = "2026-09-20T03:00:00.000Z";

    const tier1 = buildCiCurrentSnapshot({
      policy,
      catalog: seedCatalog(DEEPSEEK, {
        inputUsdPerMillion: 0.5,
        outputUsdPerMillion: 1.5,
        referenceInputUsdPerMillion: 0.66,
        referenceOutputUsdPerMillion: 1.98,
        discountPercent: 25,
        inputTokenPriceThreshold: 100_000,
        fetchedAt: Date.parse(t1Observed),
      }),
      observedAt: t1Observed,
    });
    const tier2 = buildCiCurrentSnapshot({
      policy,
      catalog: seedCatalog(DEEPSEEK, {
        inputUsdPerMillion: 0.5,
        outputUsdPerMillion: 1.5,
        referenceInputUsdPerMillion: 0.66,
        referenceOutputUsdPerMillion: 1.98,
        discountPercent: 25,
        inputTokenPriceThreshold: 200_000,
        fetchedAt: Date.parse(t2Observed),
      }),
      observedAt: t2Observed,
    });
    const tier1Return = buildCiCurrentSnapshot({
      policy,
      catalog: seedCatalog(DEEPSEEK, {
        inputUsdPerMillion: 0.5,
        outputUsdPerMillion: 1.5,
        referenceInputUsdPerMillion: 0.66,
        referenceOutputUsdPerMillion: 1.98,
        discountPercent: 25,
        inputTokenPriceThreshold: 100_000,
        fetchedAt: Date.parse(t1ReturnObserved),
      }),
      observedAt: t1ReturnObserved,
    });

    const claim1 = claimTrackerRun(db, { runDateKey: "2026-09-19", phase: "OBSERVE_ONLY", startedAt: t2Observed });
    const event1 = classifyCiCurrentChange({ modelId: DEEPSEEK, previous: tier1, current: tier2 })[0]!;
    assert.equal(event1.eventType, "PROCUREMENT_TIER_CHANGED");
    assert.equal(insertClassifiedEvent(db, claim1.attemptId, DEEPSEEK, event1, 1), true);

    const claim2 = claimTrackerRun(db, { runDateKey: "2026-09-20", phase: "OBSERVE_ONLY", startedAt: t1ReturnObserved });
    const event2 = classifyCiCurrentChange({ modelId: DEEPSEEK, previous: tier2, current: tier1Return })[0]!;
    assert.equal(event2.eventType, "PROCUREMENT_TIER_CHANGED");
    assert.equal(insertClassifiedEvent(db, claim2.attemptId, DEEPSEEK, event2, 1), true);

    assert.equal(countTierChangeEvents(db, DEEPSEEK), 2);
  });

  it("Q7: returned eventCount equals persisted event rows for this attempt", async () => {
    const db = makeDb();
    seedAllTracked(Date.parse("2026-09-18T03:00:00.000Z"));
    seedCatalog(DEEPSEEK, {
      inputUsdPerMillion: 0.5,
      outputUsdPerMillion: 1.5,
      referenceInputUsdPerMillion: 0.66,
      referenceOutputUsdPerMillion: 1.98,
      discountPercent: 25,
      fetchedAt: Date.parse("2026-09-18T03:00:00.000Z"),
    });
    await runModelPricingTracker({
      db,
      now: new Date("2026-09-18T03:00:00.000Z"),
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      skipOfficialProviderRefresh: true,
    });

    seedCatalog(DEEPSEEK, {
      inputUsdPerMillion: 0.8,
      outputUsdPerMillion: 2.4,
      referenceInputUsdPerMillion: 0.66,
      referenceOutputUsdPerMillion: 1.98,
      discountPercent: 25,
      fetchedAt: Date.parse("2026-09-20T03:00:00.000Z"),
    });
    const result = await runModelPricingTracker({
      db,
      now: FIXED_NOW,
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      skipOfficialProviderRefresh: true,
    });
    assert.ok(result.attemptId != null);
    const persisted = (
      db
        .prepare(`SELECT COUNT(*) c FROM model_price_change_events WHERE attempt_id = ?`)
        .get(result.attemptId) as { c: number }
    ).c;
    assert.equal(result.eventCount, persisted);
    assert.equal(result.eventCount, findTrackerAttemptById(db, result.attemptId)!.event_count);
  });

  it("Q8: failed attempt retry of the same source observation does not duplicate the business event", async () => {
    const db = makeDb();
    seedAllTracked(Date.parse("2026-09-18T03:00:00.000Z"));
    seedCatalog(DEEPSEEK, {
      inputUsdPerMillion: 0.5,
      outputUsdPerMillion: 1.5,
      referenceInputUsdPerMillion: 0.66,
      referenceOutputUsdPerMillion: 1.98,
      discountPercent: 25,
      fetchedAt: Date.parse("2026-09-18T03:00:00.000Z"),
    });
    await runModelPricingTracker({
      db,
      now: new Date("2026-09-18T03:00:00.000Z"),
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      skipOfficialProviderRefresh: true,
    });

    const sourceFetchedAt = Date.parse("2026-09-20T03:00:00.000Z");
    seedAllTracked(sourceFetchedAt);
    seedCatalog(DEEPSEEK, {
      inputUsdPerMillion: 0.8,
      outputUsdPerMillion: 2.4,
      referenceInputUsdPerMillion: 0.66,
      referenceOutputUsdPerMillion: 1.98,
      discountPercent: 25,
      fetchedAt: sourceFetchedAt,
    });

    const startedAt = FIXED_NOW.toISOString();
    const failedAttempt = claimTrackerRun(db, {
      runDateKey: "2026-09-20",
      phase: "OBSERVE_ONLY",
      startedAt,
    });
    assert.equal(failedAttempt.outcome, "CLAIMED");
    const policy = getModelPricingPolicy(DEEPSEEK)!;
    const prevCurrent = readLatestSnapshot(db, DEEPSEEK, "cheaper_inference_models_current");
    const ciCurrent = buildCiCurrentSnapshot({
      policy,
      catalog: seedCatalog(DEEPSEEK, {
        inputUsdPerMillion: 0.8,
        outputUsdPerMillion: 2.4,
        referenceInputUsdPerMillion: 0.66,
        referenceOutputUsdPerMillion: 1.98,
        discountPercent: 25,
        fetchedAt: sourceFetchedAt,
      }),
      observedAt: new Date(sourceFetchedAt).toISOString(),
    });
    insertPriceSnapshot(db, failedAttempt.attemptId, ciCurrent);
    for (const event of classifyCiCurrentChange({
      modelId: DEEPSEEK,
      previous: prevCurrent,
      current: ciCurrent,
    })) {
      insertClassifiedEvent(db, failedAttempt.attemptId, DEEPSEEK, event, getPublishedPricingVersion(DEEPSEEK));
    }
    finishTrackerRun(db, {
      attemptId: failedAttempt.attemptId,
      status: "failed",
      finishedAt: startedAt,
      errorSummary: "partial-then-failed",
    });
    assert.equal(countRateChangeEvents(db, DEEPSEEK), 1);

    const retry = await runModelPricingTracker({
      db,
      now: FIXED_NOW,
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      skipOfficialProviderRefresh: true,
    });
    assert.equal(retry.status, "completed");
    assert.equal(countRateChangeEvents(db, DEEPSEEK), 1);
    const replayedRateEventsOnRetry = (
      db
        .prepare(
          `SELECT COUNT(*) c FROM model_price_change_events
           WHERE attempt_id = ? AND model_id = ? AND classification = 'ci_current_rates_changed'`
        )
        .get(retry.attemptId, DEEPSEEK) as { c: number }
    ).c;
    assert.equal(replayedRateEventsOnRetry, 0);
    assert.equal(retry.events.length, retry.eventCount);
    assert.equal(
      retry.eventCount,
      (db.prepare(`SELECT COUNT(*) c FROM model_price_change_events WHERE attempt_id = ?`).get(retry.attemptId) as { c: number }).c
    );
  });
});

describe("PR #992 transition-identity fixtures (R1–R5)", () => {
  function seedAllTracked(fetchedAt?: number) {
    seedCatalog(GEMINI, {
      inputUsdPerMillion: 1.4,
      outputUsdPerMillion: 8.4,
      referenceInputUsdPerMillion: 2,
      referenceOutputUsdPerMillion: 12,
      discountPercent: 30,
      fetchedAt,
    });
    seedCatalog("gemini-3.7-flash", {
      inputUsdPerMillion: 0.22,
      outputUsdPerMillion: 1.1,
      referenceInputUsdPerMillion: 0.375,
      referenceOutputUsdPerMillion: 1.875,
      discountPercent: 40,
      fetchedAt,
    });
    seedCatalog("gpt-5.6-terra", {
      inputUsdPerMillion: 1.4,
      outputUsdPerMillion: 8.4,
      referenceInputUsdPerMillion: 2,
      referenceOutputUsdPerMillion: 12,
      discountPercent: 30,
      fetchedAt,
    });
  }

  function countRateChangeEvents(db: Database.Database, modelId: string): number {
    return (
      db
        .prepare(
          `SELECT COUNT(*) c FROM model_price_change_events
           WHERE model_id = ? AND event_type = 'CI_MARKET_DISCOUNT_CHANGED'
             AND classification = 'ci_current_rates_changed'`
        )
        .get(modelId) as { c: number }
    ).c;
  }

  function countAtoBRateEvents(db: Database.Database, modelId: string, bInput: number): number {
    return (
      db
        .prepare(
          `SELECT COUNT(*) c FROM model_price_change_events
           WHERE model_id = ? AND classification = 'ci_current_rates_changed'
             AND json_extract(new_values_json, '$.inputUsdPerMillion') = ?`
        )
        .get(modelId, bInput) as { c: number }
    ).c;
  }

  it("R1: fresh refetch retry with different fetchedAt keeps one business transition", async () => {
    const db = makeDb();
    const t0 = Date.parse("2026-09-18T03:00:00.000Z");
    const t1 = Date.parse("2026-09-20T03:00:00.000Z");
    const t2 = Date.parse("2026-09-20T06:00:00.000Z");

    seedAllTracked(t0);
    seedCatalog(DEEPSEEK, {
      inputUsdPerMillion: 0.5,
      outputUsdPerMillion: 1.5,
      referenceInputUsdPerMillion: 0.66,
      referenceOutputUsdPerMillion: 1.98,
      discountPercent: 25,
      fetchedAt: t0,
    });
    await runModelPricingTracker({
      db,
      now: new Date("2026-09-18T03:00:00.000Z"),
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      skipOfficialProviderRefresh: true,
    });

    seedAllTracked(t1);
    seedCatalog(DEEPSEEK, {
      inputUsdPerMillion: 0.8,
      outputUsdPerMillion: 2.4,
      referenceInputUsdPerMillion: 0.66,
      referenceOutputUsdPerMillion: 1.98,
      discountPercent: 25,
      fetchedAt: t1,
    });

    const startedAt = FIXED_NOW.toISOString();
    const failedAttempt = claimTrackerRun(db, {
      runDateKey: "2026-09-20",
      phase: "OBSERVE_ONLY",
      startedAt,
    });
    assert.equal(failedAttempt.outcome, "CLAIMED");
    const policy = getModelPricingPolicy(DEEPSEEK)!;
    const prevCurrent = readLatestSnapshot(db, DEEPSEEK, "cheaper_inference_models_current");
    const ciCurrentT1 = buildCiCurrentSnapshot({
      policy,
      catalog: seedCatalog(DEEPSEEK, {
        inputUsdPerMillion: 0.8,
        outputUsdPerMillion: 2.4,
        referenceInputUsdPerMillion: 0.66,
        referenceOutputUsdPerMillion: 1.98,
        discountPercent: 25,
        fetchedAt: t1,
      }),
      observedAt: new Date(t1).toISOString(),
    });
    insertPriceSnapshot(db, failedAttempt.attemptId, ciCurrentT1);
    for (const event of classifyCiCurrentChange({
      modelId: DEEPSEEK,
      previous: prevCurrent,
      current: ciCurrentT1,
    })) {
      insertClassifiedEvent(db, failedAttempt.attemptId, DEEPSEEK, event, getPublishedPricingVersion(DEEPSEEK));
    }
    finishTrackerRun(db, {
      attemptId: failedAttempt.attemptId,
      status: "failed",
      finishedAt: startedAt,
      errorSummary: "failed-after-classify",
    });
    assert.equal(countRateChangeEvents(db, DEEPSEEK), 1);

    seedAllTracked(t2);
    seedCatalog(DEEPSEEK, {
      inputUsdPerMillion: 0.8,
      outputUsdPerMillion: 2.4,
      referenceInputUsdPerMillion: 0.66,
      referenceOutputUsdPerMillion: 1.98,
      discountPercent: 25,
      fetchedAt: t2,
    });
    const retry = await runModelPricingTracker({
      db,
      now: FIXED_NOW,
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      skipOfficialProviderRefresh: true,
    });
    assert.equal(retry.status, "completed");
    assert.equal(countRateChangeEvents(db, DEEPSEEK), 1);
    assert.equal(retry.events.length, retry.eventCount);
  });

  it("R2: real return transition preserves both A→B occurrences", async () => {
    const db = makeDb();
    seedAllTracked(Date.parse("2026-09-17T03:00:00.000Z"));
    seedCatalog(DEEPSEEK, {
      inputUsdPerMillion: 0.5,
      outputUsdPerMillion: 1.5,
      referenceInputUsdPerMillion: 0.66,
      referenceOutputUsdPerMillion: 1.98,
      discountPercent: 25,
      fetchedAt: Date.parse("2026-09-17T03:00:00.000Z"),
    });
    await runModelPricingTracker({
      db,
      now: new Date("2026-09-17T03:00:00.000Z"),
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      skipOfficialProviderRefresh: true,
    });

    seedAllTracked(Date.parse("2026-09-18T03:00:00.000Z"));
    seedCatalog(DEEPSEEK, {
      inputUsdPerMillion: 0.8,
      outputUsdPerMillion: 2.4,
      referenceInputUsdPerMillion: 0.66,
      referenceOutputUsdPerMillion: 1.98,
      discountPercent: 25,
      fetchedAt: Date.parse("2026-09-18T03:00:00.000Z"),
    });
    await runModelPricingTracker({
      db,
      now: new Date("2026-09-18T03:00:00.000Z"),
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      skipOfficialProviderRefresh: true,
    });

    seedAllTracked(Date.parse("2026-09-19T03:00:00.000Z"));
    seedCatalog(DEEPSEEK, {
      inputUsdPerMillion: 0.5,
      outputUsdPerMillion: 1.5,
      referenceInputUsdPerMillion: 0.66,
      referenceOutputUsdPerMillion: 1.98,
      discountPercent: 25,
      fetchedAt: Date.parse("2026-09-19T03:00:00.000Z"),
    });
    await runModelPricingTracker({
      db,
      now: new Date("2026-09-19T03:00:00.000Z"),
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      skipOfficialProviderRefresh: true,
    });

    seedAllTracked(Date.parse("2026-09-20T03:00:00.000Z"));
    seedCatalog(DEEPSEEK, {
      inputUsdPerMillion: 0.8,
      outputUsdPerMillion: 2.4,
      referenceInputUsdPerMillion: 0.66,
      referenceOutputUsdPerMillion: 1.98,
      discountPercent: 25,
      fetchedAt: Date.parse("2026-09-20T03:00:00.000Z"),
    });
    await runModelPricingTracker({
      db,
      now: FIXED_NOW,
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      skipOfficialProviderRefresh: true,
    });

    assert.equal(countAtoBRateEvents(db, DEEPSEEK, 0.8), 2);
  });

  it("R3: parser failure same-day retry dedupes to one price-event occurrence", async () => {
    const db = makeDb();
    ensureTrackerSchema(db);
    const startedAt = FIXED_NOW.toISOString();
    const parserEvent = classifyParserFailure({
      modelId: DEEPSEEK,
      sourceKind: "cheaper_inference_models",
      reason: "model_missing_from_ci_catalog",
      runDateKey: "2026-09-20",
    });

    const failedAttempt = claimTrackerRun(db, {
      runDateKey: "2026-09-20",
      phase: "OBSERVE_ONLY",
      startedAt,
    });
    assert.equal(insertClassifiedEvent(db, failedAttempt.attemptId, DEEPSEEK, parserEvent, null), true);
    finishTrackerRun(db, {
      attemptId: failedAttempt.attemptId,
      status: "failed",
      finishedAt: startedAt,
      errorSummary: "parser-then-failed",
    });

    clearCheaperInferenceCatalogPricingForTest();
    seedCatalog(GEMINI, {
      inputUsdPerMillion: 1.4,
      outputUsdPerMillion: 8.4,
      referenceInputUsdPerMillion: 2,
      referenceOutputUsdPerMillion: 12,
      discountPercent: 30,
    });
    seedCatalog("gemini-3.7-flash", {
      inputUsdPerMillion: 0.22,
      outputUsdPerMillion: 1.1,
      referenceInputUsdPerMillion: 0.375,
      referenceOutputUsdPerMillion: 1.875,
      discountPercent: 40,
    });
    seedCatalog("gpt-5.6-terra", {
      inputUsdPerMillion: 1.4,
      outputUsdPerMillion: 8.4,
      referenceInputUsdPerMillion: 2,
      referenceOutputUsdPerMillion: 12,
      discountPercent: 30,
    });

    const retry = await runModelPricingTracker({
      db,
      now: FIXED_NOW,
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      skipOfficialProviderRefresh: true,
    });
    assert.equal(retry.status, "completed");
    const deepseekParserEvents = (
      db
        .prepare(
          `SELECT COUNT(*) c FROM model_price_change_events
           WHERE event_type = 'PARSER_FAILURE' AND model_id = ?`
        )
        .get(DEEPSEEK) as { c: number }
    ).c;
    assert.equal(deepseekParserEvents, 1);
    assert.equal(retry.events.length, retry.eventCount);
  });

  it("R4: parser failure next day records a new occurrence", async () => {
    const db = makeDb();
    clearCheaperInferenceCatalogPricingForTest();

    const day1 = await runModelPricingTracker({
      db,
      now: new Date("2026-09-19T03:00:00.000Z"),
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      skipOfficialProviderRefresh: true,
    });
    assert.equal(day1.status, "completed");
    const day1Count = (
      db.prepare(`SELECT COUNT(*) c FROM model_price_change_events WHERE event_type = 'PARSER_FAILURE'`).get() as {
        c: number;
      }
    ).c;
    assert.ok(day1Count >= 1);

    clearCheaperInferenceCatalogPricingForTest();
    const day2 = await runModelPricingTracker({
      db,
      now: FIXED_NOW,
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      skipOfficialProviderRefresh: true,
    });
    assert.equal(day2.status, "completed");
    const day2Count = (
      db.prepare(`SELECT COUNT(*) c FROM model_price_change_events WHERE event_type = 'PARSER_FAILURE'`).get() as {
        c: number;
      }
    ).c;
    assert.ok(day2Count > day1Count);
  });

  it("R5: result.events.length equals result.eventCount equals persisted attempt rows", async () => {
    const db = makeDb();
    seedAllTracked(Date.parse("2026-09-18T03:00:00.000Z"));
    seedCatalog(DEEPSEEK, {
      inputUsdPerMillion: 0.5,
      outputUsdPerMillion: 1.5,
      referenceInputUsdPerMillion: 0.66,
      referenceOutputUsdPerMillion: 1.98,
      discountPercent: 25,
      fetchedAt: Date.parse("2026-09-18T03:00:00.000Z"),
    });
    await runModelPricingTracker({
      db,
      now: new Date("2026-09-18T03:00:00.000Z"),
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      skipOfficialProviderRefresh: true,
    });

    seedAllTracked(Date.parse("2026-09-20T03:00:00.000Z"));
    seedCatalog(DEEPSEEK, {
      inputUsdPerMillion: 0.8,
      outputUsdPerMillion: 2.4,
      referenceInputUsdPerMillion: 0.66,
      referenceOutputUsdPerMillion: 1.98,
      discountPercent: 25,
      fetchedAt: Date.parse("2026-09-20T03:00:00.000Z"),
    });

    const t1 = Date.parse("2026-09-20T03:00:00.000Z");
    const failedAttempt = claimTrackerRun(db, {
      runDateKey: "2026-09-20",
      phase: "OBSERVE_ONLY",
      startedAt: FIXED_NOW.toISOString(),
    });
    const policy = getModelPricingPolicy(DEEPSEEK)!;
    const prevCurrent = readLatestSnapshot(db, DEEPSEEK, "cheaper_inference_models_current");
    const ciCurrent = buildCiCurrentSnapshot({
      policy,
      catalog: seedCatalog(DEEPSEEK, {
        inputUsdPerMillion: 0.8,
        outputUsdPerMillion: 2.4,
        referenceInputUsdPerMillion: 0.66,
        referenceOutputUsdPerMillion: 1.98,
        discountPercent: 25,
        fetchedAt: t1,
      }),
      observedAt: new Date(t1).toISOString(),
    });
    insertPriceSnapshot(db, failedAttempt.attemptId, ciCurrent);
    for (const event of classifyCiCurrentChange({
      modelId: DEEPSEEK,
      previous: prevCurrent,
      current: ciCurrent,
    })) {
      insertClassifiedEvent(db, failedAttempt.attemptId, DEEPSEEK, event, getPublishedPricingVersion(DEEPSEEK));
    }
    finishTrackerRun(db, {
      attemptId: failedAttempt.attemptId,
      status: "failed",
      finishedAt: FIXED_NOW.toISOString(),
      errorSummary: "partial",
    });

    const t2 = Date.parse("2026-09-20T06:00:00.000Z");
    seedCatalog(DEEPSEEK, {
      inputUsdPerMillion: 0.8,
      outputUsdPerMillion: 2.4,
      referenceInputUsdPerMillion: 0.66,
      referenceOutputUsdPerMillion: 1.98,
      discountPercent: 25,
      fetchedAt: t2,
    });
    const retry = await runModelPricingTracker({
      db,
      now: FIXED_NOW,
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      skipOfficialProviderRefresh: true,
    });
    const persisted = (
      db
        .prepare(`SELECT COUNT(*) c FROM model_price_change_events WHERE attempt_id = ?`)
        .get(retry.attemptId) as { c: number }
    ).c;
    assert.equal(retry.events.length, retry.eventCount);
    assert.equal(retry.eventCount, persisted);
  });
});

function seedDeepSeekOfficialObserverCatalogs(): void {
  seedCatalog(DEEPSEEK, {
    inputUsdPerMillion: 0.66,
    outputUsdPerMillion: 1.98,
    referenceInputUsdPerMillion: 1.32,
    referenceOutputUsdPerMillion: 3.96,
    discountPercent: 50,
  });
  seedCatalog(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL, {
    inputUsdPerMillion: 0.15,
    outputUsdPerMillion: 0.6,
    referenceInputUsdPerMillion: 0.3,
    referenceOutputUsdPerMillion: 1.2,
    discountPercent: 50,
  });
}

describe("Phase B1 — DeepSeek official provider PEAK observer", () => {
  const TRACKER_SOURCE_KINDS: PriceSnapshotSourceKind[] = [
    "cheaper_inference_models_current",
    "cheaper_inference_models_reference",
    "published_billing_baseline",
    "official_provider_pricing",
  ];

  function officialRefreshFromFixture(html: string, observedAt = FIXED_NOW.toISOString()) {
    const normalized = normalizeDeepSeekOfficialPricingDocument({ html, observedAt });
    assert.equal(normalized.ok, true);
    return normalized;
  }

  it("architecture: official_provider_pricing source kind exists for same-domain PEAK corroboration", () => {
    assert.ok(TRACKER_SOURCE_KINDS.includes("official_provider_pricing"));
    const withoutOfficial = TRACKER_SOURCE_KINDS.filter((kind) => kind !== "official_provider_pricing");
    assert.deepEqual(withoutOfficial, [
      "cheaper_inference_models_current",
      "cheaper_inference_models_reference",
      "published_billing_baseline",
    ]);
  });

  it("P1 integration: official PEAK snapshot persisted alongside CI + published", async () => {
    const db = makeDb();
    seedDeepSeekOfficialObserverCatalogs();
    const official = officialRefreshFromFixture(DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P1);
    const result = await runModelPricingTracker({
      db,
      now: FIXED_NOW,
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      officialProviderRefreshResult: official,
    });
    assert.equal(result.status, "completed");
    const officialSnapshot = readLatestSnapshot(db, DEEPSEEK, "official_provider_pricing");
    assert.ok(officialSnapshot);
    assert.equal(officialSnapshot!.pricingMode, "provider_peak");
    assert.equal(officialSnapshot!.rates.inputUsdPerMillion, 1.32);
    assert.equal(officialSnapshot!.rates.outputUsdPerMillion, 3.96);
    assert.equal(officialSnapshot!.rates.cacheReadUsdPerMillion, 0.044);
    const v41Official = readLatestSnapshot(db, CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL, "official_provider_pricing");
    assert.ok(v41Official);
    assert.equal(v41Official!.pricingMode, "provider_peak");
    assert.equal(v41Official!.rates.inputUsdPerMillion, 0.3);
    assert.ok(
      result.events.every(
        (event) =>
          event.eventType !== "OFFICIAL_PROVIDER_PRICE_CHANGED" &&
          event.eventType !== "OFFICIAL_PROVIDER_BASELINE_MISMATCH"
      )
    );
    assert.equal(getPublishedPricing(DEEPSEEK).pricingVersion, 4);
    assert.equal(getPublishedPricing(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL).pricingVersion, 1);
  });

  it("P2 integration: official PEAK change emits HOLD without mutating published price", async () => {
    const db = makeDb();
    seedDeepSeekOfficialObserverCatalogs();
    const day1 = officialRefreshFromFixture(
      DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P1,
      "2026-09-19T03:00:00.000Z"
    );
    await runModelPricingTracker({
      db,
      now: new Date("2026-09-19T03:00:00.000Z"),
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      officialProviderRefreshResult: day1,
    });
    const day2 = officialRefreshFromFixture(
      DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P2,
      "2026-09-20T03:00:00.000Z"
    );
    const result = await runModelPricingTracker({
      db,
      now: FIXED_NOW,
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      officialProviderRefreshResult: day2,
    });
    assert.ok(result.events.some((event) => event.eventType === "OFFICIAL_PROVIDER_PRICE_CHANGED"));
    assert.equal(getPublishedPricing(DEEPSEEK).billingReferenceInputUsdPerMillion, 1.32);
  });

  it("failure isolation: CI OK + official fetch failure marks attempt FAILED with CI snapshots", async () => {
    const db = makeDb();
    seedDeepSeekOfficialObserverCatalogs();
    const result = await runModelPricingTracker({
      db,
      now: FIXED_NOW,
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      officialProviderRefreshResult: { ok: false, reason: "DeepSeek official pricing timeout" },
    });
    assert.equal(result.status, "failed");
    assert.ok(result.errors.some((error) => error.includes("deepseek_official_pricing")));
    assert.ok(countSnapshotsForAttempt(db, result.attemptId!) > 0);
    assert.equal(readLatestSnapshot(db, DEEPSEEK, "cheaper_inference_models_current"), null);
    assert.equal(readLatestSnapshot(db, DEEPSEEK, "official_provider_pricing"), null);
    assert.ok(result.events.some((event) => event.eventType === "PARSER_FAILURE"));
    const attempt = findTrackerAttemptById(db, result.attemptId!);
    assert.equal(attempt?.status, "failed");
  });

  it("same-day retry: failed official attempt reclaims and completes without duplicate transition", async () => {
    const db = makeDb();
    seedDeepSeekOfficialObserverCatalogs();
    const failed = await runModelPricingTracker({
      db,
      now: FIXED_NOW,
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      officialProviderRefreshResult: { ok: false, reason: "DeepSeek official pricing timeout" },
    });
    assert.equal(failed.status, "failed");
    assert.notEqual(failed.attemptId, null);
    assert.equal(readLatestSnapshot(db, DEEPSEEK, "official_provider_pricing"), null);

    const retry = await runModelPricingTracker({
      db,
      now: FIXED_NOW,
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
      officialProviderRefreshResult: officialRefreshFromFixture(DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P1),
    });
    assert.equal(retry.status, "completed");
    assert.notEqual(retry.attemptId, failed.attemptId);
    assert.ok(readLatestSnapshot(db, DEEPSEEK, "official_provider_pricing"));
    assert.ok(readLatestSnapshot(db, CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL, "official_provider_pricing"));
    assert.equal(
      retry.events.filter((event) => event.eventType === "OFFICIAL_PROVIDER_PRICE_CHANGED").length,
      0
    );
    assert.equal(
      retry.events.filter((event) => event.eventType === "OFFICIAL_PROVIDER_BASELINE_MISMATCH").length,
      0
    );
  });

  it("same-domain: official PEAK vs published mismatch emits OFFICIAL_PROVIDER_BASELINE_MISMATCH", () => {
    const policy = getModelPricingPolicy(DEEPSEEK)!;
    const published = buildPublishedBaselineSnapshot({
      policy,
      published: getPublishedPricing(DEEPSEEK),
      observedAt: FIXED_NOW.toISOString(),
    });
    const official = buildOfficialProviderPeakSnapshot({
      evidence: {
        provider: "deepseek",
        canonicalModelId: DEEPSEEK,
        providerModelIdentity: "deepseek-v4-pro",
        providerVersionLabel: "DeepSeek-V4-Pro-0813",
        pricingMode: "provider_peak",
        inputUsdPerMillion: 1.5,
        outputUsdPerMillion: 4.5,
        cacheReadUsdPerMillion: 0.05,
        cacheWriteUsdPerMillion: null,
        observedAt: FIXED_NOW.toISOString(),
        validFrom: null,
        validUntil: null,
        sourceUrl: "fixture",
        rawFingerprint: "fixture-official-peak-mismatch",
      },
    });
    const mismatch = classifyOfficialProviderBaselineMismatch({
      modelId: DEEPSEEK,
      officialPeak: official,
      publishedBaseline: published,
      runDateKey: "2026-09-20",
    });
    assert.ok(mismatch);
    assert.equal(mismatch!.eventType, "OFFICIAL_PROVIDER_BASELINE_MISMATCH");
    assert.equal(classifySourceConflict({
      modelId: DEEPSEEK,
      ciReference: official,
      publishedBaseline: published,
      runDateKey: "2026-09-20",
    }), null);
  });

});
