import type Database from "better-sqlite3";
import { isTrpgActionType } from "./actionTypes";
import { formatResolutionOrderBlock, parseResolutionOrder } from "./initiative";
import {
  applyPersistedMechanicsEffects,
  logMechanicsObservability,
} from "./mechanicsApply";
import {
  buildMechanicsRefereeUserBlock,
  callTrpgMechanicsReferee,
  TRPG_MECHANICS_REFEREE_SYSTEM,
} from "./mechanicsReferee";
import { parseFlashOrEmpty, resolveRoundMechanics, shouldCallMechanicsFlash } from "./mechanicsResolve";
import { loadLastSafeRestRounds, loadMechanicsResolution, loadOngoingEffects, saveMechanicsResolution } from "./mechanicsStore";
import {
  isOngoingActive,
  isTrpgMechanicsRefereeEnabled,
  type MechanicsActorInput,
  type MechanicsResolution,
} from "./mechanicsTypes";
import { isHealingIntentAction, type DiceRng } from "./mechanicsDice";
import { loadSheetSnapshots } from "./engineSheets";
import { loadCampaignContext, resolvedCampaignPlan } from "./campaignContext";
import { publicSpecialRulesText } from "./mechanicsValidate";
import { loadScenario, parseJson } from "./store";

export type MechanicsRoundDeps = {
  mechanicsCall?: (opts: { system: string; user: string }) => Promise<{
    text: string;
    model?: string;
    latencyMs?: number;
  }>;
  rollD20?: () => number;
  rollDie?: DiceRng;
};

export function ensurePreActionMechanics(
  db: Database.Database,
  opts: { campaignId: number; roundId: number; roundNumber: number; deps?: MechanicsRoundDeps }
): MechanicsResolution {
  const existing = loadMechanicsResolution(db, opts.roundId);
  if (existing?.complete || existing?.preActionOwnerComplete) return existing;
  const sheets = loadSheetSnapshots(db, opts.campaignId);
  const effects = loadOngoingEffects(db, opts.campaignId);
  const scenario = loadScenario(db, opts.campaignId);
  const resolved = resolveRoundMechanics({
    campaignId: opts.campaignId,
    roundId: opts.roundId,
    roundNumber: opts.roundNumber,
    sheets,
    effects,
    actors: [],
    flash: null,
    fallback: "none",
    calledFlash: false,
    model: null,
    latencyMs: 0,
    baseDc: scenario.diceRules.dc,
    existing: null,
    recoveryRng: opts.deps?.rollD20,
    preActionOnly: true,
  });
  saveMechanicsResolution(db, resolved);
  return resolved;
}

export async function completeRoundMechanics(
  db: Database.Database,
  opts: {
    campaignId: number;
    roundId: number;
    opening: boolean;
    previousScene: string;
    deps?: MechanicsRoundDeps;
  }
): Promise<MechanicsResolution> {
  const existing = loadMechanicsResolution(db, opts.roundId);
  if (existing?.complete) return existing;
  const campaignContext = loadCampaignContext(db, opts.campaignId);
  const scenario = loadScenario(db, opts.campaignId);
  const specialRules = publicSpecialRulesText(resolvedCampaignPlan(campaignContext)?.specialRules);
  const sheets = loadSheetSnapshots(db, opts.campaignId);
  const effects = loadOngoingEffects(db, opts.campaignId);
  const roundNumber = (
    db.prepare(`SELECT round_number FROM trpg_rounds WHERE id=?`).get(opts.roundId) as { round_number: number }
  ).round_number;
  const storedSnapshot = parseJson(
    (db.prepare(`SELECT input_snapshot_json FROM trpg_rounds WHERE id=?`).get(opts.roundId) as
      | { input_snapshot_json: string | null }
      | undefined)?.input_snapshot_json,
    {} as { resolutionOrder?: unknown }
  );
  const actors = loadMechanicsActors(db, opts.roundId);
  const treatmentNeeded = actors.some(
    (actor) =>
      isHealingIntentAction(actor.actionType, actor.body) &&
      effects.some((effect) => isOngoingActive(effect.remainingTicks))
  );
  const enabled = isTrpgMechanicsRefereeEnabled();
  const wantFlash = enabled && shouldCallMechanicsFlash({
    opening: opts.opening,
    rolls: actors.filter((actor) => actor.d20 != null).length,
    treatmentNeeded,
  });
  let flashText: string | null = existing?.flashRaw ?? null;
  let model: string | null = existing?.model ?? null;
  let latencyMs = existing?.latencyMs ?? 0;
  let fallback: MechanicsResolution["fallback"] = enabled ? "none" : "gm_legacy";
  let calledFlash = Boolean(flashText);
  if (wantFlash && !flashText) {
    try {
      const call = opts.deps?.mechanicsCall ?? callTrpgMechanicsReferee;
      const result = await call({
        system: TRPG_MECHANICS_REFEREE_SYSTEM,
        user: buildMechanicsRefereeUserBlock({
          scene: opts.previousScene,
          resolutionOrder: formatResolutionOrderBlock(parseResolutionOrder(storedSnapshot)),
          actors,
          sheets,
          effects,
          specialRules,
        }),
      });
      flashText = result.text;
      model = result.model ?? null;
      latencyMs = result.latencyMs ?? 0;
      calledFlash = true;
      saveMechanicsResolution(db, {
        ...(existing ?? emptyIncomplete(opts.campaignId, opts.roundId, roundNumber)),
        flashRaw: flashText,
        model,
        latencyMs,
        calledFlash: true,
      });
    } catch {
      fallback = "flash_failure";
    }
  }
  const resolved = resolveRoundMechanics({
    campaignId: opts.campaignId,
    roundId: opts.roundId,
    roundNumber,
    sheets,
    effects,
    actors,
    flash: parseFlashOrEmpty(flashText),
    flashRaw: flashText,
    fallback,
    calledFlash,
    model,
    latencyMs,
    baseDc: scenario.diceRules.dc,
    specialRules,
    startInventory: scenario.startInventory ?? [],
    scene: opts.previousScene,
    existing,
    rng: opts.deps?.rollDie,
    recoveryRng: opts.deps?.rollD20,
    lastSafeRestByParticipant: loadLastSafeRestRounds(db, opts.campaignId),
  });
  saveMechanicsResolution(db, resolved);
  logMechanicsObservability(resolved);
  return resolved;
}

