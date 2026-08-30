/**
 * Harness-only: test C2/C3 on regression-failure fixtures.
 * Run: node --conditions=react-server --import tsx scripts/trpg-sandbox-blueprint-transport-candidate-probe.ts C2
 */
import {
  buildSandboxDirectorSystemPrompt,
  buildSandboxDirectorUserPrompt,
} from "../src/lib/trpg/scenarioDraft";
import { buildTrpgScenarioDraftRequestBody } from "../src/lib/trpg/scenarioDraftCall";
import {
  buildCheaperInferenceHeaders,
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  resolveCheaperInferenceApiKey,
} from "../src/lib/cheaperInferenceConfig";
import {
  adaptOpenRouterDeepSeekBackupBody,
  executeDeepSeekBackgroundWithProviderFailover,
  resolveDeepSeekBackupModelId,
} from "../src/lib/deepseekProviderFailover";

const FIXTURES = [
  {
    id: "W02_open_exploration",
    worldName: "끝없는 회색 대륙",
    worldSummary: "지도 끝이 없는 미지의 대륙. 정착지 없이 떠도는 탐험대.",
    worldContent:
      "기후대마다 다른 생태계와 유적이 존재한다. 나침반은 간헐적으로 왜곡되고, 고대 관측탑은 하늘의 이상 현상을 기록한다. 특정 메인 퀘스트 없이 발견·생존·귀환 여부가 플레이를 이끈다.",
    repeats: 2,
  },
  {
    id: "W01_apocalypse_survival",
    worldName: "잿빛 수도권",
    worldSummary: "대규모 붕괴 이후 방사능과 갱단이 뒤엉킨 수도권 폐허.",
    worldContent:
      "식량·약품·연료가 귀하다. 생존자 거점은 지하철역과 옥상 정원으로 분산되어 있다. 갱단은 연료 저장고를 장악했고, 방사능 구역은 날마다 확대된다. TRPG는 생존·탐색·거래·위협 회피 중심.",
    repeats: 1,
  },
];

const CANDIDATES: Record<string, { primaryMs: number; backupMs: number }> = {
  C1: { primaryMs: 60_000, backupMs: 45_000 },
  C2: { primaryMs: 75_000, backupMs: 45_000 },
  C3: { primaryMs: 60_000, backupMs: 60_000 },
  C4: { primaryMs: 75_000, backupMs: 60_000 },
};

async function runFixture(
  fixture: (typeof FIXTURES)[number],
  candidate: { primaryMs: number; backupMs: number },
  runIndex: number
) {
  const system = buildSandboxDirectorSystemPrompt();
  const user = buildSandboxDirectorUserPrompt({
    worldName: fixture.worldName,
    worldSummary: fixture.worldSummary,
    worldContent: fixture.worldContent,
  });
  const body = buildTrpgScenarioDraftRequestBody({ system, user });
  const started = Date.now();
  let providerAttempts = 1;
  let primaryFailure: string | null = null;
  let success = false;

  try {
    const failover = await executeDeepSeekBackgroundWithProviderFailover({
      primary: {
        endpoint: CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
        headers: buildCheaperInferenceHeaders(resolveCheaperInferenceApiKey()),
        body,
      },
      backupBody: adaptOpenRouterDeepSeekBackupBody(body, resolveDeepSeekBackupModelId("flash")),
      timeoutMs: 120_000,
      requestKind: "trpg-sandbox-blueprint-candidate-probe",
      deadlines: {
        completionMs: candidate.primaryMs,
        backupCompletionMs: candidate.backupMs,
      },
      hooks: {
        onTelemetry: (t) => {
          providerAttempts = t.provider_attempt_count;
          primaryFailure = t.primary_failure_class;
        },
      },
    });
    const data = (await failover.response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    success = Boolean(data.choices?.[0]?.message?.content?.trim());
  } catch {
    success = false;
  }

  return {
    worldId: fixture.id,
    runIndex,
    success,
    providerAttempts,
    primaryFailure,
    totalMs: Date.now() - started,
    doubleTimeout: primaryFailure === "body_timeout" && !success && providerAttempts >= 2,
  };
}

async function main() {
  const label = process.argv[2]?.toUpperCase() ?? "C1";
  const candidate = CANDIDATES[label];
  if (!candidate) {
    console.error(`Unknown candidate ${label}`);
    process.exit(1);
  }
  const results = [];
  for (const fixture of FIXTURES) {
    for (let i = 0; i < fixture.repeats; i++) {
      console.info(`[candidate-probe] ${label} ${fixture.id} run ${i}`);
      results.push(await runFixture(fixture, candidate, i));
    }
  }
  const latencies = results.filter((r) => r.success).map((r) => r.totalMs).sort((a, b) => a - b);
  console.log(
    JSON.stringify(
      {
        candidate: label,
        ...candidate,
        success: results.filter((r) => r.success).length,
        doubleTimeout: results.filter((r) => r.doubleTimeout).length,
        p95Ms: latencies[Math.ceil(latencies.length * 0.95) - 1] ?? 0,
        maxMs: latencies[latencies.length - 1] ?? 0,
        runs: results,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
