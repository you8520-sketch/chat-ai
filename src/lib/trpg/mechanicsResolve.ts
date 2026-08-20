import { statModifier } from "./stats";
import type { TrpgSheetSnapshot } from "./types";
import {
  CONTROL_MODIFIER,
  DURATION_TICKS,
  clampHpAmount,
  classRank,
  recoveryDc,
  rollDiceExpression,
  totalOngoingDamageCap,
  type DiceRng,
  DEFAULT_DICE_RNG,
} from "./mechanicsDice";
import {
  fallbackRecoveryStat,
  inventoryHasItem,
  mergeStackCureFields,
  parseFlashMechanicsOutput,
  resolvePhysicalThreat,
  sanitizeOngoingAdd,
  validateDirectEffect,
  validateOngoingApplication,
  validateTreatment,
} from "./mechanicsValidate";
import {
  isOngoingActive,
  NO_DOUBLE_BURST_ON_APPLICATION,
  type FlashActorEffect,
  type FlashMechanicsOutput,
  type MechanicsActorInput,
  type MechanicsResolution,
  type RecoveryRollRecord,
  type TrpgOngoingEffect,
} from "./mechanicsTypes";

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
  scene?: string;
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

  // 1. existing pre-action control recovery
  if (!input.existing?.preActionRecoveries?.length) {
    for (const effect of liveEffects) {
      if (effect.kind !== "control" || !isOngoingActive(effect.remainingTicks)) continue;
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

  const consumeItems: MechanicsResolution["consumeItems"] = [];
  const ongoingAdds: MechanicsResolution["ongoingAdds"] = [];
  const ongoingClearedIds = new Set<number>();
  const recoveries: RecoveryRollRecord[] = [...preActionRecoveries];
  const ongoingTicks: MechanicsResolution["ongoingTicks"] = [];
  let validation: MechanicsResolution["validation"] = "ok";

  // 2. existing scheduled periodic tick
  const capUsed = new Map<number, number>();
  for (const effect of liveEffects) {
    if (effect.kind !== "periodic_harm" || !isOngoingActive(effect.remainingTicks)) continue;
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
    // 3. periodic after-tick recovery
    if (effect.recoveryMode === "save" || effect.recoveryMode === "save_or_treatment") {
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
    if (!isOngoingActive(effect.remainingTicks)) continue;
    if (effect.startsRound > input.roundNumber) continue;
    if (effect.lastTickRound === input.roundNumber) continue;
    effect.lastTickRound = input.roundNumber;
    if (effect.remainingTicks > 0) effect.remainingTicks -= 1;
    if (effect.remainingTicks === 0 && effect.id > 0) ongoingClearedIds.add(effect.id);
  }

  // 4. determine pre-action HP/status
  const preActionHp = new Map<number, number>();
  const preActionIncap = new Set<number>();
  for (const sheet of sheets.values()) {
    preActionHp.set(sheet.participantId, sheet.hp);
    if (sheet.hp <= 0) preActionIncap.add(sheet.participantId);
  }

  const flashRows = input.flash?.effects ?? [];
  const actors: MechanicsResolution["actors"] = [];

  // 5. server action d20 already happened before Flash.
  // 6–8. Flash classification → current direct → new ongoing (starts next round)
  for (const actor of input.actors) {
    const sourceSheet = sheets.get(actor.participantId);
    if (!sourceSheet) {
      validation = "rejected_partial";
      actors.push({
        participantId: actor.participantId,
        actionType: actor.actionType,
        tier: actor.tier,
        physicalThreat: false,
        preActionHp: 0,
        skippedPhysicalAction: true,
        skipReason: null,
        direct: {
          effect: "none",
          class: "NONE",
          cause: "none",
          sourceParticipantId: actor.participantId,
          targetParticipantId: actor.participantId,
          dice: null,
          hpBefore: 0,
          hpAfter: 0,
          rejected: true,
          rejectReason: "unknown_participant",
        },
      });
      continue;
    }

    const rows = flashRows.filter(
      (row) => row.sourceParticipantId === actor.participantId || row.participantId === actor.participantId
    );
    const used = rows.length ? rows : [emptyFlash(actor.participantId)];
    let lastDirect: MechanicsResolution["actors"][number]["direct"] = null;
    let physicalThreat = false;
    let skipped = false;

    if (preActionIncap.has(actor.participantId)) {
      skipped = true;
      lastDirect = {
        effect: "none",
        class: "NONE",
        cause: "none",
        sourceParticipantId: actor.participantId,
        targetParticipantId: actor.participantId,
        dice: null,
        hpBefore: sourceSheet.hp,
        hpAfter: sourceSheet.hp,
        rejected: true,
        rejectReason: "PRE_ACTION_HP_ZERO",
      };
    } else {
      for (const flash of used) {
        const targetId = flash.targetParticipantId || actor.participantId;
        const targetSheet = sheets.get(targetId);
        if (!targetSheet) {
          validation = "rejected_partial";
          lastDirect = {
            effect: "none",
            class: "NONE",
            cause: "none",
            sourceParticipantId: actor.participantId,
            targetParticipantId: targetId,
            dice: null,
            hpBefore: sourceSheet.hp,
            hpAfter: sourceSheet.hp,
            rejected: true,
            rejectReason: "unknown_target",
          };
          continue;
        }
        const threat = resolvePhysicalThreat({
          actionType: actor.actionType,
          body: actor.body,
          scene: input.scene,
          cause: flash.cause,
        });
        physicalThreat = physicalThreat || threat;
        const direct = validateDirectEffect({
          actionType: actor.actionType,
          body: actor.body,
          tier: actor.tier,
          effect: flash.directEffect,
          klass: flash.directClass,
          cause: flash.cause,
          physicalThreat: threat,
        });
        if (direct.rejected) validation = validation === "ok" ? "downgraded" : validation;

        let hp = targetSheet.hp;
        if (direct.effect === "harm" && direct.klass !== "NONE") {
          const dice = rollDiceExpression(direct.klass, targetSheet.maxHp, rng);
          const hpAfter = clampHpAmount(hp - dice.amount, targetSheet.maxHp);
          lastDirect = {
            effect: "harm",
            class: direct.klass,
            cause: direct.cause,
            sourceParticipantId: actor.participantId,
            targetParticipantId: targetId,
            dice,
            hpBefore: hp,
            hpAfter,
            rejected: false,
            rejectReason: null,
          };
          targetSheet.hp = hpAfter;
        } else if (direct.effect === "heal" && direct.klass !== "NONE") {
          const healClass =
            direct.klass === "HEAVY" || direct.klass === "MEDIUM" || direct.klass === "LIGHT" ? direct.klass : "LIGHT";
          const dice = rollDiceExpression(healClass, targetSheet.maxHp, rng);
          const hpAfter = clampHpAmount(hp + dice.amount, targetSheet.maxHp);
          lastDirect = {
            effect: "heal",
            class: healClass,
            cause: "healing",
            sourceParticipantId: actor.participantId,
            targetParticipantId: targetId,
            dice,
            hpBefore: hp,
            hpAfter,
            rejected: false,
            rejectReason: null,
          };
          targetSheet.hp = hpAfter;
        } else {
          lastDirect = {
            effect: "none",
            class: "NONE",
            cause: "none",
            sourceParticipantId: actor.participantId,
            targetParticipantId: targetId,
            dice: null,
            hpBefore: hp,
            hpAfter: hp,
            rejected: direct.rejected,
            rejectReason: direct.reason,
          };
        }

        validation = applyTreatmentsValidation(
          validation,
          flash,
          actor,
          targetId,
          liveEffects,
          sheets,
          consumeItems,
          ongoingClearedIds
        );

        for (const rawAdd of flash.ongoingAdd ?? []) {
          const add = sanitizeOngoingAdd(rawAdd, {
            sheetStats: targetSheet.stats,
            inventory: targetSheet.inventory,
            specialRules: input.specialRules ?? "",
            startInventory: input.startInventory ?? [],
          });
          if (!add) {
            validation = validation === "ok" ? "downgraded" : validation;
            continue;
          }
          const app = validateOngoingApplication({
            add,
            actionType: actor.actionType,
            body: actor.body,
            scene: input.scene,
            tier: actor.tier,
            cause: flash.cause,
            physicalThreat: threat,
          });
          if (!app.ok) {
            validation = validation === "ok" ? "downgraded" : validation;
            continue;
          }
          const existing = liveEffects.find(
            (row) =>
              row.participantId === targetId &&
              row.stackKey === add.stackKey &&
              isOngoingActive(row.remainingTicks) &&
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
            const cure = mergeStackCureFields(existing, add);
            existing.recoveryMode = cure.recoveryMode;
            existing.recoveryStat = cure.recoveryStat;
            existing.treatmentMode = cure.treatmentMode;
            existing.requiredItem = cure.requiredItem;
            existing.stackPolicy = cure.stackPolicy;
            continue;
          }
          liveEffects.push({
            id: -1 * (ongoingAdds.length + 1),
            campaignId: input.campaignId,
            participantId: targetId,
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
      validation = applyServerOwnedTreatments(
        validation,
        actor,
        used,
        liveEffects,
        sheets,
        consumeItems,
        ongoingClearedIds
      );
    }

    actors.push({
      participantId: actor.participantId,
      actionType: actor.actionType,
      tier: actor.tier,
      physicalThreat,
      preActionHp: preActionHp.get(actor.participantId) ?? sourceSheet.hp,
      skippedPhysicalAction: skipped,
      skipReason: skipped ? "PRE_ACTION_HP_ZERO" : null,
      direct: lastDirect ?? {
        effect: "none",
        class: "NONE",
        cause: "none",
        sourceParticipantId: actor.participantId,
        targetParticipantId: actor.participantId,
        dice: null,
        hpBefore: sourceSheet.hp,
        hpAfter: sourceSheet.hp,
        rejected: false,
        rejectReason: null,
      },
    });
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
      before.actionModifier !== effect.actionModifier ||
      before.recoveryMode !== effect.recoveryMode ||
      before.recoveryStat !== effect.recoveryStat ||
      before.treatmentMode !== effect.treatmentMode ||
      before.requiredItem !== effect.requiredItem ||
      before.stackPolicy !== effect.stackPolicy
    ) {
      ongoingUpdates.push({
        id: effect.id,
        severity: effect.severity,
        tickClass: effect.tickClass,
        remainingTicks: effect.remainingTicks,
        lastTickRound: effect.lastTickRound,
        actionModifier: effect.actionModifier,
        recoveryMode: effect.recoveryMode,
        recoveryStat: effect.recoveryStat,
        treatmentMode: effect.treatmentMode,
        requiredItem: effect.requiredItem,
        stackPolicy: effect.stackPolicy,
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
    preActionHp,
    preActionIncap,
    ongoingAdds,
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
      ONGOING_ACTIVE_COUNT: liveEffects.filter((row) => isOngoingActive(row.remainingTicks)).length,
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

function applyTreatmentsValidation(
  validation: MechanicsResolution["validation"],
  flash: FlashActorEffect,
  actor: MechanicsActorInput,
  targetId: number,
  liveEffects: TrpgOngoingEffect[],
  sheets: Map<number, TrpgSheetSnapshot>,
  consumeItems: MechanicsResolution["consumeItems"],
  ongoingClearedIds: Set<number>
): MechanicsResolution["validation"] {
  const inventories = [...sheets.values()].map((sheet) => ({
    participantId: sheet.participantId,
    items: sheet.inventory,
  }));
  const removeIds = flash.ongoingRemoveIds ?? [];
  const reduceIds = flash.ongoingReduceIds ?? [];
  const requested = [...new Set([...removeIds, ...reduceIds])];
  let next = validation;
  let consumed = false;
  for (const id of requested) {
    const effect = liveEffects.find((row) => row.id === id && row.participantId === targetId);
    const verdict = validateTreatment({
      actionType: actor.actionType,
      body: actor.body,
      tier: actor.tier,
      effect: effect ?? null,
      consumeItem: flash.consumeItem ?? effect?.requiredItem ?? null,
      inventories,
    });
    if (verdict.allow === "none") {
      next = next === "ok" ? "downgraded" : next;
      continue;
    }
    if (!effect) continue;
    if (verdict.allow === "remove") {
      effect.remainingTicks = 0;
      if (effect.id > 0) ongoingClearedIds.add(effect.id);
    } else if (verdict.allow === "reduce") {
      if (effect.remainingTicks > 0) effect.remainingTicks -= 1;
      if (effect.remainingTicks === 0 && effect.id > 0) ongoingClearedIds.add(effect.id);
    }
    if (verdict.consume && verdict.ownerParticipantId != null && flash.consumeItem && !consumed) {
      const already = consumeItems.some(
        (row) => row.participantId === verdict.ownerParticipantId && row.item === flash.consumeItem
      );
      const owner = sheets.get(verdict.ownerParticipantId);
      if (!already && owner && inventoryHasItem(owner.inventory, flash.consumeItem)) {
        consumeItems.push({ participantId: verdict.ownerParticipantId, item: flash.consumeItem });
        const idx = owner.inventory.indexOf(flash.consumeItem);
        if (idx >= 0) owner.inventory.splice(idx, 1);
        consumed = true;
      }
    }
  }
  if (flash.consumeItem && !consumed && requested.length === 0) {
    const found = inventories.find((row) => inventoryHasItem(row.items, flash.consumeItem!));
    if (found) {
      // consume without treatment only when Flash asked and item exists — still require treatment intent
      next = next === "ok" ? "downgraded" : next;
    } else {
      next = next === "ok" ? "downgraded" : next;
    }
  }
  return next;
}

function effectMatchesTreatment(effect: TrpgOngoingEffect, body: string, item: string | null): boolean {
  const key = `${effect.stackKey} ${effect.label}`;
  if (item === "해독제" || /해독|antidote|poison|중독/i.test(body)) {
    return /poison|중독|독/i.test(key);
  }
  if (item === "붕대" || /붕대|지혈|bandage|bleed|출혈/i.test(body)) {
    return /bleed|출혈/i.test(key);
  }
  return true;
}

function inferConsumeItem(body: string, flashItem: string | null): string | null {
  if (flashItem?.trim()) return flashItem.trim();
  if (/해독제|antidote/i.test(body)) return "해독제";
  if (/붕대|bandage/i.test(body)) return "붕대";
  return null;
}

function inferTreatmentTarget(
  actor: MechanicsActorInput,
  flashRows: FlashActorEffect[],
  sheets: Map<number, TrpgSheetSnapshot>
): number {
  for (const sheet of sheets.values()) {
    if (sheet.participantId !== actor.participantId && sheet.name && actor.body.includes(sheet.name)) {
      return sheet.participantId;
    }
  }
  const hinted = flashRows.find(
    (row) =>
      row.targetParticipantId &&
      row.targetParticipantId !== (row.sourceParticipantId ?? row.participantId) &&
      sheets.has(row.targetParticipantId)
  );
  if (hinted?.targetParticipantId) return hinted.targetParticipantId;
  return actor.participantId;
}

function applyServerOwnedTreatments(
  validation: MechanicsResolution["validation"],
  actor: MechanicsActorInput,
  flashRows: FlashActorEffect[],
  liveEffects: TrpgOngoingEffect[],
  sheets: Map<number, TrpgSheetSnapshot>,
  consumeItems: MechanicsResolution["consumeItems"],
  ongoingClearedIds: Set<number>
): MechanicsResolution["validation"] {
  const targetId = inferTreatmentTarget(actor, flashRows, sheets);
  const consumeItem = inferConsumeItem(actor.body, flashRows.find((row) => row.consumeItem)?.consumeItem ?? null);
  const synthetic: FlashActorEffect = {
    ...emptyFlash(actor.participantId),
    sourceParticipantId: actor.participantId,
    targetParticipantId: targetId,
    consumeItem,
    ongoingRemoveIds: liveEffects
      .filter(
        (row) =>
          row.participantId === targetId &&
          isOngoingActive(row.remainingTicks) &&
          row.id > 0 &&
          effectMatchesTreatment(row, actor.body, consumeItem)
      )
      .map((row) => row.id),
  };
  if (!synthetic.ongoingRemoveIds?.length) return validation;
  return applyTreatmentsValidation(
    validation,
    synthetic,
    actor,
    targetId,
    liveEffects,
    sheets,
    consumeItems,
    ongoingClearedIds
  );
}

function emptyFlash(participantId: number): FlashActorEffect {
  return {
    sourceParticipantId: participantId,
    targetParticipantId: participantId,
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
  preActionHp: Map<number, number>;
  preActionIncap: Set<number>;
  ongoingAdds: MechanicsResolution["ongoingAdds"];
}): string {
  const blocks = opts.sheets.map((sheet) => {
    const name = sheet.name;
    const ticks = opts.ongoingTicks.filter((row) => row.participantId === sheet.participantId);
    const recs = opts.recoveries.filter((row) => row.participantId === sheet.participantId);
    const actor = opts.actors.find((row) => row.participantId === sheet.participantId);
    const input = opts.actorInputs.find((row) => row.participantId === sheet.participantId);
    const adds = opts.ongoingAdds.filter((row) => row.participantId === sheet.participantId);
    const lines = [`${name}`];
    const preRecs = recs.filter((row) => row.timing === "pre_action");
    for (const rec of preRecs) {
      lines.push(
        `pre-action recovery: d20 ${rec.d20} + ${rec.modifier} vs DC ${rec.dc} ${rec.success ? "SUCCESS" : "FAILURE"}${rec.cleared ? " cleared" : ""}`
      );
    }
    if (ticks.length) {
      lines.push("ONGOING:");
      for (const tick of ticks) {
        lines.push(
          `${tick.label} tick ${tick.dice?.expression ?? ""} = ${tick.dice?.total ?? 0} HP ${tick.hpBefore} → ${tick.hpAfter}`
        );
      }
    }
    for (const rec of recs.filter((row) => row.timing === "after_tick")) {
      lines.push(
        `after-tick recovery: d20 ${rec.d20} + ${rec.modifier} vs DC ${rec.dc} ${rec.success ? "SUCCESS" : "FAILURE"}${rec.cleared ? " cleared after this tick" : ""}`
      );
    }
    const preHp = opts.preActionHp.get(sheet.participantId);
    if (preHp != null) lines.push(`PRE_ACTION_HP ${preHp}`);
    if (opts.preActionIncap.has(sheet.participantId)) {
      lines.push("PRE_ACTION_HP_ZERO incapacitated; current physical action skipped");
    }
    if (actor && input) {
      lines.push(`CURRENT ACTION: ${input.actionType ?? "free"} ${input.tier ?? ""}`.trim());
      if (actor.skippedPhysicalAction) {
        lines.push("authoritative: 시도하지 못함/쓰러짐");
      } else if (actor.direct && actor.direct.effect !== "none") {
        const targetNote =
          actor.direct.targetParticipantId !== actor.direct.sourceParticipantId
            ? ` target=${actor.direct.targetParticipantId}`
            : "";
        lines.push(
          `direct ${actor.direct.effect}: ${actor.direct.class} ${actor.direct.dice?.expression ?? ""} = ${actor.direct.dice?.total ?? 0} HP ${actor.direct.hpBefore} → ${actor.direct.hpAfter}${targetNote}`
        );
      } else {
        lines.push("direct: NONE");
      }
    }
    for (const add of adds) {
      lines.push(`new ongoing ${add.label} startsRound=${add.startsRound}`);
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
