import type Database from "better-sqlite3";
import { CONTROL_MODIFIER, DURATION_TICKS } from "./mechanicsDice";
import {
  insertOngoingEffect,
  loadOngoingEffects,
  updateOngoingEffectRow,
} from "./mechanicsStore";
import type { TrpgOngoingEffect } from "./mechanicsTypes";
import type { TrpgSheetSnapshot, TrpgStateDelta } from "./types";

export const POST_GM_ONGOING_OWNER = "SERVER" as const;
export const EXTRA_PROVIDER_CALLS = 0;
export const NEW_ONGOING_STARTS_NEXT_ROUND = true;
export const GM_OMISSION_CANNOT_CLEAR_ONGOING = true;
export const LEGACY_FULL_PROMOTION_READ_AS_SEED_ONLY = true;

export type PostGmOngoingFamily = "POISON" | "BLEED" | "PARALYSIS";

/** The only persisted authority. All mechanics are rebuilt from trusted DB context. */
export type PostGmOngoingSeed = {
  participantId: number;
  family: PostGmOngoingFamily;
};

type FamilyDefaults = {
  family: PostGmOngoingFamily;
  kind: "periodic_harm" | "control";
  label: "중독" | "출혈" | "마비";
  stackKey: "poison" | "bleed" | "paralysis";
  tickClass: TrpgOngoingEffect["tickClass"];
  treatmentMode: TrpgOngoingEffect["treatmentMode"];
  actionModifier: number;
};

const FAMILY_DEFAULTS: Record<PostGmOngoingFamily, FamilyDefaults> = {
  POISON: {
    family: "POISON",
    kind: "periodic_harm",
    label: "중독",
    stackKey: "poison",
    tickClass: "LIGHT",
    treatmentMode: "item_or_support",
    actionModifier: 0,
  },
  BLEED: {
    family: "BLEED",
    kind: "periodic_harm",
    label: "출혈",
    stackKey: "bleed",
    tickClass: "LIGHT",
    treatmentMode: "item_or_support",
    actionModifier: 0,
  },
  PARALYSIS: {
    family: "PARALYSIS",
    kind: "control",
    label: "마비",
    stackKey: "paralysis",
    tickClass: null,
    treatmentMode: "generic_support",
    actionModifier: CONTROL_MODIFIER.LIGHT,
  },
};

function conditionKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

export function classifyPostGmCondition(value: string): PostGmOngoingFamily | null {
  const key = conditionKey(value);
  if (["중독", "독", "poison", "venom", "toxin"].includes(key)) return "POISON";
  if (["출혈", "bleeding"].includes(key)) return "BLEED";
  if (["마비", "paralysis", "neuralsuppression", "신경제압"].includes(key)) return "PARALYSIS";
  return null;
}

export function derivePostGmOngoingSeeds(opts: {
  startingSheets: readonly TrpgSheetSnapshot[];
  delta: TrpgStateDelta;
}): PostGmOngoingSeed[] {
  const sheets = new Map(opts.startingSheets.map((sheet) => [sheet.participantId, sheet]));
  const out: PostGmOngoingSeed[] = [];
  const seen = new Set<string>();
  for (const patch of opts.delta.players) {
    if (!Array.isArray(patch.conditions)) continue;
    const sheet = sheets.get(patch.participantId);
    if (!sheet) continue;
    const startingFamilies = new Set(
      sheet.conditions
        .map(classifyPostGmCondition)
        .filter((family): family is PostGmOngoingFamily => family != null)
    );
    for (const condition of patch.conditions) {
      const family = classifyPostGmCondition(condition);
      if (!family || startingFamilies.has(family)) continue;
      const key = `${patch.participantId}:${family}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ participantId: patch.participantId, family });
    }
  }
  return out;
}

/**
 * Accepts new seeds and legacy #523 full-promotion objects, but reads only
 * participantId/family. Duplicate and malformed seeds are dropped.
 */
export function parsePostGmOngoingSeeds(raw: unknown): PostGmOngoingSeed[] {
  if (!Array.isArray(raw)) return [];
  const out: PostGmOngoingSeed[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as { participantId?: unknown; family?: unknown };
    const participantId =
      typeof row.participantId === "number" ? row.participantId : Number.NaN;
    const family =
      typeof row.family === "string" &&
      Object.prototype.hasOwnProperty.call(FAMILY_DEFAULTS, row.family)
        ? (row.family as PostGmOngoingFamily)
        : null;
    if (!Number.isInteger(participantId) || participantId <= 0 || !family) continue;
    const key = `${participantId}:${family}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ participantId, family });
  }
  return out;
}

