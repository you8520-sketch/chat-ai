import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  clearCheaperInferenceCatalogPricingForTest,
  updateCheaperInferenceCatalogPricing,
  type CheaperInferenceCatalogPricing,
} from "@/lib/cheaperInferenceCatalogPricing";
import {
  classifyCiCurrentChange,
  classifyCiReferenceChange,
  classifyParserFailure,
  classifySourceConflict,
} from "@/lib/modelPriceChangeClassifier";
import {
  buildCiCurrentSnapshot,
  buildCiReferenceSnapshot,
  buildPublishedBaselineSnapshot,
} from "@/lib/modelPriceSnapshot";
import { getModelPricingPolicy } from "@/lib/modelPricingPolicy";
import {
  CACHE_RATE_PROVENANCE_UNVERIFIED,
  CHEAPER_INFERENCE_MODELS_SOURCE_URL,
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

  it("G: CI reference vs published mismatch → SOURCE_CONFLICT hold", () => {
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
    });
    assert.ok(conflict);
    assert.equal(conflict.eventType, "SOURCE_CONFLICT");
    assert.equal(conflict.action, "HOLD");
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
    });
    assert.equal(first.status, "completed");
    assert.ok(first.attemptId != null);

    const second = await runModelPricingTracker({
      db,
      now: FIXED_NOW,
      phase: "OBSERVE_ONLY",
      skipCatalogRefresh: true,
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

    // No CI API key in the test env -> the live refresh fails (resilient cache
    // stays warm). Production path: no skipCatalogRefresh.
    const result = await runModelPricingTracker({
      db,
      now: FIXED_NOW,
      phase: "OBSERVE_ONLY",
    });

    assert.equal(result.status, "completed");
    assert.ok(result.errors.includes("ci_catalog_refresh_failed"));
    assert.ok(result.events.length === 0, "no CI price-change classification without a fresh source");
    // No CI snapshot (current or reference) from the stale cache.
    const ciSnapshots = db
      .prepare(
        `SELECT COUNT(*) c FROM model_price_snapshots s
         JOIN model_pricing_tracker_attempts a ON a.id = s.attempt_id
         WHERE s.source_kind IN ('cheaper_inference_models_current','cheaper_inference_models_reference')
           AND a.run_date_key = '2026-09-20'`
      )
      .get() as { c: number };
    assert.equal(ciSnapshots.c, 0);
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

    // A large CI move is still owned by the CI-unverified event; the large
    // change is surfaced only in the classification detail.
    const large = buildCiReferenceSnapshot({
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
