import { statModifier } from "./stats";
import type { TrpgSheetSnapshot } from "./types";
import {
  CONTROL_MODIFIER,
  DURATION_TICKS,
  clampHpAmount,
  classRank,
  isPhysicalThreatAction,
  recoveryDc,
  rollDiceExpression,
  totalOngoingDamageCap,
  type DiceRng,
  DEFAULT_DICE_RNG,
} from "./mechanicsDice";
import {
  fallbackRecoveryStat,
  inferPhysicalThreat,
  inventoryHasItem,
  parseFlashMechanicsOutput,
  sanitizeOngoingAdd,
  validateDirectEffect,
} from "./mechanicsValidate";
import type {
  FlashActorEffect,
  FlashMechanicsOutput,
  MechanicsActorInput,
  MechanicsResolution,
  RecoveryRollRecord,
  TrpgOngoingEffect,
} from "./mechanicsTypes";
import { NO_DOUBLE_BURST_ON_APPLICATION } from "./mechanicsTypes";

export type MechanicsResolveInput = {
  campaignId: number;
  roundId: number;
  roundNumber: number;
  sheets: TrpgSheetSnapshot[];
  effects: TrpgOngoingEffect[];
  actors: MechanicsActorInput[];
  flash: FlashMechanicsOutput | null;
  fallback: MechanicsResolution["fallback"];
  calledFlash: boolean;
  model: string | null;
  latencyMs: number;
  baseDc: number;
  specialRules?: string;
  startInventory?: string[];
  existing?: MechanicsResolution | null;
  flashRaw?: string | null;
  rng?: DiceRng;
  recoveryRng?: () => number;
  preActionOnly?: boolean;
};

