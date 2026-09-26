/**
 * Bounded JEV Decisions mapping for the TRPG mechanics referee shadow benchmark.
 * Maps into the existing FlashActorEffect semantic structure — no second mechanics
 * policy, no numeric HP/dice ownership, no invented participant IDs.
 */
import type { JevDecisionAnswer, JevDecisionQuestions } from "@/lib/jevDecisions";
import { buildMechanicsRefereeUserBlock } from "@/lib/trpg/mechanicsReferee";
import {
  fixtureParticipantAliases,
  type MechanicsRefereeBenchmarkFixture,
} from "@/lib/trpg/mechanicsRefereeBenchmarkCorpus";
import {
  DIRECT_CAUSES,
  DIRECT_EFFECTS,
  DURATION_BANDS,
  MECHANICS_CLASSES,
  V1_ONGOING_KINDS,
  type DirectCause,
  type DirectEffectKind,
  type DurationBand,
  type FlashActorEffect,
  type FlashOngoingAdd,
  type MechanicsClass,
  type V1OngoingKind,
} from "@/lib/trpg/mechanicsTypes";

export const TRPG_MECHANICS_JEV_QUESTION_IDS = [
  "direct_effect",
  "direct_class",
  "cause",
  "ongoing_kind",
  "duration",
  "treatment",
  "target",
  "consume_item",
] as const;

export type TrpgMechanicsJevQuestionId = (typeof TRPG_MECHANICS_JEV_QUESTION_IDS)[number];

/** Shared input owner: same public fields DeepSeek Flash receives. */
export function buildMechanicsRefereeJevState(
  fixture: MechanicsRefereeBenchmarkFixture
): Record<string, unknown> {
  const userBlock = buildMechanicsRefereeUserBlock({
    scene: fixture.previousScene,
    resolutionOrder: `[RESOLUTION ORDER]\n1. ${fixture.actor.name}`,
    actors: [fixture.actor],
    sheets: fixture.sheets,
    effects: fixture.effects,
    specialRules: fixture.specialRules ?? "",
  });
  return {
    timing: "PRE_GM",
    sceneSource: "previousNarration",
    currentGmResultAvailable: false,
    refereeUserBlock: userBlock,
    actor: {
      participantId: fixture.actor.participantId,
      name: fixture.actor.name,
      actionType: fixture.actor.actionType,
      body: fixture.actor.body,
      tier: fixture.actor.tier,
      d20: fixture.actor.d20,
      modifier: fixture.actor.modifier,
      finalScore: fixture.actor.finalScore,
      dc: fixture.actor.dc,
      statKey: fixture.actor.statKey,
    },
    participants: fixture.sheets.map((s) => ({
      alias: `P${s.participantId}`,
      participantId: s.participantId,
      name: s.name,
      hp: s.hp,
      maxHp: s.maxHp,
      conditions: s.conditions,
      inventory: s.inventory,
    })),
    ongoing: fixture.effects.map((e) => ({
      id: e.id,
      participantId: e.participantId,
      label: e.label,
      kind: e.kind,
      severity: e.severity,
      requiredItem: e.requiredItem,
    })),
  };
}

function choiceCriteria(entries: Array<[string, string]>): Record<string, string> {
  return Object.fromEntries(entries);
}

