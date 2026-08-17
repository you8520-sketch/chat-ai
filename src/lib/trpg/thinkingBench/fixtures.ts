import {
  serializeCampaignDirectorInstructions,
  serializeCampaignDirectorState,
  serializeDirectorDeltaContract,
  type TrpgCampaignContext,
} from "../campaignContext";
import { computeResolutionOrder, formatResolutionOrderBlock } from "../initiative";
import { buildTrpgGmUserBlock, formatTrpgSheetCanon, TRPG_GM_SYSTEM } from "../gmPrompt";
import { parseTrpgScenarioPlan, serializeTrpgScenarioPlanForGm } from "../scenarioPlan";
import { DEFAULT_TRPG_STAT_DEFS, defsFromKeys } from "../stats";
import type { TrpgSheetSnapshot } from "../types";
import type { BenchActionSpec, ThinkingBenchCase } from "./types";

const WORLD_ONLY_BRIEF = `비 오는 골목. 간판 하나가 깜빡이고, 닫힌 편의점 앞에서 버스 정류장 안내음이 끊긴다.
장르는 일상/스릴러. 공식 시나리오 원고는 없다. 골목·편의점·버스 정류장만 주어진다.`;

const AUTHORED_BRIEF = `통신이 끊긴 해안 중계소. 안개와 소금 냄새가 복도에 남아 있다.
장르는 공포/추리. 플레이어는 실종된 보급대의 마지막 신호를 추적한다.`;

const HIDDEN_TOKEN = "HIDDEN_CORE_SWAP_TOKEN";

const AUTHORED_PLAN = parseTrpgScenarioPlan({
  version: 1,
  startingSituation: "안개 낀 해안 중계소 정문에 도착한다. 발전기는 아직 돈다.",
  centralConflict: "중계소 코어를 봉쇄하려는 조사팀과, 코어를 지키려는 잔류 인원이 충돌한다.",
  goal: "통신 두절의 원인을 밝히고 코어를 안전하게 봉쇄한다.",
  secret: `지휘관은 이미 대체되었다. 내부 표식은 ${HIDDEN_TOKEN} 이다. 플레이어에게 직접 말하지 말 것.`,
  endingConditions: ["코어를 봉쇄한다", "잔류 인원을 설득해 함께 철수한다"],
  majorEvents: ["보급대가 실종된다", "비상등이 한 층만 남기고 꺼진다", "지하 통로에서 심장 박동 같은 진동이 난다"],
  clues: ["끊긴 통신 기록", "지휘관 명찰이 두 개다", "코어실 잠금이 안에서 열렸다"],
  forbiddenEvents: ["현대 국가 군대가 등장하지 않는다", "외계 침공은 없다"],
  boss: "대체된 지휘관",
  specialRules: ["GM 비밀을 나레이션에 직접 쓰지 않는다"],
  difficulty: "normal",
  climax: "지하 코어실에서 누가 사람인지 가려진다.",
  endingCandidates: ["봉쇄", "공존", "철수"],
  factionChanges: ["잔류 인원이 조사팀을 불신한다"],
  gmDirection: "단서와 공간 압박을 주고, 플레이어가 정문을 열지 말지 고르게 한다.",
  playLength: "medium",
});

const AUTHORED_PLAN_BLOCK = serializeTrpgScenarioPlanForGm(AUTHORED_PLAN);

const STATS_WITH_SPD = defsFromKeys(["str", "dex", "int", "wis", "cha", "con", "spd"]);

function sheet(opts: {
  participantId: number;
  name: string;
  playerName: string;
  stats: Record<string, number>;
  hp?: number;
  maxHp?: number;
  conditions?: string[];
  inventory?: string[];
  location: string;
}): TrpgSheetSnapshot {
  const maxHp = opts.maxHp ?? 20;
  return {
    participantId: opts.participantId,
    name: opts.name,
    playerName: opts.playerName,
    level: 1,
    hp: opts.hp ?? maxHp,
    maxHp,
    stats: opts.stats,
    conditions: opts.conditions ?? [],
    inventory: opts.inventory ?? [],
    location: opts.location,
    modifiersNote: "",
  };
}

