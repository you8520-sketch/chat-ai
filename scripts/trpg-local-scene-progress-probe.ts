/**
 * Real-provider probe for local scene progress (P1–P8).
 * Run: node --conditions=react-server --import tsx scripts/trpg-local-scene-progress-probe.ts
 */
import { writeFileSync } from "node:fs";
import { buildTrpgGmUserBlock, parseTrpgGmOutput, TRPG_GM_SYSTEM } from "../src/lib/trpg/gmPrompt";
import { callTrpgGm } from "../src/lib/trpg/gmCall";
import {
  applyLocalSceneProgressDelta,
  emptyLocalSceneProgress,
  type TrpgLocalSceneProgressV1,
  serializeLocalSceneDeltaContract,
  serializeLocalSceneStateForGm,
} from "../src/lib/trpg/localSceneProgress";

type ProbeCase = {
  id: string;
  label: string;
  progress: TrpgLocalSceneProgressV1;
  action: string;
  runs: number;
};

const cases: ProbeCase[] = [
  {
    id: "P1",
    label: "route already opened",
    progress: applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
      objectiveSet: "건물 탈출",
      openRoutesAdd: ["우측 환풍구"],
    }),
    action: "환풍구 쪽을 조용히 살핀다.",
    runs: 1,
  },
  {
    id: "P2",
    label: "resolved obstacle",
    progress: applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
      objectiveSet: "건물 탈출",
      resolvedObstaclesAdd: ["정면 균사벽 일부 제거"],
      openRoutesAdd: ["우측 환풍구"],
    }),
    action: "환풍구로 이동할 준비를 한다.",
    runs: 1,
  },
  {
    id: "P3",
    label: "new threat after progress",
    progress: applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
      objectiveSet: "건물 탈출",
      openRoutesAdd: ["우측 환풍구"],
      remainingBlockersAdd: ["기생종 접근"],
    }),
    action: "주변을 경계하며 다음 수를 본다.",
    runs: 1,
  },
  {
    id: "P4",
    label: "transition_ready",
    progress: applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
      objectiveSet: "탈출 경로 확보",
      openRoutesAdd: ["환풍구", "후문"],
      sceneStateSet: "transition_ready",
    }),
    action: "당장 나갈지, 한 번 더 둘러볼지 고민한다.",
    runs: 1,
  },
  {
    id: "P5",
    label: "player voluntarily remains",
    progress: applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
      objectiveSet: "편의점 생존",
      openRoutesAdd: ["후문"],
      sceneStateSet: "transition_ready",
    }),
    action: "후문은 열려 있지만 아직 나가지 않고 선반 뒤에 몸을 숨긴다.",
    runs: 1,
  },
  {
    id: "P6",
    label: "complex unresolved boss",
    progress: applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
      objectiveSet: "보스 격파",
      remainingBlockersAdd: ["보스 HP 잔존", "광역 독 구름"],
      sceneStateSet: "active",
    }),
    action: "보스의 다음 패턴을 읽으려 한다.",
    runs: 1,
  },
  {
    id: "P7",
    label: "objective wording refinement same scene",
    progress: applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
      objectiveSet: "건물 탈출",
      openRoutesAdd: ["환풍구"],
      resolvedObstaclesAdd: ["균사벽 제거"],
    }),
    action: "환풍구 주변을 더 자세히 살핀다.",
    runs: 3,
  },
  {
    id: "P8",
    label: "genuine scene transition",
    progress: applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
      objectiveSet: "건물 탈출",
      openRoutesAdd: ["환풍구"],
      resolvedObstaclesAdd: ["균사벽 제거"],
    }),
    action: "환풍구를 타고 유지보수 터널로 진입한다.",
    runs: 3,
  },
];

const PC_AGENCY_PATTERNS = [
  /(?:민수|PC).*(?:이미|저절로|강제로).*(?:나갔|탈출했|도망)/,
  /몸이.*끌려/,
];

function playerAgencyViolation(narration: string, probe: ProbeCase): boolean {
  if (probe.id === "P8") return false;
  if (probe.action.includes("나가지 않") || probe.action.includes("몸을 숨긴")) return false;
  return PC_AGENCY_PATTERNS.some((re) => re.test(narration));
}