export function buildMechanicsRefereeJevQuestions(
  fixture: MechanicsRefereeBenchmarkFixture
): JevDecisionQuestions {
  const aliases = fixtureParticipantAliases(fixture);
  const inventoryItems = [
    ...new Set(fixture.sheets.flatMap((s) => s.inventory.map((i) => i.trim()).filter(Boolean))),
  ];
  const treatmentEffects = fixture.effects.map((e) => [`EFFECT_${e.id}`, `${e.label} (#${e.id})`] as [string, string]);

  const treatmentCriteria: Array<[string, string]> = [
    ["NONE", "No treatment action."],
    ["HEAL_ONLY", "HP heal / first aid without clearing an ongoing id."],
  ];
  for (const [key, label] of treatmentEffects) {
    treatmentCriteria.push([`REMOVE_${key}`, `Fully clear ${label}`]);
    treatmentCriteria.push([`REDUCE_${key}`, `Reduce ${label}`]);
  }

  return {
    direct_effect: {
      type: "choice",
      instructions:
        "Classify the direct HP effect of this actor's action. Never invent numeric damage. FAILURE is not automatic harm.",
      criteria: choiceCriteria([
        ["NONE", "No direct HP effect."],
        ["HARM", "Direct harm classification only (server rolls amount)."],
        ["HEAL", "Direct heal classification only when treatment/support/item."],
      ]),
    },
    direct_class: {
      type: "choice",
      instructions: "Choose the severity class band. Do not output a numeric HP amount.",
      criteria: choiceCriteria(MECHANICS_CLASSES.map((c) => [c, `Severity class ${c}`])),
    },
    cause: {
      type: "choice",
      instructions: "Choose the cause of any direct effect. Use NONE when there is no effect.",
      criteria: choiceCriteria([
        ["NONE", "No cause / no effect."],
        ["TRADEOFF", "Partial-success tradeoff cost."],
        ["ENEMY_COUNTER", "Enemy counterattack or gunfire."],
        ["HAZARD", "Trap, collapse, creature, environmental hazard."],
        ["SELF_COST", "Self-inflicted cost."],
        ["HEALING", "Treatment/support healing."],
      ]),
    },
    ongoing_kind: {
      type: "choice",
      instructions:
        "V1 ongoing kinds only. Do not invent poison/curse without an explicit cause in the public scene.",
      criteria: choiceCriteria([
        ["NONE", "No ongoing add."],
        ["PERIODIC_HARM", "Poison/bleed-style periodic harm."],
        ["CONTROL", "Paralysis/control condition."],
      ]),
    },
    duration: {
      type: "choice",
      instructions: "Duration band for any new ongoing. NONE when ongoing_kind is NONE.",
      criteria: choiceCriteria([
        ["NONE", "No duration."],
        ["SHORT", "Short duration."],
        ["MEDIUM", "Medium duration."],
        ["LONG", "Long duration."],
      ]),
    },
    treatment: {
      type: "choice",
      instructions:
        "Treatment of an existing ongoing effect, or HEAL_ONLY for HP heal without clearing status. Options are bounded to known effect ids.",
      criteria: choiceCriteria(treatmentCriteria),
    },
    target: {
      type: "choice",
      instructions: "Choose the HP/effect recipient from fixture participants only. Do not invent IDs.",
      criteria: choiceCriteria(
        Object.entries(aliases).map(([alias, id]) => {
          const sheet = fixture.sheets.find((s) => s.participantId === id)!;
          return [alias, `${sheet.name} (participantId=${id})`];
        })
      ),
    },
    consume_item: {
      type: "choice",
      instructions: "Item to consume from known inventory only. NONE when no item is used.",
      criteria: choiceCriteria([
        ["NONE", "No item consume."],
        ...inventoryItems.map((item) => [item, `Consume ${item}`] as [string, string]),
      ]),
    },
  };
}

function asChoice(answers: Record<string, JevDecisionAnswer>, id: string): string | null {
  const answer = answers[id];
  if (!answer || answer.type !== "choice") return null;
  return answer.choice;
}

function mapDirectEffect(raw: string | null): DirectEffectKind | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  return (DIRECT_EFFECTS as readonly string[]).includes(v) ? (v as DirectEffectKind) : null;
}

function mapClass(raw: string | null): MechanicsClass | null {
  if (!raw) return null;
  const v = raw.trim().toUpperCase();
  return (MECHANICS_CLASSES as readonly string[]).includes(v) ? (v as MechanicsClass) : null;
}

function mapCause(raw: string | null): DirectCause | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  return (DIRECT_CAUSES as readonly string[]).includes(v) ? (v as DirectCause) : null;
}

function mapOngoingKind(raw: string | null): "NONE" | V1OngoingKind | null {
  if (!raw) return null;
  const v = raw.trim().toUpperCase();
  if (v === "NONE") return "NONE";
  if (v === "PERIODIC_HARM") return "periodic_harm";
  if (v === "CONTROL") return "control";
  if ((V1_ONGOING_KINDS as readonly string[]).includes(raw.trim().toLowerCase())) {
    return raw.trim().toLowerCase() as V1OngoingKind;
  }
  return null;
}

function mapDuration(raw: string | null): "NONE" | DurationBand | null {
  if (!raw) return null;
  const v = raw.trim().toUpperCase();
  if (v === "NONE") return "NONE";
  return (DURATION_BANDS as readonly string[]).includes(v) ? (v as DurationBand) : null;
}

/**
 * Convert JEV answers into one FlashActorEffect.
 * Returns null on malformed/out-of-bounds answers (caller fails closed to empty effects).
 * Never emits numeric damage/heal amounts or unbound participant IDs.
 */
