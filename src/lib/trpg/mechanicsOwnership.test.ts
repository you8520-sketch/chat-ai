import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  CONTEXTUAL_BLEED_TREAT_DRAFT,
  CONTEXTUAL_PARALYSIS_TREAT_DRAFT,
  CONTEXTUAL_POISON_TREAT_DRAFT,
  CONTEXTUAL_STATUS_TREAT_DRAFT,
  contextualStatusTreatDraft,
} from "./actionComposer";
import { EVEN_STATS, createTrpgCampaign, saveTrpgSheet } from "./engineCreate";
import { advanceTrpgCampaign, startTrpgCampaign, submitTrpgAction, type TrpgEngineDeps } from "./engineAdvance";
import { loadTrpgSnapshot } from "./engineSnapshot";
import { mergeMechanicsOwnedDelta, hpOwnershipOf, resolveParticipantHp } from "./mechanicsMerge";
import { resolveRoundMechanics } from "./mechanicsResolve";
import { insertOngoingEffect, loadLatestCompleteMechanics } from "./mechanicsStore";
import { formatMechanicsHudLines } from "./sheetHud";
import {
  ALLY_SERVER_RECOVERY_TARGET_OWNER,
  BANDAGE_HEAL_AND_BLEED_TREAT,
  CURRENT_INVENTORY_REQUIRED_FOR_ITEM_HEAL,
  DIRECT_HEAL_ITEM_CONSUMED_ONCE,
  FLASH_TARGET_OWNER,
  DIRECT_HEAL_ITEM_CONSUMED_ONCE,
  FLAG_OFF_FIRST_AID_COMMITS,
  FLAG_OFF_LEGACY_COMBAT_HP_PRESERVED,
  MAX_ONGOING_TREAT_TARGETS_PER_ACTION,
  NO_DOUBLE_HEAL_ITEM_CONSUME,
  NO_SILENT_DIRECT_OVERWRITE,
  NO_SILENT_HARM_PLUS_HEAL,
  ONE_STATUS_PER_TREATMENT,
  PARALYSIS_DRAFT_CORRECT,
  POST_COMBAT_REST_AVAILABLE,
  SAFE_REST_PREVIEW_EXACT,
  STATUS_TREATMENT_DOES_NOT_HEAL_HP,
  TRPG_MECHANICS_REFEREE_ENABLED_ENV,
  type MechanicsActorInput,
  type MechanicsResolution,
  type TrpgOngoingEffect,
} from "./mechanicsTypes";
import { evaluateSafeRestEligibility, hasActivePhysicalThreat } from "./mechanicsValidate";
import type { TrpgSheetSnapshot } from "./types";
import { ensureTrpgTables } from "./schema";

function sheet(partial: Partial<TrpgSheetSnapshot> = {}): TrpgSheetSnapshot {
  return {
    participantId: 1,
    name: "강이현",
    playerName: "현",
    level: 1,
    hp: 20,
    maxHp: 25,
    stats: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8, res: 8 },
    conditions: [],
    inventory: [],
    location: "",
    modifiersNote: "",
    ...partial,
  };
}

function actor(partial: Partial<MechanicsActorInput> = {}): MechanicsActorInput {
  return {
    participantId: 1,
    name: "강이현",
    actionType: "support",
    body: "상처를 응급처치한다",
    tier: "SUCCESS",
    d20: 14,
    modifier: 1,
    finalScore: 15,
    dc: 12,
    statKey: "wis",
    ...partial,
  };
}

function poison(partial: Partial<TrpgOngoingEffect> = {}): TrpgOngoingEffect {
  return {
    id: 10,
    campaignId: 1,
    participantId: 1,
    label: "중독",
    kind: "periodic_harm",
    severity: "MEDIUM",
    stackKey: "poison",
    stackPolicy: "refresh",
    sourceRound: 5,
    appliedRound: 5,
    startsRound: 6,
    tickClass: "LIGHT",
    remainingTicks: 3,
    lastTickRound: null,
    recoveryMode: "save_or_treatment",
    recoveryStat: "res",
    treatmentMode: "generic_support",
    requiredItem: null,
    actionModifier: 0,
    metadata: {},
    ...partial,
  };
}

function ally(partial: Partial<TrpgSheetSnapshot> = {}): TrpgSheetSnapshot {
  return sheet({ participantId: 2, name: "렌", playerName: "렌", inventory: [], ...partial });
}

function bleed(partial: Partial<TrpgOngoingEffect> = {}): TrpgOngoingEffect {
  return poison({
    id: 11,
    label: "출혈",
    stackKey: "bleed",
    ...partial,
  });
}

function paralysis(partial: Partial<TrpgOngoingEffect> = {}): TrpgOngoingEffect {
  return {
    id: 12,
    campaignId: 1,
    participantId: 1,
    label: "마비",
    kind: "control",
    severity: "LIGHT",
    stackKey: "paralysis",
    stackPolicy: "refresh",
    sourceRound: 5,
    appliedRound: 5,
    startsRound: 6,
    tickClass: null,
    remainingTicks: 3,
    lastTickRound: null,
    recoveryMode: "save_or_treatment",
    recoveryStat: "res",
    treatmentMode: "generic_support",
    requiredItem: null,
    actionModifier: -1,
    metadata: {},
    ...partial,
  };
}

