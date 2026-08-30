/**
 * Frozen world-only sandbox blueprint quality probe.
 * Uses EXISTING generator owners — no prompt changes.
 *
 * Run: npx tsx scripts/trpg-sandbox-blueprint-quality-probe.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import {
  buildSandboxDirectorSystemPrompt,
  buildSandboxDirectorUserPrompt,
  TRPG_SCENARIO_DRAFT_MODEL,
} from "../src/lib/trpg/scenarioDraft";
import { completeTrpgAuthoringJson, callTrpgAuthoringModel } from "../src/lib/trpg/scenarioDraftCall";
import {
  evaluateSandboxBlueprint,
  hasPlayableScenarioPlan,
  lintTrpgScenarioPlan,
  type TrpgScenarioPlan,
} from "../src/lib/trpg/scenarioPlan";
import { computeOpenRouterTurnBilling } from "../src/lib/points";

loadEnvConfig(process.cwd());

type WorldFixture = {
  id: string;
  genre: string;
  worldName: string;
  worldSummary: string;
  worldContent: string;
};

const WORLDS: WorldFixture[] = [
  {
    id: "survival_apocalypse",
    genre: "survival / apocalypse",
    worldName: "붕괴 도시",
    worldSummary: "대정전 이후 3년, 전력과 통신이 끊긴 대도시 잔해.",
    worldContent:
      "생존자들은 폐쇄된 지하철역과 붕괴된 고층 건물에 거점을 마련했다. 공기 중에는 불명의 포자와 곰팡이가 퍼져 있으며, 일부 구역은 생물학적 오염으로 접근이 제한된다. 생존 세력은 식량, 약품, 안전한 탈출 경로를 두고 경쟁한다. 군 잔존 부대와 민간 생존자 연합, 그리고 오염 구역에 적응한 변이 생물이 존재한다.",
  },
  {
    id: "fantasy_adventure",
    genre: "fantasy adventure",
    worldName: "안개 섬",
    worldSummary: "마법이 희미해진 섬나라, 고대 유적과 해적 왕국이 공존한다.",
    worldContent:
      "섬 전역에 안개가 드리워져 항로가 자주 바뀐다. 왕국은 마법사 길드와 상인 연합이 균형을 유지하지만, 최근 유적에서 깨어난 고대 수호자의 흔적이 목격된다. 숲, 해안, 폐허 신전, 지하 동굴이 주요 무대다. 마법은 약해졌지만 유물과 고대 문양으로 제한적 효과를 낸다.",
  },
  {
    id: "social_relationship",
    genre: "social / relationship",
    worldName: "강변 마을",
    worldSummary: "소규모 공동체가 계절 축제와 농경을 중심으로 살아가는 평화로운 마을.",
    worldContent:
      "마을은 강변 언덕에 자리 잡았고, 이웃 간의 약속과 명성이 중요하다. 최근 젊은 세대의 이주와 외부 상인의 진출로 전통과 변화가 충돌한다. 축제 준비, 상실, 비밀스러운 편지, 오래된 가족 갈등이 마을의 긴장을 만든다. 폭력보다 관계와 선택이 중심이다.",
  },
  {
    id: "mystery",
    genre: "mystery",
    worldName: "안개 호텔",
    worldSummary: "폐쇄된 산악 리조트 호텔에서 연쇄 실종 사건이 발생했다.",
    worldContent:
      "눈보라로 고립된 호텔. 손님과 직원 각각 다른 이유로 머물고 있으며, CCTV 일부 구간이 손상되었다. 실종자의 짐, 손상된 열쇠, 이중 장부, 직원 간 알ibi가 엇갈린다. 호텔 지하에는 오래된 지하실과 폐쇄된 연회장이 있다. 공포보다 수사와 인물 관계가 중심.",
  },
  {
    id: "open_exploration",
    genre: "open exploration",
    worldName: "별무리 항로",
    worldSummary: "미지의 섬과 해역을 연결하는 항해 시대의 탐험 세계.",
    worldContent:
      "수많은 섬과 해류, 기후대, 고대 항로 표식이 존재한다. 특정 목적지가 강제되지 않으며, 항해사 길드, 연구자, 포식자, 고립 부족이 각자의 이유로 바다를 항해한다. 보물, 지도, 자연재해, 미확인 생물, 문화적 발견이 가능하다. 장기 샌드박스 탐험이 전제다.",
  },
];

type QualityReview = {
  STARTING_SITUATION_USABLE: boolean;
  CENTRAL_CONFLICT_CLEAR: boolean;
  PLAYER_GOAL_ACTIONABLE: boolean;
  ENDING_CONDITIONS_PLAYABLE: boolean;
  MAJOR_EVENTS_OPTIONAL_NOT_RAILROAD: boolean;
  CLUES_USEFUL: boolean;
  CLIMAX_CAUSAL: boolean;
  ENDING_CANDIDATES_NOT_FIXED_BRANCHES: boolean;
  WORLD_CANON_CONTRADICTION: boolean;
  PLAYER_AGENCY_VIOLATION: boolean;
};

function reviewPlan(plan: TrpgScenarioPlan, world: WorldFixture): QualityReview {
  const railroad =
    /먼저|반드시|순서대로|1단계|2단계|무조건|필수적으로/i.test(
      [plan.gmDirection, ...plan.majorEvents, plan.climax].join("\n")
    ) || plan.majorEvents.length >= 6;
  const agencyViolation =
    /플레이어는 .*한다|PC는 .*선택|주인공이 .*하기로|파티는 .*할 것/i.test(
      [plan.startingSituation, plan.goal, plan.gmDirection].join("\n")
    );
  const worldTokens = `${world.worldSummary} ${world.worldContent}`.toLowerCase();
  const planText = JSON.stringify(plan).toLowerCase();
  const contradiction =
    plan.forbiddenEvents.some((f) => planText.includes(f.toLowerCase().slice(0, 8))) ||
    (world.worldName && !planText.includes(world.worldName.slice(0, 2).toLowerCase()) && planText.length > 200);

  return {
    STARTING_SITUATION_USABLE: plan.startingSituation.trim().length >= 20,
    CENTRAL_CONFLICT_CLEAR: plan.centralConflict.trim().length >= 15,
    PLAYER_GOAL_ACTIONABLE: plan.goal.trim().length >= 10 && !/감정|느낀다$/i.test(plan.goal),
    ENDING_CONDITIONS_PLAYABLE: plan.endingConditions.some((e) => e.trim().length >= 8),
    MAJOR_EVENTS_OPTIONAL_NOT_RAILROAD: plan.majorEvents.length > 0 && !railroad,
    CLUES_USEFUL: plan.clues.length > 0,
    CLIMAX_CAUSAL:
      plan.climax.trim().length >= 10 &&
      /갈등|위기|대립|수습|결|전환|드러/i.test(plan.climax + plan.centralConflict),
    ENDING_CANDIDATES_NOT_FIXED_BRANCHES:
      plan.endingCandidates.length >= 1 || plan.endingConditions.length >= 2,
    WORLD_CANON_CONTRADICTION: contradiction,
    PLAYER_AGENCY_VIOLATION: agencyViolation,
  };
}

function estimatePoints(inputTokens: number, outputTokens: number): number {
  return computeOpenRouterTurnBilling({
    modelId: TRPG_SCENARIO_DRAFT_MODEL,
    inputTokens,
    outputTokens,
  }).total;
}

async function main(): Promise<void> {
  const system = buildSandboxDirectorSystemPrompt();
  const results: unknown[] = [];
  const latencies: number[] = [];
  const inputTokens: number[] = [];
  const outputTokens: number[] = [];
  let playablePass = 0;
  let sandboxPass = 0;

  for (const world of WORLDS) {
    const user = buildSandboxDirectorUserPrompt({
      worldName: world.worldName,
      worldSummary: world.worldSummary,
      worldContent: world.worldContent,
    });
    const started = Date.now();
    let error = "";
    let draft;
    let inTok = 0;
    let outTok = 0;
    try {
      draft = await completeTrpgAuthoringJson({
        kind: "sandbox_blueprint",
        system,
        user,
        complete: async (call) => {
          const result = await callTrpgAuthoringModel({
            system: call.system,
            user: call.user,
            maxTokens: call.maxTokens,
            timeoutMs: call.timeoutMs,
            temperature: call.temperature,
          });
          inTok += result.usage?.inputTokens ?? 0;
          outTok += result.usage?.outputTokens ?? 0;
          return result;
        },
      });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const latencyMs = Date.now() - started;
    latencies.push(latencyMs);

    if (!draft) {
      results.push({ world: world.id, genre: world.genre, error, latencyMs });
      continue;
    }

    const plan = draft.plan;
    const playable = hasPlayableScenarioPlan(plan);
    const sandbox = evaluateSandboxBlueprint(plan);
    const lint = lintTrpgScenarioPlan({ plan });
    const review = reviewPlan(plan, world);
    if (playable) playablePass += 1;
    if (sandbox.ok) sandboxPass += 1;

    const inTokFinal = inTok;
    const outTokFinal = outTok;
    inputTokens.push(inTokFinal);
    outputTokens.push(outTokFinal);

    results.push({
      world: world.id,
      genre: world.genre,
      latencyMs,
      inputTokens: inTokFinal,
      outputTokens: outTokFinal,
      estimatedUserPoints: estimatePoints(inTokFinal, outTokFinal),
      playable,
      evaluateSandboxBlueprint: sandbox,
      lintErrors: lint.filter((i) => i.level === "error").map((i) => i.code),
      lintWarnings: lint.filter((i) => i.level === "warning").map((i) => i.code),
      qualityReview: review,
      planFieldsPresent: {
        startingSituation: Boolean(plan.startingSituation.trim()),
        centralConflict: Boolean(plan.centralConflict.trim()),
        goal: Boolean(plan.goal.trim()),
        endingConditions: plan.endingConditions.length,
        majorEvents: plan.majorEvents.length,
        clues: plan.clues.length,
        climax: Boolean(plan.climax.trim()),
        endingCandidates: plan.endingCandidates.length,
        playLength: plan.playLength,
      },
    });
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1] ?? 0;
  const avgIn = inputTokens.length
    ? Math.round(inputTokens.reduce((a, b) => a + b, 0) / inputTokens.length)
    : 0;
  const avgOut = outputTokens.length
    ? Math.round(outputTokens.reduce((a, b) => a + b, 0) / outputTokens.length)
    : 0;
  const avgPoints = inputTokens.length
    ? Math.round(
        inputTokens
          .map((inTok, i) => estimatePoints(inTok, outputTokens[i] ?? 0))
          .reduce((a, b) => a + b, 0) / inputTokens.length
      )
    : 0;

  const summary = {
    model: TRPG_SCENARIO_DRAFT_MODEL,
    worldsRun: WORLDS.length,
    successes: results.filter((r) => !(r as { error?: string }).error).length,
    playablePassRate: `${playablePass}/${WORLDS.length}`,
    evaluateSandboxPassRate: `${sandboxPass}/${WORLDS.length}`,
    medianLatencyMs: median,
    p95LatencyMs: p95,
    typicalInputTokens: avgIn,
    typicalOutputTokens: avgOut,
    typicalEstimatedUserPointsIfBilled: avgPoints,
    note: "Blueprint generation is NOT billed to users today; points are hypothetical via computeOpenRouterTurnBilling.",
  };

  const outDir = join(process.cwd(), "docs/audits/trpg-story-architecture-next");
  mkdirSync(outDir, { recursive: true });
  const payload = { summary, results, generatedAt: new Date().toISOString() };
  writeFileSync(join(outDir, "sandbox-blueprint-quality-probe.json"), JSON.stringify(payload, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
