import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import { computeAppearanceLockHash } from "@/lib/officialSupply/appearance";
import { computeTextLockHash } from "@/lib/officialSupply/characterText";
import { loadCompiledOfficialCharacterSource } from "@/lib/officialSupply/compiledOfficialSource";
import { composeOfficialSlotGeneration, runOfficialAssetSlot } from "@/lib/officialSupply/runner";
import { buildPilotClusterBStyleProofDraft } from "@/lib/officialSupply/pilotClusterBStyleProof";
import { ROFAN_V4_PRODUCTION_BATCH_CONFIG } from "@/lib/officialSupply/pilotProduction";
import { PILOT_STYLE_PROOF_CANDIDATE_ID } from "@/lib/officialSupply/pilotStyleProof";
import { testStyleCandidate } from "@/lib/officialSupply/officialSupply.fixtures";
import { OfficialSupplyGateError, OfficialSupplyStore } from "@/lib/officialSupply/store";
import { ROFAN_CLUSTER_B_VISUAL_STYLE_DNA } from "@/lib/officialSupply/style";
import type { OfficialAppearanceLock, OfficialAssetPlan, OfficialCharacterDraft } from "@/lib/officialSupply/types";
import {
  CLUSTER_B_PRIMARY_STYLE_PATH,
  PILOT_STYLE_PROOF_V4_BATCH_KEY,
  PILOT_STYLE_PROOF_V4_STYLE_KEY,
  buildClusterBRofanStyleSeed,
} from "@/lib/officialSupply/userOwnedRofanStyleRefs";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";

const FIXTURE_PATH = path.join(
  process.cwd(),
  "src/lib/officialSupply/pilot/fixtures/pilot-rf-v4-02-locked-2026-09-27.json"
);
const CURRENT_PLAN_PATH = path.join(process.cwd(), "src/lib/officialSupply/pilot/characters/pilot-rf-02.json");
const DRAFT_KEY = "pilot-rf-v4-02";
const SIBLING_KEY = "pilot-rf-v4-99";
const WORLD_KEY = "pilot-rf-erendel";
const ENV = { NEXTAUTH_URL: "https://hav.chat", OPENAI_IMAGE_MODEL: "gpt-image-2.5-sunburst" } as NodeJS.ProcessEnv;
const APPROVED_TEXT_HASH = "00ccbac57fe5c655e174eb7b0b039c868e259a0a7e7fed207c7658d469aa1cd7";

type StaleFixture = {
  expectedTextLockHash: string;
  expectedAppearanceLockHash: string;
  representative: {
    resultUrl: string;
    attempts: number;
    model: string;
    width: number;
    height: number;
    spentUsd: number;
    moderation: { status: "checked"; adultFlagged: boolean; moderationReject: boolean; reason: string };
  };
  draft: OfficialCharacterDraft;
  appearance: OfficialAppearanceLock;
  assetPlan: OfficialAssetPlan;
};

function loadFixture(): StaleFixture {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8")) as StaleFixture;
}

function currentPlan(): OfficialAssetPlan {
  return (JSON.parse(fs.readFileSync(CURRENT_PLAN_PATH, "utf8")) as { assetPlan: OfficialAssetPlan }).assetPlan;
}

function currentDraft(): OfficialCharacterDraft {
  return buildPilotClusterBStyleProofDraft(loadCompiledOfficialCharacterSource("pilot-rf-02").draft);
}

function snapshot(store: OfficialSupplyStore, draftKey: string): unknown {
  return {
    character: store.database
      .prepare(
        `SELECT draft_key, batch_key, world_key, style_key, stage, draft_json, text_lock_hash,
                appearance_json, appearance_lock_hash, asset_plan_json, is_style_proof,
                anchor_approved_by, staging_claim, staged_character_id
           FROM official_supply_characters WHERE draft_key=?`
      )
      .get(draftKey),
    assets: store.database.prepare("SELECT * FROM official_supply_assets WHERE draft_key=? ORDER BY id").all(draftKey),
    replacements: store.database
      .prepare("SELECT * FROM official_supply_asset_replacements WHERE draft_key=? ORDER BY id")
      .all(draftKey),
  };
}