function resolve(partial: Partial<Parameters<typeof resolveRoundMechanics>[0]>): MechanicsResolution {
  return resolveRoundMechanics({
    campaignId: 1,
    roundId: 400,
    roundNumber: 6,
    sheets: [sheet()],
    effects: [],
    actors: [actor()],
    flash: null,
    fallback: "gm_legacy",
    calledFlash: false,
    model: null,
    latencyMs: 0,
    baseDc: 12,
    rng: () => 4,
    recoveryRng: () => 1,
    scene: "안전한 폐허 안쪽. 적이 보이지 않는다.",
    ...partial,
  });
}

function gmText(opts?: { hp?: number; participantId?: number; narration?: string }): string {
  const players =
    opts?.participantId != null && opts.hp != null ? [{ participantId: opts.participantId, hp: opts.hp }] : [];
  return `<<<NARRATION>>>
${opts?.narration ?? "폐허가 고요하다. 바람만 분다."}
<<<DELTA>>>
${JSON.stringify({
  players,
  location: "폐허",
  next_round_context: "다음을 고른다",
  campaign_finished: false,
})}`;
}

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  return db;
}

async function withReferee<T>(enabled: boolean, fn: () => Promise<T> | T): Promise<T> {
  const prev = process.env[TRPG_MECHANICS_REFEREE_ENABLED_ENV];
  process.env[TRPG_MECHANICS_REFEREE_ENABLED_ENV] = enabled ? "1" : "0";
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env[TRPG_MECHANICS_REFEREE_ENABLED_ENV];
    else process.env[TRPG_MECHANICS_REFEREE_ENABLED_ENV] = prev;
  }
}

function hostSheet(db: Database.Database, campaignId: number): { id: number; hp: number; maxHp: number; inventory: string[] } {
  const row = db
    .prepare(
      `SELECT participant_id AS id, hp, max_hp AS maxHp, inventory_json AS inventoryJson
       FROM trpg_character_sheets
       WHERE campaign_id=?
       ORDER BY id ASC
       LIMIT 1`
    )
    .get(campaignId) as { id: number; hp: number; maxHp: number; inventoryJson: string };
  return { ...row, inventory: JSON.parse(row.inventoryJson || "[]") as string[] };
}

function pinHostVitals(
  db: Database.Database,
  hostId: number,
  hp: number,
  maxHp = 25,
  inventory?: string[]
): void {
  if (inventory) {
    db.prepare(`UPDATE trpg_character_sheets SET hp=?, max_hp=?, inventory_json=? WHERE participant_id=?`).run(
      hp,
      maxHp,
      JSON.stringify(inventory),
      hostId
    );
    return;
  }
  db.prepare(`UPDATE trpg_character_sheets SET hp=?, max_hp=? WHERE participant_id=?`).run(hp, maxHp, hostId);
}

async function setupSolo(
  db: Database.Database,
  deps: TrpgEngineDeps
): Promise<{ campaignId: number; hostId: number }> {
  const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
  saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
  await startTrpgCampaign(db, { campaignId, userId: 1, deps });
  return { campaignId, hostId: hostSheet(db, campaignId).id };
}

describe("TRPG P0-3 ownership / recovery semantics — flags", () => {
  it("exports the required gate flags", () => {
    assert.equal(FLAG_OFF_FIRST_AID_COMMITS, true);
    assert.equal(FLAG_OFF_LEGACY_COMBAT_HP_PRESERVED, true);
    assert.equal(CURRENT_INVENTORY_REQUIRED_FOR_ITEM_HEAL, true);
    assert.equal(DIRECT_HEAL_ITEM_CONSUMED_ONCE, true);
    assert.equal(NO_DOUBLE_HEAL_ITEM_CONSUME, true);
    assert.equal(NO_SILENT_HARM_PLUS_HEAL, true);
    assert.equal(NO_SILENT_DIRECT_OVERWRITE, true);
    assert.equal(SAFE_REST_PREVIEW_EXACT, true);
    assert.equal(POST_COMBAT_REST_AVAILABLE, true);
    assert.equal(PARALYSIS_DRAFT_CORRECT, true);
    assert.equal(STATUS_TREATMENT_DOES_NOT_HEAL_HP, true);
    assert.equal(ONE_STATUS_PER_TREATMENT, true);
    assert.equal(MAX_ONGOING_TREAT_TARGETS_PER_ACTION, 1);
  });
});

