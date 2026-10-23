import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { getDb } from "@/lib/db";
import {
  approvedAssetStatus,
  openApprovedAssetOperator,
  runApprovedAssetReview,
  type ApprovedAssetOperatorTarget,
  type ReviewEvidence,
} from "@/lib/officialSupply/approvedAssetApplyOperator";
import {
  ADMIN,
  anchorQa,
  compositionCheck,
  APPROVED_PLAN,
  APPROVED_PLAN_PATH,
  CANDIDATES,
  candidateBytes,
  MANIFEST_PATH,
  REP,
  seedApprovedApplyUsers,
  stageApprovedWolfgangDraft,
  STRANGER,
  TEST_ONLY_MODERATION,
  TestPorts,
  variationQa,
} from "@/lib/officialSupply/officialSupply.approvedApplyFixtures";
import { testBatchConfig, testStyleCandidate } from "@/lib/officialSupply/officialSupply.fixtures";
import {
  applyApprovedOfficialAssetReplacements,
  registerExternalOfficialAssetReplacement,
  type OfficialRepresentativeApplySet,
} from "@/lib/officialSupply/replacement";
import { moderateOfficialAssetReplacement } from "@/lib/officialSupply/runner";
import { OfficialSupplyGateError, OfficialSupplyStore } from "@/lib/officialSupply/store";
import type { OfficialAnchorQaReport, OfficialAssetModeration } from "@/lib/officialSupply/types";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";

/**
 * Isolated-DB verification of the explicit re-review of a rejected
 * representative candidate. The QA, reviewer and correction texts below are
 * gate fixtures for the temporary database only; they are not an
 * image-quality approval of any file.
 */
const BATCH = "rereview-batch";
const REVIEWER = "rereview-isolated-gate-reviewer";
const CORRECTION = {
  reason: "isolated gate: earlier identifyingFeatures judgement counted an unverifiable feature as a mismatch",
  evidence: "isolated gate: re-read of the same file, no clearly observable mismatch",
};
const REPRESENTATIVE_SET: OfficialRepresentativeApplySet = {
  nextAssetPlan: APPROVED_PLAN,
  generationReference: "representative_identity_and_style",
};

let store: OfficialSupplyStore;
let ports: TestPorts;
const originalFetch = globalThis.fetch;
const originalBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
const egressAttempts: string[] = [];
let draftCounter = 0;

const failingQa = (): OfficialAnchorQaReport =>
  anchorQa({ identifyingFeatures: { ok: false, note: "isolated gate: earlier failing judgement" } });
const passingQa = (): OfficialAnchorQaReport =>
  anchorQa({ identifyingFeatures: { ok: true, note: "isolated gate: no clearly observable mismatch" } });

/** Adds the comparison basis a representative review must carry to a QA that records a composition answer. */
function withEvidence(qa: OfficialAnchorQaReport, url: string, sha: string): OfficialAnchorQaReport {
  const check = qa.compositionIndependence;
  if (typeof check?.ok !== "boolean") return qa;
  return { ...qa, compositionIndependence: { ...compositionCheck(url, sha), ...check } };
}

function expectGate(code: string) {
  return (error: unknown) => {
    assert.ok(error instanceof OfficialSupplyGateError, String(error));
    assert.equal(error.code, code, error.message);
    return true;
  };
}

function withoutUpdatedAt(row: unknown): Record<string, unknown> {
  const { updated_at: _updatedAt, ...rest } = (row ?? {}) as Record<string, unknown>;
  return rest;
}

function repRow(draftKey: string) {
  return store.database
    .prepare("SELECT * FROM official_supply_asset_replacements WHERE draft_key=? AND slot_key='rep'")
    .get(draftKey) as Record<string, unknown>;
}

function state(draftKey: string, characterId: number) {
  const db = store.database;
  return {
    character: withoutUpdatedAt(db.prepare("SELECT * FROM characters WHERE id=?").get(characterId)),
    supply: withoutUpdatedAt(db.prepare("SELECT * FROM official_supply_characters WHERE draft_key=?").get(draftKey)),
    assets: db
      .prepare("SELECT * FROM official_supply_assets WHERE draft_key=? ORDER BY slot_key")
      .all(draftKey)
      .map(withoutUpdatedAt),
    otherReplacements: db
      .prepare("SELECT * FROM official_supply_asset_replacements WHERE draft_key=? AND slot_key<>'rep' ORDER BY slot_key")
      .all(draftKey)
      .map(withoutUpdatedAt),
    applies: db.prepare("SELECT * FROM official_supply_replacement_applies WHERE draft_key=?").all(draftKey),
  };
}

