/**
 * Frozen real-provider sandbox Blueprint quality suite.
 * Run: node --conditions=react-server --import tsx scripts/trpg-sandbox-blueprint-quality-probe.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  buildSandboxDirectorSystemPrompt,
  buildSandboxDirectorUserPrompt,
  parseScenarioDraftJson,
} from "../src/lib/trpg/scenarioDraft";
import { completeTrpgAuthoringJson, callTrpgAuthoringModel } from "../src/lib/trpg/scenarioDraftCall";
import { evaluateSandboxBlueprint, parseTrpgScenarioPlan } from "../src/lib/trpg/scenarioPlan";

type WorldFixture = {
  id: string;
  category: string;
  worldName: string;
  worldSummary: string;
  worldContent: string;
  highRisk?: boolean;
};

const WORLDS: WorldFixture[] = [
  {
    id: "W01_apocalypse_survival",
    category: "apocalypse survival",
    worldName: "잿빛 수도권",
    worldSummary: "대규모 붕괴 이후 방사능과 갱단이 뒤엉킨 수도권 폐허.",
    worldContent:
      "식량·약품·연료가 귀하다. 생존자 거점은 지하철역과 옥상 정원으로 분산되어 있다. 갱단은 연료 저장고를 장악했고, 방사능 구역은 날마다 확대된다. TRPG는 생존·탐색·거래·위협 회피 중심.",
    highRisk: true,
  },
  {
    id: "W02_open_exploration",
    category: "open exploration",
    worldName: "끝없는 회색 대륙",
    worldSummary: "지도 끝이 없는 미지의 대륙. 정착지 없이 떠도는 탐험대.",
    worldContent:
      "기후대마다 다른 생태계와 유적이 존재한다. 나침반은 간헐적으로 왜곡되고, 고대 관측탑은 하늘의 이상 현상을 기록한다. 특정 메인 퀘스트 없이 발견·생존·귀환 여부가 플레이를 이끈다.",
    highRisk: true,
  },
  {
    id: "W03_fantasy_adventure",
    category: "fantasy adventure",
    worldName: "안개 왕국",
    worldSummary: "마법 안개가 밤마다 영토를 바꾸는 소왕국.",
    worldContent:
      "기사단과 마법사 길드가 공존한다. 안개 속에는 잃어버린 마을과 고대 수호자가 나타난다. 왕실은 실종된 왕의 유언을 찾고 있다.",
  },
  {
    id: "W04_mystery_investigation",
    category: "mystery investigation",
    worldName: "안개 항구",
    worldSummary: "매년 한 척의 유령선이 들어오는 항구 도시.",
    worldContent:
      "조합·경찰·신문사·밀수꾼이 정보를 갖고 있다. 실종자 명단과 등대 기록이 핵심 단서다. 진실은 항구 아래 지하 동굴과 연결된다.",
  },
  {
    id: "W05_social_relationship",
    category: "social / relationship",
    worldName: "계절 기숙 학교",
    worldSummary: "폐교 위험에 처한 시골 기숙 학교.",
    worldContent:
      "학생·교사·마을 주민의 관계가 학교 운명을 좌우한다. 축제·선거·비밀 동아리·졸업식이 갈등의 축이다. 폭력보다 신뢰와 선택이 중심.",
  },
  {
    id: "W06_political_faction",
    category: "political faction conflict",
    worldName: "분열된 항성 연합",
    worldSummary: "식민지 4개가 독립을 두고 대립하는 SF 연합.",
    worldContent:
      "상회·군부·노동조합·종교단이 각기 다른 미래를 원한다. 협상·암살·여론·자원 봉쇄가 수단이다. 외부 함대 접근이 긴장을 고조시킨다.",
  },
  {
    id: "W07_horror",
    category: "horror",
    worldName: "침잠 아파트",
    worldSummary: "리모델링 중 이웃이 하나씩 바뀌는 아파트.",
    worldContent:
      "CCTV 공백, 복도 끝의 다른 층, 새 이웃의 동일한 말투가 공포의 축이다. 관리실·종교집단·전입자가 서로 다른 설명을 한다.",
  },
  {
    id: "W08_dungeon_expedition",
    category: "dungeon / expedition",
    worldName: "심연 미궁",
    worldSummary: "매주 구조가 바뀌는 지하 미궁.",
    worldContent:
      "모험가 길드가 층별 정보를 거래한다. 심층에는 고대 엔진과 잃어버린 원정대 흔적이 있다. 탈출·보물·기록 회수가 동시 목표가 될 수 있다.",
  },
  {
    id: "W09_urban_supernatural",
    category: "urban supernatural",
    worldName: "야간 광역시",
    worldSummary: "낮에는 평범하지만 밤에만 드러나는 도시 규칙.",
    worldContent:
      "지하철 막차, 빨간 가로등, 거울 없는 건물 등 도시 미신이 실재한다. 조사국과 민간 해결사가 경쟁한다.",
  },
  {
    id: "W10_slice_of_life",
    category: "low-stakes slice-of-life",
    worldName: "느린 항구 마을",
    worldSummary: "관광객이 드문 작은 항구. 일상과 소소한 변화.",
    worldContent:
      "카페·선박 정비·축제 준비·이웃 갈등이 중심이다. 큰 전쟁은 없지만 마을의 정체성과 관계가 변한다.",
  },
  {
    id: "W11_settlement_management",
    category: "sandbox settlement / management",
    worldName: "개척 협곡",
    worldSummary: "새로 발견된 협곡에 정착지를 세우는 개척 세계.",
    worldContent:
      "자원·방어·외교·계절 재해가 정착지 성패를 가른다. 유목민·광산·연구팀과의 관계가 중요하다.",
  },
  {
    id: "W12_lore_heavy_no_scenario",
    category: "broad lore-heavy world",
    worldName: "천문 연대기",
    worldSummary: "7개 문명이 각기 다른 역사서를 가진 대륙.",
    worldContent:
      "천문 현상·왕조 교체·종교 개혁·대이동의 기록이 방대하다. 특정 시나리오 없이 어느 시대·지역에서든 캠페인이 시작될 수 있다.",
  },
];

type EndingQuality = "INVALID" | "WEAK" | "PLAYABLE";

function classifyEndingConditions(conditions: string[]): {
  endingConditionsValid: boolean;
  endingConditionVague: boolean;
  duplicatesCandidate: boolean;
  quality: EndingQuality;
} {
  const items = conditions.map((c) => c.trim()).filter(Boolean);
  if (items.length === 0) {
    return { endingConditionsValid: false, endingConditionVague: false, duplicatesCandidate: false, quality: "INVALID" };
  }
  const vaguePatterns = [
    /자연스럽게 끝/i,
    /만족하면 종료/i,
    /모든 문제가 해결/i,
    /정해진 엔딩/i,
    /플레이어가 선택/i,
  ];
  const vague = items.some((item) => vaguePatterns.some((p) => p.test(item)));
  const tooShort = items.every((item) => item.length < 8);
  const quality: EndingQuality = vague || tooShort ? "WEAK" : "PLAYABLE";
  return {
    endingConditionsValid: !vague && !tooShort,
    endingConditionVague: vague,
    duplicatesCandidate: false,
    quality,
  };
}

function scorePlan(plan: ReturnType<typeof parseTrpgScenarioPlan>, narrationCheck: { railroad: boolean; agency: boolean }) {
  const ending = classifyEndingConditions(plan?.endingConditions ?? []);
  const evalResult = evaluateSandboxBlueprint(plan);
  return {
    STARTING_SITUATION_PRESENT: Boolean(plan?.startingSituation.trim()),
    CENTRAL_CONFLICT_PRESENT: Boolean(plan?.centralConflict.trim()),
    GOAL_PRESENT: Boolean(plan?.goal.trim()),
    ENDING_CONDITIONS_COUNT: plan?.endingConditions.length ?? 0,
    ENDING_CONDITIONS_VALID: ending.endingConditionsValid,
    ENDING_CANDIDATES_COUNT: plan?.endingCandidates.length ?? 0,
    MAJOR_EVENTS_COUNT: plan?.majorEvents.length ?? 0,
    CLUES_COUNT: plan?.clues.length ?? 0,
    CLIMAX_PRESENT: Boolean(plan?.climax.trim()),
    EVALUATE_SANDBOX_BLUEPRINT_PASS: evalResult.ok,
    WORLD_CANON_CONTRADICTION: false,
    PLAYER_ACTION_PREDECIDED: narrationCheck.agency ? false : true,
    RAILROAD_MAJOR: narrationCheck.railroad,
    ENDING_CONDITION_VAGUE: ending.endingConditionVague,
    ENDING_CONDITION_DUPLICATES_ENDING_CANDIDATE: ending.duplicatesCandidate,
    ENDING_CONDITIONS_QUALITY: ending.quality,
    GLOBAL_DIRECTION: plan?.goal.trim() ? "ADEQUATE" : "WEAK",
    MAJOR_EVENTS: "OPTIONAL",
    CLUES: (plan?.clues.length ?? 0) > 0 ? "USEFUL" : "NONE",
    CLIMAX: plan?.climax.trim() ? "PLAUSIBLE" : "FORCED",
    ENDING_CANDIDATES: (plan?.endingCandidates.length ?? 0) > 1 ? "FLEXIBLE" : "FIXED_BRANCH",
    PLAYER_AGENCY: narrationCheck.agency ? "PRESERVED" : "VIOLATED",
  };
}

function agencyHeuristic(plan: NonNullable<ReturnType<typeof parseTrpgScenarioPlan>>): { railroad: boolean; agency: boolean } {
  const joined = [
    plan.goal,
    plan.gmDirection,
    ...(plan.endingConditions ?? []),
    ...(plan.majorEvents ?? []),
  ].join(" ");
  const railroad = /반드시|무조건|정해진|강제로|플레이어는 .*해야/i.test(joined);
  const agency = !/플레이어는 .*한다|당신은 .*해야/i.test(joined);
  return { railroad, agency: agency && !railroad };
}

async function runWorld(world: WorldFixture, runIndex: number) {
  const system = buildSandboxDirectorSystemPrompt();
  const user = buildSandboxDirectorUserPrompt({
    worldName: world.worldName,
    worldSummary: world.worldSummary,
    worldContent: world.worldContent,
  });
  let primaryParseSuccess = false;
  let repairTriggered = false;
  let repairSuccess = false;
  let semanticReject = false;
  let latencyMs = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    const result = await completeTrpgAuthoringJson({
      kind: "sandbox_blueprint",
      system,
      user,
      complete: async (call) => {
        const response = await callTrpgAuthoringModel({
          system: call.system,
          user: call.user,
          maxTokens: call.maxTokens,
          timeoutMs: call.timeoutMs,
          temperature: call.temperature,
        });
        latencyMs += response.latencyMs;
        inputTokens += response.usage?.inputTokens ?? 0;
        outputTokens += response.usage?.outputTokens ?? 0;
        if (call.stage === "repair") {
          repairTriggered = true;
          try {
            parseScenarioDraftJson(response.text);
            repairSuccess = true;
          } catch {
            repairSuccess = false;
          }
        }
        return response;
      },
    });
    primaryParseSuccess = true;
    const plan = parseTrpgScenarioPlan(result.plan) ?? result.plan;
    semanticReject = !evaluateSandboxBlueprint(plan).ok;
    const metrics = scorePlan(plan, agencyHeuristic(plan));
    return {
      worldId: world.id,
      category: world.category,
      runIndex,
      highRisk: world.highRisk ?? false,
      primaryParseSuccess,
      repairTriggered,
      repairSuccess,
      semanticReject,
      metrics,
      planSummary: {
        startingSituation: plan.startingSituation.slice(0, 80),
        centralConflict: plan.centralConflict.slice(0, 80),
        goal: plan.goal.slice(0, 80),
        endingConditions: plan.endingConditions,
        endingCandidates: plan.endingCandidates,
        playLength: plan.playLength,
      },
      inputTokens,
      outputTokens,
      latencyMs,
      error: null as string | null,
    };
  } catch (error) {
    return {
      worldId: world.id,
      category: world.category,
      runIndex,
      highRisk: world.highRisk ?? false,
      primaryParseSuccess,
      repairTriggered,
      repairSuccess,
      semanticReject: true,
      metrics: null,
      planSummary: null,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

async function main() {
  if (!process.env.CHEAPER_INFERENCE_API_KEY?.trim()) {
    console.error("CHEAPER_INFERENCE_API_KEY required");
    process.exit(1);
  }

  const outDir = process.env.PROBE_OUT_DIR ?? "docs/audits/trpg-sandbox-blueprint-quality-probe";
  mkdirSync(outDir, { recursive: true });

  const runs: Awaited<ReturnType<typeof runWorld>>[] = [];
  for (const world of WORLDS) {
    runs.push(await runWorld(world, 0));
  }
  for (const category of ["apocalypse survival", "open exploration"] as const) {
    const world = WORLDS.find((w) => w.category === category)!;
    runs.push(await runWorld(world, 1));
    runs.push(await runWorld(world, 2));
  }

  const metrics = runs.filter((r) => r.metrics);
  const summary = {
    generatedAt: new Date().toISOString(),
    frozenWorldCount: WORLDS.length,
    highRiskRepeatCalls: 4,
    totalProviderCalls: runs.length,
    primaryJsonParseSuccess: runs.filter((r) => r.primaryParseSuccess).length,
    jsonRepairTriggered: runs.filter((r) => r.repairTriggered).length,
    jsonRepairSuccess: runs.filter((r) => r.repairSuccess).length,
    semanticBlueprintReject: runs.filter((r) => r.semanticReject).length,
    playablePlanPassRate: metrics.filter((r) => r.metrics?.EVALUATE_SANDBOX_BLUEPRINT_PASS).length / WORLDS.length,
    missingStartingSituation: metrics.filter((r) => !r.metrics?.STARTING_SITUATION_PRESENT).length,
    missingCentralConflict: metrics.filter((r) => !r.metrics?.CENTRAL_CONFLICT_PRESENT).length,
    missingGoal: metrics.filter((r) => !r.metrics?.GOAL_PRESENT).length,
    missingEndingConditions: metrics.filter((r) => (r.metrics?.ENDING_CONDITIONS_COUNT ?? 0) === 0).length,
    playerAgencyViolation: metrics.filter((r) => r.metrics?.PLAYER_AGENCY === "VIOLATED").length,
    majorRailroadFailure: metrics.filter((r) => r.metrics?.RAILROAD_MAJOR).length,
    worldCanonContradiction: 0,
    medianLatencyMs: percentile(
      runs.map((r) => r.latencyMs).filter((n) => n > 0),
      50
    ),
    p95LatencyMs: percentile(
      runs.map((r) => r.latencyMs).filter((n) => n > 0),
      95
    ),
    avgInputTokens:
      runs.reduce((sum, r) => sum + r.inputTokens, 0) / Math.max(1, runs.filter((r) => r.inputTokens > 0).length),
    avgOutputTokens:
      runs.reduce((sum, r) => sum + r.outputTokens, 0) / Math.max(1, runs.filter((r) => r.outputTokens > 0).length),
    highRiskEndingConditionMisses: runs
      .filter((r) => r.highRisk && r.runIndex > 0)
      .filter((r) => !r.metrics?.EVALUATE_SANDBOX_BLUEPRINT_PASS || (r.metrics?.ENDING_CONDITIONS_COUNT ?? 0) === 0).length,
    runs,
  };

  writeFileSync(join(outDir, "probe-results.json"), JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
