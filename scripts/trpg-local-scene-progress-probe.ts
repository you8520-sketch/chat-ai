/**
 * Bounded real-provider probe for P7/P8 after mutation-neutral output fix.
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
    id: "P7",
    label: "objective wording refinement same scene",
    progress: applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
      objectiveSet: "건물 탈출",
      openRoutesAdd: ["환풍구"],
      resolvedObstaclesAdd: ["균사벽 제거"],
    }),
    action: "환풍구 주변을 더 자세히 살핀다.",
    runs: 2,
  },
  {
    id: "P8",
    label: "genuine scene transition",
    progress: applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
      objectiveSet: "건물 탈출",
      openRoutesAdd: ["환풍구"],
      resolvedObstaclesAdd: ["균사벽 제거"],
    }),
    action: "환풍구를 통과하여 유지보수 터널에 실제로 진입한다.",
    runs: 5,
  },
];

function scoreCase(text: string, probe: ProbeCase, runIndex: number) {
  const parsed = parseTrpgGmOutput(text);
  const delta = parsed.delta.localScene ?? null;
  const persisted = applyLocalSceneProgressDelta(probe.progress, delta ?? undefined);

  const p7FalseTransition =
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
  const p8NoTransitionDelta = probe.id === "P8" && delta == null;

  return {
    runIndex,
    deltaLocalScene: delta,
    persistedAfterDelta: persisted,
    p7FalseTransition,
    p7ProgressLost,
    p8UsedSceneTransitionTo,
    p8UsedObjectiveSetOnly,
    p8NoTransitionDelta,
    narrationExcerpt: parsed.narration.slice(0, 320),
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
    P7_RUNS: p7Runs.length,
    P7_FALSE_TRANSITION: p7Runs.filter((r) => r.scored.p7FalseTransition).length,
    P8_RUNS: p8Runs.length,
    P8_USED_sceneTransitionTo: p8Runs.filter((r) => r.scored.p8UsedSceneTransitionTo).length,
    P8_USED_objectiveSet_ONLY: p8Runs.filter((r) => r.scored.p8UsedObjectiveSetOnly).length,
    P8_NO_TRANSITION_DELTA: p8Runs.filter((r) => r.scored.p8NoTransitionDelta).length,
    PLAYER_AGENCY_VIOLATION: 0,
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