describe("TRPG P0-1 flag-off HP ownership", () => {
  it("A. FLAG_OFF_FIRST_AID_COMMITS — resolve + merge", () => {
    const resolution = resolve({
      sheets: [sheet({ hp: 10 })],
      actors: [actor({ body: "상처를 응급처치한다", tier: "SUCCESS" })],
      fallback: "gm_legacy",
      calledFlash: false,
      rng: () => 4,
    });
    assert.equal(resolution.actors[0]?.direct?.effect, "heal");
    assert.equal(resolution.actors[0]?.directHpOwner, "SERVER_RECOVERY");
    assert.equal(resolution.hpAfter["1"], 14);
    assert.match(resolution.packet, /owner=SERVER_RECOVERY/);
    assert.doesNotMatch(resolution.packet, /direct: NONE/);
    const merged = mergeMechanicsOwnedDelta(
      [sheet({ hp: 10 })],
      { players: [{ participantId: 1 }] },
      resolution
    );
    assert.equal(merged.ok, true);
    if (merged.ok) assert.equal(merged.next[0]?.hp, 14);
  });

  it("B. FLAG_OFF_LEGACY_COMBAT_HP_PRESERVED — resolve + merge", () => {
    const resolution = resolve({
      sheets: [sheet({ hp: 20 })],
      actors: [actor({ actionType: "attack", body: "검으로 벤다", tier: "FAILURE" })],
      fallback: "gm_legacy",
      calledFlash: false,
    });
    assert.equal(resolution.actors[0]?.directHpOwner, "GM_LEGACY");
    assert.match(resolution.packet, /GM_LEGACY_DIRECT/);
    assert.doesNotMatch(resolution.packet, /authoritative:[\s\S]{0,40}direct: NONE/);
    const merged = mergeMechanicsOwnedDelta(
      [sheet({ hp: 20 })],
      { players: [{ participantId: 1, hp: 16 }] },
      resolution
    );
    assert.equal(merged.ok, true);
    if (merged.ok) assert.equal(merged.next[0]?.hp, 16);
  });

  it("C. flag-off safe rest survives a stale GM start-HP write", () => {
    const resolution = resolve({
      sheets: [sheet({ hp: 10, maxHp: 25 })],
      actors: [actor({ actionType: "free", body: "안전한 곳에서 잠시 휴식하며 상처를 추스른다.", tier: null, d20: null })],
      fallback: "gm_legacy",
      calledFlash: false,
    });
    assert.equal(resolution.safeRests?.[0]?.amount, 5);
    assert.equal(resolution.hpAfter["1"], 15);
    const merged = mergeMechanicsOwnedDelta(
      [sheet({ hp: 10, maxHp: 25 })],
      { players: [{ participantId: 1, hp: 10 }] },
      resolution
    );
    assert.equal(merged.ok, true);
    if (merged.ok) assert.equal(merged.next[0]?.hp, 15);
  });

  it("D. flag-on Flash harm is FLASH_REFEREE authoritative", () => {
    const resolution = resolve({
      sheets: [sheet({ hp: 20 })],
      actors: [actor({ actionType: "attack", body: "벤다", tier: "FAILURE" })],
      flash: {
        effects: [{ participantId: 1, directEffect: "harm", directClass: "MEDIUM", cause: "enemy_counter" }],
      },
      fallback: "none",
      calledFlash: true,
      scene: "적이 받아친다. 전투.",
      rng: () => 4,
    });
    assert.equal(resolution.actors[0]?.direct?.effect, "harm");
    assert.equal(resolution.actors[0]?.directHpOwner, "FLASH_REFEREE");
    assert.equal(resolution.hpAfter["1"], 16);
    const merged = mergeMechanicsOwnedDelta(
      [sheet({ hp: 20 })],
      { players: [{ participantId: 1, hp: 20 }] },
      resolution
    );
    assert.equal(merged.ok, true);
    if (merged.ok) assert.equal(merged.next[0]?.hp, 16);
  });

  it("A-engine. FLAG_OFF_FIRST_AID_COMMITS", async () => {
    await withReferee(false, async () => {
      const db = memoryDb();
      const deps: TrpgEngineDeps = {
        skipBilling: true,
        rollD20: () => 14,
        rollDie: () => 4,
        gmCall: async () => ({ text: gmText() }),
      };
      const { campaignId, hostId } = await setupSolo(db, deps);
      pinHostVitals(db, hostId, 10);
      submitTrpgAction(db, { campaignId, userId: 1, body: "상처를 응급처치한다.", actionType: "support" });
      await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
      assert.equal(hostSheet(db, campaignId).hp, 14);
      const stored = loadLatestCompleteMechanics(db, campaignId);
      assert.equal(stored?.actors[0]?.directHpOwner, "SERVER_RECOVERY");
      assert.equal(stored?.hpAfter[String(hostId)], 14);
      db.close();
    });
  });

  it("B-engine. FLAG_OFF_LEGACY_COMBAT_HP_PRESERVED", async () => {
    await withReferee(false, async () => {
      const db = memoryDb();
      const hostIdRef = { id: 0 };
      const deps: TrpgEngineDeps = {
        skipBilling: true,
        rollD20: () => 6,
        rollDie: () => 4,
        gmCall: async () => ({
          text: gmText({
            participantId: hostIdRef.id || undefined,
            hp: hostIdRef.id ? 16 : undefined,
            narration: "칼날이 스친다. 피가 난다.",
          }),
        }),
      };
      const { campaignId, hostId } = await setupSolo(db, deps);
      hostIdRef.id = hostId;
      pinHostVitals(db, hostId, 20);
      submitTrpgAction(db, { campaignId, userId: 1, body: "검으로 벤다.", actionType: "attack" });
      await advanceTrpgCampaign(db, {
        campaignId,
        userId: 1,
        deps: {
          ...deps,
          gmCall: async () => ({
            text: gmText({ participantId: hostId, hp: 16, narration: "칼날이 스친다. 피가 난다." }),
          }),
        },
      });
      assert.equal(hostSheet(db, campaignId).hp, 16);
      const stored = loadLatestCompleteMechanics(db, campaignId);
      assert.equal(stored?.actors[0]?.directHpOwner, "GM_LEGACY");
      assert.match(stored?.packet ?? "", /GM_LEGACY_DIRECT/);
      db.close();
    });
  });

  it("C-engine. flag-off safe rest is not overwritten by GM", async () => {
    await withReferee(false, async () => {
      const db = memoryDb();
      const hostIdRef = { id: 0 };
      const deps: TrpgEngineDeps = {
        skipBilling: true,
        rollD20: () => 14,
        rollDie: () => 4,
        gmCall: async () => ({ text: gmText({ narration: "폐허가 고요하다. 바람만 분다." }) }),
      };
      const { campaignId, hostId } = await setupSolo(db, deps);
      hostIdRef.id = hostId;
      pinHostVitals(db, hostId, 10);
      submitTrpgAction(db, {
        campaignId,
        userId: 1,
        body: "안전한 곳에서 잠시 휴식하며 상처를 추스른다.",
        actionType: "free",
      });
      await advanceTrpgCampaign(db, {
        campaignId,
        userId: 1,
        deps: {
          ...deps,
          gmCall: async () => ({
            text: gmText({ participantId: hostId, hp: 10, narration: "잠시 숨을 고른다." }),
          }),
        },
      });
      assert.equal(hostSheet(db, campaignId).hp, 15);
      db.close();
    });
  });

  it("D-engine. flag-on Flash harm commits mechanics HP", async () => {
    await withReferee(true, async () => {
      const db = memoryDb();
      const hostIdRef = { id: 0 };
      const deps: TrpgEngineDeps = {
        skipBilling: true,
        rollD20: () => 6,
        rollDie: () => 4,
        mechanicsCall: async () => ({
          text: JSON.stringify({
            effects: [
              {
                participantId: hostIdRef.id,
                directEffect: "harm",
                directClass: "MEDIUM",
                cause: "enemy_counter",
              },
            ],
          }),
        }),
        gmCall: async () => ({
          text: gmText({
            participantId: hostIdRef.id || undefined,
            hp: hostIdRef.id ? 20 : undefined,
            narration: "적이 받아친다. 전투.",
          }),
        }),
      };
      const { campaignId, hostId } = await setupSolo(db, deps);
      hostIdRef.id = hostId;
      pinHostVitals(db, hostId, 20);
      submitTrpgAction(db, { campaignId, userId: 1, body: "검으로 벤다.", actionType: "attack" });
      await advanceTrpgCampaign(db, {
        campaignId,
        userId: 1,
        deps: {
          ...deps,
          gmCall: async () => ({
            text: gmText({ participantId: hostId, hp: 20, narration: "적이 받아친다. 전투." }),
          }),
        },
      });
      assert.equal(hostSheet(db, campaignId).hp, 16);
      const stored = loadLatestCompleteMechanics(db, campaignId);
      assert.equal(stored?.actors[0]?.directHpOwner, "FLASH_REFEREE");
      assert.equal(stored?.hpAfter[String(hostId)], 16);
      db.close();
    });
  });
});

