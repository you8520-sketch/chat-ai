import type Database from "better-sqlite3";
import type { MechanicsResolution, TrpgOngoingEffect } from "./mechanicsTypes";
import { parseJson } from "./store";

export function loadOngoingEffects(db: Database.Database, campaignId: number): TrpgOngoingEffect[] {
  if (!hasTable(db, "trpg_ongoing_effects")) return [];
  const rows = db
    .prepare(
      `SELECT * FROM trpg_ongoing_effects WHERE campaign_id=? AND remaining_ticks!=0 ORDER BY id ASC`
    )
    .all(campaignId) as Array<Record<string, unknown>>;
  return rows.map(rowToEffect);
}

export function loadOngoingEffectsForParticipant(
  db: Database.Database,
  campaignId: number,
  participantId: number
): TrpgOngoingEffect[] {
  return loadOngoingEffects(db, campaignId).filter((row) => row.participantId === participantId);
}

export function insertOngoingEffect(
  db: Database.Database,
  effect: Omit<TrpgOngoingEffect, "id">
): number {
  const result = db
    .prepare(
      `INSERT INTO trpg_ongoing_effects (
         campaign_id, participant_id, label, kind, severity, stack_key, stack_policy,
         source_round, applied_round, starts_round, tick_class, remaining_ticks, last_tick_round,
         recovery_mode, recovery_stat, treatment_mode, required_item, action_modifier, metadata_json
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      effect.campaignId,
      effect.participantId,
      effect.label,
      effect.kind,
      effect.severity,
      effect.stackKey,
      effect.stackPolicy,
      effect.sourceRound,
      effect.appliedRound,
      effect.startsRound,
      effect.tickClass,
      effect.remainingTicks,
      effect.lastTickRound,
      effect.recoveryMode,
      effect.recoveryStat,
      effect.treatmentMode,
      effect.requiredItem,
      effect.actionModifier,
      JSON.stringify(effect.metadata)
    );
  return Number(result.lastInsertRowid);
}

export function updateOngoingEffectRow(
  db: Database.Database,
  effect: Pick<
    TrpgOngoingEffect,
    | "id"
    | "severity"
    | "tickClass"
    | "remainingTicks"
    | "lastTickRound"
    | "actionModifier"
    | "recoveryMode"
    | "recoveryStat"
    | "treatmentMode"
    | "requiredItem"
    | "stackPolicy"
  >
): void {
  db.prepare(
    `UPDATE trpg_ongoing_effects
     SET severity=?, tick_class=?, remaining_ticks=?, last_tick_round=?, action_modifier=?,
         recovery_mode=?, recovery_stat=?, treatment_mode=?, required_item=?, stack_policy=?
     WHERE id=?`
  ).run(
    effect.severity,
    effect.tickClass,
    effect.remainingTicks,
    effect.lastTickRound,
    effect.actionModifier,
    effect.recoveryMode,
    effect.recoveryStat,
    effect.treatmentMode,
    effect.requiredItem,
    effect.stackPolicy,
    effect.id
  );
}

export function clearOngoingEffect(db: Database.Database, effectId: number): void {
  db.prepare(`UPDATE trpg_ongoing_effects SET remaining_ticks=0 WHERE id=?`).run(effectId);
}

export function loadMechanicsResolution(
  db: Database.Database,
  roundId: number
): MechanicsResolution | null {
  if (!hasTable(db, "trpg_mechanics_resolutions")) return null;
  const row = db
    .prepare(`SELECT resolution_json FROM trpg_mechanics_resolutions WHERE round_id=?`)
    .get(roundId) as { resolution_json: string } | undefined;
  if (!row) return null;
  const parsed = parseJson(row.resolution_json, null as MechanicsResolution | null);
  return parsed?.v === 1 ? parsed : null;
}

export function saveMechanicsResolution(db: Database.Database, resolution: MechanicsResolution): void {
  db.prepare(
    `INSERT INTO trpg_mechanics_resolutions (round_id, campaign_id, resolution_json)
     VALUES (?,?,?)
     ON CONFLICT(round_id) DO UPDATE SET resolution_json=excluded.resolution_json`
  ).run(resolution.roundId, resolution.campaignId, JSON.stringify(resolution));
}

export function markMechanicsApplied(db: Database.Database, resolution: MechanicsResolution): void {
  saveMechanicsResolution(db, { ...resolution, applied: true });
}

export function loadLastSafeRestRounds(
  db: Database.Database,
  campaignId: number
): Record<string, number> {
  if (!hasTable(db, "trpg_mechanics_resolutions")) return {};
  const rows = db
    .prepare(
      `SELECT r.round_number, m.resolution_json
       FROM trpg_mechanics_resolutions m
       JOIN trpg_rounds r ON r.id = m.round_id
       WHERE m.campaign_id=?
       ORDER BY r.round_number DESC`
    )
    .all(campaignId) as Array<{ round_number: number; resolution_json: string }>;
  const out: Record<string, number> = {};
  for (const row of rows) {
    const parsed = parseJson(row.resolution_json, null as MechanicsResolution | null);
    if (parsed?.v !== 1 || !parsed.applied) continue;
    for (const rest of parsed.safeRests ?? []) {
      if (!rest.allowed) continue;
      const key = String(rest.participantId);
      if (out[key] == null) out[key] = row.round_number;
    }
  }
  return out;
}

export function loadLatestCompleteMechanics(
  db: Database.Database,
  campaignId: number
): MechanicsResolution | null {
  if (!hasTable(db, "trpg_mechanics_resolutions")) return null;
  const rows = db
    .prepare(
      `SELECT m.resolution_json
       FROM trpg_mechanics_resolutions m
       JOIN trpg_rounds r ON r.id = m.round_id
       WHERE m.campaign_id=?
       ORDER BY r.round_number DESC`
    )
    .all(campaignId) as Array<{ resolution_json: string }>;
  for (const row of rows) {
    const parsed = parseJson(row.resolution_json, null as MechanicsResolution | null);
    if (parsed?.v === 1 && parsed.complete) return parsed;
  }
  return null;
}

function rowToEffect(row: Record<string, unknown>): TrpgOngoingEffect {
  return {
    id: Number(row.id),
    campaignId: Number(row.campaign_id),
    participantId: Number(row.participant_id),
    label: String(row.label ?? ""),
    kind: row.kind as TrpgOngoingEffect["kind"],
    severity: row.severity as TrpgOngoingEffect["severity"],
    stackKey: String(row.stack_key ?? ""),
    stackPolicy: (row.stack_policy as TrpgOngoingEffect["stackPolicy"]) || "refresh",
    sourceRound: Number(row.source_round ?? 0),
    appliedRound: Number(row.applied_round ?? 0),
    startsRound: Number(row.starts_round ?? 0),
    tickClass: (row.tick_class as TrpgOngoingEffect["tickClass"]) ?? null,
    remainingTicks: Number(row.remaining_ticks ?? 0),
    lastTickRound: row.last_tick_round == null ? null : Number(row.last_tick_round),
    recoveryMode: row.recovery_mode as TrpgOngoingEffect["recoveryMode"],
    recoveryStat: String(row.recovery_stat ?? "res"),
    treatmentMode: row.treatment_mode as TrpgOngoingEffect["treatmentMode"],
    requiredItem: row.required_item == null ? null : String(row.required_item),
    actionModifier: Number(row.action_modifier ?? 0),
    metadata: parseJson(String(row.metadata_json ?? "{}"), {} as Record<string, unknown>),
  };
}

function hasTable(db: Database.Database, name: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name) as { ok: number } | undefined;
  return Boolean(row);
}