function seedStyleAndBatch(store: OfficialSupplyStore): void {
  store.createBatch(PILOT_STYLE_PROOF_V4_BATCH_KEY, ROFAN_V4_PRODUCTION_BATCH_CONFIG);
  store.proposeStyle({
    styleKey: PILOT_STYLE_PROOF_V4_STYLE_KEY,
    genre: "로맨스 판타지",
    candidates: [
      { ...testStyleCandidate("c1"), dna: ROFAN_CLUSTER_B_VISUAL_STYLE_DNA },
      { ...testStyleCandidate(PILOT_STYLE_PROOF_CANDIDATE_ID), dna: ROFAN_CLUSTER_B_VISUAL_STYLE_DNA },
      testStyleCandidate("c3"),
    ],
    proofAssetLimit: 3,
  });
  store.approveStyleCandidate(
    PILOT_STYLE_PROOF_V4_STYLE_KEY,
    PILOT_STYLE_PROOF_CANDIDATE_ID,
    buildClusterBRofanStyleSeed(ENV),
    "owner"
  );
}

function insertLockedCharacter(
  store: OfficialSupplyStore,
  draft: OfficialCharacterDraft,
  appearance: OfficialAppearanceLock,
  plan: OfficialAssetPlan,
  opts: { generatedRep?: StaleFixture["representative"] } = {}
): { expectedDraftJson: string; expectedAssetPlanJson: string } {
  const appearanceHash = computeAppearanceLockHash(appearance);
  const expectedDraftJson = JSON.stringify(draft);
  const expectedAssetPlanJson = JSON.stringify(plan);
  store.database
    .prepare(
      `INSERT INTO official_supply_characters
       (draft_key, batch_key, world_key, style_key, stage, draft_json, text_lock_hash,
        appearance_json, appearance_lock_hash, asset_plan_json, is_style_proof)
       VALUES (?, ?, ?, ?, 'asset_plan_locked', ?, ?, ?, ?, ?, 1)`
    )
    .run(
      draft.draftKey,
      PILOT_STYLE_PROOF_V4_BATCH_KEY,
      draft.worldKey,
      draft.styleKey,
      expectedDraftJson,
      computeTextLockHash(draft),
      JSON.stringify(appearance),
      appearanceHash,
      expectedAssetPlanJson
    );
  const insert = store.database.prepare(
    `INSERT INTO official_supply_assets
     (draft_key, slot_key, kind, status, attempts, result_url, width, height, model, spent_usd,
      has_unknown_cost, appearance_lock_hash, moderation_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  );
  for (const slot of plan.slots) {
    const isRep = slot.kind === "representative" && opts.generatedRep;
    insert.run(
      draft.draftKey,
      slot.slotKey,
      slot.kind,
      isRep ? "generated" : "planned",
      isRep ? opts.generatedRep!.attempts : 0,
      isRep ? opts.generatedRep!.resultUrl : null,
      isRep ? opts.generatedRep!.width : null,
      isRep ? opts.generatedRep!.height : null,
      isRep ? opts.generatedRep!.model : null,
      isRep ? opts.generatedRep!.spentUsd : 0,
      appearanceHash,
      isRep ? JSON.stringify(opts.generatedRep!.moderation) : null
    );
  }
  return { expectedDraftJson, expectedAssetPlanJson };
}

function reconcileInput(fixture: StaleFixture, expectedDraftJson: string, expectedAssetPlanJson: string) {
  return {
    expectedDraftJson,
    expectedAssetPlanJson,
    expectedTextLockHash: fixture.expectedTextLockHash,
    expectedAppearanceLockHash: fixture.expectedAppearanceLockHash,
    expectedRepresentative: {
      status: "generated" as const,
      resultUrl: fixture.representative.resultUrl,
      attempts: fixture.representative.attempts,
    },
    nextDraft: currentDraft(),
    nextPlan: currentPlan(),
  };
}

function noPostDeps(store: OfficialSupplyStore) {
  const fail = async () => {
    throw new Error("unexpected provider or upload");
  };
  return {
    store,
    transport: { generate: fail },
    imageOps: { inspect: fail },
    storage: { store: fail },
    spool: { save: fail, load: fail, remove: fail },
    workerId: "wolfgang-cas-test",
    env: ENV,
  };
}

function assemble(store: OfficialSupplyStore, slotKey: string) {
  return composeOfficialSlotGeneration({
    character: store.getCharacter(DRAFT_KEY),
    style: store.getStyle(PILOT_STYLE_PROOF_V4_STYLE_KEY),
    slotKey,
    representativeUrl: store.representativeAsset(DRAFT_KEY).resultUrl,
    env: ENV,
  });
}

describe("OfficialSupplyStore.reconcileLockedSnapshot", () => {
  const originalFetch = globalThis.fetch;
  let store: OfficialSupplyStore;
  let fixture: StaleFixture;
  let expectedDraftJson: string;
  let expectedAssetPlanJson: string;

  before(() => {
    globalThis.fetch = async (input) => {
      throw new Error(`unexpected fetch ${String(input)}`);
    };
  });
  after(() => {
    globalThis.fetch = originalFetch;
    uninstallIsolatedTestDatabase();
  });
  beforeEach(() => {
    uninstallIsolatedTestDatabase();
    installIsolatedTestDatabase();
    store = new OfficialSupplyStore();
    fixture = loadFixture();
    seedStyleAndBatch(store);
    ({ expectedDraftJson, expectedAssetPlanJson } = insertLockedCharacter(
      store,
      fixture.draft,
      fixture.appearance,
      fixture.assetPlan,
      { generatedRep: fixture.representative }
    ));
    insertLockedCharacter(
      store,
      { ...fixture.draft, draftKey: SIBLING_KEY, name: "형제 대조 캐릭터" },
      fixture.appearance,
      fixture.assetPlan
    );
    store.decideStyleProof(PILOT_STYLE_PROOF_V4_STYLE_KEY, "approve", "owner");
  });

  it("reproduces the 2026-09-27 mismatch: hashes, omitted imageSubjects, and failed assemblies", () => {
    assert.equal(computeTextLockHash(fixture.draft), fixture.expectedTextLockHash);
    assert.equal(computeAppearanceLockHash(fixture.appearance), fixture.expectedAppearanceLockHash);
    assert.equal(computeTextLockHash(currentDraft()), APPROVED_TEXT_HASH);
    assert.notEqual(fixture.expectedTextLockHash, APPROVED_TEXT_HASH);
    assert.match(fixture.draft.tagline, /압송/);
    assert.match(fixture.draft.hook.rpHook, /압송/);
    assert.match(JSON.stringify(fixture.assetPlan), /수갑|압송|character_plus_required_partner|플레이어와 함께/);
    assert.equal(
      fixture.assetPlan.slots.every((slot) => !("imageSubjects" in slot)),
      true
    );
    const failures: string[] = [];
    for (const slot of fixture.assetPlan.slots) {
      try {
        assemble(store, slot.slotKey);
        failures.push(`${slot.slotKey}: assembled`);
      } catch (error) {
        assert.match(error instanceof Error ? error.message : String(error), /imageSubjects/);
      }
    }
    assert.deepEqual(failures, []);
  });

  it("CAS writes approved text/plan only and leaves all 14 asset rows and siblings unchanged", async () => {
    const beforeTarget = snapshot(store, DRAFT_KEY);
    const beforeSibling = snapshot(store, SIBLING_KEY);
    const beforeBatch = store.database
      .prepare("SELECT config_json, status FROM official_supply_batches WHERE batch_key=?")
      .get(PILOT_STYLE_PROOF_V4_BATCH_KEY);
    const beforeStyle = store.database
      .prepare("SELECT stage, style_seed_json, approved_candidate_id FROM official_supply_styles WHERE style_key=?")
      .get(PILOT_STYLE_PROOF_V4_STYLE_KEY);

    const first = store.reconcileLockedSnapshot(DRAFT_KEY, reconcileInput(fixture, expectedDraftJson, expectedAssetPlanJson));
    assert.equal(first.status, "updated");
    assert.equal(first.textLockHash, APPROVED_TEXT_HASH);

    const after = store.getCharacter(DRAFT_KEY);
    assert.equal(after.stage, "asset_plan_locked");
    assert.equal(after.draft.tagline.length, 37);
    assert.equal(after.draft.description.length, 1299);
    assert.equal(after.draft.greeting.length, 1547);
    assert.match(after.draft.hook.rpHook, /처형 명령서/);
    assert.match(after.draft.hook.relationshipTrope, /보호자/);
    assert.doesNotMatch(JSON.stringify(after.draft), /압송|수갑/);
    assert.doesNotMatch(JSON.stringify(after.assetPlan), /압송|수갑|character_plus_required_partner|플레이어와 함께/);
    assert.equal(computeTextLockHash(after.draft), APPROVED_TEXT_HASH);
    assert.equal(after.appearanceLockHash, fixture.expectedAppearanceLockHash);
    assert.equal(after.batchKey, PILOT_STYLE_PROOF_V4_BATCH_KEY);
    assert.equal(after.isStyleProof, true);

    const afterAssets = snapshot(store, DRAFT_KEY);
    assert.deepEqual(
      (afterAssets as { assets: unknown }).assets,
      (beforeTarget as { assets: unknown }).assets
    );
    assert.deepEqual(
      (afterAssets as { replacements: unknown }).replacements,
      (beforeTarget as { replacements: unknown }).replacements
    );
    assert.deepEqual(snapshot(store, SIBLING_KEY), beforeSibling);
    assert.deepEqual(
      store.database.prepare("SELECT config_json, status FROM official_supply_batches WHERE batch_key=?").get(PILOT_STYLE_PROOF_V4_BATCH_KEY),
      beforeBatch
    );
    assert.deepEqual(
      store.database.prepare("SELECT stage, style_seed_json, approved_candidate_id FROM official_supply_styles WHERE style_key=?").get(PILOT_STYLE_PROOF_V4_STYLE_KEY),
      beforeStyle
    );

    const repRun = await runOfficialAssetSlot(noPostDeps(store), DRAFT_KEY, "rep");
    assert.equal(repRun.status, "already_generated");
    if (repRun.status === "already_generated") {
      assert.equal(repRun.url, fixture.representative.resultUrl);
    }

    for (const slot of currentPlan().slots) {
      const composed = assemble(store, slot.slotKey);
      assert.equal(composed.ok, true);
      if (!composed.ok) continue;
      assert.doesNotMatch(composed.primaryPrompt, /압송|수갑|플레이어와 함께/);
      if (slot.kind === "representative") {
        assert.equal(composed.references.some((ref) => ref.includes(CLUSTER_B_PRIMARY_STYLE_PATH)), true);
        continue;
      }
      assert.equal(composed.references[0], fixture.representative.resultUrl);
      assert.match(composed.references[1] ?? "", new RegExp(CLUSTER_B_PRIMARY_STYLE_PATH));
      assert.equal(composed.referenceRoleLayout, "identity_then_style");
    }

    const second = store.reconcileLockedSnapshot(DRAFT_KEY, reconcileInput(fixture, expectedDraftJson, expectedAssetPlanJson));
    assert.equal(second.status, "already_current");
    assert.deepEqual(
      (snapshot(store, DRAFT_KEY) as { assets: unknown }).assets,
      (beforeTarget as { assets: unknown }).assets
    );
  });

  it("fails closed and writes nothing for the required negative cases", () => {
    const input = reconcileInput(fixture, expectedDraftJson, expectedAssetPlanJson);
    const before = snapshot(store, DRAFT_KEY);

    const expectNoWrite = (code: string, mutate: () => void, restore: () => void, call = input) => {
      mutate();
      assert.throws(
        () => store.reconcileLockedSnapshot(DRAFT_KEY, call),
        (error: OfficialSupplyGateError) => error.code === code
      );
      restore();
      assert.deepEqual(snapshot(store, DRAFT_KEY), before);
    };

    expectNoWrite(
      "locked_snapshot_preimage_mismatch",
      () => undefined,
      () => undefined,
      { ...input, expectedTextLockHash: APPROVED_TEXT_HASH }
    );

    const hooked = { ...fixture.draft, hook: { ...fixture.draft.hook, rpHook: `${fixture.draft.hook.rpHook}·변경` } };
    assert.equal(computeTextLockHash(hooked), fixture.expectedTextLockHash);
    expectNoWrite("locked_snapshot_preimage_mismatch", () => undefined, () => undefined, {
      ...input,
      expectedDraftJson: JSON.stringify(hooked),
    });

    const changedPlan = JSON.parse(expectedAssetPlanJson) as OfficialAssetPlan;
    changedPlan.slots = changedPlan.slots.map((slot) =>
      slot.slotKey === "emo1" ? { ...slot, tag: "바뀐 계획" } : slot
    );
    expectNoWrite("locked_snapshot_preimage_mismatch", () => undefined, () => undefined, {
      ...input,
      expectedAssetPlanJson: JSON.stringify(changedPlan),
    });

    expectNoWrite(
      "locked_snapshot_rep_drift",
      () => {
        store.database
          .prepare("UPDATE official_supply_assets SET result_url=? WHERE draft_key=? AND slot_key='rep'")
          .run("/uploads/other.webp", DRAFT_KEY);
      },
      () => {
        store.database
          .prepare("UPDATE official_supply_assets SET result_url=? WHERE draft_key=? AND slot_key='rep'")
          .run(fixture.representative.resultUrl, DRAFT_KEY);
      }
    );

    expectNoWrite(
      "locked_snapshot_rep_drift",
      () => {
        store.database
          .prepare("UPDATE official_supply_assets SET attempts=2 WHERE draft_key=? AND slot_key='rep'")
          .run(DRAFT_KEY);
      },
      () => {
        store.database
          .prepare("UPDATE official_supply_assets SET attempts=1 WHERE draft_key=? AND slot_key='rep'")
          .run(DRAFT_KEY);
      }
    );

    expectNoWrite(
      "locked_snapshot_in_flight",
      () => {
        store.database
          .prepare("UPDATE official_supply_assets SET lease_owner='other' WHERE draft_key=? AND slot_key='rep'")
          .run(DRAFT_KEY);
      },
      () => {
        store.database
          .prepare("UPDATE official_supply_assets SET lease_owner=NULL WHERE draft_key=? AND slot_key='rep'")
          .run(DRAFT_KEY);
      }
    );

    expectNoWrite(
      "locked_snapshot_rep_drift",
      () => {
        store.database
          .prepare("UPDATE official_supply_assets SET moderation_json=? WHERE draft_key=? AND slot_key='rep'")
          .run(JSON.stringify({ status: "checked", adultFlagged: false, moderationReject: true, reason: "x" }), DRAFT_KEY);
      },
      () => {
        store.database
          .prepare("UPDATE official_supply_assets SET moderation_json=? WHERE draft_key=? AND slot_key='rep'")
          .run(JSON.stringify(fixture.representative.moderation), DRAFT_KEY);
      }
    );

    expectNoWrite(
      "appearance_lock_stale",
      () => {
        store.database
          .prepare("UPDATE official_supply_characters SET appearance_lock_hash=? WHERE draft_key=?")
          .run("0".repeat(64), DRAFT_KEY);
      },
      () => {
        store.database
          .prepare("UPDATE official_supply_characters SET appearance_lock_hash=? WHERE draft_key=?")
          .run(fixture.expectedAppearanceLockHash, DRAFT_KEY);
      }
    );

    expectNoWrite(
      "locked_snapshot_assets_drift",
      () => {
        store.database
          .prepare("UPDATE official_supply_assets SET attempts=1 WHERE draft_key=? AND slot_key='emo1'")
          .run(DRAFT_KEY);
      },
      () => {
        store.database
          .prepare("UPDATE official_supply_assets SET attempts=0 WHERE draft_key=? AND slot_key='emo1'")
          .run(DRAFT_KEY);
      }
    );

    expectNoWrite(
      "locked_snapshot_assets_drift",
      () => {
        store.database
          .prepare("UPDATE official_supply_assets SET kind='emotion' WHERE draft_key=? AND slot_key='scene3'")
          .run(DRAFT_KEY);
      },
      () => {
        store.database
          .prepare("UPDATE official_supply_assets SET kind='scene' WHERE draft_key=? AND slot_key='scene3'")
          .run(DRAFT_KEY);
      }
    );

    expectNoWrite("locked_snapshot_assets_drift", () => {
      store.database.prepare("UPDATE official_supply_assets SET slot_key='sig-unknown' WHERE draft_key=? AND slot_key='sig1'").run(DRAFT_KEY);
    }, () => {
      store.database.prepare("UPDATE official_supply_assets SET slot_key='sig1' WHERE draft_key=? AND slot_key='sig-unknown'").run(DRAFT_KEY);
    });

    expectNoWrite("locked_snapshot_identity_changed", () => undefined, () => undefined, {
      ...input,
      nextDraft: { ...input.nextDraft, age: 40 },
    });
    expectNoWrite("locked_snapshot_identity_changed", () => undefined, () => undefined, {
      ...input,
      nextDraft: { ...input.nextDraft, adult: { ...input.nextDraft.adult, orientation: "changed without approval" } },
    });

    expectNoWrite("character_stage", () => {
      store.database.prepare("UPDATE official_supply_characters SET stage='anchor_approved' WHERE draft_key=?").run(DRAFT_KEY);
    }, () => {
      store.database.prepare("UPDATE official_supply_characters SET stage='asset_plan_locked' WHERE draft_key=?").run(DRAFT_KEY);
    });

    expectNoWrite("locked_snapshot_stage", () => {
      store.database.prepare("UPDATE official_supply_characters SET staging_claim='tok' WHERE draft_key=?").run(DRAFT_KEY);
    }, () => {
      store.database.prepare("UPDATE official_supply_characters SET staging_claim=NULL WHERE draft_key=?").run(DRAFT_KEY);
    });

    expectNoWrite("locked_snapshot_qa_failed", () => undefined, () => undefined, {
      ...input,
      nextPlan: {
        slots: input.nextPlan.slots.map((slot) => {
          if (slot.slotKey !== "emo1") return slot;
          const { imageSubjects: _imageSubjects, ...rest } = slot;
          return rest as typeof slot;
        }),
      },
    });

    expectNoWrite(
      "locked_snapshot_preimage_mismatch",
      () => {
        store.database
          .prepare("UPDATE official_supply_characters SET draft_json=? WHERE draft_key=?")
          .run(JSON.stringify({ ...fixture.draft, tagline: "동시 작성 충돌" }), DRAFT_KEY);
      },
      () => {
        store.database
          .prepare("UPDATE official_supply_characters SET draft_json=? WHERE draft_key=?")
          .run(expectedDraftJson, DRAFT_KEY);
      }
    );
  });
});
