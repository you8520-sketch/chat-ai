import type { TrpgActionType } from "./actionTypes";
import {
  DURATION_BANDS,
  DIRECT_CAUSES,
  DIRECT_EFFECTS,
  MECHANICS_CLASSES,
  ONGOING_KINDS,
  RECOVERY_MODES,
  STACK_POLICIES,
  TREATMENT_MODES,
  TICK_CLASSES,
  V1_ONGOING_KINDS,
  isOngoingActive,
  isV1OngoingKind,
  type DirectCause,
  type DirectEffectKind,
  type DurationBand,
  type FlashActorEffect,
  type FlashMechanicsOutput,
  type FlashOngoingAdd,
  type MechanicsClass,
  type RecoveryMode,
  type StackPolicy,
  type TickClass,
  type TreatmentMode,
  type TrpgOngoingEffect,
} from "./mechanicsTypes";
import { classRank, isHealingIntentAction, minClass, TIER_HARM_CAP } from "./mechanicsDice";
import type { TrpgSuccessTier } from "./types";

function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function asInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function parseFlashMechanicsOutput(raw: string): FlashMechanicsOutput {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        parsed = JSON.parse(raw.slice(start, end + 1));
      } catch {
        parsed = null;
      }
    }
  }
  const obj = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as { effects?: unknown }) : null;
  const rows = Array.isArray(obj?.effects) ? obj.effects : [];
  const effects: FlashActorEffect[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const rec = row as Record<string, unknown>;
    const sourceParticipantId = asInt(rec.sourceParticipantId) ?? asInt(rec.participantId);
    if (sourceParticipantId == null) continue;
    const targetParticipantId = asInt(rec.targetParticipantId) ?? sourceParticipantId;
    effects.push({
      sourceParticipantId,
      targetParticipantId,
      participantId: sourceParticipantId,
      directEffect: asEnum(rec.directEffect, DIRECT_EFFECTS, "none"),
      directClass: asEnum(rec.directClass, MECHANICS_CLASSES, "NONE"),
      cause: asEnum(rec.cause, DIRECT_CAUSES, "none"),
      ongoingAdd: Array.isArray(rec.ongoingAdd)
        ? rec.ongoingAdd
            .map((item) => parseOngoingAdd(item))
            .filter((item): item is FlashOngoingAdd => item != null)
        : [],
      ongoingRemoveIds: Array.isArray(rec.ongoingRemoveIds)
        ? rec.ongoingRemoveIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
        : [],
      ongoingReduceIds: Array.isArray(rec.ongoingReduceIds)
        ? rec.ongoingReduceIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
        : [],
      consumeItem: typeof rec.consumeItem === "string" && rec.consumeItem.trim() ? rec.consumeItem.trim() : null,
      reason: typeof rec.reason === "string" ? rec.reason.slice(0, 240) : "",
    });
  }
  return { effects };
}

function parseOngoingAdd(raw: unknown): FlashOngoingAdd | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const label = typeof rec.label === "string" ? rec.label.trim() : "";
  const stackKey = typeof rec.stackKey === "string" ? rec.stackKey.trim() : "";
  if (!label || !stackKey) return null;
  const kind = asEnum(rec.kind, ONGOING_KINDS, "periodic_harm");
  if (!isV1OngoingKind(kind)) return null;
  const durationRaw = rec.durationBand;
  const durationBand =
    durationRaw === "PERSISTENT"
      ? "PERSISTENT"
      : asEnum(durationRaw, DURATION_BANDS, "MEDIUM");
  return {
    label: label.slice(0, 40),
    kind,
    severity: asEnum(rec.severity, MECHANICS_CLASSES, "LIGHT"),
    tickClass: rec.tickClass == null ? null : asEnum(String(rec.tickClass), TICK_CLASSES, "LIGHT"),
    durationBand,
    recoveryMode: asEnum(rec.recoveryMode, RECOVERY_MODES, "save_or_treatment"),
    recoveryStat: typeof rec.recoveryStat === "string" ? rec.recoveryStat.trim().slice(0, 16) : "res",
    treatmentMode: asEnum(rec.treatmentMode, TREATMENT_MODES, "item_or_support"),
    requiredItem: typeof rec.requiredItem === "string" && rec.requiredItem.trim() ? rec.requiredItem.trim() : null,
    stackKey: stackKey.slice(0, 40),
    stackPolicy: asEnum(rec.stackPolicy, STACK_POLICIES, "refresh"),
  };
}

