import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { parseAssets } from "@/lib/characterAssets";
import { getDb } from "@/lib/db";
import {
  approvedAssetReviewTemplate,
  approvedAssetStatus,
  knownVisionAttemptCostUsd,
  openApprovedAssetOperator,
  runApprovedAssetApply,
  runApprovedAssetIntake,
  runApprovedAssetModeration,
  runApprovedAssetReview,
  runApprovedAssetRollback,
  type ApprovedAssetOperatorTarget,
  type MeteredAttempt,
  type ModerationMeter,
  type ReviewEvidence,
} from "@/lib/officialSupply/approvedAssetApplyOperator";
import {
  ADMIN,
  APPROVED_PLAN_PATH,
  CANDIDATES,
  DOC,
  MANIFEST_PATH,
  REP,
  seedApprovedApplyUsers,
  stageApprovedWolfgangDraft,
  STRANGER,
  TEST_ONLY_MODERATION,
  TEST_ONLY_REVIEWER,
  TestPorts,
} from "@/lib/officialSupply/officialSupply.approvedApplyFixtures";
import { testBatchConfig, testStyleCandidate } from "@/lib/officialSupply/officialSupply.fixtures";
import { createVisionOfficialAssetModerator } from "@/lib/officialSupply/productionAdapters";
import { OfficialSupplyGateError, OfficialSupplyStore } from "@/lib/officialSupply/store";
import type { OfficialAssetModeration } from "@/lib/officialSupply/types";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";

/**
 * Isolated-DB run of the approved-asset operator over the real 14 manifest
 * files. Moderation results and the review evidence here are gate fixtures
 * for this temporary database only, not a quality approval.
 */
const DRAFT = "operator-wolfgang";
const BATCH = "operator-batch";
const ISOLATED_REVIEWER = "isolated-operator-proof";
const ISOLATED_EVIDENCE = "isolated DB wrapper proof only; production review uses its own evidence file";

let store: OfficialSupplyStore;
let ports: TestPorts;
let characterId = 0;
let target: ApprovedAssetOperatorTarget;
const originalFetch = globalThis.fetch;
const originalBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
const egressAttempts: string[] = [];
const tempDirs: string[] = [];

function expectGate(code: string) {
  return (error: unknown) => {
    assert.ok(error instanceof OfficialSupplyGateError, String(error));
    assert.equal(error.code, code, error.message);
    return true;
  };
}

function open(overrides: Partial<Parameters<typeof openApprovedAssetOperator>[0]> = {}) {
  return openApprovedAssetOperator({
    store,
    draftKey: DRAFT,
    characterId,
    adminEmail: ADMIN.email,
    manifestPath: MANIFEST_PATH,
    approvedPlanPath: APPROVED_PLAN_PATH,
    ...overrides,
  });
}

function dbState() {
  const db = store.database;
  return {
    character: db.prepare("SELECT assets, images, official, visibility, creator_id FROM characters WHERE id=?").get(characterId),
    supply: db.prepare("SELECT * FROM official_supply_characters WHERE draft_key=?").get(DRAFT),
    assets: db.prepare("SELECT * FROM official_supply_assets WHERE draft_key=? ORDER BY slot_key").all(DRAFT),
    replacements: db.prepare("SELECT * FROM official_supply_asset_replacements WHERE draft_key=? ORDER BY slot_key").all(DRAFT),
    applies: db.prepare("SELECT * FROM official_supply_replacement_applies WHERE draft_key=? ORDER BY apply_id").all(DRAFT),
  };
}

function tamperedManifest(mutate: (candidates: typeof CANDIDATES) => void): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "operator-manifest-"));
  tempDirs.push(dir);
  const candidates = CANDIDATES.map((c) => ({ ...c }));
  mutate(candidates);
  for (const candidate of CANDIDATES) fs.symlinkSync(path.join(DOC, candidate.file), path.join(dir, candidate.file));
  const manifestPath = path.join(dir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify({ candidates }));
  return manifestPath;
}

type Scripted = { attempts: MeteredAttempt[]; moderation: OfficialAssetModeration };

function scriptedMeter(script: Scripted[]): { meter: ModerationMeter; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    meter: {
      attemptsPerCall: 2,
      createModerator: (observe) => ({
        moderate: async (url) => {
          calls.push(url);
          const next = script.shift();
          if (!next) throw new Error("scripted moderation exhausted");
          observe(next.attempts);
          return next.moderation;
        },
      }),
    },
  };
}

const PRIMARY_OK: Scripted = { attempts: [{ costUsd: 0.0004 }], moderation: TEST_ONLY_MODERATION };
const FALLBACK_OK: Scripted = { attempts: [{ costUsd: null }, { costUsd: 0.0006 }], moderation: TEST_ONLY_MODERATION };