function scoreCase(text: string, probe: ProbeCase, runIndex: number) {
  const parsed = parseTrpgGmOutput(text);
  const narration = parsed.narration;
  const delta = parsed.delta.localScene ?? null;
  const persisted = applyLocalSceneProgressDelta(probe.progress, delta ?? undefined);

  const intentionalTransition = delta?.sceneTransitionTo != null;

  const openRouteStateLost =
    !intentionalTransition &&
    probe.progress.openRoutes.some(
      (route) => !persisted.openRoutes.includes(route) && !delta?.openRoutesRemove?.includes(route)
    );
  const openRouteNotMentioned = probe.progress.openRoutes.some(
    (route) => !narration.includes(route) && !JSON.stringify(parsed.delta).includes(route)
  );

  const resolvedFunctionallyRecreated =
    probe.id === "P2" &&
    probe.progress.resolvedObstacles.some(
      (obs) =>
        /(?:다시|재|새.*(?:벽|막)|봉쇄|막힌)/.test(narration) &&
        narration.includes(obs.slice(0, Math.min(6, obs.length))) &&
        !delta?.resolvedObstaclesRemove?.includes(obs)
    );
  const resolvedHistoricalReference =
    probe.id === "P2" &&
    probe.progress.resolvedObstacles.some((obs) => /(?:남|뒤|지나|이미|제거|열린)/.test(narration));

  const playerAgencyViolationHit = playerAgencyViolation(narration, probe);

  const p7SceneTransitionFalsePositive =
    probe.id === "P7" && delta?.sceneTransitionTo != null && delta.objectiveSet == null;
  const p7ProgressLost =
    probe.id === "P7" &&
    (persisted.openRoutes.length < probe.progress.openRoutes.length ||
      persisted.resolvedObstacles.length < probe.progress.resolvedObstacles.length);

  const p8UsedSceneTransitionTo = probe.id === "P8" && delta?.sceneTransitionTo != null;
  const p8UsedObjectiveSetOnly =
    probe.id === "P8" &&
    delta?.objectiveSet != null &&
    delta.sceneTransitionTo == null;

  const prematureAdvance =
    probe.progress.sceneState === "active" &&
    probe.id === "P6" &&
    delta?.sceneStateSet === "transition_ready";

  return {
    runIndex,
    openRouteStateLost,
    openRouteNotMentioned,
    resolvedFunctionallyRecreated,
    resolvedHistoricalReference,
    playerAgencyViolation: playerAgencyViolationHit,
    p7SceneTransitionFalsePositive,
    p7ProgressLost,
    p8UsedSceneTransitionTo,
    p8UsedObjectiveSetOnly,
    prematureAdvance,
    deltaLocalScene: delta,
    persistedAfterDelta: persisted,
    narrationExcerpt: narration.slice(0, 320),
  };
}

async function main() {
  if (!process.env.CHEAPER_INFERENCE_API_KEY?.trim()) {
    console.error("CHEAPER_INFERENCE_API_KEY not configured — skipping real provider probe");
    process.exit(0);
  }

  const results: Record<string, unknown> = {
    model: process.env.TRPG_GM_MODEL ?? "default",
    promptChars: TRPG_GM_SYSTEM.length,
    runs: [] as unknown[],
    summary: {},
  };

  for (const probe of cases) {
    for (let run = 0; run < probe.runs; run += 1) {
      const user = buildTrpgGmUserBlock({
        worldBrief: "균사가 번진 편의점. 생존 호러.",
        memoryBlock: "[MEMORY]\n최근: 정면 균사벽을 일부 제거했다.",
        opening: false,
        actions: [
          {
            participantId: 1,
            name: "민수",
            body: probe.action,
            statKey: "per",
            d20: 14,
            finalScore: 16,
            dc: 12,
            tier: "SUCCESS",
          },
        ],
        localSceneBlock: serializeLocalSceneStateForGm(probe.progress),
        localSceneDeltaContract: serializeLocalSceneDeltaContract(),
      });
      const result = await callTrpgGm({
        system: TRPG_GM_SYSTEM,
        user,
        timeoutMs: 90_000,
      });
      const scored = scoreCase(result.text, probe, run);
      (results.runs as unknown[]).push({
        id: probe.id,
        label: probe.label,
        run,
        scored,
        rawLength: result.text.length,
      });
    }
  }

  const runsArr = results.runs as Array<{ id: string; scored: ReturnType<typeof scoreCase> }>;
  const p7Runs = runsArr.filter((r) => r.id === "P7");
  const p8Runs = runsArr.filter((r) => r.id === "P8");

  results.summary = {
    REAL_PROVIDER_CALLS: runsArr.length,
    OPEN_ROUTE_STATE_LOST: runsArr.filter((r) => r.scored.openRouteStateLost).length,
    OPEN_ROUTE_NOT_MENTIONED: runsArr.filter((r) => r.scored.openRouteNotMentioned).length,
    RESOLVED_OBSTACLE_FUNCTIONALLY_RECREATED: runsArr.filter((r) => r.scored.resolvedFunctionallyRecreated).length,
    RESOLVED_OBSTACLE_HISTORICAL_REFERENCE: runsArr.filter((r) => r.scored.resolvedHistoricalReference).length,
    PLAYER_AGENCY_VIOLATION: runsArr.filter((r) => r.scored.playerAgencyViolation).length,
    PREMATURE_TRANSITION: runsArr.filter((r) => r.scored.prematureAdvance).length,
    P7_SCENE_TRANSITION_FALSE_POSITIVE: p7Runs.filter((r) => r.scored.p7SceneTransitionFalsePositive).length,
    P7_PROGRESS_LOST: p7Runs.filter((r) => r.scored.p7ProgressLost).length,
    P8_GENUINE_TRANSITION_RECOGNIZED: p8Runs.filter((r) => r.scored.p8UsedSceneTransitionTo).length,
    P8_USED_sceneTransitionTo: p8Runs.filter((r) => r.scored.p8UsedSceneTransitionTo).length,
    P8_USED_objectiveSet_ONLY: p8Runs.filter((r) => r.scored.p8UsedObjectiveSetOnly).length,
  };

  const out = "/opt/cursor/artifacts/trpg-local-scene-progress-probe.json";
  writeFileSync(out, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results.summary, null, 2));
  console.log(`Wrote ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