export function resolveRoundMechanics(input: MechanicsResolveInput): MechanicsResolution {
  if (input.existing?.v === 1 && input.existing.complete) return input.existing;
  const rng = input.rng ?? DEFAULT_DICE_RNG;
  const recoveryRng = input.recoveryRng ?? (() => rng(20));
  const sheets = new Map(input.sheets.map((sheet) => [sheet.participantId, { ...sheet, inventory: [...sheet.inventory] }]));
  const liveEffects = input.effects.map((effect) => ({ ...effect }));
  const preActionRecoveries: RecoveryRollRecord[] = input.existing?.preActionRecoveries?.length
    ? input.existing.preActionRecoveries.map((row) => ({ ...row }))
    : [];
  const actionModifiers: Record<string, number> = { ...(input.existing?.actionModifiers ?? {}) };

  if (!input.existing?.preActionRecoveries?.length) {
    for (const effect of liveEffects) {
      if (effect.kind !== "control" || effect.remainingTicks <= 0) continue;
      if (effect.recoveryMode === "duration" || effect.recoveryMode === "treatment") {
        actionModifiers[String(effect.participantId)] =
          (actionModifiers[String(effect.participantId)] ?? 0) + (effect.actionModifier || CONTROL_MODIFIER[effect.severity]);
        continue;
      }
      const sheet = sheets.get(effect.participantId);
      const rec = rollRecovery(effect, sheet, input.baseDc, recoveryRng, "pre_action");
      preActionRecoveries.push(rec);
      if (rec.success) {
        effect.remainingTicks = 0;
        rec.cleared = true;
      } else {
        actionModifiers[String(effect.participantId)] =
          (actionModifiers[String(effect.participantId)] ?? 0) + (effect.actionModifier || CONTROL_MODIFIER[effect.severity]);
      }
    }
  } else {
    for (const rec of preActionRecoveries) {
      if (!rec.success) continue;
      const effect = liveEffects.find((row) => row.id === rec.effectId);
      if (effect) effect.remainingTicks = 0;
    }
  }

  if (input.preActionOnly) {
    return {
      v: 1,
      complete: false,
      campaignId: input.campaignId,
      roundId: input.roundId,
      roundNumber: input.roundNumber,
      calledFlash: false,
      model: null,
      latencyMs: 0,
      fallback: "none",
      validation: "ok",
      preActionRecoveries,
      actionModifiers,
      actors: [],
      ongoingTicks: [],
      recoveries: preActionRecoveries,
      ongoingAdds: [],
      ongoingUpdates: [],
      ongoingClearedIds: preActionRecoveries.filter((row) => row.cleared).map((row) => row.effectId),
      consumeItems: [],
      hpAfter: Object.fromEntries([...sheets.values()].map((sheet) => [String(sheet.participantId), sheet.hp])),
      incapacitated: [],
      applied: false,
      flashRaw: input.flashRaw ?? input.existing?.flashRaw ?? null,
      packet: "",
      observability: emptyObservability(),
    };
  }

  const flashById = new Map((input.flash?.effects ?? []).map((row) => [row.participantId, row]));
  const actors: MechanicsResolution["actors"] = [];
  const consumeItems: MechanicsResolution["consumeItems"] = [];
  const ongoingAdds: MechanicsResolution["ongoingAdds"] = [];
  const ongoingClearedIds = new Set<number>();
  const recoveries: RecoveryRollRecord[] = [...preActionRecoveries];
  const ongoingTicks: MechanicsResolution["ongoingTicks"] = [];
  let validation: MechanicsResolution["validation"] = "ok";

  for (const actor of input.actors) {
    const sheet = sheets.get(actor.participantId);
    if (!sheet) {
      validation = "rejected_partial";
      actors.push({
        participantId: actor.participantId,
        actionType: actor.actionType,
        tier: actor.tier,
        physicalThreat: false,
        direct: {
          effect: "none",
          class: "NONE",
          cause: "none",
          dice: null,
          hpBefore: 0,
          hpAfter: 0,
          rejected: true,
          rejectReason: "unknown_participant",
        },
      });
      continue;
    }
    const flash = flashById.get(actor.participantId) ?? emptyFlash(actor.participantId);
    const physicalThreat = inferPhysicalThreat(actor.actionType, flash.cause) && isPhysicalThreatAction(actor.actionType);
    const direct = validateDirectEffect({
      actionType: actor.actionType,
      body: actor.body,
      tier: actor.tier,
      effect: flash.directEffect,
      klass: flash.directClass,
      cause: flash.cause,
      physicalThreat,
    });
    if (direct.rejected) validation = validation === "ok" ? "downgraded" : validation;

    let hp = sheet.hp;
    if (direct.effect === "harm" && direct.klass !== "NONE") {
      const dice = rollDiceExpression(direct.klass, sheet.maxHp, rng);
      const hpAfter = clampHpAmount(hp - dice.amount, sheet.maxHp);
      actors.push({
        participantId: actor.participantId,
        actionType: actor.actionType,
        tier: actor.tier,
        physicalThreat,
        direct: {
          effect: "harm",
          class: direct.klass,
          cause: direct.cause,
          dice,
          hpBefore: hp,
          hpAfter,
          rejected: false,
          rejectReason: null,
        },
      });
      hp = hpAfter;
    } else if (direct.effect === "heal" && direct.klass !== "NONE") {
      const healClass = direct.klass === "HEAVY" || direct.klass === "MEDIUM" || direct.klass === "LIGHT" ? direct.klass : "LIGHT";
      const dice = rollDiceExpression(healClass, sheet.maxHp, rng);
      const hpAfter = clampHpAmount(hp + dice.amount, sheet.maxHp);
      actors.push({
        participantId: actor.participantId,
        actionType: actor.actionType,
        tier: actor.tier,
        physicalThreat,
        direct: {
          effect: "heal",
          class: healClass,
          cause: "healing",
          dice,
          hpBefore: hp,
          hpAfter,
          rejected: false,
          rejectReason: null,
        },
      });
      hp = hpAfter;
    } else {
      actors.push({
        participantId: actor.participantId,
        actionType: actor.actionType,
        tier: actor.tier,
        physicalThreat,
        direct: {
          effect: "none",
          class: "NONE",
          cause: "none",
          dice: null,
          hpBefore: hp,
          hpAfter: hp,
          rejected: direct.rejected,
          rejectReason: direct.reason,
        },
      });
    }
    sheet.hp = hp;

    if (flash.consumeItem) {
      if (inventoryHasItem(sheet.inventory, flash.consumeItem)) {
        consumeItems.push({ participantId: actor.participantId, item: flash.consumeItem });
        const idx = sheet.inventory.indexOf(flash.consumeItem);
        if (idx >= 0) sheet.inventory.splice(idx, 1);
      } else {
        validation = "downgraded";
      }
    }

    for (const id of flash.ongoingRemoveIds ?? []) {
      const effect = liveEffects.find((row) => row.id === id && row.participantId === actor.participantId);
      if (effect) {
        effect.remainingTicks = 0;
        ongoingClearedIds.add(id);
      }
    }
    for (const id of flash.ongoingReduceIds ?? []) {
      const effect = liveEffects.find((row) => row.id === id && row.participantId === actor.participantId);
      if (effect && effect.remainingTicks > 1) effect.remainingTicks -= 1;
    }

    for (const rawAdd of flash.ongoingAdd ?? []) {
      const add = sanitizeOngoingAdd(rawAdd, {
        sheetStats: sheet.stats,
        inventory: sheet.inventory,
        specialRules: input.specialRules ?? "",
        startInventory: input.startInventory ?? [],
      });
      const existing = liveEffects.find(
        (row) =>
          row.participantId === actor.participantId &&
          row.stackKey === add.stackKey &&
          row.remainingTicks > 0 &&
          row.stackPolicy !== "independent"
      );
      const ticks =
        add.durationBand === "PERSISTENT"
          ? -1
          : DURATION_TICKS[add.durationBand === "SHORT" || add.durationBand === "LONG" ? add.durationBand : "MEDIUM"];
      const startsRound = input.roundNumber + (NO_DOUBLE_BURST_ON_APPLICATION ? 1 : 0);
      if (existing) {
        if (existing.stackPolicy === "upgrade" || classRank(add.severity) > classRank(existing.severity)) {
          existing.severity = add.severity;
          existing.tickClass = add.tickClass ?? existing.tickClass;
          existing.actionModifier = CONTROL_MODIFIER[add.severity];
        }
        if (existing.remainingTicks >= 0) existing.remainingTicks = Math.max(existing.remainingTicks, ticks);
        continue;
      }
      liveEffects.push({
        id: -1 * (ongoingAdds.length + 1),
        campaignId: input.campaignId,
        participantId: actor.participantId,
        label: add.label,
        kind: add.kind,
        severity: add.severity,
        stackKey: add.stackKey,
        stackPolicy: add.stackPolicy ?? "refresh",
        sourceRound: input.roundNumber,
        appliedRound: input.roundNumber,
        startsRound,
        tickClass: add.tickClass ?? null,
        remainingTicks: ticks,
        lastTickRound: null,
        recoveryMode: add.recoveryMode,
        recoveryStat: add.recoveryStat,
        treatmentMode: add.treatmentMode,
        requiredItem: add.requiredItem ?? null,
        actionModifier: CONTROL_MODIFIER[add.severity],
        metadata: {},
      });
      ongoingAdds.push({ ...liveEffects[liveEffects.length - 1]! });
    }
  }

  const capUsed = new Map<number, number>();
  for (const effect of liveEffects) {
    if (effect.kind !== "periodic_harm" || effect.remainingTicks === 0) continue;
    if (effect.lastTickRound === input.roundNumber) continue;
    if (effect.startsRound > input.roundNumber) continue;
    const sheet = sheets.get(effect.participantId);
    if (!sheet || !effect.tickClass) continue;
    const dice = rollDiceExpression(effect.tickClass, sheet.maxHp, rng);
    const used = capUsed.get(effect.participantId) ?? 0;
    const cap = totalOngoingDamageCap(sheet.maxHp);
    const allowed = Math.max(0, Math.min(dice.amount, cap - used));
    const hpAfter = clampHpAmount(sheet.hp - allowed, sheet.maxHp);
    ongoingTicks.push({
      effectId: effect.id,
      participantId: effect.participantId,
      label: effect.label,
      kind: effect.kind,
      dice: { ...dice, amount: allowed },
      hpBefore: sheet.hp,
      hpAfter,
    });
    capUsed.set(effect.participantId, used + allowed);
    sheet.hp = hpAfter;
    effect.lastTickRound = input.roundNumber;
    if (effect.remainingTicks > 0) effect.remainingTicks -= 1;
    if (
      effect.recoveryMode === "save" ||
      effect.recoveryMode === "save_or_treatment"
    ) {
      const rec = rollRecovery(effect, sheet, input.baseDc, recoveryRng, "after_tick");
      recoveries.push(rec);
      if (rec.success) {
        rec.cleared = true;
        effect.remainingTicks = 0;
        if (effect.id > 0) ongoingClearedIds.add(effect.id);
      }
    }
    if (effect.remainingTicks === 0 && effect.id > 0) ongoingClearedIds.add(effect.id);
  }

  for (const effect of liveEffects) {
    if (effect.kind === "periodic_harm") continue;
    if (effect.remainingTicks <= 0) continue;
    if (effect.startsRound > input.roundNumber) continue;
    if (effect.lastTickRound === input.roundNumber) continue;
    effect.lastTickRound = input.roundNumber;
    if (effect.remainingTicks > 0) effect.remainingTicks -= 1;
    if (effect.remainingTicks === 0 && effect.id > 0) ongoingClearedIds.add(effect.id);
  }

  const original = new Map(input.effects.map((row) => [row.id, row]));
  const ongoingUpdates: MechanicsResolution["ongoingUpdates"] = [];
  for (const effect of liveEffects) {
    if (effect.id <= 0) continue;
    const before = original.get(effect.id);
    if (!before) continue;
    if (
      before.remainingTicks !== effect.remainingTicks ||
      before.severity !== effect.severity ||
      before.tickClass !== effect.tickClass ||
      before.lastTickRound !== effect.lastTickRound ||
      before.actionModifier !== effect.actionModifier
    ) {
      ongoingUpdates.push({
        id: effect.id,
        severity: effect.severity,
        tickClass: effect.tickClass,
        remainingTicks: effect.remainingTicks,
        lastTickRound: effect.lastTickRound,
        actionModifier: effect.actionModifier,
      });
    }
  }

  const hpAfter: Record<string, number> = {};
  const incapacitated: MechanicsResolution["incapacitated"] = [];
  for (const sheet of sheets.values()) {
    hpAfter[String(sheet.participantId)] = sheet.hp;
    if (sheet.hp <= 0) incapacitated.push({ participantId: sheet.participantId, reason: "hp_zero" });
  }

  const packet = formatAuthoritativePacket({
    sheets: [...sheets.values()],
    actors,
    actorInputs: input.actors,
    ongoingTicks,
    recoveries,
    liveEffects,
  });

  const harmCount = actors.filter((row) => row.direct?.effect === "harm").length;
  const healCount = actors.filter((row) => row.direct?.effect === "heal").length;
  return {
    v: 1,
    complete: true,
    campaignId: input.campaignId,
    roundId: input.roundId,
    roundNumber: input.roundNumber,
    calledFlash: input.calledFlash,
    model: input.model,
    latencyMs: input.latencyMs,
    fallback: input.fallback,
    validation,
    preActionRecoveries,
    actionModifiers,
    actors,
    ongoingTicks,
    recoveries,
    ongoingAdds,
    ongoingUpdates,
    ongoingClearedIds: [...ongoingClearedIds],
    consumeItems,
    hpAfter,
    incapacitated,
    applied: false,
    flashRaw: input.flashRaw ?? input.existing?.flashRaw ?? null,
    packet,
    observability: {
      MECHANICS_CALLED: input.calledFlash,
      MECHANICS_MODEL: input.model,
      MECHANICS_LATENCY_MS: input.latencyMs,
      MECHANICS_EFFECT_COUNT: (input.flash?.effects.length ?? 0) + ongoingAdds.length,
      MECHANICS_HARM_COUNT: harmCount,
      MECHANICS_HEAL_COUNT: healCount,
      ONGOING_ACTIVE_COUNT: liveEffects.filter((row) => row.remainingTicks !== 0).length,
      ONGOING_TICK_COUNT: ongoingTicks.length,
      ONGOING_DAMAGE_TOTAL: ongoingTicks.reduce((sum, row) => sum + (row.dice?.amount ?? 0), 0),
      ONGOING_CLEARED_COUNT: ongoingClearedIds.size,
      RECOVERY_ROLL_COUNT: recoveries.length,
      RECOVERY_SUCCESS_COUNT: recoveries.filter((row) => row.success).length,
      MECHANICS_VALIDATION_RESULT: validation,
      MECHANICS_FALLBACK: input.fallback,
      FLASH_CALLS_PER_ROUND: input.calledFlash ? 1 : 0,
    },
  };
}