function evidence(overrides: Partial<ReviewEvidence> = {}): ReviewEvidence {
  const template = approvedAssetReviewTemplate(target);
  return {
    draftKey: DRAFT,
    characterId,
    isolatedProofOnly: true,
    reviewer: ISOLATED_REVIEWER,
    approvalEvidence: ISOLATED_EVIDENCE,
    slots: template.slots.map((slot) => ({
      slot: slot.slot,
      candidateUrl: slot.candidateUrl!,
      candidateSha256: slot.candidateSha256,
      qa: Object.fromEntries(Object.keys(slot.qa).map((key) => [key, { ok: true, note: `${slot.slot} ${key} isolated check` }])),
    })),
    ...overrides,
  };
}

const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));

before(async () => {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    egressAttempts.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    throw new Error("network egress is not allowed in operator tests");
  }) as typeof fetch;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  installIsolatedTestDatabase();
  const db = getDb();
  seedApprovedApplyUsers(db);
  store = new OfficialSupplyStore(db);
  ports = new TestPorts();
  store.createBatch(BATCH, testBatchConfig({ budgetUsd: { batch: 100 } }));
  store.proposeStyle({ styleKey: "romance_fantasy_v4", genre: "로맨스 판타지", candidates: ["c1", "c2", "c3"].map(testStyleCandidate) });
  store.approveStyleCandidate(
    "romance_fantasy_v4",
    "c2",
    { url: "/uploads/official-style-seed.webp", provenance: "platform_owned", note: "owned seed" },
    "owner"
  );
  characterId = await stageApprovedWolfgangDraft(store, DRAFT, BATCH);
});