export function jevAnswersToFlashActorEffect(opts: {
  fixture: MechanicsRefereeBenchmarkFixture;
  answers: Record<string, JevDecisionAnswer>;
}): FlashActorEffect | null {
  const { fixture, answers } = opts;
  const aliases = fixtureParticipantAliases(fixture);
  const directEffect = mapDirectEffect(asChoice(answers, "direct_effect"));
  const directClass = mapClass(asChoice(answers, "direct_class"));
  const cause = mapCause(asChoice(answers, "cause"));
  const ongoingKind = mapOngoingKind(asChoice(answers, "ongoing_kind"));
  const duration = mapDuration(asChoice(answers, "duration"));
  const treatmentRaw = asChoice(answers, "treatment");
  const targetRaw = asChoice(answers, "target");
  const consumeRaw = asChoice(answers, "consume_item");

  if (!directEffect || !directClass || !cause || !ongoingKind || !duration || !treatmentRaw || !targetRaw || !consumeRaw) {
    return null;
  }
  if (!(targetRaw in aliases)) return null;
  const targetParticipantId = aliases[targetRaw]!;

  const inventory = new Set(fixture.sheets.flatMap((s) => s.inventory));
  if (consumeRaw !== "NONE" && !inventory.has(consumeRaw)) return null;

  let ongoingRemoveIds: number[] = [];
  let ongoingReduceIds: number[] = [];
  let mappedDirectEffect = directEffect;
  let mappedDirectClass = directClass;
  let mappedCause = cause;

  if (treatmentRaw === "NONE") {
    // ok
  } else if (treatmentRaw === "HEAL_ONLY") {
    mappedDirectEffect = "heal";
    mappedCause = "healing";
    if (mappedDirectClass === "NONE") mappedDirectClass = "LIGHT";
  } else {
    const removeMatch = /^REMOVE_EFFECT_(\d+)$/.exec(treatmentRaw);
    const reduceMatch = /^REDUCE_EFFECT_(\d+)$/.exec(treatmentRaw);
    const effectId = removeMatch
      ? Number(removeMatch[1])
      : reduceMatch
        ? Number(reduceMatch[1])
        : null;
    if (effectId == null || !fixture.effects.some((e) => e.id === effectId)) return null;
    if (removeMatch) ongoingRemoveIds = [effectId];
    if (reduceMatch) ongoingReduceIds = [effectId];
  }

  if (ongoingKind !== "NONE" && duration === "NONE") return null;
  if (ongoingKind === "NONE" && duration !== "NONE") {
    // tolerate NONE duration with none kind by ignoring duration
  }

  const ongoingAdd: FlashOngoingAdd[] = [];
  if (ongoingKind !== "NONE" && duration !== "NONE") {
    ongoingAdd.push({
      label: ongoingKind === "periodic_harm" ? "중독" : "제어",
      kind: ongoingKind,
      severity: mappedDirectClass === "NONE" ? "LIGHT" : mappedDirectClass,
      tickClass: ongoingKind === "periodic_harm" ? "LIGHT" : null,
      durationBand: duration,
      recoveryMode: "save_or_treatment",
      recoveryStat: "res",
      treatmentMode: "generic_support",
      requiredItem: null,
      stackKey: ongoingKind === "periodic_harm" ? "poison" : "control",
      stackPolicy: "refresh",
    });
  }

  // Consistency clamps matching Flash schema (no numeric amounts).
  if (mappedDirectEffect === "none") {
    mappedDirectClass = "NONE";
    if (mappedCause !== "none" && ongoingAdd.length === 0 && ongoingRemoveIds.length === 0) {
      mappedCause = "none";
    }
  }

  return {
    sourceParticipantId: fixture.actor.participantId,
    targetParticipantId,
    directEffect: mappedDirectEffect,
    directClass: mappedDirectClass,
    cause: mappedCause,
    ongoingAdd,
    ongoingRemoveIds,
    ongoingReduceIds,
    consumeItem: consumeRaw === "NONE" ? null : consumeRaw,
    reason: "jev_benchmark",
  };
}

/** Assert state never contains hidden GM / resolved current outcome leakage keys. */
export function assertMechanicsJevStateIsPreGmOnly(state: Record<string, unknown>): string[] {
  const violations: string[] = [];
  if (state.currentGmResultAvailable !== false) violations.push("currentGmResultAvailable");
  if (state.timing !== "PRE_GM") violations.push("timing");
  const forbiddenKeys = ["endingCandidates", "directorState", "hiddenGm", "gmSecret", "currentGmResult", "postResolution"];
  for (const key of forbiddenKeys) {
    if (Object.prototype.hasOwnProperty.call(state, key)) violations.push(`hidden_key:${key}`);
  }
  const json = JSON.stringify(state);
  if (/OPENROUTER_|CHEAPER_INFERENCE_|api[_-]?key|Bearer /i.test(json)) {
    violations.push("credential_leak");
  }
  // Explicit narrative leakage markers (avoid matching currentGmResultAvailable).
  if (/"endingCandidates"|"directorState"|"hiddenGm"|"gmSecret"|"postResolutionNarration"/i.test(json)) {
    violations.push("hidden_gm_or_resolved_outcome_leak");
  }
  return violations;
}