function emptyFlash(participantId: number): FlashActorEffect {
  return {
    participantId,
    directEffect: "none",
    directClass: "NONE",
    cause: "none",
    ongoingAdd: [],
    ongoingRemoveIds: [],
    ongoingReduceIds: [],
    consumeItem: null,
  };
}

function rollRecovery(
  effect: TrpgOngoingEffect,
  sheet: TrpgSheetSnapshot | undefined,
  baseDc: number,
  recoveryRng: () => number,
  timing: RecoveryRollRecord["timing"]
): RecoveryRollRecord {
  const statKey = fallbackRecoveryStat(effect.recoveryStat, sheet?.stats ?? {});
  const modifier = statModifier(sheet?.stats[statKey] ?? 5);
  const d20 = recoveryRng();
  const dc = recoveryDc(baseDc, effect.severity);
  return {
    effectId: effect.id,
    participantId: effect.participantId,
    d20,
    modifier,
    dc,
    success: d20 + modifier >= dc,
    timing,
    cleared: false,
  };
}

function formatAuthoritativePacket(opts: {
  sheets: TrpgSheetSnapshot[];
  actors: MechanicsResolution["actors"];
  actorInputs: MechanicsActorInput[];
  ongoingTicks: MechanicsResolution["ongoingTicks"];
  recoveries: RecoveryRollRecord[];
  liveEffects: TrpgOngoingEffect[];
}): string {
  const blocks = opts.sheets.map((sheet) => {
    const name = sheet.name;
    const ticks = opts.ongoingTicks.filter((row) => row.participantId === sheet.participantId);
    const recs = opts.recoveries.filter((row) => row.participantId === sheet.participantId);
    const actor = opts.actors.find((row) => row.participantId === sheet.participantId);
    const input = opts.actorInputs.find((row) => row.participantId === sheet.participantId);
    const lines = [`${name}`];
    if (ticks.length) {
      lines.push("ONGOING:");
      for (const tick of ticks) {
        lines.push(
          `${tick.label} tick ${tick.dice?.expression ?? ""} = ${tick.dice?.total ?? 0} HP ${tick.hpBefore} → ${tick.hpAfter}`
        );
      }
    }
    for (const rec of recs) {
      lines.push(
        `recovery: d20 ${rec.d20} + ${rec.modifier} vs DC ${rec.dc} ${rec.success ? "SUCCESS" : "FAILURE"}${rec.cleared ? " cleared after this tick" : ""}`
      );
    }
    if (actor && input) {
      lines.push(`CURRENT ACTION: ${input.actionType ?? "free"} ${input.tier ?? ""}`.trim());
      if (actor.direct && actor.direct.effect !== "none") {
        lines.push(
          `direct ${actor.direct.effect}: ${actor.direct.class} ${actor.direct.dice?.expression ?? ""} = ${actor.direct.dice?.total ?? 0} HP ${actor.direct.hpBefore} → ${actor.direct.hpAfter}`
        );
      } else {
        lines.push("direct: NONE");
      }
    }
    lines.push(`최종: HP ${sheet.hp}/${sheet.maxHp}`);
    return lines.join("\n");
  });
  return `[AUTHORITATIVE MECHANICS]\n${blocks.join("\n\n")}`;
}

function emptyObservability(): MechanicsResolution["observability"] {
  return {
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
  };
}

export function parseFlashOrEmpty(raw: string | null): FlashMechanicsOutput {
  if (!raw?.trim()) return { effects: [] };
  return parseFlashMechanicsOutput(raw);
}

export function shouldCallMechanicsFlash(opts: {
  opening: boolean;
  rolls: number;
  treatmentNeeded: boolean;
}): boolean {
  if (opts.opening) return false;
  return opts.rolls > 0 || opts.treatmentNeeded;
}