after(() => {
  globalThis.fetch = originalFetch;
  if (originalBlobToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = originalBlobToken;
  uninstallIsolatedTestDatabase();
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(egressAttempts, [], "operator tests made network calls");
});

describe("approved asset operator (isolated DB)", () => {
  it("1. refuses a non-admin, another character and a manifest whose file SHA or tag differs", () => {
    assert.throws(() => open({ adminEmail: STRANGER.email }), expectGate("operator_admin_required"));
    assert.throws(() => open({ adminEmail: "nobody@test.local" }), expectGate("operator_admin_required"));
    assert.throws(() => open({ characterId: characterId + 1 }), expectGate("operator_target_mismatch"));
    const shaChanged = tamperedManifest((c) => {
      c[1]!.rawSha256 = REP.rawSha256;
    });
    assert.throws(() => open({ manifestPath: shaChanged }), expectGate("operator_manifest_sha"));
    const tagChanged = tamperedManifest((c) => {
      c.find((x) => x.slot === "emo5")!.tag = "진지함";
    });
    assert.throws(() => open({ manifestPath: tagChanged }), expectGate("operator_manifest_tag"));
    target = open();
    assert.equal(target.candidates.length, 14);
  });

  it("2. status, intake, moderation, review and apply write nothing without --execute", async () => {
    const before = dbState();
    const status = approvedAssetStatus(target);
    assert.equal(status.writes, 0);
    assert.equal(status.stage, "staged_private");
    assert.deepEqual(new Set(status.slots.map((s) => s.next)), new Set(["intake"]));
    const intake = await runApprovedAssetIntake(target, ports, false);
    assert.equal(intake.planned.length, 14);
    assert.deepEqual(intake.registered, []);
    const { meter, calls } = scriptedMeter([]);
    const plan = await runApprovedAssetModeration(target, meter, null, false);
    assert.equal(plan.status, "planned");
    assert.deepEqual(plan.plan.pending, []);
    assert.throws(() => runApprovedAssetApply(target, false), expectGate("operator_apply_not_ready"));
    assert.deepEqual(dbState(), before);
    assert.deepEqual(ports.storedFiles, []);
    assert.deepEqual(calls, []);
  });

  it("3. intake stores each manifest file once and a rerun skips completed slots", async () => {
    const first = await runApprovedAssetIntake(target, ports, true);
    assert.equal(first.registered.length, 14);
    for (const row of first.registered) {
      assert.equal(row.candidateSha256, CANDIDATES.find((c) => c.slot === row.slot)!.rawSha256);
    }
    const again = await runApprovedAssetIntake(target, ports, true);
    assert.deepEqual(again.registered, []);
    assert.deepEqual(new Set(again.skipped.map((s) => s.next)), new Set(["moderate"]));
    assert.equal(ports.storedFiles.length, 14);
  });

  it("4. paid moderation needs explicit caps, refuses caps below the worst case and counts fallback attempts", async () => {
    const before = dbState();
    const idle = scriptedMeter([]);
    const plan = await runApprovedAssetModeration(target, idle.meter, { maxCalls: 28, maxCostUsd: 0.28, perCallReserveUsd: 0.01 }, false);
    assert.deepEqual(plan.plan, {
      pending: CANDIDATES.map((c) => c.slot),
      attemptsPerCall: 2,
      worstCaseCalls: 28,
      worstCaseCostUsd: 0.28,
    });
    await assert.rejects(() => runApprovedAssetModeration(target, idle.meter, null, true), expectGate("operator_moderation_budget_required"));
    await assert.rejects(
      () => runApprovedAssetModeration(target, idle.meter, { maxCalls: 27, maxCostUsd: 1, perCallReserveUsd: 0.01 }, true),
      expectGate("operator_moderation_budget_exceeded")
    );
    await assert.rejects(
      () => runApprovedAssetModeration(target, idle.meter, { maxCalls: 28, maxCostUsd: 0.27, perCallReserveUsd: 0.01 }, true),
      expectGate("operator_moderation_budget_exceeded")
    );
    assert.deepEqual(idle.calls, []);
    assert.deepEqual(dbState(), before);

    const overReserve = scriptedMeter([{ attempts: [{ costUsd: 0.02 }], moderation: TEST_ONLY_MODERATION }]);
    const reserveStop = await runApprovedAssetModeration(
      target,
      overReserve.meter,
      { maxCalls: 28, maxCostUsd: 0.28, perCallReserveUsd: 0.01 },
      true
    );
    assert.equal(reserveStop.status, "stopped");
    assert.match(reserveStop.stopReason!, /rep attempt cost exceeded the per-call reserve/);
    assert.deepEqual(reserveStop.accounting, { chargedCalls: 2, observedAttempts: 1, chargedCostUsd: 0.03, knownCostUsd: 0.02 });

    const unavailable: Scripted = {
      attempts: [{ costUsd: null }, { costUsd: null }],
      moderation: { status: "unavailable", reason: "asset vision moderation unavailable" },
    };
    const secondRun = scriptedMeter([PRIMARY_OK, FALLBACK_OK, unavailable]);
    const stopped = await runApprovedAssetModeration(
      target,
      secondRun.meter,
      { maxCalls: 26, maxCostUsd: 0.26, perCallReserveUsd: 0.01 },
      true
    );
    assert.equal(stopped.status, "stopped");
    assert.match(stopped.stopReason!, /sig3 moderation unavailable/);
    assert.deepEqual(stopped.plan.pending.slice(0, 3), ["sig1", "sig2", "sig3"]);
    assert.deepEqual(stopped.results.map((r) => r.verdict), ["clean", "clean", "unavailable"]);
    assert.deepEqual(stopped.accounting, { chargedCalls: 6, observedAttempts: 5, chargedCostUsd: 0.041, knownCostUsd: 0.001 });

    const rest = Array.from({ length: 11 }, (_, i) => (i % 2 === 0 ? FALLBACK_OK : PRIMARY_OK));
    const resumed = scriptedMeter(rest);
    const completed = await runApprovedAssetModeration(
      target,
      resumed.meter,
      { maxCalls: 22, maxCostUsd: 0.22, perCallReserveUsd: 0.01 },
      true
    );
    assert.equal(completed.status, "completed");
    assert.equal(completed.plan.pending[0], "sig3");
    assert.equal(completed.plan.pending.length, 11);
    assert.deepEqual(completed.accounting, { chargedCalls: 22, observedAttempts: 17, chargedCostUsd: 0.1156, knownCostUsd: 0.0056 });
    assert.equal(resumed.calls.length, 11);
    assert.ok(completed.results.every((r) => r.verdict === "clean"));

    const done = scriptedMeter([]);
    const noop = await runApprovedAssetModeration(target, done.meter, { maxCalls: 1, maxCostUsd: 0.01, perCallReserveUsd: 0.01 }, true);
    assert.equal(noop.status, "completed");
    assert.deepEqual(done.calls, []);
    assert.deepEqual(new Set(approvedAssetStatus(target).slots.map((s) => s.next)), new Set(["review"]));
  });

  it("4b. only provider-billed vision attempts count as known cost", () => {
    assert.equal(knownVisionAttemptCostUsd({ model: "m", usageEstimated: true, upstreamCostUsd: 0.5, outcome: "success" }), null);
    assert.equal(
      knownVisionAttemptCostUsd({
        model: "m",
        usageEstimated: false,
        upstreamCostUsd: 0.5,
        cheaperInferenceBilledCostUsd: 0.2,
        outcome: "success",
      }),
      0.2
    );
    assert.equal(knownVisionAttemptCostUsd({ model: "m", usageEstimated: false, outcome: "failed_with_usage" }), null);
  });

  it("4c. the production vision moderator reports every call's attempts to the meter", async () => {
    const observed: unknown[] = [];
    const moderator = createVisionOfficialAssetModerator((attempts) => observed.push(attempts));
    const result = await moderator.moderate(CANDIDATES[0]!.file);
    assert.deepEqual(result, { status: "unavailable", reason: "asset vision moderation unavailable" });
    assert.deepEqual(observed, [[]]);
    assert.deepEqual(egressAttempts, []);
  });

  it("5. review evidence is bound to the stored URL and SHA; fixtures, isolated proof in production and gaps are refused", () => {
    const template = approvedAssetReviewTemplate(target);
    assert.equal(template.slots.length, 14);
    assert.ok(template.slots.every((slot) => Object.values(slot.qa).every((check) => check.ok === null)));
    const review = (value: unknown, production = false, execute = false) =>
      runApprovedAssetReview(target, bytes(value), { execute, productionDatabase: production });
    const refused = (value: unknown, production = false) =>
      assert.throws(() => review(value, production), expectGate("operator_review_evidence"));

    refused(template);
    refused(evidence({ reviewer: TEST_ONLY_REVIEWER }));
    refused(evidence(), true);
    const valid = evidence();
    refused({ ...valid, slots: [{ ...valid.slots[1]!, candidateUrl: valid.slots[2]!.candidateUrl }] });
    refused({ ...valid, slots: [{ ...valid.slots[1]!, candidateSha256: REP.rawSha256 }] });
    refused({
      ...valid,
      slots: [{ ...valid.slots[1]!, qa: { ...valid.slots[1]!.qa, artStyle: { ok: true, note: "" } } }],
    });
    refused({ ...valid, slots: [{ ...valid.slots[1]!, qa: { ...valid.slots[1]!.qa, face: { ok: true, note: "x" } } }] });

    const before = dbState();
    const dry = review(valid);
    assert.equal(dry.planned.length, 14);
    assert.deepEqual(dry.recorded, []);
    assert.deepEqual(dbState(), before);

    const recorded = review(valid, false, true);
    assert.equal(recorded.recorded.length, 14);
    assert.ok(recorded.recorded.every((r) => r.approved));
    assert.equal(store.getReplacement(DRAFT, "rep").reviewedBy, ISOLATED_REVIEWER);
    assert.match(recorded.evidenceSha256, /^[0-9a-f]{64}$/);
    const again = review(valid, false, true);
    assert.deepEqual(again.recorded, []);
    assert.equal(again.alreadyReviewed.length, 14);
  });

  it("6. apply defaults to a dry run, records an applyId once, and rollback restores the previous state", () => {
    const before = dbState();
    const dry = runApprovedAssetApply(target, false);
    assert.equal(dry.status, "dry_run");
    assert.equal(dry.applyId, null);
    assert.deepEqual(dbState(), before);

    const applied = runApprovedAssetApply(target, true);
    assert.equal(applied.status, "applied");
    assert.ok(applied.applyId);
    const assets = parseAssets((dbState().character as { assets: string }).assets);
    assert.equal(assets[0]!.url, store.getReplacement(DRAFT, "rep").candidateResultUrl);
    assert.equal(assets[0]!.tag, "기본 초상");
    assert.deepEqual(new Set(approvedAssetStatus(target).slots.map((s) => s.next)), new Set(["applied"]));

    const repeat = runApprovedAssetApply(target, true);
    assert.equal(repeat.status, "already_applied");
    assert.equal(repeat.applyId, applied.applyId);
    assert.equal(approvedAssetStatus(target).applies.length, 1);

    const appliedState = dbState();
    const dryRollback = runApprovedAssetRollback(target, applied.applyId!, false);
    assert.equal(dryRollback.status, "dry_run");
    assert.deepEqual(dbState(), appliedState);

    const rolledBack = runApprovedAssetRollback(target, applied.applyId!, true);
    assert.equal(rolledBack.status, "rolled_back");
    const restored = dbState();
    assert.deepEqual(restored.character, before.character);
    assert.deepEqual(restored.supply, before.supply);
    assert.deepEqual(new Set(approvedAssetStatus(target).slots.map((s) => s.next)), new Set(["apply"]));
    assert.deepEqual(approvedAssetStatus(target).applies.map((row) => row.status), ["rolled_back"]);
    assert.deepEqual(egressAttempts, []);
  });
});