async function stage(): Promise<{ draftKey: string; characterId: number }> {
  const draftKey = `rereview-draft-${++draftCounter}`;
  const batchKey = `${BATCH}-${draftCounter}`;
  store.createBatch(batchKey, testBatchConfig({ budgetUsd: { batch: 100 } }));
  const characterId = await stageApprovedWolfgangDraft(store, draftKey, batchKey);
  return { draftKey, characterId };
}

async function register(draftKey: string, slot: string) {
  const candidate = CANDIDATES.find((c) => c.slot === slot)!;
  const registered = await registerExternalOfficialAssetReplacement({
    store,
    storage: ports.storage,
    imageOps: ports.imageOps,
    actor: ADMIN,
    draftKey,
    slotKey: slot,
    bytes: candidateBytes(candidate),
    approvedTag: candidate.tag,
  });
  return { candidate, url: registered.candidateResultUrl! };
}

async function moderate(draftKey: string, slot: string, moderation: OfficialAssetModeration = TEST_ONLY_MODERATION) {
  ports.nextModeration.push(moderation);
  await moderateOfficialAssetReplacement({ store, moderator: ports.moderator }, draftKey, slot);
}

function reviewRep(draftKey: string, url: string, qa: OfficialAnchorQaReport) {
  return store.reviewRepresentativeReplacement(
    ADMIN,
    draftKey,
    withEvidence(qa, url, REP.rawSha256),
    { candidateUrl: url, candidateSha256: REP.rawSha256 },
    REVIEWER
  );
}

function rereview(
  draftKey: string,
  url: string,
  qa: OfficialAnchorQaReport,
  options: { actor?: typeof ADMIN | typeof STRANGER; sha?: string; correction?: { reason: string; evidence: string } } = {}
) {
  return store.rereviewRepresentativeReplacement(
    options.actor ?? ADMIN,
    draftKey,
    withEvidence(qa, url, options.sha ?? REP.rawSha256),
    { candidateUrl: url, candidateSha256: options.sha ?? REP.rawSha256 },
    REVIEWER,
    options.correction ?? CORRECTION
  );
}

async function rejectedRepresentative() {
  const staged = await stage();
  const { url } = await register(staged.draftKey, "rep");
  await moderate(staged.draftKey, "rep");
  assert.equal(reviewRep(staged.draftKey, url, failingQa()).approved, false);
  assert.equal(repRow(staged.draftKey).status, "rejected");
  return { ...staged, url };
}

function tamper<T>(sql: string, params: unknown[], restoreSql: string, restoreParams: unknown[], body: () => T): T {
  store.database.prepare(sql).run(...params);
  try {
    return body();
  } finally {
    store.database.prepare(restoreSql).run(...restoreParams);
  }
}

before(() => {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    egressAttempts.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    throw new Error("network egress is not allowed in re-review tests");
  }) as typeof fetch;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  installIsolatedTestDatabase();
  const db = getDb();
  seedApprovedApplyUsers(db);
  store = new OfficialSupplyStore(db);
  ports = new TestPorts();
  store.proposeStyle({ styleKey: "romance_fantasy_v4", genre: "로맨스 판타지", candidates: ["c1", "c2", "c3"].map(testStyleCandidate) });
  store.approveStyleCandidate(
    "romance_fantasy_v4",
    "c2",
    { url: "/uploads/official-style-seed.webp", provenance: "platform_owned", note: "owned seed" },
    "owner"
  );
});

