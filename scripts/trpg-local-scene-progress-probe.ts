/**
 * Real-provider probe for local scene progress (4–6 frozen states).
 * Run: node --conditions=react-server --import tsx scripts/trpg-local-scene-progress-probe.ts
 */
import { writeFileSync } from "node:fs";
import { buildTrpgGmUserBlock, parseTrpgGmOutput, TRPG_GM_SYSTEM } from "../src/lib/trpg/gmPrompt";
import { callTrpgGm } from "../src/lib/trpg/gmCall";
import {
  applyLocalSceneProgressDelta,
  emptyLocalSceneProgress,
  serializeLocalSceneDeltaContract,
  serializeLocalSceneStateForGm,
} from "../src/lib/trpg/localSceneProgress";

type ProbeCase = {
  id: string;
  label: string;
  progress: ReturnType<typeof applyLocalSceneProgressDelta>;
  action: string;
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
  },
];

function scoreCase(text: string, probe: ProbeCase) {
  const parsed = parseTrpgGmOutput(text);
  const narration = parsed.narration;
  const openRouteForgotten =
    probe.progress.openRoutes.some((route) => !narration.includes(route) && !JSON.stringify(parsed.delta).includes(route));
  const resolvedRecreated =
    probe.progress.resolvedObstacles.some(
      (obs) =>
        /다시|재|막힌|새.*벽|봉쇄/.test(narration) &&
        narration.includes(obs.slice(0, Math.min(4, obs.length)))
    ) && probe.id === "P2";
  const playerForced =
    /이미.*나갔|강제로.*이동|저절로.*탈출|몸이.*끌려/.test(narration) && probe.id === "P5";
  const prematureAdvance =
    probe.progress.sceneState === "active" &&
    probe.id === "P6" &&
    parsed.delta.localScene?.sceneStateSet === "transition_ready";
  return {
    openRouteForgotten,
    resolvedRecreated,
    playerForced,
    prematureAdvance,
    deltaLocalScene: parsed.delta.localScene ?? null,
    narrationExcerpt: narration.slice(0, 280),
  };
}

async function main() {
  const results: Record<string, unknown> = {
    model: process.env.TRPG_GM_MODEL ?? "default",
    cases: [] as unknown[],
    summary: {},
  };
  for (const probe of cases) {
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
    });
    const scored = scoreCase(result.text, probe);
    (results.cases as unknown[]).push({ id: probe.id, label: probe.label, scored, rawLength: result.text.length });
  }
  const casesArr = results.cases as Array<{ scored: ReturnType<typeof scoreCase> }>;
  results.summary = {
    OPEN_ROUTE_FORGOTTEN: casesArr.filter((c) => c.scored.openRouteForgotten).length,
    RESOLVED_OBSTACLE_RECREATED: casesArr.filter((c) => c.scored.resolvedRecreated).length,
    PLAYER_AGENCY_VIOLATION: casesArr.filter((c) => c.scored.playerForced).length,
    PREMATURE_TRANSITION: casesArr.filter((c) => c.scored.prematureAdvance).length,
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
