/**
 * Real-provider effectiveness QA for the Flash mechanics referee.
 *
 * Production runtime is not imported or modified beyond calling the existing
 * prompt/provider/parser/resolver functions. The feature flag remains off.
 * Fixtures are synthetic and logs contain structured effects/statistics only.
 *
 * Run:
 *   npx tsx scripts/trpg-mechanics-referee-effectiveness-qa.ts
 * Optional:
 *   TRPG_MECHANICS_QA_OUTPUT=/opt/cursor/artifacts/mechanics_referee_qa.json
 */
import { writeFileSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import {
  buildMechanicsRefereeUserBlock,
  callTrpgMechanicsReferee,
  TRPG_MECHANICS_REFEREE_SYSTEM,
} from "../src/lib/trpg/mechanicsReferee";
import { parseFlashOrEmpty, resolveRoundMechanics } from "../src/lib/trpg/mechanicsResolve";
import {
  isTrpgMechanicsRefereeEnabled,
  TRPG_MECHANICS_REFEREE_MODEL,
  V1_ONGOING_KINDS,
  type FlashActorEffect,
  type MechanicsActorInput,
  type MechanicsClass,
  type TrpgOngoingEffect,
} from "../src/lib/trpg/mechanicsTypes";
import { TRPG_SCENARIO_DRAFT_MODEL } from "../src/lib/trpg/scenarioDraft";
import { adaptTrpgReplySuggestionChatBody } from "../src/lib/trpg/replySuggestions";
import { classRank, TIER_HARM_CAP } from "../src/lib/trpg/mechanicsDice";
import type { TrpgSheetSnapshot, TrpgSuccessTier } from "../src/lib/trpg/types";

loadEnvConfig(process.cwd());

type Category = "A_PHYSICAL_FAILURE" | "B_SAFE_FAILURE" | "C_ONGOING" | "D_TREATMENT" | "E_PARTIAL" | "F_AMBIGUOUS";

type FixtureExpectation = {
  obviousHarm?: boolean;
  safe?: boolean;
  ongoingKind?: "periodic_harm" | "control";
  allyTarget?: number;
  treatment?: "heal" | "remove" | "reduce" | "none";
  treatmentEffectId?: number;
  treatmentItem?: string;
  partial?: boolean;
};

type Fixture = {
  id: string;
  category: Category;
  scene: string;
  actor: MechanicsActorInput;
  sheets: TrpgSheetSnapshot[];
  effects: TrpgOngoingEffect[];
  specialRules?: string;
  expectation: FixtureExpectation;
};

type WireStats = {
  providerCalls: number;
  inputTokens: number;
  outputTokens: number;
  cost: number | null;
  finishReason: string;
  httpStatus: number | null;
  request: {
    model: string;
    thinking: unknown;
    reasoningEffort: unknown;
    maxTokens: unknown;
    responseFormat: unknown;
  } | null;
};

const CLASS: Record<MechanicsClass, number> = {
  NONE: 0,
  CHIP: 1,
  LIGHT: 2,
  MEDIUM: 3,
  HEAVY: 4,
  SEVERE: 5,
  CRITICAL: 6,
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
    location: "QA fixture",
    modifiersNote: "",
  };
}