export function applyMechanicsOnCommit(db: Database.Database, resolution: MechanicsResolution | null): void {
  if (!resolution) return;
  applyPersistedMechanicsEffects(db, resolution);
}

function emptyIncomplete(campaignId: number, roundId: number, roundNumber: number): MechanicsResolution {
  return {
    v: 1,
    complete: false,
    preActionOwnerComplete: false,
    campaignId,
    roundId,
    roundNumber,
    calledFlash: false,
    model: null,
    latencyMs: 0,
    fallback: "none",
    validation: "ok",
    preActionRecoveries: [],
    actionModifiers: {},
    actors: [],
    ongoingTicks: [],
    recoveries: [],
    ongoingAdds: [],
    ongoingUpdates: [],
    ongoingClearedIds: [],
    consumeItems: [],
    hpAfter: {},
    incapacitated: [],
    applied: false,
    flashRaw: null,
    packet: "",
    observability: {
      MECHANICS_CALLED: false,
      MECHANICS_MODEL: null,
      MECHANICS_LATENCY_MS: 0,
      MECHANICS_EFFECT_COUNT: 0,
      MECHANICS_HARM_COUNT: 0,
      MECHANICS_HEAL_COUNT: 0,
      ONGOING_ACTIVE_COUNT: 0,
      ONGOING_TICK_COUNT: 0,
      ONGOING_DAMAGE_TOTAL: 0,
      ONGOING_CLEARED_COUNT: 0,
      RECOVERY_ROLL_COUNT: 0,
      RECOVERY_SUCCESS_COUNT: 0,
      MECHANICS_VALIDATION_RESULT: "ok",
      MECHANICS_FALLBACK: "none",
      FLASH_CALLS_PER_ROUND: 0,
    },
  };
}

function loadMechanicsActors(db: Database.Database, roundId: number): MechanicsActorInput[] {
  const rows = db
    .prepare(
      `SELECT s.participant_id, p.display_name AS name, s.body, s.action_type,
              r.d20, r.stat_modifier, r.final_score, r.dc, r.tier, r.stat_key
       FROM trpg_action_submissions s
       JOIN trpg_participants p ON p.id = s.participant_id
       LEFT JOIN trpg_dice_rolls r ON r.submission_id = s.id
       WHERE s.round_id=? AND s.locked=1
       ORDER BY s.id ASC`
    )
    .all(roundId) as Array<{
    participant_id: number;
    name: string;
    body: string;
    action_type: string | null;
    d20: number | null;
    stat_modifier: number | null;
    final_score: number | null;
    dc: number | null;
    tier: string | null;
    stat_key: string | null;
  }>;
  return rows.map((row) => ({
    participantId: row.participant_id,
    name: row.name,
    actionType: row.action_type && isTrpgActionType(row.action_type) ? row.action_type : "free",
    body: row.body,
    intent: row.body,
    tier: (row.tier as MechanicsActorInput["tier"]) ?? null,
    d20: row.d20,
    modifier: row.stat_modifier,
    finalScore: row.final_score,
    dc: row.dc,
    statKey: row.stat_key,
  }));
}