export function capHarmClass(tier: TrpgSuccessTier | null, requested: MechanicsClass): MechanicsClass {
  if (!tier) return "NONE";
  return minClass(requested, TIER_HARM_CAP[tier]);
}

const PHYSICAL_THREAT_CUE =
  /함정|trap|붕괴|hazard|총격|gunfire|적탄|적습|습격|독니|venom|독액|독사|뱀독|붕괴하는|무너지|전투|교전|피격|습격당|적에게 노출|enemy|gunfire/i;

export function hasPhysicalThreatCue(text: string): boolean {
  return PHYSICAL_THREAT_CUE.test(text);
}

/**
 * Action type is not the damage-gate owner. Threat comes from scene/body cues
 * plus a harm-capable cause. attack/defend still count as being in a fight.
 */
export function resolvePhysicalThreat(opts: {
  actionType: TrpgActionType | null;
  body: string;
  scene?: string;
  cause: DirectCause;
}): boolean {
  const cues = hasPhysicalThreatCue(`${opts.body}\n${opts.scene ?? ""}`);
  const harmCause =
    opts.cause === "enemy_counter" ||
    opts.cause === "hazard" ||
    opts.cause === "tradeoff" ||
    opts.cause === "self_cost";
  if (opts.actionType === "attack" || opts.actionType === "defend") {
    return harmCause || cues || opts.cause === "none";
  }
  return cues && harmCause;
}

export function validateDirectEffect(opts: {
  actionType: TrpgActionType | null;
  body: string;
  tier: TrpgSuccessTier | null;
  effect: DirectEffectKind;
  klass: MechanicsClass;
  cause: DirectCause;
  physicalThreat: boolean;
}): { effect: DirectEffectKind; klass: MechanicsClass; cause: DirectCause; rejected: boolean; reason: string | null } {
  if (opts.effect === "heal") {
    if (!isHealingIntentAction(opts.actionType, opts.body)) {
      return { effect: "none", klass: "NONE", cause: "none", rejected: true, reason: "heal_without_treatment" };
    }
    if (opts.klass === "NONE" || opts.klass === "CHIP" || opts.klass === "SEVERE" || opts.klass === "CRITICAL") {
      return { effect: "heal", klass: "LIGHT", cause: "healing", rejected: false, reason: "heal_class_normalized" };
    }
    if (classRank(opts.klass) > classRank("HEAVY")) {
      return { effect: "heal", klass: "HEAVY", cause: "healing", rejected: false, reason: "heal_capped" };
    }
    return { effect: "heal", klass: opts.klass, cause: "healing", rejected: false, reason: null };
  }
  if (opts.effect !== "harm") {
    return { effect: "none", klass: "NONE", cause: "none", rejected: false, reason: null };
  }
  if (!opts.physicalThreat) {
    return { effect: "none", klass: "NONE", cause: "none", rejected: true, reason: "no_physical_threat" };
  }
  const capped = capHarmClass(opts.tier, opts.klass);
  if (capped === "NONE") {
    return { effect: "none", klass: "NONE", cause: "none", rejected: true, reason: "tier_cap_none" };
  }
  return {
    effect: "harm",
    klass: capped,
    cause: opts.cause === "healing" || opts.cause === "none" ? "enemy_counter" : opts.cause,
    rejected: capped !== opts.klass,
    reason: capped !== opts.klass ? "tier_cap" : null,
  };
}

export function fallbackRecoveryStat(requested: string, sheetStats: Record<string, number>): string {
  if (sheetStats[requested] != null) return requested;
  for (const key of ["res", "con", "wil", "str", "dex"]) {
    if (sheetStats[key] != null) return key;
  }
  return Object.keys(sheetStats)[0] ?? "con";
}

const TREATMENT_RANK: Record<TreatmentMode, number> = {
  none: 0,
  generic_support: 1,
  item_or_support: 2,
  specific_item: 3,
};

