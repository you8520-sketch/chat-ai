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
  type DirectCause,
  type DirectEffectKind,
  type DurationBand,
  type FlashActorEffect,
  type FlashMechanicsOutput,
  type FlashOngoingAdd,
  type MechanicsClass,
  type OngoingKind,
  type RecoveryMode,
  type StackPolicy,
  type TickClass,
  type TreatmentMode,
} from "./mechanicsTypes";
import { classRank, isHealingIntentAction, isPhysicalThreatAction, minClass, TIER_HARM_CAP } from "./mechanicsDice";
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
    const participantId = asInt(rec.participantId);
    if (participantId == null) continue;
    effects.push({
      participantId,
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
  const durationRaw = rec.durationBand;
  const durationBand =
    durationRaw === "PERSISTENT"
      ? "PERSISTENT"
      : asEnum(durationRaw, DURATION_BANDS, "MEDIUM");
  return {
    label: label.slice(0, 40),
    kind: asEnum(rec.kind, ONGOING_KINDS, "periodic_harm"),
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
  if (!opts.physicalThreat && !isPhysicalThreatAction(opts.actionType)) {
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

export function sanitizeOngoingAdd(
  add: FlashOngoingAdd,
  opts: {
    sheetStats: Record<string, number>;
    inventory: readonly string[];
    specialRules: string;
    startInventory: readonly string[];
  }
): FlashOngoingAdd {
  const recoveryStat = fallbackRecoveryStat(add.recoveryStat, opts.sheetStats);
  let recoveryMode = add.recoveryMode;
  let durationBand = add.durationBand ?? "MEDIUM";
  if (durationBand === "PERSISTENT" || recoveryMode === "persistent") {
    const explicit = /영구|저주|persistent|specialRules/i.test(opts.specialRules);
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

export function inventoryHasItem(inventory: readonly string[], item: string): boolean {
  return inventory.some((row) => row.trim() === item.trim());
}

export function inferPhysicalThreat(actionType: TrpgActionType | null, cause: DirectCause): boolean {
  if (isPhysicalThreatAction(actionType)) return true;
  return cause === "enemy_counter" || cause === "hazard";
}
