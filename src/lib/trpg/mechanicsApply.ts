import type Database from "better-sqlite3";
import type { MechanicsResolution } from "./mechanicsTypes";
import { clearOngoingEffect, insertOngoingEffect, updateOngoingEffectRow } from "./mechanicsStore";

export function applyPersistedMechanicsEffects(db: Database.Database, resolution: MechanicsResolution): void {
  if (resolution.applied) return;
  for (const update of resolution.ongoingUpdates ?? []) {
    updateOngoingEffectRow(db, update);
  }
  for (const add of resolution.ongoingAdds) {
    if (add.id && add.id > 0) continue;
    const exists = db
      .prepare(
        `SELECT id FROM trpg_ongoing_effects
         WHERE campaign_id=? AND participant_id=? AND stack_key=? AND source_round=? AND remaining_ticks!=0
         LIMIT 1`
      )
      .get(resolution.campaignId, add.participantId, add.stackKey, add.sourceRound) as { id: number } | undefined;
    if (exists) continue;
    insertOngoingEffect(db, {
      campaignId: resolution.campaignId,
      participantId: add.participantId,
      label: add.label,
      kind: add.kind,
      severity: add.severity,
      stackKey: add.stackKey,
      stackPolicy: add.stackPolicy,
      sourceRound: add.sourceRound,
      appliedRound: add.appliedRound,
      startsRound: add.startsRound,
      tickClass: add.tickClass,
      remainingTicks: add.remainingTicks,
      lastTickRound: add.lastTickRound,
      recoveryMode: add.recoveryMode,
      recoveryStat: add.recoveryStat,
      treatmentMode: add.treatmentMode,
      requiredItem: add.requiredItem,
      actionModifier: add.actionModifier,
      metadata: add.metadata,
    });
  }
  for (const rec of resolution.preActionRecoveries) {
    if (rec.cleared && rec.effectId > 0) clearOngoingEffect(db, rec.effectId);
  }
  for (const rec of resolution.recoveries) {
    if (rec.cleared && rec.effectId > 0) clearOngoingEffect(db, rec.effectId);
  }
  for (const id of resolution.ongoingClearedIds) {
    if (id > 0) clearOngoingEffect(db, id);
  }
  for (const row of resolution.incapacitated) {
    db.prepare(
      `UPDATE trpg_participants
       SET status='incapacitated', can_act=0
       WHERE id=? AND status='active'`
    ).run(row.participantId);
  }
}

export function logMechanicsObservability(resolution: MechanicsResolution): void {
  console.info("[trpg-mechanics]", resolution.observability);
}