export function sanitizeOngoingAdd(
  add: FlashOngoingAdd,
  opts: {
    sheetStats: Record<string, number>;
    inventory: readonly string[];
    specialRules: string;
    startInventory: readonly string[];
  }
): FlashOngoingAdd | null {
  if (!isV1OngoingKind(add.kind)) return null;
  const recoveryStat = fallbackRecoveryStat(add.recoveryStat, opts.sheetStats);
  let recoveryMode = add.recoveryMode;
  let durationBand = add.durationBand ?? "MEDIUM";
  if (durationBand === "PERSISTENT" || recoveryMode === "persistent") {
    const explicit = allowsPersistentFromSpecialRules(opts.specialRules);
    if (!explicit) {
      recoveryMode = "save_or_treatment";
      durationBand = "MEDIUM";
    }
  }
  let treatmentMode = add.treatmentMode;
  let requiredItem = add.requiredItem;
  if (treatmentMode === "specific_item") {
    const item = requiredItem?.trim() ?? "";
    const known = [...opts.inventory, ...opts.startInventory].some((row) => row === item);
    const named = item && opts.specialRules.includes(item);
    if (!item || (!known && !named)) {
      treatmentMode = "item_or_support";
      requiredItem = null;
      if (recoveryMode === "treatment") recoveryMode = "save_or_treatment";
    }
  }
  let tickClass = add.tickClass ?? null;
  if (add.kind === "periodic_harm") {
    const requested = tickClass && (TICK_CLASSES as readonly string[]).includes(tickClass) ? tickClass : "LIGHT";
    tickClass = classRank(requested) > classRank("MEDIUM") ? "MEDIUM" : (requested as TickClass);
  } else {
    tickClass = null;
  }
  return {
    ...add,
    recoveryStat,
    recoveryMode,
    durationBand,
    treatmentMode,
    requiredItem,
    tickClass,
    stackPolicy: add.stackPolicy ?? "refresh",
    severity: add.severity === "NONE" ? "LIGHT" : add.severity,
  };
}

/** Persistent / specific-cure authority is public scenario specialRules only. */
export function allowsPersistentFromSpecialRules(specialRules: string): boolean {
  const text = specialRules.trim();
  if (!text) return false;
  return /영구|저주|persistent/i.test(text);
}

export function publicSpecialRulesText(rules: readonly string[] | null | undefined): string {
  return (rules ?? []).map((row) => row.trim()).filter(Boolean).join("\n");
}

export function inventoryHasItem(inventory: readonly string[], item: string): boolean {
  return inventory.some((row) => row.trim() === item.trim());
}

export function inferPhysicalThreat(actionType: TrpgActionType | null, cause: DirectCause): boolean {
  return resolvePhysicalThreat({ actionType, body: "", scene: "", cause });
}

export function isTreatmentCapableAction(actionType: TrpgActionType | null, body: string): boolean {
  return actionType === "support" || actionType === "use_item" || isHealingIntentAction(actionType, body);
}

export function hasTreatmentIntent(body: string): boolean {
  return /치료|치유|붕대|해독|해독제|회복|약|지혈|antidote|bandage|heal|treat/i.test(body);
}

const SUCCESS_TREAT_TIERS: readonly TrpgSuccessTier[] = ["SUCCESS", "GREAT_SUCCESS", "CRITICAL_SUCCESS"];
const PARTIAL_TREAT_TIERS: readonly TrpgSuccessTier[] = ["PARTIAL_SUCCESS"];

export type TreatmentAllow = "remove" | "reduce" | "none";

