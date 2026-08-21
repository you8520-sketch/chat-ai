import type Database from "better-sqlite3";
import { CONTROL_MODIFIER, DURATION_TICKS } from "./mechanicsDice";
import { insertOngoingEffect } from "./mechanicsStore";
import type { TrpgOngoingEffect } from "./mechanicsTypes";
import type { TrpgSheetSnapshot, TrpgStateDelta } from "./types";

export const POST_GM_ONGOING_OWNER = "SERVER" as const;
export const EXTRA_PROVIDER_CALLS = 0;
export const NEW_ONGOING_STARTS_NEXT_ROUND = true;
export const GM_OMISSION_CANNOT_CLEAR_ONGOING = true;

export type PostGmOngoingFamily = "POISON" | "BLEED" | "PARALYSIS";

export type PostGmOngoingPromotion = {
  participantId: number;
  family: PostGmOngoingFamily;
  kind: "periodic_harm" | "control";
  label: "중독" | "출혈" | "마비";
  stackKey: "poison" | "bleed" | "paralysis";
  deduped: boolean;
  existingEffectId: number | null;
  effect: Omit<TrpgOngoingEffect, "id"> | null;
};

type FamilyDefaults = Pick<
  PostGmOngoingPromotion,
  "family" | "kind" | "label" | "stackKey"
> & {
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

export function derivePostGmOngoingPromotions(opts: {
  campaignId: number;
  roundNumber: number;
  startingSheets: readonly TrpgSheetSnapshot[];
  delta: TrpgStateDelta;
  activeEffects: readonly TrpgOngoingEffect[];
}): PostGmOngoingPromotion[] {
  const sheets = new Map(opts.startingSheets.map((sheet) => [sheet.participantId, sheet]));
  const out: PostGmOngoingPromotion[] = [];
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
      const defaults = FAMILY_DEFAULTS[family];
      const key = `${patch.participantId}:${defaults.stackKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const existing =
        opts.activeEffects.find(
          (effect) =>
            effect.participantId === patch.participantId &&
            effect.stackKey === defaults.stackKey &&
            effect.remainingTicks !== 0
        ) ?? null;
      out.push({
        participantId: patch.participantId,
        family,
        kind: defaults.kind,
        label: defaults.label,
        stackKey: defaults.stackKey,
        deduped: existing != null,
        existingEffectId: existing?.id ?? null,
        effect: existing
          ? null
          : {
              campaignId: opts.campaignId,
              participantId: patch.participantId,
              label: defaults.label,
              kind: defaults.kind,
              severity: "LIGHT",
              stackKey: defaults.stackKey,
              stackPolicy: "refresh",
              sourceRound: opts.roundNumber,
              appliedRound: opts.roundNumber,
              startsRound: opts.roundNumber + 1,
              tickClass: defaults.tickClass,
              remainingTicks: DURATION_TICKS.SHORT,
              lastTickRound: null,
              recoveryMode: "save_or_treatment",
              recoveryStat: "res",
              treatmentMode: defaults.treatmentMode,
              requiredItem: null,
              actionModifier: defaults.actionModifier,
              metadata: {
                owner: "POST_GM_CONDITION_PROMOTION",
                family,
              },
            },
      });
    }
  }
  return out;
}

export function parsePostGmOngoingPromotions(raw: unknown): PostGmOngoingPromotion[] {
  if (!Array.isArray(raw)) return [];
  const out: PostGmOngoingPromotion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Partial<PostGmOngoingPromotion>;
    if (
      typeof row.participantId !== "number" ||
      !Number.isInteger(row.participantId) ||
      row.participantId <= 0 ||
      !row.family ||
      !FAMILY_DEFAULTS[row.family]
    ) {
      continue;
    }
    const defaults = FAMILY_DEFAULTS[row.family];
    const effect =
      row.effect &&
      row.effect.participantId === row.participantId &&
      row.effect.stackKey === defaults.stackKey
        ? row.effect
        : null;
    out.push({
      participantId: row.participantId,
      family: row.family,
      kind: defaults.kind,
      label: defaults.label,
      stackKey: defaults.stackKey,
      deduped: row.deduped === true,
      existingEffectId:
        typeof row.existingEffectId === "number" && Number.isInteger(row.existingEffectId)
          ? row.existingEffectId
          : null,
      effect,
    });
  }
  return out;
}

export function applyPostGmOngoingPromotions(
  db: Database.Database,
  promotions: readonly PostGmOngoingPromotion[]
): { promoted: number; deduped: number } {
  let promoted = 0;
  let deduped = 0;
  for (const promotion of promotions) {
    if (promotion.deduped || !promotion.effect) {
      deduped += 1;
      continue;
    }
    const existing = db
      .prepare(
        `SELECT id FROM trpg_ongoing_effects
         WHERE campaign_id=? AND participant_id=? AND stack_key=? AND remaining_ticks!=0
         LIMIT 1`
      )
      .get(
        promotion.effect.campaignId,
        promotion.participantId,
        promotion.stackKey
      ) as { id: number } | undefined;
    if (existing) {
      deduped += 1;
      continue;
    }
    insertOngoingEffect(db, promotion.effect);
    promoted += 1;
  }
  return { promoted, deduped };
}

export function logPostGmOngoingObservability(opts: {
  promotions: readonly PostGmOngoingPromotion[];
  promoted: number;
  deduped: number;
}): void {
  console.info("[trpg-post-gm-ongoing]", {
    POST_GM_ONGOING_CANDIDATES: opts.promotions.length,
    POST_GM_ONGOING_PROMOTED: opts.promoted,
    POST_GM_ONGOING_DEDUPED: opts.deduped,
    effects: opts.promotions.map((promotion) => ({
      participantId: promotion.participantId,
      kind: promotion.kind,
      stackKey: promotion.stackKey,
    })),
  });
}

export function logPostGmOngoingCandidates(
  promotions: readonly PostGmOngoingPromotion[]
): void {
  console.info("[trpg-post-gm-ongoing-candidates]", {
    POST_GM_ONGOING_CANDIDATES: promotions.length,
    POST_GM_ONGOING_DEDUPED: promotions.filter((promotion) => promotion.deduped).length,
    effects: promotions.map((promotion) => ({
      participantId: promotion.participantId,
      kind: promotion.kind,
      stackKey: promotion.stackKey,
    })),
  });
}