after(() => {
  globalThis.fetch = originalFetch;
  if (originalBlobToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = originalBlobToken;
  uninstallIsolatedTestDatabase();
  assert.deepEqual(egressAttempts, [], "re-review tests made network calls");
});

describe("explicit re-review of a rejected representative (isolated DB)", () => {
  it("0. an externally registered representative needs a composition-independence answer; a failed one rejects it", async () => {
    const staged = await stage();
    const { url } = await register(staged.draftKey, "rep");
    await moderate(staged.draftKey, "rep");
    const { compositionIndependence: _omitted, ...legacyQa } = passingQa();
    assert.throws(
      () => reviewRep(staged.draftKey, url, legacyQa as OfficialAnchorQaReport),
      expectGate("composition_review_required")
    );
    assert.equal(repRow(staged.draftKey).status, "generated");
    const rawReview = (qa: OfficialAnchorQaReport) =>
      store.reviewRepresentativeReplacement(ADMIN, staged.draftKey, qa, { candidateUrl: url, candidateSha256: REP.rawSha256 }, REVIEWER);
    assert.throws(() => rawReview(anchorQa()), expectGate("composition_evidence_required"));
    assert.throws(
      () => rawReview(anchorQa({ compositionIndependence: compositionCheck(url, "9".repeat(64)) })),
      expectGate("composition_evidence_mismatch")
    );
    assert.throws(
      () => rawReview(anchorQa({ compositionIndependence: compositionCheck("/uploads/other.webp", REP.rawSha256) })),
      expectGate("composition_evidence_mismatch")
    );
    assert.throws(
      () => rawReview(anchorQa({ compositionIndependence: { ...compositionCheck(url, REP.rawSha256), evidence: { candidateUrl: url, candidateSha256: REP.rawSha256, references: [] } } })),
      expectGate("composition_evidence_required")
    );
    assert.equal(repRow(staged.draftKey).status, "generated");
    const cloned = anchorQa({ compositionIndependence: { ok: false, note: "isolated gate: head angle and gaze copy a reference" } });
    assert.equal(reviewRep(staged.draftKey, url, cloned).approved, false);
    assert.equal(repRow(staged.draftKey).status, "rejected");
  });

  it("1. the default review keeps blocking a rejected candidate", async () => {
    const { draftKey, url } = await rejectedRepresentative();
    assert.throws(() => reviewRep(draftKey, url, passingQa()), expectGate("replacement_not_generated"));
    assert.equal(repRow(draftKey).status, "rejected");
    assert.equal(store.listReplacementRereviews(draftKey).length, 0);
  });

  it("2. the same candidate is re-reviewed; file, URL, SHA and moderation stay, old and new records are both kept", async () => {
    const { draftKey, characterId, url } = await rejectedRepresentative();
    const storedFilesBefore = [...ports.storedFiles];
    const moderatedBefore = [...ports.moderatedUrls];
    const before = repRow(draftKey);
    const characterBefore = state(draftKey, characterId);

    const result = rereview(draftKey, url, passingQa());
    assert.equal(result.approved, true);

    const after = repRow(draftKey);
    assert.equal(after.status, "approved");
    for (const column of [
      "candidate_result_url",
      "candidate_sha256",
      "base_result_url",
      "appearance_lock_hash",
      "moderation_json",
      "approved_tag",
    ]) {
      assert.equal(after[column], before[column], column);
    }
    assert.equal(after.reviewed_by, REVIEWER);
    assert.equal(after.reviewed_text_lock_hash, store.getCharacter(draftKey).textLockHash);
    assert.deepEqual(JSON.parse(after.qa_json as string), withEvidence(passingQa(), url, REP.rawSha256));

    const history = store.listReplacementRereviews(draftKey);
    assert.equal(history.length, 1);
    const [entry] = history;
    assert.equal(entry!.id, result.rereviewId);
    assert.equal(entry!.previousStatus, "rejected");
    assert.deepEqual(entry!.previousQa, withEvidence(failingQa(), url, REP.rawSha256));
    assert.equal(entry!.previousReviewedBy, null);
    assert.equal(entry!.newStatus, "approved");
    assert.deepEqual(entry!.newQa, withEvidence(passingQa(), url, REP.rawSha256));
    assert.equal(entry!.reviewer, REVIEWER);
    assert.equal(entry!.correctionReason, CORRECTION.reason);
    assert.equal(entry!.correctionEvidence, CORRECTION.evidence);
    assert.equal(entry!.candidateResultUrl, url);
    assert.equal(entry!.candidateSha256, REP.rawSha256);
    assert.equal(entry!.baseResultUrl, before.base_result_url);
    assert.equal(entry!.actorId, ADMIN.id);

    const characterAfter = state(draftKey, characterId);
    assert.deepEqual(characterAfter, characterBefore, "live character, supply, assets and other slots changed");
    assert.deepEqual(ports.storedFiles, storedFilesBefore);
    assert.deepEqual(ports.moderatedUrls, moderatedBefore);
  });

  it("3. a new QA that still has a failing item keeps the candidate rejected and is recorded; a later correction can still pass", async () => {
    const { draftKey, url } = await rejectedRepresentative();
    const stillFailing = anchorQa({ identifyingFeatures: { ok: false, note: "isolated gate: scar position clearly differs" } });
    assert.equal(rereview(draftKey, url, stillFailing).approved, false);
    assert.equal(repRow(draftKey).status, "rejected");
    assert.equal(repRow(draftKey).reviewed_by, null);

    const otherItem = anchorQa({ face: { ok: false, note: "isolated gate: face differs" } });
    assert.equal(rereview(draftKey, url, otherItem).approved, false);
    assert.equal(repRow(draftKey).status, "rejected");

    assert.equal(rereview(draftKey, url, passingQa()).approved, true);
    assert.equal(repRow(draftKey).status, "approved");
    const history = store.listReplacementRereviews(draftKey);
    assert.deepEqual(history.map((h) => [h.previousStatus, h.newStatus]), [
      ["rejected", "rejected"],
      ["rejected", "rejected"],
      ["rejected", "approved"],
    ]);
    assert.deepEqual(history[0]!.previousQa, withEvidence(failingQa(), url, REP.rawSha256));
    assert.deepEqual(history[1]!.previousQa, withEvidence(stillFailing, url, REP.rawSha256));
    assert.deepEqual(history[2]!.previousQa, withEvidence(otherItem, url, REP.rawSha256));
  });

  it("4. an incomplete QA (a missing key) cannot approve", async () => {
    const { draftKey, url } = await rejectedRepresentative();
    const { cardCrop: _cardCrop, ...incomplete } = passingQa();
    assert.throws(() => rereview(draftKey, url, incomplete as OfficialAnchorQaReport), expectGate("qa_incomplete"));
    assert.equal(repRow(draftKey).status, "rejected");
  });

  it("5. a missing correction reason or evidence, reviewer, or non-admin actor is refused", async () => {
    const { draftKey, url } = await rejectedRepresentative();
    const before = repRow(draftKey);
    assert.throws(
      () => rereview(draftKey, url, passingQa(), { correction: { reason: " ", evidence: CORRECTION.evidence } }),
      expectGate("rereview_correction_required")
    );
    assert.throws(
      () => rereview(draftKey, url, passingQa(), { correction: { reason: CORRECTION.reason, evidence: "" } }),
      expectGate("rereview_correction_required")
    );
    assert.throws(
      () =>
        store.rereviewRepresentativeReplacement(
          ADMIN,
          draftKey,
          passingQa(),
          { candidateUrl: url, candidateSha256: REP.rawSha256 },
          "  ",
          CORRECTION
        ),
      expectGate("reviewer_required")
    );
    assert.throws(() => rereview(draftKey, url, passingQa(), { actor: STRANGER }), expectGate("replacement_forbidden"));
    assert.deepEqual(repRow(draftKey), before);
    assert.equal(store.listReplacementRereviews(draftKey).length, 0);
  });

  it("6. another URL, another SHA, another base URL, another Lock or a changed Text Lock are refused", async () => {
    const { draftKey, url } = await rejectedRepresentative();
    const before = repRow(draftKey);
    assert.throws(() => rereview(draftKey, `${url}.other`, passingQa()), expectGate("replacement_review_stale"));
    assert.throws(() => rereview(draftKey, "  ", passingQa()), expectGate("replacement_review_stale"));
    assert.throws(
      () => rereview(draftKey, url, passingQa(), { sha: CANDIDATES.find((c) => c.slot !== "rep")!.rawSha256 }),
      expectGate("replacement_review_stale")
    );

    const activeUrl = store.getAsset(draftKey, "rep").resultUrl!;
    tamper(
      "UPDATE official_supply_assets SET result_url=? WHERE draft_key=? AND slot_key='rep'",
      ["/uploads/another-base.webp", draftKey],
      "UPDATE official_supply_assets SET result_url=? WHERE draft_key=? AND slot_key='rep'",
      [activeUrl, draftKey],
      () => assert.throws(() => rereview(draftKey, url, passingQa()), expectGate("replacement_base_stale"))
    );

    tamper(
      "UPDATE official_supply_asset_replacements SET appearance_lock_hash=? WHERE draft_key=? AND slot_key='rep'",
      ["0".repeat(64), draftKey],
      "UPDATE official_supply_asset_replacements SET appearance_lock_hash=? WHERE draft_key=? AND slot_key='rep'",
      [before.appearance_lock_hash, draftKey],
      () => assert.throws(() => rereview(draftKey, url, passingQa()), expectGate("appearance_lock_stale"))
    );

    tamper(
      "UPDATE official_supply_characters SET appearance_lock_hash=? WHERE draft_key=?",
      ["1".repeat(64), draftKey],
      "UPDATE official_supply_characters SET appearance_lock_hash=? WHERE draft_key=?",
      [store.getCharacter(draftKey).appearanceLockHash, draftKey],
      () => assert.throws(() => rereview(draftKey, url, passingQa()), expectGate("appearance_lock_stale"))
    );

    tamper(
      "UPDATE official_supply_asset_replacements SET reviewed_text_lock_hash=? WHERE draft_key=? AND slot_key='rep'",
      ["2".repeat(64), draftKey],
      "UPDATE official_supply_asset_replacements SET reviewed_text_lock_hash=? WHERE draft_key=? AND slot_key='rep'",
      [before.reviewed_text_lock_hash, draftKey],
      () => assert.throws(() => rereview(draftKey, url, passingQa()), expectGate("replacement_review_stale"))
    );

    tamper(
      "UPDATE official_supply_characters SET text_lock_hash=? WHERE draft_key=?",
      ["3".repeat(64), draftKey],
      "UPDATE official_supply_characters SET text_lock_hash=? WHERE draft_key=?",
      [store.getCharacter(draftKey).textLockHash, draftKey],
      () => assert.throws(() => rereview(draftKey, url, passingQa()), expectGate("text_lock_stale"))
    );

    assert.deepEqual(repRow(draftKey), before);
    assert.equal(store.listReplacementRereviews(draftKey).length, 0);
  });

  it("7. moderation rejected, missing or unavailable cannot be re-reviewed", async () => {
    const { draftKey, url } = await rejectedRepresentative();
    const original = repRow(draftKey).moderation_json;
    const setModeration = (value: string | null) =>
      store.database
        .prepare("UPDATE official_supply_asset_replacements SET moderation_json=? WHERE draft_key=? AND slot_key='rep'")
        .run(value, draftKey);
    try {
      setModeration(JSON.stringify({ ...TEST_ONLY_MODERATION, moderationReject: true }));
      assert.throws(() => rereview(draftKey, url, passingQa()), expectGate("rereview_moderation_rejected"));
      setModeration(null);
      assert.throws(() => rereview(draftKey, url, passingQa()), expectGate("moderation_missing"));
      setModeration(JSON.stringify({ status: "unavailable", reason: "isolated gate" }));
      assert.throws(() => rereview(draftKey, url, passingQa()), expectGate("moderation_unavailable"));
    } finally {
      setModeration(original as string);
    }
    assert.equal(repRow(draftKey).status, "rejected");
    assert.equal(store.listReplacementRereviews(draftKey).length, 0);
  });

  it("8. generated, approved and applied candidates and a non-staged_private character are not re-reviewable", async () => {
    const staged = await stage();
    const { url } = await register(staged.draftKey, "rep");
    await moderate(staged.draftKey, "rep");
    assert.throws(() => rereview(staged.draftKey, url, passingQa()), expectGate("replacement_not_rejected"));

    assert.equal(reviewRep(staged.draftKey, url, passingQa()).approved, true);
    assert.throws(() => rereview(staged.draftKey, url, passingQa()), expectGate("replacement_not_rejected"));

    const appliedRow = store.database
      .prepare("UPDATE official_supply_asset_replacements SET status='applied' WHERE draft_key=? AND slot_key='rep'")
      .run(staged.draftKey);
    assert.equal(appliedRow.changes, 1);
    assert.throws(() => rereview(staged.draftKey, url, passingQa()), expectGate("replacement_not_rejected"));

    const rejected = await rejectedRepresentative();
    store.database.prepare("UPDATE official_supply_characters SET stage='qa_passed' WHERE draft_key=?").run(rejected.draftKey);
    assert.throws(() => rereview(rejected.draftKey, rejected.url, passingQa()), OfficialSupplyGateError);
    assert.equal(repRow(rejected.draftKey).status, "rejected");
    assert.equal(store.listReplacementRereviews(rejected.draftKey).length, 0);
  });

  it("9. a failure of the history write rolls the status change back", async () => {
    const { draftKey, url } = await rejectedRepresentative();
    const before = repRow(draftKey);
    store.database.exec(
      `CREATE TEMP TRIGGER rereview_fail_history BEFORE INSERT ON official_supply_replacement_rereviews
       BEGIN SELECT RAISE(ABORT, 'injected history failure'); END;`
    );
    try {
      assert.throws(() => rereview(draftKey, url, passingQa()), /injected history failure/);
    } finally {
      store.database.exec("DROP TRIGGER rereview_fail_history");
    }
    assert.deepEqual(repRow(draftKey), before);
    assert.equal(store.listReplacementRereviews(draftKey).length, 0);
  });

  it("10. only the representative is re-reviewable by the store owner and the other 13 slots stay as reviewed", async () => {
    const staged = await stage();
    const urls = new Map<string, string>();
    for (const candidate of CANDIDATES) {
      const registered = await register(staged.draftKey, candidate.slot);
      await moderate(staged.draftKey, candidate.slot);
      urls.set(candidate.slot, registered.url);
      if (candidate.slot === "rep") {
        assert.equal(reviewRep(staged.draftKey, registered.url, failingQa()).approved, false);
      } else {
        assert.equal(store.reviewReplacement(ADMIN, staged.draftKey, candidate.slot, variationQa(), registered.url).approved, true);
      }
    }
    const before = state(staged.draftKey, staged.characterId);
    const storedFiles = ports.storedFiles.length;

    assert.equal(rereview(staged.draftKey, urls.get("rep")!, passingQa()).approved, true);

    const after = state(staged.draftKey, staged.characterId);
    assert.deepEqual(after, before);
    assert.equal(ports.storedFiles.length, storedFiles);
    assert.deepEqual(
      store.listReplacements(staged.draftKey).map((r) => [r.slotKey, r.status]).sort((a, b) => a[0]!.localeCompare(b[0]!)),
      CANDIDATES.map((c) => [c.slot, "approved"]).sort((a, b) => a[0]!.localeCompare(b[0]!))
    );

    const dry = applyApprovedOfficialAssetReplacements({
      store,
      draftKey: staged.draftKey,
      actor: ADMIN,
      slotKeys: CANDIDATES.map((c) => c.slot),
      representative: REPRESENTATIVE_SET,
      dryRun: true,
    });
    assert.equal(dry.status, "dry_run");
    assert.deepEqual(state(staged.draftKey, staged.characterId), before);
  });
});

describe("operator --rereview over the same owner (isolated DB)", () => {
  function open(draftKey: string, characterId: number): ApprovedAssetOperatorTarget {
    return openApprovedAssetOperator({
      store,
      draftKey,
      characterId,
      adminEmail: ADMIN.email,
      manifestPath: MANIFEST_PATH,
      approvedPlanPath: APPROVED_PLAN_PATH,
    });
  }

  function evidence(
    target: ApprovedAssetOperatorTarget,
    url: string,
    overrides: { qa?: OfficialAnchorQaReport; correction?: { reason: string; evidence: string } | null } = {}
  ): ReviewEvidence {
    const qa = overrides.qa ?? passingQa();
    return {
      draftKey: target.draftKey,
      characterId: target.characterId,
      isolatedProofOnly: true,
      reviewer: REVIEWER,
      approvalEvidence: "isolated DB wrapper proof only; production review uses its own evidence file",
      slots: [
        {
          slot: "rep",
          candidateUrl: url,
          candidateSha256: REP.rawSha256,
          qa: Object.fromEntries(
            Object.keys(qa).map((key) => [
              key,
              {
                ok: (qa as unknown as Record<string, { ok: boolean }>)[key]!.ok,
                note: `rep ${key} isolated check`,
                ...(key === "compositionIndependence" ? { evidence: compositionCheck(url, REP.rawSha256).evidence } : {}),
              },
            ])
          ),
          ...(overrides.correction === null ? {} : { correction: overrides.correction ?? CORRECTION }),
        },
      ],
    };
  }

  const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));

  it("11. without --rereview a rejected representative stays blocked and a correction is refused", async () => {
    const { draftKey, characterId, url } = await rejectedRepresentative();
    const target = open(draftKey, characterId);
    const slot = approvedAssetStatus(target).slots.find((s) => s.slot === "rep")!;
    assert.equal(slot.next, "blocked");

    assert.throws(
      () => runApprovedAssetReview(target, bytes(evidence(target, url, { correction: null })), { execute: true, productionDatabase: false }),
      expectGate("operator_review_evidence")
    );
    assert.throws(
      () => runApprovedAssetReview(target, bytes(evidence(target, url)), { execute: true, productionDatabase: false }),
      expectGate("operator_review_evidence")
    );
    assert.equal(repRow(draftKey).status, "rejected");
    assert.equal(store.listReplacementRereviews(draftKey).length, 0);
  });

  it("12. --rereview needs a correction; dry-run writes nothing; execute records the correction through the store owner", async () => {
    const { draftKey, characterId, url } = await rejectedRepresentative();
    const target = open(draftKey, characterId);
    const before = repRow(draftKey);

    assert.throws(
      () =>
        runApprovedAssetReview(target, bytes(evidence(target, url, { correction: null })), {
          execute: false,
          productionDatabase: false,
          rereview: true,
        }),
      expectGate("operator_review_evidence")
    );
    assert.throws(
      () =>
        runApprovedAssetReview(target, bytes(evidence(target, url, { correction: { reason: "x", evidence: "test-fixture-not-quality-approval" } })), {
          execute: false,
          productionDatabase: false,
          rereview: true,
        }),
      expectGate("operator_review_evidence")
    );

    const dry = runApprovedAssetReview(target, bytes(evidence(target, url)), {
      execute: false,
      productionDatabase: false,
      rereview: true,
    });
    assert.equal(dry.rereview, true);
    assert.deepEqual(dry.recorded, []);
    assert.deepEqual(dry.planned.map((p) => [p.slot, p.allChecksOk, p.correction?.reason]), [["rep", true, CORRECTION.reason]]);
    assert.deepEqual(repRow(draftKey), before);
    assert.equal(store.listReplacementRereviews(draftKey).length, 0);

    const done = runApprovedAssetReview(target, bytes(evidence(target, url)), {
      execute: true,
      productionDatabase: false,
      rereview: true,
    });
    assert.equal(done.recorded.length, 1);
    assert.equal(done.recorded[0]!.approved, true);
    assert.ok(done.recorded[0]!.rereviewId);
    assert.equal(repRow(draftKey).status, "approved");
    assert.equal(repRow(draftKey).candidate_result_url, url);
    assert.equal(store.listReplacementRereviews(draftKey).length, 1);
    const status = approvedAssetStatus(target);
    assert.equal(status.rereviews.length, 1);
    assert.equal(status.rereviews[0]!.previousStatus, "rejected");
    assert.equal(status.rereviews[0]!.newStatus, "approved");
  });

  it("13. --rereview refuses a slot that is not a rejected representative and a failing new QA stays rejected", async () => {
    const generated = await stage();
    const { url: generatedUrl } = await register(generated.draftKey, "rep");
    await moderate(generated.draftKey, "rep");
    const generatedTarget = open(generated.draftKey, generated.characterId);
    assert.throws(
      () =>
        runApprovedAssetReview(generatedTarget, bytes(evidence(generatedTarget, generatedUrl)), {
          execute: true,
          productionDatabase: false,
          rereview: true,
        }),
      expectGate("operator_review_evidence")
    );
    assert.equal(repRow(generated.draftKey).status, "generated");

    const { draftKey, characterId, url } = await rejectedRepresentative();
    const target = open(draftKey, characterId);
    const failing = runApprovedAssetReview(
      target,
      bytes(evidence(target, url, { qa: anchorQa({ identifyingFeatures: { ok: false, note: "x" } }) })),
      { execute: true, productionDatabase: false, rereview: true }
    );
    assert.equal(failing.recorded[0]!.approved, false);
    assert.equal(repRow(draftKey).status, "rejected");
    assert.equal(store.listReplacementRereviews(draftKey).length, 1);
  });
});