describe("TRPG P0-2/P0-3 current inventory item heal", () => {
  it("CURRENT_INVENTORY_REQUIRED_FOR_ITEM_HEAL — startInventory is not ownership", () => {
    const out = resolve({
      sheets: [sheet({ hp: 10, inventory: [] })],
      actors: [actor({ actionType: "use_item", body: "구급키트를 사용한다", tier: "SUCCESS" })],
      startInventory: ["구급키트"],
      fallback: "gm_legacy",
      calledFlash: false,
    });
    assert.equal(out.actors[0]?.direct?.effect, "none");
    assert.equal(out.actors[0]?.direct?.rejectReason, "ITEM_HEAL_REJECTED_ITEM_MISSING");
    assert.equal(out.hpAfter["1"], 10);
    assert.deepEqual(out.consumeItems, []);
  });

  it("DIRECT_HEAL_ITEM_CONSUMED_ONCE — success consumes; retry does not double", () => {
    const first = resolve({
      sheets: [sheet({ hp: 10, inventory: ["구급키트"] })],
      actors: [actor({ actionType: "use_item", body: "구급키트를 사용한다", tier: "SUCCESS" })],
      rng: () => 4,
    });
    assert.equal(first.actors[0]?.direct?.effect, "heal");
    assert.ok((first.hpAfter["1"] ?? 0) > 10);
    assert.deepEqual(first.consumeItems, [{ participantId: 1, item: "구급키트" }]);
    const retry = resolve({ existing: { ...first, complete: true, applied: false } });
    assert.deepEqual(retry.consumeItems, first.consumeItems);
    assert.equal(retry.hpAfter["1"], first.hpAfter["1"]);
    const fail = resolve({
      sheets: [sheet({ hp: 10, inventory: ["구급키트"] })],
      actors: [actor({ actionType: "use_item", body: "구급키트를 사용한다", tier: "FAILURE" })],
    });
    assert.equal(fail.actors[0]?.direct?.effect, "none");
    assert.equal(fail.hpAfter["1"], 10);
    assert.deepEqual(fail.consumeItems, []);
    const full = resolve({
      sheets: [sheet({ hp: 25, maxHp: 25, inventory: ["구급키트"] })],
      actors: [actor({ actionType: "use_item", body: "구급키트를 사용한다", tier: "SUCCESS" })],
    });
    assert.equal(full.hpAfter["1"], 25);
    assert.deepEqual(full.consumeItems, []);
  });

  it("ONE_MEDKIT_TWO_ROUNDS engine path", async () => {
    await withReferee(false, async () => {
      const db = memoryDb();
      const deps: TrpgEngineDeps = {
        skipBilling: true,
        rollD20: () => 14,
        rollDie: () => 4,
        gmCall: async () => ({ text: gmText() }),
      };
      const { campaignId, hostId } = await setupSolo(db, deps);
      db.prepare(`UPDATE trpg_scenarios SET start_inventory_json=? WHERE campaign_id=?`).run(
        JSON.stringify(["구급키트"]),
        campaignId
      );
      pinHostVitals(db, hostId, 10, 25, ["구급키트"]);
      submitTrpgAction(db, { campaignId, userId: 1, body: "구급키트를 사용한다.", actionType: "use_item" });
      await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
      const afterR1 = hostSheet(db, campaignId);
      assert.equal(afterR1.hp, 14);
      assert.deepEqual(afterR1.inventory, []);
      const first = loadLatestCompleteMechanics(db, campaignId);
      assert.deepEqual(first?.consumeItems, [{ participantId: hostId, item: "구급키트" }]);
      submitTrpgAction(db, { campaignId, userId: 1, body: "구급키트를 사용한다.", actionType: "use_item" });
      await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
      const afterR2 = hostSheet(db, campaignId);
      assert.equal(afterR2.hp, 14);
      assert.deepEqual(afterR2.inventory, []);
      const second = loadLatestCompleteMechanics(db, campaignId);
      assert.equal(second?.actors[0]?.direct?.rejectReason, "ITEM_HEAL_REJECTED_ITEM_MISSING");
      assert.deepEqual(second?.consumeItems, []);
      db.close();
    });
  });

  it("CURRENT_INVENTORY_REQUIRED_FOR_ITEM_HEAL engine path", async () => {
    await withReferee(false, async () => {
      const db = memoryDb();
      const deps: TrpgEngineDeps = {
        skipBilling: true,
        rollD20: () => 14,
        rollDie: () => 4,
        gmCall: async () => ({ text: gmText() }),
      };
      const { campaignId, hostId } = await setupSolo(db, deps);
      db.prepare(`UPDATE trpg_scenarios SET start_inventory_json=? WHERE campaign_id=?`).run(
        JSON.stringify(["구급키트"]),
        campaignId
      );
      pinHostVitals(db, hostId, 10, 25, []);
      submitTrpgAction(db, { campaignId, userId: 1, body: "구급키트를 사용한다.", actionType: "use_item" });
      await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
      assert.equal(hostSheet(db, campaignId).hp, 10);
      const stored = loadLatestCompleteMechanics(db, campaignId);
      assert.equal(stored?.actors[0]?.direct?.rejectReason, "ITEM_HEAL_REJECTED_ITEM_MISSING");
      db.close();
    });
  });
});