function canonicalEffect(opts: {
  campaignId: number;
  roundNumber: number;
  participantId: number;
  defaults: FamilyDefaults;
}): Omit<TrpgOngoingEffect, "id"> {
  return {
    campaignId: opts.campaignId,
    participantId: opts.participantId,
    label: opts.defaults.label,
    kind: opts.defaults.kind,
    severity: "LIGHT",
    stackKey: opts.defaults.stackKey,
    stackPolicy: "refresh",
    sourceRound: opts.roundNumber,
    appliedRound: opts.roundNumber,
    startsRound: opts.roundNumber + 1,
    tickClass: opts.defaults.tickClass,
    remainingTicks: DURATION_TICKS.SHORT,
    lastTickRound: null,
    recoveryMode: "save_or_treatment",
    recoveryStat: "res",
    treatmentMode: opts.defaults.treatmentMode,
    requiredItem: null,
    actionModifier: opts.defaults.actionModifier,
    metadata: {
      owner: "POST_GM_CONDITION_PROMOTION",
      family: opts.defaults.family,
    },
  };
}

function refreshExisting(db: Database.Database, effect: TrpgOngoingEffect): void {
  updateOngoingEffectRow(db, {
    id: effect.id,
    severity: effect.severity,
    tickClass: effect.tickClass,
    remainingTicks:
      effect.remainingTicks < 0 || effect.stackPolicy === "independent"
        ? effect.remainingTicks
        : Math.max(effect.remainingTicks, DURATION_TICKS.SHORT),
    lastTickRound: effect.lastTickRound,
    actionModifier: effect.actionModifier,
    recoveryMode: effect.recoveryMode,
    recoveryStat: effect.recoveryStat,
    treatmentMode: effect.treatmentMode,
    requiredItem: effect.requiredItem,
    stackPolicy: effect.stackPolicy,
  });
}

/**
 * Final mutation owner. It accepts semantic seeds plus trusted campaign/round,
 * revalidates participants, requeries active stacks, and reconstructs defaults.
 */
export function applyPostGmOngoingSeeds(
  db: Database.Database,
  opts: {
    campaignId: number;
    roundNumber: number;
    seeds: readonly PostGmOngoingSeed[];
  }
): { candidates: number; promoted: number; deduped: number } {
  const seeds = parsePostGmOngoingSeeds(opts.seeds);
  const validParticipants = new Set(
    (
      db
        .prepare(
          `SELECT s.participant_id AS id
           FROM trpg_character_sheets s
           JOIN trpg_participants p ON p.id=s.participant_id
           WHERE s.campaign_id=? AND p.campaign_id=?`
        )
        .all(opts.campaignId, opts.campaignId) as Array<{ id: number }>
    ).map((row) => row.id)
  );
  const activeEffects = loadOngoingEffects(db, opts.campaignId);
  let promoted = 0;
  let deduped = 0;
  for (const seed of seeds) {
    if (!validParticipants.has(seed.participantId)) continue;
    const defaults = FAMILY_DEFAULTS[seed.family];
    const existing = activeEffects.find(
      (effect) =>
        effect.participantId === seed.participantId &&
        effect.stackKey === defaults.stackKey &&
        effect.remainingTicks !== 0
    );
    if (existing) {
      refreshExisting(db, existing);
      deduped += 1;
      continue;
    }
    insertOngoingEffect(
      db,
      canonicalEffect({
        campaignId: opts.campaignId,
        roundNumber: opts.roundNumber,
        participantId: seed.participantId,
        defaults,
      })
    );
    promoted += 1;
  }
  return { candidates: seeds.length, promoted, deduped };
}

function seedDetails(seeds: readonly PostGmOngoingSeed[]) {
  return parsePostGmOngoingSeeds(seeds).map((seed) => {
    const defaults = FAMILY_DEFAULTS[seed.family];
    return {
      participantId: seed.participantId,
      kind: defaults.kind,
      stackKey: defaults.stackKey,
    };
  });
}

export function logPostGmOngoingCandidates(seeds: readonly PostGmOngoingSeed[]): void {
  const effects = seedDetails(seeds);
  console.info("[trpg-post-gm-ongoing-candidates]", {
    POST_GM_ONGOING_CANDIDATES: effects.length,
    effects,
  });
}

export function logPostGmOngoingObservability(opts: {
  seeds: readonly PostGmOngoingSeed[];
  promoted: number;
  deduped: number;
}): void {
  console.info("[trpg-post-gm-ongoing]", {
    POST_GM_ONGOING_CANDIDATES: parsePostGmOngoingSeeds(opts.seeds).length,
    POST_GM_ONGOING_PROMOTED: opts.promoted,
    POST_GM_ONGOING_DEDUPED: opts.deduped,
    effects: seedDetails(opts.seeds),
  });
}