export function validateTreatment(opts: {
  actionType: TrpgActionType | null;
  body: string;
  tier: TrpgSuccessTier | null;
  effect: TrpgOngoingEffect | null;
  consumeItem: string | null;
  inventories: Array<{ participantId: number; items: readonly string[] }>;
}): { allow: TreatmentAllow; consume: boolean; ownerParticipantId: number | null; reason: string | null } {
  if (!opts.effect || !isOngoingActive(opts.effect.remainingTicks)) {
    return { allow: "none", consume: false, ownerParticipantId: null, reason: "effect_missing" };
  }
  if (!isTreatmentCapableAction(opts.actionType, opts.body) || !hasTreatmentIntent(opts.body)) {
    return { allow: "none", consume: false, ownerParticipantId: null, reason: "no_treatment_intent" };
  }
  const itemNeeded =
    opts.effect.treatmentMode === "specific_item" ||
    (opts.effect.treatmentMode === "item_or_support" && Boolean(opts.consumeItem || opts.effect.requiredItem));
  const wanted = (opts.effect.requiredItem ?? opts.consumeItem ?? "").trim();
  if (opts.effect.treatmentMode === "specific_item") {
    if (!wanted || (opts.consumeItem && opts.consumeItem.trim() !== wanted)) {
      return { allow: "none", consume: false, ownerParticipantId: null, reason: "specific_item_mismatch" };
    }
  }
  let owner: number | null = null;
  if (itemNeeded && wanted) {
    const found = opts.inventories.find((row) => inventoryHasItem(row.items, wanted));
    if (!found) {
      return { allow: "none", consume: false, ownerParticipantId: null, reason: "item_missing" };
    }
    owner = found.participantId;
  }
  if (!opts.tier || opts.tier === "FAILURE" || opts.tier === "SEVERE_FAILURE" || opts.tier === "CRITICAL_FAILURE") {
    return { allow: "none", consume: false, ownerParticipantId: owner, reason: "tier_failure" };
  }
  if (PARTIAL_TREAT_TIERS.includes(opts.tier)) {
    return { allow: "reduce", consume: Boolean(owner && wanted), ownerParticipantId: owner, reason: null };
  }
  if (SUCCESS_TREAT_TIERS.includes(opts.tier)) {
    return { allow: "remove", consume: Boolean(owner && wanted), ownerParticipantId: owner, reason: null };
  }
  return { allow: "none", consume: false, ownerParticipantId: owner, reason: "tier_unknown" };
}

export function validateOngoingApplication(opts: {
  add: FlashOngoingAdd;
  actionType: TrpgActionType | null;
  body: string;
  scene?: string;
  tier: TrpgSuccessTier | null;
  cause: DirectCause;
  physicalThreat: boolean;
}): { ok: boolean; reason: string | null } {
  if (!isV1OngoingKind(opts.add.kind)) {
    return { ok: false, reason: "kind_out_of_v1_scope" };
  }
  const safeSocial =
    (opts.actionType === "investigate" || opts.actionType === "persuade" || opts.actionType === "stealth") &&
    (opts.tier === "SUCCESS" || opts.tier === "GREAT_SUCCESS" || opts.tier === "CRITICAL_SUCCESS") &&
    !opts.physicalThreat;
  if (safeSocial) {
    return { ok: false, reason: "safe_success_no_threat" };
  }
  if (opts.add.kind === "periodic_harm" || opts.add.kind === "control") {
    const combat = opts.actionType === "attack" || opts.actionType === "defend";
    if (!opts.physicalThreat && !combat) {
      return { ok: false, reason: "no_threat_for_negative_add" };
    }
  }
  return { ok: true, reason: null };
}

/** V1 stack policy: never suddenly make an existing cure path harder. */
export function mergeStackCureFields(
  existing: TrpgOngoingEffect,
  incoming: FlashOngoingAdd
): Pick<TrpgOngoingEffect, "recoveryMode" | "recoveryStat" | "treatmentMode" | "requiredItem" | "stackPolicy"> {
  const incomingHarder = TREATMENT_RANK[incoming.treatmentMode] > TREATMENT_RANK[existing.treatmentMode];
  const incomingPersistent = incoming.recoveryMode === "persistent" && existing.recoveryMode !== "persistent";
  if (incomingHarder || incomingPersistent) {
    return {
      recoveryMode: existing.recoveryMode,
      recoveryStat: existing.recoveryStat,
      treatmentMode: existing.treatmentMode,
      requiredItem: existing.requiredItem,
      stackPolicy: existing.stackPolicy,
    };
  }
  return {
    recoveryMode: incoming.recoveryMode,
    recoveryStat: incoming.recoveryStat || existing.recoveryStat,
    treatmentMode: incoming.treatmentMode,
    requiredItem: incoming.requiredItem ?? existing.requiredItem,
    stackPolicy: incoming.stackPolicy ?? existing.stackPolicy,
  };
}

export { V1_ONGOING_KINDS };