describe("TRPG P0-4 single direct HP slot", () => {
  it("NO_SILENT_HARM_PLUS_HEAL — PARTIAL first aid reserves heal over Flash harm", () => {
    const out = resolve({
      sheets: [sheet({ hp: 10 })],
      actors: [actor({ body: "상처를 응급처치한다", tier: "PARTIAL_SUCCESS" })],
      flash: {
        effects: [
          { participantId: 1, directEffect: "harm", directClass: "MEDIUM", cause: "enemy_counter" },
          { participantId: 1, directEffect: "none", directClass: "NONE", cause: "none" },
        ],
      },
      fallback: "none",
      calledFlash: true,
      scene: "적이 받아친다. 전투.",
      rng: () => 4,
    });
    assert.equal(out.actors[0]?.direct?.effect, "heal");
    assert.equal(out.actors[0]?.directHpOwner, "SERVER_RECOVERY");
    assert.equal(out.hpAfter["1"], 14);
    assert.equal(out.actors.filter((row) => row.direct?.effect === "harm").length, 0);
    const hud = formatMechanicsHudLines({ ...out, applied: true }, 1);
    assert.equal(hud.some((line) => line.startsWith("회복")), true);
    assert.equal(hud.some((line) => line.startsWith("피해")), false);
    assert.match(hud.join("\n"), /HP 10 → 14/);
  });

  it("NO_SILENT_DIRECT_OVERWRITE — later none/invalid Flash row cannot replace accepted heal", () => {
    const out = resolve({
      sheets: [sheet({ hp: 10 })],
      actors: [actor({ body: "상처를 응급처치한다", tier: "SUCCESS" })],
      flash: {
        effects: [
          { participantId: 1, directEffect: "heal", directClass: "LIGHT", cause: "healing" },
          { participantId: 1, directEffect: "none", directClass: "NONE", cause: "none", reason: "noise" },
        ],
      },
      fallback: "none",
      calledFlash: true,
      rng: () => 4,
    });
    assert.equal(out.actors[0]?.direct?.effect, "heal");
    assert.equal(out.actors[0]?.direct?.hpBefore, 10);
    assert.equal(out.hpAfter["1"], 14);
  });

  it("FAILURE first aid may still accept Flash harm", () => {
    const out = resolve({
      sheets: [sheet({ hp: 20 })],
      actors: [actor({ body: "상처를 응급처치한다", tier: "FAILURE" })],
      flash: {
        effects: [{ participantId: 1, directEffect: "harm", directClass: "MEDIUM", cause: "enemy_counter" }],
      },
      fallback: "none",
      calledFlash: true,
      scene: "적이 받아친다. 전투.",
      rng: () => 4,
    });
    assert.equal(out.actors[0]?.direct?.effect, "harm");
    assert.equal(out.actors[0]?.directHpOwner, "FLASH_REFEREE");
    assert.equal(out.hpAfter["1"], 16);
  });
});