function actor(
  body: string,
  actionType: MechanicsActorInput["actionType"],
  tier: TrpgSuccessTier,
  opts: { participantId?: number; name?: string; d20?: number; statKey?: string } = {}
): MechanicsActorInput {
  const d20 = opts.d20 ?? (tier === "PARTIAL_SUCCESS" ? 10 : tier.includes("FAILURE") ? 5 : 15);
  return {
    participantId: opts.participantId ?? 1,
    name: opts.name ?? "강이현",
    actionType,
    body,
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
  kind: "periodic_harm" | "control",
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

const me = () => sheet(1, "강이현");
const ally = () => sheet(2, "렌", { hp: 14 });

const fixtures: Fixture[] = [
  // A — obvious physical failures
  {
    id: "A1_melee_counter",
    category: "A_PHYSICAL_FAILURE",
    scene: "폐허 복도에서 무장한 적이 칼을 휘두르며 즉시 반격한다.",
    actor: actor("적에게 근접 공격을 시도한다.", "attack", "FAILURE"),
    sheets: [me()],
    effects: [],
    expectation: { obviousHarm: true },
  },
  {
    id: "A2_cover_under_gunfire",
    category: "A_PHYSICAL_FAILURE",
    scene: "총격전 한복판. 적탄이 벽을 부수며 계속 날아온다.",
    actor: actor("낮은 콘크리트 엄폐물 뒤로 몸을 숨긴다.", "defend", "FAILURE", { statKey: "dex" }),
    sheets: [me()],
    effects: [],
    expectation: { obviousHarm: true },
  },
  {
    id: "A3_collapsing_floor",
    category: "A_PHYSICAL_FAILURE",
    scene: "발밑 바닥이 붕괴하며 아래에는 날카로운 잔해가 드러난다.",
    actor: actor("무너지는 바닥을 뛰어 건넌다.", "free", "SEVERE_FAILURE", { statKey: "dex" }),
    sheets: [me()],
    effects: [],
    expectation: { obviousHarm: true },
  },
  {
    id: "A4_trap_disarm",
    category: "A_PHYSICAL_FAILURE",
    scene: "압력판과 연결된 쇠뇌 함정이 작동 직전이다.",
    actor: actor("쇠뇌 함정의 압력판을 해제한다.", "investigate", "FAILURE", { statKey: "int" }),
    sheets: [me()],
    effects: [],
    expectation: { obviousHarm: true },
  },
  {
    id: "A5_venom_bite",
    category: "A_PHYSICAL_FAILURE",
    scene: "독사가 달려들어 독니로 팔을 깊게 문다.",
    actor: actor("독사의 공격을 피한다.", "defend", "SEVERE_FAILURE", { statKey: "dex" }),
    sheets: [me()],
    effects: [],
    expectation: { obviousHarm: true },
  },

  // B — safe non-physical failures
  {
    id: "B1_safe_room_search",
    category: "B_SAFE_FAILURE",
    scene: "문이 잠긴 안전한 자료실. 적도 함정도 없고 먼지 낀 책만 있다.",
    actor: actor("책장에서 단서를 조사한다.", "investigate", "FAILURE", { statKey: "int" }),
    sheets: [me()],
    effects: [],
    expectation: { safe: true },
  },
  {
    id: "B2_calm_persuasion",
    category: "B_SAFE_FAILURE",
    scene: "평온한 여관에서 비무장 상인과 대화 중이다. 물리적 위협은 없다.",
    actor: actor("상인에게 길 안내를 부탁하며 설득한다.", "persuade", "FAILURE", { statKey: "cha" }),
    sheets: [me()],
    effects: [],
    expectation: { safe: true },
  },
  {
    id: "B3_information_question",
    category: "B_SAFE_FAILURE",
    scene: "조용한 도서관 안내 데스크. 사서에게 정보를 묻는다.",
    actor: actor("오래된 지도에 대해 질문한다.", "persuade", "FAILURE", { statKey: "cha" }),
    sheets: [me()],
    effects: [],
    expectation: { safe: true },
  },
  {
    id: "B4_market_bargain",
    category: "B_SAFE_FAILURE",
    scene: "경비가 지키는 안전한 시장에서 평범한 가격 흥정을 한다.",
    actor: actor("등불 가격을 깎아 달라고 흥정한다.", "persuade", "FAILURE", { statKey: "cha" }),
    sheets: [me()],
    effects: [],
    expectation: { safe: true },
  },
  {
    id: "B5_harmless_observation",
    category: "B_SAFE_FAILURE",
    scene: "맑은 낮의 공원. 위험 요소 없이 멀리 있는 새를 관찰한다.",
    actor: actor("새의 종류를 자세히 관찰한다.", "investigate", "FAILURE", { statKey: "wis" }),
    sheets: [me()],
    effects: [],
    expectation: { safe: true },
  },

  // C — obvious ongoing causes
  {
    id: "C1_snake_poison",
    category: "C_ONGOING",
    scene: "독사의 독니가 팔에 박혀 독액이 혈관으로 퍼진다.",
    actor: actor("독사의 공격을 피한다.", "defend", "FAILURE", { statKey: "dex" }),
    sheets: [me()],
    effects: [],
    expectation: { ongoingKind: "periodic_harm" },
  },
  {
    id: "C2_deep_bleeding",
    category: "C_ONGOING",
    scene: "톱날 함정이 허벅지를 깊게 베어 출혈이 계속된다.",
    actor: actor("톱날 함정을 뛰어넘는다.", "free", "FAILURE", { statKey: "dex" }),
    sheets: [me()],
    effects: [],
    expectation: { ongoingKind: "periodic_harm" },
  },
  {
    id: "C3_paralysis_dart",
    category: "C_ONGOING",
    scene: "마비 독이 묻은 침이 목에 박혀 팔다리가 굳기 시작한다.",
    actor: actor("벽의 발사 함정을 조사한다.", "investigate", "FAILURE", { statKey: "int" }),
    sheets: [me()],
    effects: [],
    expectation: { ongoingKind: "control" },
  },
  {
    id: "C4_chemical_toxin",
    category: "C_ONGOING",
    scene: "깨진 탱크에서 독성 화학 증기가 새어 나와 호흡기에 들어간다.",
    actor: actor("누출 구역을 빠르게 통과한다.", "free", "FAILURE", { statKey: "con" }),
    sheets: [me()],
    effects: [],
    expectation: { ongoingKind: "periodic_harm" },
  },
  {
    id: "C5_neural_suppression",
    category: "C_ONGOING",
    scene: "신경 제압 장치의 전극이 명중해 근육 신호를 차단한다.",
    actor: actor("신경 제압 장치를 피해 엄폐한다.", "defend", "FAILURE", { statKey: "res" }),
    sheets: [me()],
    effects: [],
    expectation: { ongoingKind: "control" },
  },

  // D — heal/treat targeting
  {
    id: "D1_self_first_aid",
    category: "D_TREATMENT",
    scene: "전투가 끝난 뒤 강이현이 자신의 상처를 응급처치한다.",
    actor: actor("내 상처를 응급처치한다.", "support", "SUCCESS", { statKey: "wis" }),
    sheets: [sheet(1, "강이현", { hp: 10 })],
    effects: [],
    expectation: { treatment: "heal" },
  },
  {
    id: "D2_ally_first_aid",
    category: "D_TREATMENT",
    scene: "강이현이 다친 렌의 상처를 응급처치한다.",
    actor: actor("렌의 상처를 응급처치한다.", "support", "SUCCESS", { statKey: "wis" }),
    sheets: [me(), ally()],
    effects: [],
    expectation: { treatment: "heal", allyTarget: 2 },
  },
  {
    id: "D3_ally_antidote",
    category: "D_TREATMENT",
    scene: "강이현이 중독된 렌에게 자신의 해독제를 먹인다.",
    actor: actor("렌에게 해독제를 사용해 중독을 치료한다.", "use_item", "SUCCESS", { statKey: "wis" }),
    sheets: [sheet(1, "강이현", { inventory: ["해독제"] }), ally()],
    effects: [ongoing(10, 2, "중독", "periodic_harm", { requiredItem: "해독제", stackKey: "poison" })],
    expectation: { treatment: "remove", treatmentEffectId: 10, treatmentItem: "해독제", allyTarget: 2 },
  },
  {
    id: "D4_ally_bandage",
    category: "D_TREATMENT",
    scene: "강이현이 출혈 중인 렌의 상처를 붕대로 지혈한다.",
    actor: actor("렌의 출혈 상처에 붕대를 감아 지혈한다.", "use_item", "SUCCESS", { statKey: "wis" }),
    sheets: [sheet(1, "강이현", { inventory: ["붕대"] }), ally()],
    effects: [ongoing(11, 2, "출혈", "periodic_harm", { requiredItem: "붕대", stackKey: "bleed" })],
    expectation: { treatment: "remove", treatmentEffectId: 11, treatmentItem: "붕대", allyTarget: 2 },
  },
  {
    id: "D5_failed_antidote",
    category: "D_TREATMENT",
    scene: "강이현이 중독된 렌에게 해독제를 먹이려 했지만 전부 쏟았다.",
    actor: actor("렌에게 해독제를 사용해 중독을 치료한다.", "use_item", "FAILURE", { statKey: "wis" }),
    sheets: [sheet(1, "강이현", { inventory: ["해독제"] }), ally()],
    effects: [ongoing(12, 2, "중독", "periodic_harm", { requiredItem: "해독제", stackKey: "poison" })],
    expectation: { treatment: "none", treatmentEffectId: 12, treatmentItem: "해독제", allyTarget: 2 },
  },

  // E — partial success proportionality
  {
    id: "E1_attack_partial",
    category: "E_PARTIAL",
    scene: "교전 중 적을 밀어냈지만 반격할 틈을 조금 내줬다.",
    actor: actor("적을 창으로 밀어낸다.", "attack", "PARTIAL_SUCCESS"),
    sheets: [me()],
    effects: [],
    expectation: { partial: true },
  },
  {
    id: "E2_hazard_investigate_partial",
    category: "E_PARTIAL",
    scene: "불안정한 발전기를 조사하는 동안 작은 불꽃과 열기가 튄다.",
    actor: actor("과열된 발전기의 고장 원인을 조사한다.", "investigate", "PARTIAL_SUCCESS", { statKey: "int" }),
    sheets: [me()],
    effects: [],
    expectation: { partial: true },
  },
  {
    id: "E3_treatment_partial",
    category: "E_PARTIAL",
    scene: "강이현이 해독제를 일부만 투여해 렌의 중독을 완화한다.",
    actor: actor("렌에게 해독제를 투여해 중독을 치료한다.", "use_item", "PARTIAL_SUCCESS", { statKey: "wis" }),
    sheets: [sheet(1, "강이현", { inventory: ["해독제"] }), ally()],
    effects: [ongoing(13, 2, "중독", "periodic_harm", { requiredItem: "해독제", stackKey: "poison" })],
    expectation: { treatment: "reduce", treatmentEffectId: 13, treatmentItem: "해독제", allyTarget: 2, partial: true },
  },
  {
    id: "E4_stealth_partial",
    category: "E_PARTIAL",
    scene: "적의 총격 속에서 몸은 숨겼지만 파편이 스칠 수 있는 위치다.",
    actor: actor("총격을 피해 차량 뒤로 은신한다.", "stealth", "PARTIAL_SUCCESS", { statKey: "dex" }),
    sheets: [me()],
    effects: [],
    expectation: { partial: true },
  },
  {
    id: "E5_trap_partial",
    category: "E_PARTIAL",
    scene: "함정을 거의 해제했지만 작은 보조 칼날 하나가 튀어나온다.",
    actor: actor("복도 함정을 해제한다.", "investigate", "PARTIAL_SUCCESS", { statKey: "int" }),
    sheets: [me()],
    effects: [],
    expectation: { partial: true },
  },

  // F — ambiguous / mixed
  {
    id: "F1_threat_resumes",
    category: "F_AMBIGUOUS",
    scene: "전투는 끝났지만 복도 끝에서 새로운 적이 총을 겨누며 다시 등장한다.",
    actor: actor("상황을 살피며 몸을 낮춘다.", "defend", "PARTIAL_SUCCESS", { statKey: "dex" }),
    sheets: [me()],
    effects: [],
    expectation: { partial: true },
  },
  {
    id: "F2_unknown_poison_like",
    category: "F_AMBIGUOUS",
    scene: "갑자기 어지럽지만 원인은 피로인지 독인지 아직 알 수 없다.",
    actor: actor("증상의 원인을 침착하게 확인한다.", "investigate", "FAILURE", { statKey: "wis" }),
    sheets: [me()],
    effects: [],
    expectation: {},
  },
  {
    id: "F3_covering_fire_support",
    category: "F_AMBIGUOUS",
    scene: "교전 중 강이현이 렌의 이동을 돕기 위해 적의 머리 위로 엄호 사격한다.",
    actor: actor("렌이 이동하도록 적의 머리 위로 엄호 사격한다.", "support", "SUCCESS", { statKey: "dex" }),
    sheets: [me(), ally()],
    effects: [],
    expectation: {},
  },
  {
    id: "F4_bandage_heal_and_treat",
    category: "F_AMBIGUOUS",
    scene: "강이현은 다친 데다 출혈 중이며 붕대 하나로 지혈과 응급처치를 함께 한다.",
    actor: actor("붕대로 출혈을 지혈하고 내 상처를 응급처치한다.", "use_item", "SUCCESS", { statKey: "wis" }),
    sheets: [sheet(1, "강이현", { hp: 10, inventory: ["붕대"] })],
    effects: [ongoing(14, 1, "출혈", "periodic_harm", { requiredItem: "붕대", stackKey: "bleed" })],
    expectation: { treatment: "remove", treatmentEffectId: 14, treatmentItem: "붕대" },
  },
  {
    id: "F5_risky_self_cost",
    category: "F_AMBIGUOUS",
    scene: "고장 난 차단기를 맨손으로 붙잡으면 문은 열리지만 감전 위험을 감수해야 한다.",
    actor: actor("감전을 감수하고 맨손으로 차단기를 붙잡아 문을 연다.", "free", "PARTIAL_SUCCESS", { statKey: "con" }),
    sheets: [me()],
    effects: [],
    expectation: { partial: true },
  },
];

function extractObject(raw: string): Record<string, unknown> | null {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  for (const candidate of [text, text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)]) {
    if (!candidate) continue;
    try {
      const value = JSON.parse(candidate) as unknown;
      if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function rawRows(raw: string): Record<string, unknown>[] {
  const parsed = extractObject(raw);
  return Array.isArray(parsed?.effects)
    ? parsed.effects.filter(
        (row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row)
      )
    : [];
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))] ?? 0;
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function ratio(numerator: number, denominator: number): number {
  return denominator ? numerator / denominator : 0;
}

function numericCost(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function callWithWireStats(system: string, user: string): Promise<{
  call: Awaited<ReturnType<typeof callTrpgMechanicsReferee>> | null;
  wire: WireStats;
  errorClass: string;
}> {
  const originalFetch = globalThis.fetch;
  const wire: WireStats = {
    providerCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cost: null,
    finishReason: "",
    httpStatus: null,
    request: null,
  };
  globalThis.fetch = async (input, init) => {
    wire.providerCalls += 1;
    try {
      const request = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      wire.request = {
        model: String(request.model ?? ""),
        thinking: request.thinking,
        reasoningEffort: request.reasoning_effort,
        maxTokens: request.max_tokens,
        responseFormat: request.response_format,
      };
    } catch {
      wire.request = null;
    }
    const response = await originalFetch(input, init);
    wire.httpStatus = response.status;
    try {
      const payload = (await response.clone().json()) as {
        choices?: Array<{ finish_reason?: unknown }>;
        usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; cost?: unknown };
        cost?: unknown;
      };
      wire.inputTokens = Number(payload.usage?.prompt_tokens ?? 0) || 0;
      wire.outputTokens = Number(payload.usage?.completion_tokens ?? 0) || 0;
      wire.cost = numericCost(payload.usage?.cost) ?? numericCost(payload.cost);
      wire.finishReason = String(payload.choices?.[0]?.finish_reason ?? "");
    } catch {
      // The production call owns HTTP/empty-response handling.
    }
    return response;
  };
  try {
    const call = await callTrpgMechanicsReferee({ system, user });
    return { call, wire, errorClass: "" };
  } catch (error) {
    return {
      call: null,
      wire,
      errorClass: error instanceof Error ? error.name || "Error" : "Error",
    };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function treatmentRawCorrect(fixture: Fixture, rows: FlashActorEffect[]): boolean {
  const expected = fixture.expectation;
  const row = rows.find(
    (item) =>
      (item.sourceParticipantId ?? item.participantId) === fixture.actor.participantId &&
      (expected.allyTarget == null || item.targetParticipantId === expected.allyTarget)
  );
  if (!row) return false;
  if (expected.treatment === "heal") {
    return row.directEffect === "heal";
  }
  if (expected.treatment === "remove") {
    return Boolean(
      expected.treatmentEffectId != null &&
        row.ongoingRemoveIds?.includes(expected.treatmentEffectId) &&
        (!expected.treatmentItem || row.consumeItem === expected.treatmentItem)
    );
  }
  if (expected.treatment === "reduce") {
    return Boolean(
      expected.treatmentEffectId != null &&
        row.ongoingReduceIds?.includes(expected.treatmentEffectId) &&
        !row.ongoingRemoveIds?.includes(expected.treatmentEffectId)
    );
  }
  return !row.ongoingRemoveIds?.length && !row.ongoingReduceIds?.length;
}

async function runFixture(fixture: Fixture, index: number) {
  const user = buildMechanicsRefereeUserBlock({
    scene: fixture.scene,
    resolutionOrder: `[RESOLUTION ORDER]\n1. ${fixture.actor.name}`,
    actors: [fixture.actor],
    sheets: fixture.sheets,
    effects: fixture.effects,
    specialRules: fixture.specialRules ?? "",
  });
  const called = await callWithWireStats(TRPG_MECHANICS_REFEREE_SYSTEM, user);
  const flashText = called.call?.text ?? "";
  const parsed = parseFlashOrEmpty(flashText);
  const sourceRows = parsed.effects.filter(
    (row) => (row.sourceParticipantId ?? row.participantId) === fixture.actor.participantId
  );
  const rawUntyped = rawRows(flashText);
  const untypedOngoing = rawUntyped.flatMap((row) =>
    Array.isArray(row.ongoingAdd)
      ? row.ongoingAdd.filter(
          (item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)
        )
      : []
  );
  const invalidKinds = untypedOngoing.filter(
    (row) => !(V1_ONGOING_KINDS as readonly string[]).includes(String(row.kind ?? ""))
  );
  const consumeItemStringNone = rawUntyped.some(
    (row) => typeof row.consumeItem === "string" && row.consumeItem.trim().toLowerCase() === "none"
  );
  const rawHarmRows = sourceRows.filter((row) => row.directEffect === "harm" && row.directClass !== "NONE");
  const rawNegativeOngoing = sourceRows.flatMap((row) => row.ongoingAdd ?? []);
  const rawClearIds = new Set(sourceRows.flatMap((row) => row.ongoingRemoveIds ?? []));
  const rawReduceIds = new Set(sourceRows.flatMap((row) => row.ongoingReduceIds ?? []));
  const rawNone =
    rawHarmRows.length === 0 &&
    sourceRows.every((row) => row.directEffect === "none" || row.directClass === "NONE") &&
    rawNegativeOngoing.length === 0 &&
    rawClearIds.size === 0 &&
    rawReduceIds.size === 0;

  const resolution = resolveRoundMechanics({
    campaignId: 1,
    roundId: index + 1,
    roundNumber: 6,
    sheets: fixture.sheets,
    effects: fixture.effects,
    actors: [fixture.actor],
    flash: parsed,
    flashRaw: flashText,
    fallback: "none",
    calledFlash: true,
    model: called.call?.model ?? TRPG_MECHANICS_REFEREE_MODEL,
    latencyMs: called.call?.latencyMs ?? 0,
    baseDc: 12,
    specialRules: fixture.specialRules ?? "",
    scene: fixture.scene,
    rng: () => 3,
    recoveryRng: () => 1,
  });
  const serverActor = resolution.actors.find((row) => row.participantId === fixture.actor.participantId);
  const serverDirect = serverActor?.direct ?? null;
  const acceptedOngoing = resolution.ongoingAdds;

  const rawDirect = rawHarmRows[0] ?? sourceRows.find((row) => row.directEffect !== "none") ?? sourceRows[0] ?? null;
  const directDowngraded = Boolean(
    rawDirect &&
      (rawDirect.directEffect !== (serverDirect?.effect ?? "none") ||
        rawDirect.directClass !== (serverDirect?.class ?? "NONE"))
  );
  const ongoingDowngraded = rawNegativeOngoing.length > acceptedOngoing.length;
  const treatmentDowngraded = sourceRows.some((row) => {
    const removeRejected = (row.ongoingRemoveIds ?? []).some((id) => !resolution.ongoingClearedIds.includes(id));
    const reduceRejected = (row.ongoingReduceIds ?? []).some((id) => {
      const update = resolution.ongoingUpdates.find((item) => item.id === id);
      return !update && !resolution.ongoingClearedIds.includes(id);
    });
    return removeRejected || reduceRejected;
  });
  const serverDowngraded = directDowngraded || ongoingDowngraded || treatmentDowngraded;
  const serverRejected =
    resolution.validation !== "ok" || Boolean(serverDirect?.rejected) || ongoingDowngraded || treatmentDowngraded;

  const safetyViolations: string[] = [];
  const tierCap = TIER_HARM_CAP[fixture.actor.tier ?? "FAILURE"];
  if (serverDirect?.effect === "harm" && classRank(serverDirect.class) > classRank(tierCap)) {
    safetyViolations.push("tier_cap_escape");
  }
  if (
    (fixture.actor.tier === "FAILURE" ||
      fixture.actor.tier === "SEVERE_FAILURE" ||
      fixture.actor.tier === "CRITICAL_FAILURE") &&
    serverDirect?.effect === "heal"
  ) {
    safetyViolations.push("failure_heal_escape");
  }
  if (fixture.expectation.safe && (serverDirect?.effect === "harm" || acceptedOngoing.length > 0)) {
    safetyViolations.push("safe_negative_effect_escape");
  }
  if (acceptedOngoing.some((row) => !(V1_ONGOING_KINDS as readonly string[]).includes(row.kind))) {
    safetyViolations.push("invalid_kind_escape");
  }
  if (!fixture.specialRules && acceptedOngoing.some((row) => row.remainingTicks < 0)) {
    safetyViolations.push("persistent_softlock_escape");
  }
  if (resolution.consumeItems.length > 1) safetyViolations.push("multiple_item_consumes");
  if (resolution.ongoingClearedIds.length > 1) safetyViolations.push("multiple_treatment_targets");
  for (const consume of resolution.consumeItems) {
    const owner = fixture.sheets.find((row) => row.participantId === consume.participantId);
    if (!owner?.inventory.includes(consume.item)) safetyViolations.push("item_ownership_escape");
  }
  if (serverDirect && serverDirect.targetParticipantId !== fixture.actor.participantId) {
    const ownership = resolution.hpOwnership?.[String(serverDirect.targetParticipantId)];
    if (
      serverDirect.owner === "FLASH_REFEREE" &&
      !ownership?.FLASH_REFEREE
    ) {
      safetyViolations.push("flash_target_ownership_escape");
    }
    if (
      serverDirect.owner === "SERVER_RECOVERY" &&
      !ownership?.SERVER_RECOVERY
    ) {
      safetyViolations.push("recovery_target_ownership_escape");
    }
  }

  const allyTargetCorrect =
    fixture.expectation.allyTarget == null ||
    sourceRows.some((row) => row.targetParticipantId === fixture.expectation.allyTarget);
  const treatmentCorrect =
    fixture.expectation.treatment == null ? null : treatmentRawCorrect(fixture, sourceRows);
  const treatmentFailureFalseClear =
    fixture.expectation.treatment === "none" &&
    fixture.expectation.treatmentEffectId != null &&
    (rawClearIds.has(fixture.expectation.treatmentEffectId) ||
      rawReduceIds.has(fixture.expectation.treatmentEffectId));
  const partialOversevere =
    fixture.expectation.partial === true &&
    (sourceRows.some(
      (row) =>
        row.directEffect === "harm" &&
        CLASS[row.directClass] > CLASS.MEDIUM
    ) ||
      rawNegativeOngoing.some(
        (row) =>
          CLASS[row.severity] > CLASS.MEDIUM ||
          row.durationBand === "LONG" ||
          row.durationBand === "PERSISTENT"
      ));
  const ongoingRecall =
    fixture.expectation.ongoingKind == null
      ? null
      : rawNegativeOngoing.some((row) => row.kind === fixture.expectation.ongoingKind);

  return {
    FIXTURE: fixture.id,
    CATEGORY: fixture.category,
    PROVIDER_CALLS: called.wire.providerCalls,
    MODEL: called.wire.request?.model ?? called.call?.model ?? "",
    THINKING: called.wire.request?.thinking ?? null,
    REASONING_EFFORT: called.wire.request?.reasoningEffort ?? null,
    PROMPT_CHARS: TRPG_MECHANICS_REFEREE_SYSTEM.length + user.length,
    INPUT_TOKENS: called.wire.inputTokens,
    OUTPUT_TOKENS: called.wire.outputTokens,
    COST: called.wire.cost,
    LATENCY_MS: called.call?.latencyMs ?? 0,
    FINISH_REASON: called.wire.finishReason,
    ERROR_CLASS: called.errorClass,
    FLASH_RAW_EFFECT: sourceRows.map((row) => ({
      sourceParticipantId: row.sourceParticipantId,
      targetParticipantId: row.targetParticipantId,
      directEffect: row.directEffect,
      directClass: row.directClass,
      cause: row.cause,
      ongoingAdd: row.ongoingAdd,
      ongoingRemoveIds: row.ongoingRemoveIds,
      ongoingReduceIds: row.ongoingReduceIds,
      consumeItem: row.consumeItem,
    })),
    SERVER_ACCEPTED_EFFECT: {
      direct: serverDirect
        ? {
            effect: serverDirect.effect,
            class: serverDirect.class,
            cause: serverDirect.cause,
            targetParticipantId: serverDirect.targetParticipantId,
            rejected: serverDirect.rejected,
            reason: serverDirect.rejectReason,
            owner: serverDirect.owner,
          }
        : null,
      ongoingAdds: acceptedOngoing.map((row) => ({
        targetParticipantId: row.participantId,
        kind: row.kind,
        severity: row.severity,
        remainingTicks: row.remainingTicks,
        treatmentMode: row.treatmentMode,
        requiredItem: row.requiredItem,
      })),
      ongoingClearedIds: resolution.ongoingClearedIds,
      ongoingUpdates: resolution.ongoingUpdates.map((row) => ({
        id: row.id,
        remainingTicks: row.remainingTicks,
      })),
      consumeItems: resolution.consumeItems,
      validation: resolution.validation,
    },
    SCORE: {
      rawHarm: rawHarmRows.length > 0,
      rawNegativeOngoing: rawNegativeOngoing.length > 0,
      rawNone,
      ongoingRecall,
      allyTargetCorrect,
      treatmentCorrect,
      treatmentFailureFalseClear,
      partialOversevere,
      consumeItemStringNone,
      invalidKinds: invalidKinds.length,
      rawOngoingCount: untypedOngoing.length,
      serverDowngraded,
      serverRejected,
      safetyViolations,
    },
  };
}

async function main() {
  const adapted = adaptTrpgReplySuggestionChatBody({ model: TRPG_MECHANICS_REFEREE_MODEL });
  if (TRPG_MECHANICS_REFEREE_MODEL !== TRPG_SCENARIO_DRAFT_MODEL) {
    throw new Error("mechanics/scenario model contract mismatch");
  }
  if (
    JSON.stringify(adapted.thinking) !== JSON.stringify({ type: "disabled" }) ||
    adapted.reasoning_effort !== "none"
  ) {
    throw new Error("mechanics true-off contract mismatch");
  }
  if (isTrpgMechanicsRefereeEnabled({}) !== false) {
    throw new Error("TRPG_MECHANICS_REFEREE_ENABLED must remain default false");
  }
  if (fixtures.length !== 30) throw new Error(`expected 30 fixtures, got ${fixtures.length}`);

  const rows = [];
  for (let index = 0; index < fixtures.length; index += 1) {
    const row = await runFixture(fixtures[index]!, index);
    rows.push(row);
    console.log(JSON.stringify(row));
  }

  const obvious = rows.filter((row) => row.CATEGORY === "A_PHYSICAL_FAILURE");
  const safe = rows.filter((row) => row.CATEGORY === "B_SAFE_FAILURE");
  const ongoingCases = rows.filter((row) => row.CATEGORY === "C_ONGOING");
  const allyCases = rows.filter((row) => row.CATEGORY === "D_TREATMENT" && fixtures.find((f) => f.id === row.FIXTURE)?.expectation.allyTarget != null);
  const successfulTreatments = rows.filter((row) => {
    const treatment = fixtures.find((fixture) => fixture.id === row.FIXTURE)?.expectation.treatment;
    return row.CATEGORY === "D_TREATMENT" && treatment != null && treatment !== "none";
  });
  const failedTreatments = rows.filter(
    (row) => fixtures.find((fixture) => fixture.id === row.FIXTURE)?.expectation.treatment === "none"
  );
  const partial = rows.filter((row) => row.CATEGORY === "E_PARTIAL");
  const proposed = rows.filter(
    (row) =>
      !row.SCORE.rawNone ||
      row.FLASH_RAW_EFFECT.some((effect) => effect.consumeItem)
  );
  const latencies = rows.map((row) => row.LATENCY_MS).filter((value) => value > 0);
  const inputTokens = rows.map((row) => row.INPUT_TOKENS).filter((value) => value > 0);
  const outputTokens = rows.map((row) => row.OUTPUT_TOKENS).filter((value) => value > 0);
  const costs = rows.map((row) => row.COST).filter((value): value is number => value != null);
  const byCategory = Object.fromEntries(
    (["A_PHYSICAL_FAILURE", "B_SAFE_FAILURE", "C_ONGOING", "D_TREATMENT", "E_PARTIAL", "F_AMBIGUOUS"] as Category[]).map(
      (category) => {
        const categoryRows = rows.filter((row) => row.CATEGORY === category);
        return [
          category,
          {
            fixtures: categoryRows.length,
            flashNoneRate: ratio(
              categoryRows.filter((row) => row.SCORE.rawNone).length,
              categoryRows.length
            ),
          },
        ];
      }
    )
  );
  const metrics = {
    PROVIDER_CALLS_TOTAL: rows.reduce((sum, row) => sum + row.PROVIDER_CALLS, 0),
    HARM_RECALL_OBVIOUS_THREAT: ratio(obvious.filter((row) => row.SCORE.rawHarm).length, obvious.length),
    SAFE_FALSE_POSITIVE_HARM_RATE: ratio(safe.filter((row) => row.SCORE.rawHarm).length, safe.length),
    NEGATIVE_ONGOING_FALSE_POSITIVE_RATE: ratio(
      safe.filter((row) => row.SCORE.rawNegativeOngoing).length,
      safe.length
    ),
    ONGOING_RECALL_OBVIOUS_CAUSE: ratio(
      ongoingCases.filter((row) => row.SCORE.ongoingRecall).length,
      ongoingCases.length
    ),
    ALLY_TARGET_ACCURACY: ratio(
      allyCases.filter((row) => row.SCORE.allyTargetCorrect).length,
      allyCases.length
    ),
    TREATMENT_SUCCESS_ACCURACY: ratio(
      successfulTreatments.filter((row) => row.SCORE.treatmentCorrect).length,
      successfulTreatments.length
    ),
    TREATMENT_FAILURE_FALSE_CLEAR_RATE: ratio(
      failedTreatments.filter((row) => row.SCORE.treatmentFailureFalseClear).length,
      failedTreatments.length
    ),
    PARTIAL_OVERSEVERITY_RATE: ratio(
      partial.filter((row) => row.SCORE.partialOversevere).length,
      partial.length
    ),
    INVALID_KIND_RATE: ratio(
      rows.reduce((sum, row) => sum + row.SCORE.invalidKinds, 0),
      rows.reduce((sum, row) => sum + row.SCORE.rawOngoingCount, 0)
    ),
    SERVER_DOWNGRADE_RATE: ratio(
      proposed.filter((row) => row.SCORE.serverDowngraded).length,
      proposed.length
    ),
    SERVER_REJECT_RATE: ratio(
      proposed.filter((row) => row.SCORE.serverRejected).length,
      proposed.length
    ),
    FLASH_NONE_RATE_TOTAL: ratio(rows.filter((row) => row.SCORE.rawNone).length, rows.length),
    CONSUME_ITEM_STRING_NONE_RATE: ratio(
      rows.filter((row) => row.SCORE.consumeItemStringNone).length,
      rows.length
    ),
    FLASH_NONE_RATE_BY_CATEGORY: byCategory,
    AVG_INPUT_TOKENS: average(inputTokens),
    AVG_OUTPUT_TOKENS: average(outputTokens),
    AVG_LATENCY_MS: average(latencies),
    P50_LATENCY_MS: percentile(latencies, 0.5),
    P95_LATENCY_MS: percentile(latencies, 0.95),
    AVG_COST_PER_CALLED_ROUND: costs.length ? average(costs) : null,
    P95_COST_PER_CALLED_ROUND: costs.length ? percentile(costs, 0.95) : null,
    COST_SAMPLES: costs.length,
    SERVER_SAFETY_ESCAPE_COUNT: rows.reduce(
      (sum, row) => sum + row.SCORE.safetyViolations.length,
      0
    ),
    ERROR_COUNT: rows.filter((row) => row.ERROR_CLASS).length,
  };
  const report = {
    generatedAt: new Date().toISOString(),
    contract: {
      MODEL: TRPG_MECHANICS_REFEREE_MODEL,
      THINKING: adapted.thinking,
      REASONING_EFFORT: adapted.reasoning_effort,
      PROVIDER_RETRY: 0,
      FLAG_DEFAULT: false,
      FIXTURE_COUNT: fixtures.length,
      PROVIDER_CALLS_PER_FIXTURE: 1,
    },
    metrics,
    rows,
  };
  const outputPath = process.env.TRPG_MECHANICS_QA_OUTPUT?.trim();
  if (outputPath) writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ FINAL_METRICS: metrics }, null, 2));
}

void main().catch((error) => {
  console.error(
    JSON.stringify({
      ERROR_CLASS: error instanceof Error ? error.name : "Error",
      ERROR: error instanceof Error ? error.message : String(error),
    })
  );
  process.exitCode = 1;
});
