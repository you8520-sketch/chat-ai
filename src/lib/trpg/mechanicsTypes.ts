import { TRPG_SCENARIO_DRAFT_MODEL } from "./scenarioDraft";
import type { TrpgActionType } from "./actionTypes";
import type { TrpgSuccessTier } from "./types";

export const TRPG_MECHANICS_REFEREE_ENABLED_ENV = "TRPG_MECHANICS_REFEREE_ENABLED";
export const TRPG_MECHANICS_REFEREE_MODEL = TRPG_SCENARIO_DRAFT_MODEL;
export const PER_ROUND_DIRECTOR = false;
export const MECHANICS_REFEREE = true;
export const ENEMY_HP_ENGINE = false;
export const TRPG_SOURCE_THUMB = false;
export const NO_DOUBLE_BURST_ON_APPLICATION = true;
export const NO_HIDDEN_CURE_SOFTLOCK = true;
export const NO_DAMAGE_REROLL = true;
export const NO_DOUBLE_DAMAGE = true;
export const NO_DOUBLE_POISON_TICK = true;
export const NO_DOUBLE_ITEM_CONSUME = true;
export const TOTAL_ONGOING_DAMAGE_RATIO = 0.35;

export const MECHANICS_CLASSES = [
  "NONE",
  "CHIP",
  "LIGHT",
  "MEDIUM",
  "HEAVY",
  "SEVERE",
  "CRITICAL",
] as const;
export type MechanicsClass = (typeof MECHANICS_CLASSES)[number];

export const DIRECT_EFFECTS = ["none", "harm", "heal"] as const;
export type DirectEffectKind = (typeof DIRECT_EFFECTS)[number];

export const DIRECT_CAUSES = [
  "none",
  "tradeoff",
  "enemy_counter",
  "hazard",
  "self_cost",
  "healing",
] as const;
export type DirectCause = (typeof DIRECT_CAUSES)[number];

export const ONGOING_KINDS = ["periodic_harm", "control", "debuff", "regen"] as const;
export type OngoingKind = (typeof ONGOING_KINDS)[number];

export const DURATION_BANDS = ["SHORT", "MEDIUM", "LONG"] as const;
export type DurationBand = (typeof DURATION_BANDS)[number];

export const RECOVERY_MODES = [
  "duration",
  "save",
  "treatment",
  "save_or_treatment",
  "persistent",
] as const;
export type RecoveryMode = (typeof RECOVERY_MODES)[number];

export const TREATMENT_MODES = ["none", "generic_support", "item_or_support", "specific_item"] as const;
export type TreatmentMode = (typeof TREATMENT_MODES)[number];

export const STACK_POLICIES = ["refresh", "upgrade", "independent"] as const;
export type StackPolicy = (typeof STACK_POLICIES)[number];

export const TICK_CLASSES = ["CHIP", "LIGHT", "MEDIUM"] as const;
export type TickClass = (typeof TICK_CLASSES)[number];

export type MechanicsFallback = "none" | "gm_legacy" | "flash_failure";

export type TrpgOngoingEffect = {
  id: number;
  campaignId: number;
  participantId: number;
  label: string;
  kind: OngoingKind;
  severity: MechanicsClass;
  stackKey: string;
  stackPolicy: StackPolicy;
  sourceRound: number;
  appliedRound: number;
  startsRound: number;
  tickClass: TickClass | null;
  remainingTicks: number;
  lastTickRound: number | null;
  recoveryMode: RecoveryMode;
  recoveryStat: string;
  treatmentMode: TreatmentMode;
  requiredItem: string | null;
  actionModifier: number;
  metadata: Record<string, unknown>;
};

export type FlashOngoingAdd = {
  label: string;
  kind: OngoingKind;
  severity: MechanicsClass;
  tickClass?: TickClass | null;
  durationBand?: DurationBand | "PERSISTENT";
  recoveryMode: RecoveryMode;
  recoveryStat: string;
  treatmentMode: TreatmentMode;
  requiredItem?: string | null;
  stackKey: string;
  stackPolicy?: StackPolicy;
};