describe("TRPG P0-5 / P1 recovery UX + threat", () => {
  it("SAFE_REST_PREVIEW_EXACT — HP 24/25 is +1 on eligibility and apply", () => {
    const preview = evaluateSafeRestEligibility({
      hp: 24,
      maxHp: 25,
      scene: "폐허가 고요하다.",
      sameRoundCombat: false,
      lastSafeRestRound: null,
      currentRound: 3,
    });
    assert.equal(preview.available, true);
    assert.equal(preview.healAmount, 1);
    const out = resolve({
      sheets: [sheet({ hp: 24, maxHp: 25 })],
      actors: [actor({ actionType: "free", body: "안전한 곳에서 잠시 휴식하며 상처를 추스른다.", tier: null, d20: null })],
    });
    assert.equal(out.safeRests?.[0]?.amount, 1);
    assert.equal(out.hpAfter["1"], 25);
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /HP \+\$\{rest\.healAmount\}/);
  });

  it("POST_COMBAT_REST_AVAILABLE — ended combat is safe, resumed combat is not", () => {
    assert.equal(hasActivePhysicalThreat("전투가 끝났다. 적은 물러갔다."), false);
    assert.equal(hasActivePhysicalThreat("총격이 멎었다. 문을 봉쇄했다."), false);
    assert.equal(hasActivePhysicalThreat("전투가 끝난 듯했지만 다시 총격이 시작됐다."), true);
    assert.equal(hasActivePhysicalThreat("아직 적의 총격이 이어진다."), true);
    assert.equal(
      evaluateSafeRestEligibility({
        hp: 10,
        maxHp: 25,
        scene: "전투가 끝났다. 적은 물러갔다.",
        sameRoundCombat: false,
        lastSafeRestRound: null,
        currentRound: 4,
      }).available,
      true
    );
    assert.equal(
      evaluateSafeRestEligibility({
        hp: 10,
        maxHp: 25,
        scene: "아직 적의 총격이 이어진다.",
        sameRoundCombat: false,
        lastSafeRestRound: null,
        currentRound: 4,
      }).available,
      false
    );
  });

  it("PARALYSIS_DRAFT_CORRECT and split chips", () => {
    assert.equal(contextualStatusTreatDraft(["중독"]).body, CONTEXTUAL_POISON_TREAT_DRAFT);
    assert.equal(contextualStatusTreatDraft(["출혈"]).body, CONTEXTUAL_BLEED_TREAT_DRAFT);
    assert.equal(contextualStatusTreatDraft(["마비"]).body, CONTEXTUAL_PARALYSIS_TREAT_DRAFT);
    assert.equal(contextualStatusTreatDraft(["혼란"]).body, CONTEXTUAL_STATUS_TREAT_DRAFT);
    assert.equal(PARALYSIS_DRAFT_CORRECT, true);
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /🩹 응급처치/);
    assert.match(room, /💊 상태 치료/);
  });

  it("STATUS_TREATMENT_DOES_NOT_HEAL_HP", () => {
    const out = resolve({
      sheets: [sheet({ hp: 10 })],
      effects: [paralysis()],
      actors: [actor({ actionType: "support", body: "마비 상태를 치료한다.", tier: "SUCCESS" })],
      recoveryRng: () => 1,
    });
    assert.equal(out.hpAfter["1"], 10);
    assert.notEqual(out.actors[0]?.direct?.effect, "heal");
    assert.equal(STATUS_TREATMENT_DOES_NOT_HEAL_HP, true);
  });

  it("ONE_STATUS_PER_TREATMENT", () => {
    const out = resolve({
      sheets: [sheet({ hp: 20 })],
      effects: [poison({ tickClass: null, kind: "control" }), bleed({ id: 11, tickClass: null, kind: "control" }), paralysis()],
      actors: [actor({ actionType: "support", body: "현재 상태이상을 치료하려 한다.", tier: "SUCCESS" })],
      recoveryRng: () => 1,
    });
    assert.equal(out.ongoingClearedIds.length, 1);
    assert.equal(ONE_STATUS_PER_TREATMENT, true);
  });

  it("SAFE_REST_PREVIEW_EXACT + POST_COMBAT_REST_AVAILABLE engine snapshot", async () => {
    await withReferee(false, async () => {
      const db = memoryDb();
      const deps: TrpgEngineDeps = {
        skipBilling: true,
        gmCall: async () => ({ text: gmText({ narration: "전투가 끝났다. 적은 물러갔다." }) }),
      };
      const { campaignId, hostId } = await setupSolo(db, deps);
      pinHostVitals(db, hostId, 24);
      const snap = loadTrpgSnapshot(db, campaignId, 1);
      assert.equal(snap?.safeRest?.available, true);
      assert.equal(snap?.safeRest?.healAmount, 1);
      submitTrpgAction(db, {
        campaignId,
        userId: 1,
        body: "안전한 곳에서 잠시 휴식하며 상처를 추스른다.",
        actionType: "free",
      });
      await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
      assert.equal(hostSheet(db, campaignId).hp, 25);
      db.close();
    });
  });

  it("STATUS_TREATMENT_DOES_NOT_HEAL_HP engine path", async () => {
    await withReferee(false, async () => {
      const db = memoryDb();
      const deps: TrpgEngineDeps = {
        skipBilling: true,
        rollD20: () => 14,
        rollDie: () => 4,
        gmCall: async () => ({ text: gmText() }),
      };
      const { campaignId, hostId } = await setupSolo(db, deps);
      const round = db
        .prepare(`SELECT round_number FROM trpg_rounds WHERE campaign_id=? ORDER BY round_number DESC LIMIT 1`)
        .get(campaignId) as { round_number: number };
      pinHostVitals(db, hostId, 10);
      insertOngoingEffect(db, {
        campaignId,
        participantId: hostId,
        label: "마비",
        kind: "control",
        severity: "LIGHT",
        stackKey: "paralysis",
        stackPolicy: "refresh",
        sourceRound: round.round_number - 1,
        appliedRound: round.round_number - 1,
        startsRound: round.round_number,
        tickClass: null,
        remainingTicks: 3,
        lastTickRound: null,
        recoveryMode: "save_or_treatment",
        recoveryStat: "res",
        treatmentMode: "generic_support",
        requiredItem: null,
        actionModifier: -1,
        metadata: {},
      });
      submitTrpgAction(db, { campaignId, userId: 1, body: "마비 상태를 치료한다.", actionType: "support" });
      await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
      assert.equal(hostSheet(db, campaignId).hp, 10);
      const stored = loadLatestCompleteMechanics(db, campaignId);
      assert.notEqual(stored?.actors[0]?.direct?.effect, "heal");
      db.close();
    });
  });
});

