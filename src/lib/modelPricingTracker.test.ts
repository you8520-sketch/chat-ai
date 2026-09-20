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
import { ensureModelPricingTrackingSchema } from "@/lib/modelPricingTrackingSchema";
import { runModelPricingTracker } from "@/lib/modelPricingTracker";
import {
  findTrackerRunByDateKey,
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
      phase: "OBSERVE_ONLY",
    });
    assert.ok(events.some((e) => e.eventType === "PROVIDER_NORMAL_BASELINE_CHANGED"));
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
    assert.ok(first.runId != null);

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
      .prepare(`SELECT COUNT(*) AS c FROM model_price_change_events WHERE run_id = ?`)
      .get(first.runId) as { c: number };
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