export type FlashActorEffect = {
  participantId: number;
  directEffect: DirectEffectKind;
  directClass: MechanicsClass;
  cause: DirectCause;
  ongoingAdd?: FlashOngoingAdd[];
  ongoingRemoveIds?: number[];
  ongoingReduceIds?: number[];
  consumeItem?: string | null;
  reason?: string;
};

export type FlashMechanicsOutput = {
  effects: FlashActorEffect[];
};

export type DiceRollRecord = {
  expression: string;
  rolls: number[];
  total: number;
  amount: number;
};

export type RecoveryRollRecord = {
  effectId: number;
  participantId: number;
  d20: number;
  modifier: number;
  dc: number;
  success: boolean;
  timing: "pre_action" | "after_tick";
  cleared: boolean;
};

export type DirectResolution = {
  effect: DirectEffectKind;
  class: MechanicsClass;
  cause: DirectCause;
  dice: DiceRollRecord | null;
  hpBefore: number;
  hpAfter: number;
  rejected: boolean;
  rejectReason: string | null;
};

export type OngoingTickRecord = {
  effectId: number;
  participantId: number;
  label: string;
  kind: OngoingKind;
  dice: DiceRollRecord | null;
  hpBefore: number;
  hpAfter: number;
};

export type MechanicsActorInput = {
  participantId: number;
  name: string;
  actionType: TrpgActionType | null;
  body: string;
  intent?: string;
  tier: TrpgSuccessTier | null;
  d20: number | null;
  modifier: number | null;
  finalScore: number | null;
  dc: number | null;
  statKey: string | null;
};

export type MechanicsResolution = {
  v: 1;
  complete: boolean;
  campaignId: number;
  roundId: number;
  roundNumber: number;
  calledFlash: boolean;
  model: string | null;
  latencyMs: number;
  fallback: MechanicsFallback;
  validation: "ok" | "downgraded" | "rejected_partial";
  preActionRecoveries: RecoveryRollRecord[];
  actionModifiers: Record<string, number>;
  actors: Array<{
    participantId: number;
    actionType: TrpgActionType | null;
    tier: TrpgSuccessTier | null;
    physicalThreat: boolean;
    direct: DirectResolution | null;
  }>;
  ongoingTicks: OngoingTickRecord[];
  recoveries: RecoveryRollRecord[];
  ongoingAdds: Array<Omit<TrpgOngoingEffect, "id"> & { id?: number }>;
  ongoingClearedIds: number[];
  ongoingUpdates: Array<
    Pick<TrpgOngoingEffect, "id" | "severity" | "tickClass" | "remainingTicks" | "lastTickRound" | "actionModifier">
  >;
  consumeItems: Array<{ participantId: number; item: string }>;
  hpAfter: Record<string, number>;
  incapacitated: Array<{ participantId: number; reason: "hp_zero" }>;
  applied?: boolean;
  flashRaw?: string | null;
  packet: string;
  observability: {
    MECHANICS_CALLED: boolean;
    MECHANICS_MODEL: string | null;
    MECHANICS_LATENCY_MS: number;
    MECHANICS_EFFECT_COUNT: number;
    MECHANICS_HARM_COUNT: number;
    MECHANICS_HEAL_COUNT: number;
    ONGOING_ACTIVE_COUNT: number;
    ONGOING_TICK_COUNT: number;
    ONGOING_DAMAGE_TOTAL: number;
    ONGOING_CLEARED_COUNT: number;
    RECOVERY_ROLL_COUNT: number;
    RECOVERY_SUCCESS_COUNT: number;
    MECHANICS_VALIDATION_RESULT: "ok" | "downgraded" | "rejected_partial";
    MECHANICS_FALLBACK: MechanicsFallback;
    FLASH_CALLS_PER_ROUND: number;
  };
};

export function isTrpgMechanicsRefereeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[TRPG_MECHANICS_REFEREE_ENABLED_ENV]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function isMechanicsClass(value: string): value is MechanicsClass {
  return (MECHANICS_CLASSES as readonly string[]).includes(value);
}

export function isTickClass(value: string): value is TickClass {
  return (TICK_CLASSES as readonly string[]).includes(value);
}