function memoryBlock(opts: {
  round: number;
  location: string;
  next?: string;
  sheets: TrpgSheetSnapshot[];
  quests?: string[];
  npcs?: string[];
  flags?: string[];
  recent?: string;
}): string {
  const sheets = opts.sheets
    .map((s) => {
      const cond = s.conditions.length ? ` conditions=${s.conditions.join(",")}` : "";
      const inv = s.inventory.length ? ` inventory=${s.inventory.join(",")}` : "";
      return `- ${s.name} HP ${s.hp}/${s.maxHp} loc=${s.location}${cond}${inv}`;
    })
    .join("\n");
  return [
    "[TRPG STRUCTURED STATE — authoritative; do not contradict HP/items/location/flags]",
    `round=${opts.round}`,
    `location=${opts.location}`,
    opts.next ? `[NEXT DECISION]\n${opts.next}` : "",
    sheets,
    opts.quests?.length ? `quests: ${opts.quests.join("; ")}` : "",
    opts.npcs?.length ? `npcs: ${opts.npcs.join("; ")}` : "",
    opts.flags?.length ? `flags: ${opts.flags.join("; ")}` : "",
    opts.recent ? `[RECENT ROUNDS — RAW]\n${opts.recent}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function directorBlocks(opts: {
  storyPhase: TrpgCampaignContext["storyPhase"];
  completedRounds: number;
  threads?: string[];
}): string {
  const ctx: TrpgCampaignContext = {
    campaignId: 0,
    sourceMode: "scenario",
    worldSnapshot: null,
    scenarioSnapshot: null,
    directorPlan: AUTHORED_PLAN,
    storyPhase: opts.storyPhase,
    activeThreads: opts.threads ?? ["끊긴 통신 기록"],
    resolvedThreads: [],
    endingStatus: { finished: false },
    directorError: "",
  };
  return [
    serializeCampaignDirectorInstructions(true),
    serializeDirectorDeltaContract({
      storyPhase: opts.storyPhase,
      completedRounds: opts.completedRounds,
    }),
    serializeCampaignDirectorState(ctx),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function minjaePersona(): string {
  return [
    "[PLAYER PERSONA participantId=1 name=민재]",
    "이름/호칭: 민재",
    "20대 후반. 말이 짧고 먼저 주변을 본다. 허세를 싫어한다.",
    "[말투 예시]",
    "일단 보고 말하자. 성급하면 다쳐.",
  ].join("\n");
}

function defaultStats(overrides: Record<string, number> = {}): Record<string, number> {
  return { str: 8, dex: 10, int: 9, wis: 8, cha: 7, con: 9, ...overrides };
}

function spdStats(overrides: Record<string, number> = {}): Record<string, number> {
  return { str: 8, dex: 10, int: 9, wis: 8, cha: 7, con: 9, spd: 8, ...overrides };
}

function buildCase(opts: {
  id: string;
  title: string;
  opening: boolean;
  worldBrief: string;
  genres: string[];
  sheets: TrpgSheetSnapshot[];
  defs: typeof DEFAULT_TRPG_STAT_DEFS;
  actions: BenchActionSpec[];
  includePlan: boolean;
  storyPhase: TrpgCampaignContext["storyPhase"] | null;
  completedRounds: number;
  memory: string;
  gmSecret?: string;
  relationshipBrief?: string;
  allowCampaignFinished?: boolean;
  threads?: string[];
}): ThinkingBenchCase {
  const order = computeResolutionOrder(
    opts.actions.map((action, index) => {
      const found = opts.sheets.find((s) => s.participantId === action.participantId);
      return {
        participantId: action.participantId,
        name: action.name,
        slotIndex: index,
        stats: found?.stats ?? {},
      };
    }),
    opts.defs
  );
  const user = buildTrpgGmUserBlock({
    worldBrief: opts.worldBrief,
    gmSecret: opts.gmSecret ?? "",
    memoryBlock: opts.memory,
    opening: opts.opening,
    playerPersonas: minjaePersona(),
    sheetCanon: formatTrpgSheetCanon({
      defs: opts.defs,
      sheets: opts.sheets.map((s) => ({ name: s.name, stats: s.stats })),
    }),
    genres: opts.genres,
    relationshipBrief: opts.relationshipBrief ?? "",
    scenarioPlanBlock: opts.includePlan ? AUTHORED_PLAN_BLOCK : "",
    storyDirectorBlock:
      opts.includePlan && opts.storyPhase
        ? directorBlocks({
            storyPhase: opts.storyPhase,
            completedRounds: opts.completedRounds,
            threads: opts.threads,
          })
        : "",
    resolutionOrderBlock: formatResolutionOrderBlock(order),
    actions: opts.actions,
  });
  return {
    id: opts.id,
    title: opts.title,
    system: TRPG_GM_SYSTEM,
    user,
    opening: opts.opening,
    currentStoryPhase: opts.storyPhase,
    secretTokens: opts.includePlan ? [HIDDEN_TOKEN, "지휘관은 이미 대체"] : [],
    expectedNames: [...new Set(opts.sheets.map((s) => s.name))],
    actions: opts.actions,
    sheets: opts.sheets,
    resolutionOrder: order,
    allowCampaignFinished: opts.allowCampaignFinished === true,
    centralConflict: opts.includePlan ? AUTHORED_PLAN?.centralConflict : undefined,
    goal: opts.includePlan ? AUTHORED_PLAN?.goal : undefined,
  };
}

const CASE1_SHEETS = [
  sheet({
    participantId: 1,
    name: "민재",
    playerName: "민재",
    stats: defaultStats({ dex: 11 }),
    inventory: ["접이식 우산", "휴대전화"],
    location: "비 오는 골목",
  }),
];

const CASE2_SHEETS = [
  sheet({
    participantId: 1,
    name: "민재",
    playerName: "민재",
    stats: defaultStats({ int: 11, wis: 10 }),
    inventory: ["손전등", "출입증 사본"],
    location: "해안 중계소 정문",
  }),
];

const CASE3_SHEETS = [
  sheet({
    participantId: 1,
    name: "민재",
    playerName: "민재",
    stats: defaultStats({ dex: 11 }),
    inventory: ["접이식 우산", "휴대전화"],
    location: "편의점 앞",
  }),
];

const CASE4_SHEETS = [
  sheet({
    participantId: 1,
    name: "민재",
    playerName: "민재",
    stats: spdStats({ spd: 9, dex: 10 }),
    inventory: ["손전등"],
    location: "중계소 1층 로비",
  }),
  sheet({
    participantId: 2,
    name: "세린",
    playerName: "세린",
    stats: spdStats({ spd: 13, dex: 12, cha: 10 }),
    inventory: ["무전기"],
    location: "중계소 1층 로비",
  }),
];

const CASE5_SHEETS = [
  sheet({
    participantId: 1,
    name: "민재",
    playerName: "민재",
    stats: spdStats({ spd: 8, str: 10 }),
    inventory: ["손전등", "쇠파이프"],
    location: "중계소 계단참",
    conditions: ["젖음"],
  }),
  sheet({
    participantId: 2,
    name: "세린",
    playerName: "세린",
    stats: spdStats({ spd: 14, dex: 12 }),
    inventory: ["무전기"],
    location: "중계소 계단참",
  }),
  sheet({
    participantId: 3,
    name: "하루",
    playerName: "하루",
    stats: spdStats({ spd: 11, int: 12, wis: 11 }),
    inventory: ["메모장"],
    location: "중계소 계단참",
  }),
];

const CASE6_SHEETS = [
  sheet({
    participantId: 1,
    name: "민재",
    playerName: "민재",
    stats: spdStats({ spd: 7, str: 11, con: 10 }),
    hp: 16,
    inventory: ["손전등", "봉인용 키카드", "붕대"],
    location: "코어 접근 복도",
    conditions: ["타박상"],
  }),
  sheet({
    participantId: 2,
    name: "세린",
    playerName: "세린",
    stats: spdStats({ spd: 14, dex: 13 }),
    hp: 18,
    inventory: ["무전기", "섬광탄"],
    location: "코어 접근 복도",
  }),
  sheet({
    participantId: 3,
    name: "하루",
    playerName: "하루",
    stats: spdStats({ spd: 10, int: 13, wis: 12 }),
    hp: 17,
    inventory: ["메모장", "녹음기"],
    location: "코어 접근 복도",
  }),
];

export const THINKING_BENCH_CASES: ThinkingBenchCase[] = [
  buildCase({
    id: "case1_world_opening",
    title: "world-only opening — human 1, bot 0",
    opening: true,
    worldBrief: WORLD_ONLY_BRIEF,
    genres: ["일상", "스릴러"],
    sheets: CASE1_SHEETS,
    defs: DEFAULT_TRPG_STAT_DEFS,
    actions: [],
    includePlan: false,
    storyPhase: null,
    completedRounds: 0,
    memory: memoryBlock({
      round: 0,
      location: "비 오는 골목",
      sheets: CASE1_SHEETS,
    }),
    gmSecret: "골목 끝 편의점 냉장고 뒤에 사람이 한 명 숨어 있다. 직접 말하지 말 것.",
  }),
  buildCase({
    id: "case2_authored_opening",
    title: "authored scenario opening — Scenario Plan included",
    opening: true,
    worldBrief: AUTHORED_BRIEF,
    genres: ["공포/추리"],
    sheets: CASE2_SHEETS,
    defs: DEFAULT_TRPG_STAT_DEFS,
    actions: [],
    includePlan: true,
    storyPhase: "INTRO",
    completedRounds: 0,
    memory: memoryBlock({
      round: 0,
      location: "해안 중계소 정문",
      sheets: CASE2_SHEETS,
      quests: ["통신 두절의 원인"],
      npcs: ["정문 초소의 빈 의자"],
    }),
    gmSecret: `정문 초소 서랍에 지휘관 명찰이 두 장 있다. 표식 ${HIDDEN_TOKEN} 는 나레이션에 쓰지 말 것.`,
  }),
  buildCase({
    id: "case3_simple_round",
    title: "normal progress round — human 1, one simple action",
    opening: false,
    worldBrief: WORLD_ONLY_BRIEF,
    genres: ["일상", "스릴러"],
    sheets: CASE3_SHEETS,
    defs: DEFAULT_TRPG_STAT_DEFS,
    actions: [
      {
        participantId: 1,
        name: "민재",
        kind: "human",
        body: "편의점 유리에 얼굴을 가까이 대고 안을 들여다본다. 계산대 쪽이 보이는지 확인한다.",
        intent: "편의점 내부를 관찰한다",
        statKey: "wis",
        statLabel: "지혜",
        statValue: 8,
        d20: 14,
        finalScore: 16,
        dc: 12,
        tier: "SUCCESS",
      },
    ],
    includePlan: false,
    storyPhase: null,
    completedRounds: 1,
    memory: memoryBlock({
      round: 1,
      location: "편의점 앞",
      next: "유리를 보거나 골목 끝으로 갈 수 있다.",
      sheets: CASE3_SHEETS,
      recent: `[ROUND 1]
  민재: 골목에서 편의점 쪽으로 걸어간다.
  GM: 비가 세지고 편의점 간판만 깜빡인다.`,
    }),
  }),
  buildCase({
    id: "case4_human_bot",
    title: "human 1 + AI bot 1 — related actions",
    opening: false,
    worldBrief: AUTHORED_BRIEF,
    genres: ["공포/추리"],
    sheets: CASE4_SHEETS,
    defs: STATS_WITH_SPD,
    actions: [
      {
        participantId: 1,
        name: "민재",
        kind: "human",
        body: "로비 안내 데스크 서랍을 열어 출입 기록이나 열쇠를 찾는다.",
        intent: "데스크 서랍에서 출입 단서를 찾는다",
        statKey: "int",
        statLabel: "지능",
        statValue: 9,
        d20: 11,
        finalScore: 13,
        dc: 12,
        tier: "SUCCESS",
      },
      {
        participantId: 2,
        name: "세린",
        kind: "bot",
        body: "민재가 서랍을 여는 동안 로비 비상계단 쪽을 막아 선다. 발소리가 나면 먼저 알린다.",
        intent: "민재가 뒤가 뚫리지 않게 비상계단을 감시한다",
        statKey: "wis",
        statLabel: "지혜",
        statValue: 8,
        d20: 8,
        finalScore: 10,
        dc: 12,
        tier: "FAILURE",
      },
    ],
    includePlan: true,
    storyPhase: "DEVELOPMENT",
    completedRounds: 2,
    memory: memoryBlock({
      round: 2,
      location: "중계소 1층 로비",
      next: "로비를 뒤지거나 계단으로 올라갈 수 있다.",
      sheets: CASE4_SHEETS,
      quests: ["통신 두절의 원인"],
      flags: ["정문_통과"],
      recent: `[ROUND 1]
  민재: 정문 유리를 밀어 로비로 들어간다.
  GM: 로비 조명이 한 줄만 살아 있다.`,
    }),
    relationshipBrief: "세린은 민재의 현장 파트너다. 반말은 하지 않고, 위험하면 먼저 이름을 부른다.",
    gmSecret: `로비 카메라에 ${HIDDEN_TOKEN} 표식이 찍혀 있다. 직접 읽히게 쓰지 말 것.`,
    threads: ["끊긴 통신 기록", "로비 카메라"],
  }),
  buildCase({
    id: "case5_two_bots",
    title: "human 1 + AI bot 2 — weave three actions",
    opening: false,
    worldBrief: AUTHORED_BRIEF,
    genres: ["공포/추리"],
    sheets: CASE5_SHEETS,
    defs: STATS_WITH_SPD,
    actions: [
      {
        participantId: 1,
        name: "민재",
        kind: "human",
        body: "2층으로 이어진 철문을 어깨로 밀어 틈을 만든다. 세린과 하루가 지나가게 한다.",
        intent: "철문을 밀어 2층 통로를 연다",
        statKey: "str",
        statLabel: "힘",
        statValue: 10,
        d20: 15,
        finalScore: 18,
        dc: 12,
        tier: "SUCCESS",
      },
      {
        participantId: 2,
        name: "세린",
        kind: "bot",
        body: "민재가 문을 미는 순간 복도 끝 그림자를 향해 손전등을 비추고 누가 있는지 묻는다.",
        intent: "복도 끝 그림자에게 정체를 묻는다",
        needsCheck: false,
        statKey: "cha",
        statLabel: "매력",
        statValue: 7,
        d20: null,
        finalScore: null,
        dc: null,
        tier: null,
      },
      {
        participantId: 3,
        name: "하루",
        kind: "bot",
        body: "문틈으로 새는 바람에 섞인 기계음을 듣고, 어느 층 발전기인지 짚어 민재에게 짧게 알린다.",
        intent: "기계음의 출처 층을 추정해 알린다",
        statKey: "int",
        statLabel: "지능",
        statValue: 12,
        d20: 17,
        finalScore: 21,
        dc: 12,
        tier: "GREAT_SUCCESS",
      },
    ],
    includePlan: true,
    storyPhase: "DEVELOPMENT",
    completedRounds: 3,
    memory: memoryBlock({
      round: 3,
      location: "중계소 계단참",
      next: "2층 철문을 열거나 지하로 내려갈 수 있다.",
      sheets: CASE5_SHEETS,
      quests: ["통신 두절의 원인"],
      npcs: ["복도 끝의 그림자"],
      flags: ["정문_통과", "비상등_일부소등"],
    }),
    relationshipBrief: "하루는 과묵한 기록원이고, 세린은 민재를 엄호한다. 세 사람은 같은 조사팀이다.",
    gmSecret: `그림자는 사람 하나가 아니라 코트만 걸려 있다. ${HIDDEN_TOKEN} 를 나레이션에 쓰지 말 것.`,
    threads: ["끊긴 통신 기록", "복도 끝 그림자"],
  }),
  buildCase({
    id: "case6_complex_scenario",
    title: "complex scenario — mixed dice, deltas, story phase, initiative",
    opening: false,
    worldBrief: AUTHORED_BRIEF,
    genres: ["공포/추리"],
    sheets: CASE6_SHEETS,
    defs: STATS_WITH_SPD,
    actions: [
      {
        participantId: 1,
        name: "민재",
        kind: "human",
        body: "코어실 잠금을 키카드로 찍고 어깨로 문을 연 뒤, 안쪽 레버를 내려 봉인을 시도한다.",
        intent: "키카드로 코어실을 열고 봉인 레버를 내린다",
        statKey: "str",
        statLabel: "힘",
        statValue: 11,
        d20: 6,
        finalScore: 9,
        dc: 12,
        tier: "FAILURE",
      },
      {
        participantId: 2,
        name: "세린",
        kind: "bot",
        body: "민재보다 먼저 복도 모퉁이를 돌아 잔류 인원 두 명을 제압해 민재가 레버에 집중하게 한다.",
        intent: "잔류 인원을 제압해 민재의 뒤를 막는다",
        statKey: "dex",
        statLabel: "민첩",
        statValue: 13,
        d20: 18,
        finalScore: 22,
        dc: 12,
        tier: "GREAT_SUCCESS",
      },
      {
        participantId: 3,
        name: "하루",
        kind: "bot",
        body: "봉인이 실패하는 소리를 듣고 콘솔 경고문을 읽어, 레버가 아니라 냉각 밸브를 먼저 잠가야 한다고 외친다.",
        intent: "콘솔을 읽어 올바른 봉인 순서를 알린다",
        statKey: "int",
        statLabel: "지능",
        statValue: 13,
        d20: 12,
        finalScore: 16,
        dc: 12,
        tier: "SUCCESS",
      },
    ],
    includePlan: true,
    storyPhase: "ESCALATION",
    completedRounds: 5,
    memory: memoryBlock({
      round: 5,
      location: "코어 접근 복도",
      next: "코어실 문을 열거나 잔류 인원과 협상할 수 있다.",
      sheets: CASE6_SHEETS,
      quests: ["코어 봉쇄", "통신 두절의 원인"],
      npcs: ["잔류 인원 둘", "대체된 지휘관의 목소리"],
      flags: ["정문_통과", "비상등_일부소등", "코어_진동"],
      recent: `[ROUND 4]
  민재: 지하로 내려가며 키카드를 꺼낸다.
  세린: 뒤를 확인한다.
  하루: 경고 라벨을 베낀다.
  GM: 코어 쪽으로 박동이 커진다. 이야기 단계는 고조.`,
    }),
    relationshipBrief: "세린이 선두, 민재가 봉인, 하루가 절차를 읽는다. 서로 이름을 부른다.",
    gmSecret: `올바른 순서는 냉각 밸브 다음 레버다. 지휘관 목소리는 녹음이다. ${HIDDEN_TOKEN} 를 인용하지 말 것.`,
    threads: ["끊긴 통신 기록", "코어 박동", "잔류 인원"],
    allowCampaignFinished: false,
  }),
];

export function thinkingBenchCaseById(id: string): ThinkingBenchCase {
  const found = THINKING_BENCH_CASES.find((row) => row.id === id);
  if (!found) throw new Error(`unknown thinking bench case: ${id}`);
  return found;
}