describe("TRPG P0-4 target ownership / recovery atomicity", () => {
  it("exports gate flags", () => {
    assert.equal(ALLY_SERVER_RECOVERY_TARGET_OWNER, true);
    assert.equal(FLASH_TARGET_OWNER, true);
    assert.equal(BANDAGE_HEAL_AND_BLEED_TREAT, true);
  });

  it("1. A heals B — target owns SERVER_RECOVERY, GM omit commits heal", () => {
    const resolution = resolve({
      sheets: [sheet({ hp: 20 }), ally({ hp: 10 })],
      actors: [actor({ body: "렌의 상처를 응급처치한다", tier: "SUCCESS" })],
      fallback: "gm_legacy",
      calledFlash: false,
      rng: () => 4,
    });
    const bFlags = resolution.hpOwnership?.["2"] ?? hpOwnershipOf(resolution, 2);
    assert.equal(bFlags.SERVER_RECOVERY, true);
    assert.equal(bFlags.GM_LEGACY, false);
    assert.equal(resolution.actors[0]?.direct?.targetParticipantId, 2);
    assert.equal(resolution.hpAfter["2"], 14);
    const merged = mergeMechanicsOwnedDelta(
      [sheet({ hp: 20 }), ally({ hp: 10 })],
      { players: [{ participantId: 1 }] },
      resolution
    );
    assert.equal(merged.ok, true);
    if (merged.ok) assert.equal(merged.next.find((row) => row.participantId === 2)?.hp, 14);
  });

  it("2. Flash harms B — FLASH_TARGET_OWNER wins over stale GM hp", () => {
    const resolution = resolve({
      sheets: [sheet({ hp: 20 }), ally({ hp: 20 })],
      actors: [actor({ actionType: "attack", body: "렌을 벤다", tier: "FAILURE", participantId: 1 })],
      flash: {
        effects: [
          {
            sourceParticipantId: 1,
            targetParticipantId: 2,
            directEffect: "harm",
            directClass: "MEDIUM",
            cause: "enemy_counter",
          },
        ],
      },
      fallback: "none",
      calledFlash: true,
      scene: "전투. 적이 받아친다.",
      rng: () => 4,
    });
    assert.equal(hpOwnershipOf(resolution, 2).FLASH_REFEREE, true);
    assert.equal(resolution.hpAfter["2"], 16);
    const merged = mergeMechanicsOwnedDelta(
      [sheet({ hp: 20 }), ally({ hp: 20 })],
      { players: [{ participantId: 2, hp: 20 }] },
      resolution
    );
    assert.equal(merged.ok, true);
    if (merged.ok) assert.equal(merged.next.find((row) => row.participantId === 2)?.hp, 16);
  });

  it("3. self first aid — GM hp below mechanics ignored when GM_LEGACY=false", () => {
    const resolution = resolve({
      sheets: [sheet({ hp: 10 })],
      actors: [actor({ body: "상처를 응급처치한다", tier: "SUCCESS" })],
      rng: () => 4,
    });
    assert.equal(hpOwnershipOf(resolution, 1).SERVER_RECOVERY, true);
    assert.equal(hpOwnershipOf(resolution, 1).GM_LEGACY, false);
    assert.equal(
      resolveParticipantHp({
        startHp: 10,
        maxHp: 25,
        resolution,
        participantId: 1,
        gmHp: 6,
      }),
      14
    );
    const merged = mergeMechanicsOwnedDelta(
      [sheet({ hp: 10 })],
      { players: [{ participantId: 1, hp: 6 }] },
      resolution
    );
    assert.equal(merged.ok, true);
    if (merged.ok) assert.equal(merged.next[0]?.hp, 14);
  });

  it("4. safe rest — GM hp below mechanics ignored when GM_LEGACY=false", () => {
    const resolution = resolve({
      sheets: [sheet({ hp: 10, maxHp: 25 })],
      actors: [actor({ actionType: "free", body: "안전한 곳에서 잠시 휴식하며 상처를 추스른다.", tier: null, d20: null })],
    });
    assert.equal(
      resolveParticipantHp({
        startHp: 10,
        maxHp: 25,
        resolution,
        participantId: 1,
        gmHp: 3,
      }),
      15
    );
    const merged = mergeMechanicsOwnedDelta(
      [sheet({ hp: 10, maxHp: 25 })],
      { players: [{ participantId: 1, hp: 3 }] },
      resolution
    );
    assert.equal(merged.ok, true);
    if (merged.ok) assert.equal(merged.next[0]?.hp, 15);
  });

  it("5. A heals B +4 and B GM_LEGACY harm — layered gm7 + recovery4 = 11", () => {
    const resolution = resolve({
      sheets: [sheet({ hp: 20 }), ally({ hp: 10 })],
      actors: [
        actor({ body: "렌의 상처를 응급처치한다", tier: "SUCCESS" }),
        actor({
          participantId: 2,
          name: "렌",
          actionType: "attack",
          body: "반격한다",
          tier: "FAILURE",
        }),
      ],
      fallback: "gm_legacy",
      calledFlash: false,
      rng: () => 4,
    });
    const bFlags = hpOwnershipOf(resolution, 2);
    assert.equal(bFlags.SERVER_RECOVERY, true);
    assert.equal(bFlags.GM_LEGACY, true);
    assert.equal(
      resolveParticipantHp({
        startHp: 10,
        maxHp: 25,
        resolution,
        participantId: 2,
        gmHp: 7,
      }),
      11
    );
    const merged = mergeMechanicsOwnedDelta(
      [sheet({ hp: 20 }), ally({ hp: 10 })],
      { players: [{ participantId: 2, hp: 7 }] },
      resolution
    );
    assert.equal(merged.ok, true);
    if (merged.ok) assert.equal(merged.next.find((row) => row.participantId === 2)?.hp, 11);
  });

  it("6. BANDAGE_HEAL_AND_BLEED_TREAT — one bandage powers heal + bleed treat", () => {
    const out = resolve({
      sheets: [sheet({ hp: 10, inventory: ["붕대"] })],
      effects: [bleed({ participantId: 1, startsRound: 7, treatmentMode: "item_or_support", requiredItem: "붕대" })],
      actors: [
        actor({
          actionType: "use_item",
          body: "붕대로 출혈을 지혈하고 상처를 응급처치한다.",
          tier: "SUCCESS",
        }),
      ],
      rng: () => 4,
    });
    assert.ok((out.hpAfter["1"] ?? 0) > 10);
    assert.ok(out.ongoingClearedIds.includes(11));
    assert.deepEqual(out.consumeItems, [{ participantId: 1, item: "붕대" }]);
    const merged = mergeMechanicsOwnedDelta([sheet({ hp: 10, inventory: ["붕대"] })], { players: [] }, out);
    assert.equal(merged.ok, true);
    if (merged.ok) assert.deepEqual(merged.next[0]?.inventory, []);
  });

  it("7. bandage combined treatment retry does not double consume", () => {
    const first = resolve({
      sheets: [sheet({ hp: 10, inventory: ["붕대"] })],
      effects: [bleed({ participantId: 1, startsRound: 7, treatmentMode: "item_or_support", requiredItem: "붕대" })],
      actors: [
        actor({
          actionType: "use_item",
          body: "붕대로 출혈을 지혈하고 상처를 응급처치한다.",
          tier: "SUCCESS",
        }),
      ],
      rng: () => 4,
    });
    const retry = resolve({ existing: { ...first, complete: true, applied: false } });
    assert.deepEqual(retry.consumeItems, first.consumeItems);
    assert.equal(retry.consumeItems.length, 1);
  });

  it("8. ended clause with later active threat blocks safe rest", () => {
    assert.equal(hasActivePhysicalThreat("전투가 끝났다. 하지만 복도 끝에서 적이 총을 겨눴다."), true);
    assert.equal(hasActivePhysicalThreat("총격은 멎었지만 문밖에서 괴물이 달려든다."), true);
    assert.equal(hasActivePhysicalThreat("싸움이 끝난 줄 알았으나 바로 뒤에서 습격당했다."), true);
    assert.equal(
      evaluateSafeRestEligibility({
        hp: 10,
        maxHp: 25,
        scene: "전투가 끝났다. 하지만 적이 총을 겨눴다.",
        sameRoundCombat: false,
        lastSafeRestRound: null,
        currentRound: 3,
      }).available,
      false
    );
  });

  it("9. terminal safe clauses allow safe rest", () => {
    assert.equal(hasActivePhysicalThreat("적이 물러갔다. 총격도 멎었다. 주변은 조용하다."), false);
    assert.equal(hasActivePhysicalThreat("전투가 끝났다. 문을 봉쇄했고 더는 위협이 없다."), false);
    assert.equal(
      evaluateSafeRestEligibility({
        hp: 10,
        maxHp: 25,
        scene: "전투가 끝났다. 더는 위협이 없다.",
        sameRoundCombat: false,
        lastSafeRestRound: null,
        currentRound: 3,
      }).available,
      true
    );
  });
});
