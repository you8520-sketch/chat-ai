/**
 * Production-realistic labeled corpus for the DeepSeek ↔ JEV mechanics referee
 * shadow benchmark. Scenes are PRE-GM only (previous public narration + server
 * dice/tier facts). Expected labels are declared explicitly — never inferred
 * from fixture ids. No production/user data.
 */
import type { TrpgActionType } from "./actionTypes";
import type {
  DirectCause,
  DirectEffectKind,
  MechanicsActorInput,
  MechanicsClass,
  TrpgOngoingEffect,
  V1OngoingKind,
} from "./mechanicsTypes";
import type { TrpgSheetSnapshot, TrpgSuccessTier } from "./types";

export type MechanicsRefereeTreatmentExpectation = "none" | "remove" | "reduce" | "heal";

export type MechanicsRefereeExpected = {
  /** Obvious physical-threat harm case. */
  expectHarm: boolean;
  /** Safe / non-physical failure — harm or negative ongoing is a false positive. */
  expectSafe: boolean;
  directEffect: DirectEffectKind;
  directClass: MechanicsClass;
  /** Upper bound for severity correctness (partial tradeoffs stay ≤ this). */
  maxDirectClass: MechanicsClass;
  cause: DirectCause;
  ongoingKind: "NONE" | V1OngoingKind;
  durationBand: "NONE" | "SHORT" | "MEDIUM" | "LONG";
  treatment: MechanicsRefereeTreatmentExpectation;
  treatmentEffectId?: number;
  treatmentItem?: string | null;
  /** Expected HP/effect recipient. */
  targetParticipantId: number;
  /** When set, ally-target correctness requires this exact target. */
  allyTarget?: number;
  partial?: boolean;
  /** Inventing ongoing on a clean SUCCESS is a false positive. */
  forbidInventedOngoing?: boolean;
};

export type MechanicsRefereeBenchmarkFixture = {
  id: string;
  category: string;
  /** Previous public scene only — never current GM result. */
  previousScene: string;
  actor: MechanicsActorInput;
  sheets: TrpgSheetSnapshot[];
  effects: TrpgOngoingEffect[];
  specialRules?: string;
  expected: MechanicsRefereeExpected;
  rationale: string;
};

function sheet(
  participantId: number,
  name: string,
  opts: { hp?: number; inventory?: string[]; conditions?: string[] } = {}
): TrpgSheetSnapshot {
  return {
    participantId,
    name,
    playerName: name,
    level: 1,
    hp: opts.hp ?? 20,
    maxHp: 25,
    stats: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8, res: 8 },
    conditions: opts.conditions ?? [],
    inventory: opts.inventory ?? [],
    location: "benchmark fixture",
    modifiersNote: "",
  };
}

function actor(
  body: string,
  actionType: TrpgActionType,
  tier: TrpgSuccessTier,
  opts: { participantId?: number; name?: string; d20?: number; statKey?: string } = {}
): MechanicsActorInput {
  const d20 = opts.d20 ?? (tier === "PARTIAL_SUCCESS" ? 10 : tier.includes("FAILURE") ? 5 : 15);
  return {
    participantId: opts.participantId ?? 1,
    name: opts.name ?? "강이현",
    actionType,
    body,
    intent: body,
    tier,
    d20,
    modifier: 1,
    finalScore: d20 + 1,
    dc: 12,
    statKey: opts.statKey ?? "str",
  };
}

function ongoing(
  id: number,
  participantId: number,
  label: string,
  kind: V1OngoingKind,
  opts: { requiredItem?: string | null; stackKey?: string } = {}
): TrpgOngoingEffect {
  return {
    id,
    campaignId: 1,
    participantId,
    label,
    kind,
    severity: "MEDIUM",
    stackKey: opts.stackKey ?? (kind === "control" ? "control" : "poison"),
    stackPolicy: "refresh",
    sourceRound: 5,
    appliedRound: 5,
    startsRound: 7,
    tickClass: kind === "periodic_harm" ? "LIGHT" : null,
    remainingTicks: 3,
    lastTickRound: null,
    recoveryMode: "save_or_treatment",
    recoveryStat: "res",
    treatmentMode: opts.requiredItem ? "item_or_support" : "generic_support",
    requiredItem: opts.requiredItem ?? null,
    actionModifier: kind === "control" ? -2 : 0,
    metadata: {},
  };
}

const me = (opts?: { inventory?: string[]; conditions?: string[]; hp?: number }) =>
  sheet(1, "강이현", opts);
const ally = (opts?: { inventory?: string[]; conditions?: string[]; hp?: number }) =>
  sheet(2, "렌", { hp: 14, ...opts });
const enemy = () => sheet(3, "적", { hp: 18 });

/**
 * Labeled PRE-GM corpus. First 10 rows extend PRE_GM_RUNTIME_QA; remaining
 * rows cover the required decision-plane categories without resolved-outcome leakage.
 */
export const MECHANICS_REFEREE_BENCHMARK_CORPUS: readonly MechanicsRefereeBenchmarkFixture[] = [
  {
    id: "PRE_A1_enemy_ready",
    category: "obvious_physical_failure",
    previousScene: "무장한 적이 검을 들고 복도 입구를 지키며 반격할 태세다.",
    actor: actor("적에게 근접 공격을 시도한다.", "attack", "FAILURE"),
    sheets: [me(), enemy()],
    effects: [],
    expected: {
      expectHarm: true,
      expectSafe: false,
      directEffect: "harm",
      directClass: "LIGHT",
      maxDirectClass: "HEAVY",
      cause: "enemy_counter",
      ongoingKind: "NONE",
      durationBand: "NONE",
      treatment: "none",
      targetParticipantId: 1,
    },
    rationale: "Armed enemy ready to counter; FAILURE under threat → harm.",
  },
  {
    id: "PRE_SAFE1_quiet_room",
    category: "safe_room_investigation_failure",
    previousScene: "적과 함정이 없는 조용한 자료실에 먼지 낀 서랍이 놓여 있다.",
    actor: actor("서랍에서 단서를 찾는다.", "investigate", "FAILURE", { statKey: "int" }),
    sheets: [me()],
    effects: [],
    expected: {
      expectHarm: false,
      expectSafe: true,
      directEffect: "none",
      directClass: "NONE",
      maxDirectClass: "NONE",
      cause: "none",
      ongoingKind: "NONE",
      durationBand: "NONE",
      treatment: "none",
      targetParticipantId: 1,
    },
    rationale: "Safe room investigate FAILURE must stay NONE.",
  },
  {
    id: "PRE_A2_gunfight",
    category: "gunfire_cover_failure",
    previousScene: "적의 총격이 이어지고 낮은 콘크리트 엄폐물이 앞에 있다.",
    actor: actor("엄폐물 뒤로 몸을 숨긴다.", "defend", "FAILURE", { statKey: "dex" }),
    sheets: [me()],
    effects: [],
    expected: {
      expectHarm: true,
      expectSafe: false,
      directEffect: "harm",
      directClass: "LIGHT",
      maxDirectClass: "HEAVY",
      cause: "enemy_counter",
      ongoingKind: "NONE",
      durationBand: "NONE",
      treatment: "none",
      targetParticipantId: 1,
    },
    rationale: "Gunfire + failed cover → harm.",
  },
  {
    id: "PRE_A4_armed_trap",
    category: "explicit_trap_failure",
    previousScene: "압력판과 쇠뇌 장치가 연결된 함정이 작동 대기 상태다.",
    actor: actor("압력판을 해제한다.", "investigate", "FAILURE", { statKey: "int" }),
    sheets: [me()],
    effects: [],
    expected: {
      expectHarm: true,
      expectSafe: false,
      directEffect: "harm",
      directClass: "LIGHT",
      maxDirectClass: "HEAVY",
      cause: "hazard",
      ongoingKind: "NONE",
      durationBand: "NONE",
      treatment: "none",
      targetParticipantId: 1,
    },
    rationale: "Armed trap investigate FAILURE → hazard harm.",
  },
  {
    id: "PRE_A3_unstable_floor",
    category: "unstable_environment_failure",
    previousScene: "금이 간 바닥 아래로 어두운 공간이 보이지만 아직 무너지지는 않았다.",
    actor: actor("금이 간 바닥을 뛰어 건넌다.", "free", "SEVERE_FAILURE", { statKey: "dex" }),
    sheets: [me()],
    effects: [],
    expected: {
      expectHarm: true,
      expectSafe: false,
      directEffect: "harm",
      directClass: "MEDIUM",
      maxDirectClass: "SEVERE",
      cause: "hazard",
      ongoingKind: "NONE",
      durationBand: "NONE",
      treatment: "none",
      targetParticipantId: 1,
    },
    rationale: "Unstable floor SEVERE_FAILURE → hazard harm.",
  },
  {
    id: "PRE_C1_venomous_snake",
    category: "poisonous_creature_threat",
    previousScene: "맹독성 독사가 몸을 웅크리고 공격할 태세다.",
    actor: actor("독사의 공격을 피한다.", "defend", "FAILURE", { statKey: "dex" }),
    sheets: [me()],
    effects: [],
    expected: {
      expectHarm: true,
      expectSafe: false,
      directEffect: "harm",
      directClass: "LIGHT",
      maxDirectClass: "HEAVY",
      cause: "hazard",
      ongoingKind: "periodic_harm",
      durationBand: "MEDIUM",
      treatment: "none",
      targetParticipantId: 1,
    },
    rationale: "Venomous creature threat FAILURE may add periodic_harm.",
  },
  {
    id: "PRE_C2_toxic_tank",
    category: "ambiguous_toxin_source",
    previousScene: "금이 간 화학 탱크가 흔들리지만 아직 누출 여부는 확인되지 않았다.",
    actor: actor("탱크 옆 통로를 빠르게 통과한다.", "free", "FAILURE", { statKey: "dex" }),
    sheets: [me()],
    effects: [],
    expected: {
      expectHarm: false,
      expectSafe: false,
      directEffect: "none",
      directClass: "NONE",
      maxDirectClass: "LIGHT",
      cause: "none",
      ongoingKind: "NONE",
      durationBand: "NONE",
      treatment: "none",
      targetParticipantId: 1,
      forbidInventedOngoing: true,
    },
    rationale: "Ambiguous unconfirmed leak — do not invent poison ongoing.",
  },
  {
    id: "PRE_D1_existing_poison_treatment",
    category: "existing_poison_treatment_valid_item",
    previousScene: "렌은 이전 라운드부터 중독 상태이며 강이현은 해독제를 가지고 있다.",
    actor: actor("렌에게 해독제를 투여한다.", "use_item", "SUCCESS", {
      participantId: 1,
      name: "강이현",
      d20: 16,
      statKey: "wis",
    }),
    sheets: [me({ inventory: ["해독제"] }), ally({ conditions: ["중독"], hp: 12 })],
    effects: [ongoing(10, 2, "중독", "periodic_harm", { requiredItem: "해독제", stackKey: "poison" })],
    expected: {
      expectHarm: false,
      expectSafe: false,
      directEffect: "none",
      directClass: "NONE",
      maxDirectClass: "NONE",
      cause: "none",
      ongoingKind: "NONE",
      durationBand: "NONE",
      treatment: "remove",
      treatmentEffectId: 10,
      treatmentItem: "해독제",
      targetParticipantId: 2,
      allyTarget: 2,
    },
    rationale: "Valid antidote on ally poison → remove + consume.",
  },
  {
    id: "PRE_D2_treatment_missing_item",
    category: "treatment_missing_item",
    previousScene: "렌은 이전 라운드부터 중독 상태다. 강이현의 가방에는 붕대만 있다.",
    actor: actor("렌에게 해독제를 투여한다.", "use_item", "SUCCESS", {
      d20: 15,
      statKey: "wis",
    }),
    sheets: [me({ inventory: ["붕대"] }), ally({ conditions: ["중독"], hp: 12 })],
    effects: [ongoing(11, 2, "중독", "periodic_harm", { requiredItem: "해독제", stackKey: "poison" })],
    expected: {
      expectHarm: false,
      expectSafe: false,
      directEffect: "none",
      directClass: "NONE",
      maxDirectClass: "NONE",
      cause: "none",
      ongoingKind: "NONE",
      durationBand: "NONE",
      treatment: "none",
      treatmentEffectId: 11,
      treatmentItem: null,
      targetParticipantId: 2,
      allyTarget: 2,
    },
    rationale: "Missing antidote — must not clear poison or invent consume.",
  },
  {
    id: "PRE_D3_ally_treatment_target",
    category: "ally_treatment_target",
    previousScene: "전투 후 렌이 상처를 입고 앉아 있고 강이현은 붕대를 들고 있다.",
    actor: actor("렌의 상처를 붕대로 응급처치한다.", "use_item", "SUCCESS", {
      d20: 14,
      statKey: "wis",
    }),
    sheets: [me({ inventory: ["붕대"] }), ally({ hp: 10, conditions: ["부상"] })],
    effects: [],
    expected: {
      expectHarm: false,
      expectSafe: false,
      directEffect: "heal",
      directClass: "LIGHT",
      maxDirectClass: "MEDIUM",
      cause: "healing",
      ongoingKind: "NONE",
      durationBand: "NONE",
      treatment: "heal",
      treatmentItem: "붕대",
      targetParticipantId: 2,
      allyTarget: 2,
    },
    rationale: "Ally first-aid with bandage → heal ally target.",
  },
  {
    id: "PRE_E1_partial_attack",
    category: "partial_success_combat_tradeoff",
    previousScene: "두 전투원이 서로 거리를 재며 공격 기회를 노린다.",
    actor: actor("적을 창으로 밀어낸다.", "attack", "PARTIAL_SUCCESS"),
    sheets: [me(), enemy()],
    effects: [],
    expected: {
      expectHarm: true,
      expectSafe: false,
      directEffect: "harm",
      directClass: "CHIP",
      maxDirectClass: "MEDIUM",
      cause: "tradeoff",
      ongoingKind: "NONE",
      durationBand: "NONE",
      treatment: "none",
      targetParticipantId: 1,
      partial: true,
    },
    rationale: "PARTIAL_SUCCESS melee may be bounded tradeoff harm.",
  },
  {
    id: "PRE_S1_safe_success",
    category: "safe_success",
    previousScene: "적과 함정이 없는 조용한 자료실에 먼지 낀 서랍이 놓여 있다.",
    actor: actor("서랍에서 단서를 찾는다.", "investigate", "SUCCESS", {
      d20: 17,
      statKey: "int",
    }),
    sheets: [me()],
    effects: [],
    expected: {
      expectHarm: false,
      expectSafe: true,
      directEffect: "none",
      directClass: "NONE",
      maxDirectClass: "NONE",
      cause: "none",
      ongoingKind: "NONE",
      durationBand: "NONE",
      treatment: "none",
      targetParticipantId: 1,
      forbidInventedOngoing: true,
    },
    rationale: "Safe SUCCESS → NONE, no invented ongoing.",
  },
  {
    id: "PRE_B2_none_persuade_failure",
    category: "failure_remains_none",
    previousScene: "평온한 여관에서 비무장 상인과 대화 중이다. 물리적 위협은 없다.",
    actor: actor("상인에게 길 안내를 부탁하며 설득한다.", "persuade", "FAILURE", {
      d20: 4,
      statKey: "cha",
    }),
    sheets: [me()],
    effects: [],
    expected: {
      expectHarm: false,
      expectSafe: true,
      directEffect: "none",
      directClass: "NONE",
      maxDirectClass: "NONE",
      cause: "none",
      ongoingKind: "NONE",
      durationBand: "NONE",
      treatment: "none",
      targetParticipantId: 1,
    },
    rationale: "Non-physical persuade FAILURE remains NONE.",
  },
  {
    id: "PRE_F1_uncertain_symptom",
    category: "ambiguous_symptom_investigation",
    previousScene: "강이현은 이유를 알 수 없는 가벼운 어지럼증을 느낀다.",
    actor: actor("증상의 원인을 확인한다.", "investigate", "FAILURE", { statKey: "wis" }),
    sheets: [me({ conditions: ["어지럼"] })],
    effects: [],
    expected: {
      expectHarm: false,
      expectSafe: true,
      directEffect: "none",
      directClass: "NONE",
      maxDirectClass: "NONE",
      cause: "none",
      ongoingKind: "NONE",
      durationBand: "NONE",
      treatment: "none",
      targetParticipantId: 1,
      forbidInventedOngoing: true,
    },
    rationale: "Ambiguous symptom check must not invent poison/harm.",
  },
  {
    id: "PRE_D4_control_treatment",
    category: "existing_control_treatment",
    previousScene: "렌은 마비 상태이며 강이현은 신경안정제를 가지고 있다.",
    actor: actor("렌에게 신경안정제를 투여해 마비를 치료한다.", "use_item", "SUCCESS", {
      d20: 15,
      statKey: "wis",
    }),
    sheets: [
      me({ inventory: ["신경안정제"] }),
      ally({ conditions: ["마비"], hp: 14 }),
    ],
    effects: [
      ongoing(12, 2, "마비", "control", {
        requiredItem: "신경안정제",
        stackKey: "paralysis",
      }),
    ],
    expected: {
      expectHarm: false,
      expectSafe: false,
      directEffect: "none",
      directClass: "NONE",
      maxDirectClass: "NONE",
      cause: "none",
      ongoingKind: "NONE",
      durationBand: "NONE",
      treatment: "remove",
      treatmentEffectId: 12,
      treatmentItem: "신경안정제",
      targetParticipantId: 2,
      allyTarget: 2,
    },
    rationale: "Control recovery with required item → remove.",
  },
  {
    id: "PRE_D5_item_no_valid_target",
    category: "item_use_without_valid_target",
    previousScene: "조용한 방에서 강이현만 서 있다. 치료 대상은 없다.",
    actor: actor("없는 동료에게 해독제를 투여한다.", "use_item", "SUCCESS", {
      d20: 14,
      statKey: "wis",
    }),
    sheets: [me({ inventory: ["해독제"] })],
    effects: [],
    expected: {
      expectHarm: false,
      expectSafe: true,
      directEffect: "none",
      directClass: "NONE",
      maxDirectClass: "NONE",
      cause: "none",
      ongoingKind: "NONE",
      durationBand: "NONE",
      treatment: "none",
      treatmentItem: null,
      targetParticipantId: 1,
    },
    rationale: "Item use without valid treatment target → none.",
  },
  {
    id: "PRE_S2_success_no_invented_ongoing",
    category: "success_no_invented_ongoing",
    previousScene: "전투가 끝난 뒤 복도는 조용하다. 남은 위협은 없다.",
    actor: actor("주변을 경계하며 전진한다.", "free", "SUCCESS", { d20: 16, statKey: "wis" }),
    sheets: [me()],
    effects: [],
    expected: {
      expectHarm: false,
      expectSafe: true,
      directEffect: "none",
      directClass: "NONE",
      maxDirectClass: "NONE",
      cause: "none",
      ongoingKind: "NONE",
      durationBand: "NONE",
      treatment: "none",
      targetParticipantId: 1,
      forbidInventedOngoing: true,
    },
    rationale: "Clean SUCCESS must not invent ongoing effects.",
  },
  {
    id: "PRE_E2_partial_severity_bounded",
    category: "partial_severity_bounded",
    previousScene: "좁은 다리에서 적과 창을 맞대며 균형을 다툰다.",
    actor: actor("적을 밀어내며 다리를 확보한다.", "attack", "PARTIAL_SUCCESS"),
    sheets: [me(), enemy()],
    effects: [],
    expected: {
      expectHarm: true,
      expectSafe: false,
      directEffect: "harm",
      directClass: "CHIP",
      maxDirectClass: "MEDIUM",
      cause: "tradeoff",
      ongoingKind: "NONE",
      durationBand: "NONE",
      treatment: "none",
      targetParticipantId: 1,
      partial: true,
    },
    rationale: "Partial tradeoff severity must stay ≤ MEDIUM.",
  },
] as const;

/** Participant aliases allowed as JEV target choices for a fixture. */
export function fixtureParticipantAliases(
  fixture: MechanicsRefereeBenchmarkFixture
): Record<string, number> {
  const aliases: Record<string, number> = {};
  for (const s of fixture.sheets) {
    aliases[`P${s.participantId}`] = s.participantId;
  }
  return aliases;
}
