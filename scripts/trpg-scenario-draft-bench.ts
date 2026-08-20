/**
 * Safe real-provider benchmark for Scenario AI Draft.
 *
 * Synthetic fixtures only. Logs lengths, token usage, latency, and status;
 * never logs world text, creator text, secrets, or hidden reasoning.
 *
 * Run:
 *   TRPG_SCENARIO_DRAFT_BENCH_RUNS=1 npx tsx scripts/trpg-scenario-draft-bench.ts
 */
import { loadEnvConfig } from "@next/env";
import {
  buildScenarioDraftSystemPrompt,
  buildScenarioDraftUserPrompt,
  makeDraftProvenance,
  mergeScenarioDraft,
  previewDraftOverwrite,
  scenarioDraftOutputMaxTokens,
  scenarioDraftPrimaryTimeoutMs,
  TRPG_SCENARIO_DRAFT_MODEL,
  TRPG_SCENARIO_DRAFT_REPAIR_OUTPUT_TOKENS,
  TRPG_SCENARIO_DRAFT_REPAIR_TIMEOUT_MS,
  type TrpgScenarioDraftExisting,
  type TrpgScenarioDraftField,
  type TrpgScenarioDraftMode,
} from "../src/lib/trpg/scenarioDraft";
import {
  callTrpgAuthoringModel,
  completeTrpgAuthoringJson,
  isTrpgAuthoringTimeoutError,
  type TrpgAuthoringCallResult,
} from "../src/lib/trpg/scenarioDraftCall";
import {
  emptyTrpgScenarioPlan,
  hasPlayableScenarioPlan,
  lintTrpgScenarioPlan,
} from "../src/lib/trpg/scenarioPlan";

loadEnvConfig(process.cwd());

type Fixture = {
  name: string;
  worldName: string;
  worldSummary: string;
  worldContent: string;
  worldSelected: boolean;
  mode: TrpgScenarioDraftMode;
  selectedFields?: TrpgScenarioDraftField[];
  existing: TrpgScenarioDraftExisting;
};

const playablePlan = {
  ...emptyTrpgScenarioPlan(),
  startingSituation: "격리 구역에서 마지막 구조 신호가 반복된다.",
  centralConflict: "생존자 구조와 오염 확산 차단이 충돌한다.",
  goal: "신호의 근원을 확인하고 생존자의 탈출로를 확보한다.",
  endingConditions: ["생존자가 대피하거나 구역 봉쇄가 결정된다."],
  difficulty: "normal" as const,
};

const fixtures: Fixture[] = [
  {
    name: "A_no_world_blank",
    worldName: "",
    worldSummary: "",
    worldContent: "",
    worldSelected: false,
    mode: "fill_empty",
    existing: {},
  },
  {
    name: "B_small_world_blank",
    worldName: "회색 항구",
    worldSummary: "폭풍 이후 교역이 끊긴 해안 도시.",
    worldContent: "항구 조합과 등대 수호대가 제한된 식량과 항로를 두고 대립한다.",
    worldSelected: true,
    mode: "fill_empty",
    existing: {},
  },
  {
    name: "C_large_world_blank",
    worldName: "재난 도시",
    worldSummary: "대정전 이후 여러 생존자 세력이 구역별로 고립된 현대 도시.",
    worldContent: "붕괴한 도시 구역, 생존자 세력, 폐쇄된 의료 시설의 기록. ".repeat(320),
    worldSelected: true,
    mode: "fill_empty",
    existing: {},
  },
  {
    name: "D_existing_content_secret",
    worldName: "",
    worldSummary: "",
    worldContent: "",
    worldSelected: false,
    mode: "fill_empty",
    existing: {
      title: "격리 구역의 마지막 신호",
      summary: "폐쇄된 연구 구역의 신호를 조사한다.",
      content: "구역의 식량 창고와 의료실 위치, 생존자 갈등에 관한 창작자 설정. ".repeat(35),
      secretContent: "신호는 구조 요청이 아니라 오염 확산을 유도하는 자동 방송이다. ".repeat(20),
    },
  },
  {
    name: "E_regenerate_boss",
    worldName: "",
    worldSummary: "",
    worldContent: "",
    worldSelected: false,
    mode: "regenerate_selected",
    selectedFields: ["boss"],
    existing: { title: "격리 구역", plan: playablePlan },
  },
  {
    name: "F_regenerate_npc_events",
    worldName: "회색 항구",
    worldSummary: "폭풍 이후 교역이 끊긴 해안 도시.",
    worldContent: "항구 조합과 등대 수호대가 제한된 식량과 항로를 두고 대립한다.",
    worldSelected: true,
    mode: "regenerate_selected",
    selectedFields: ["npcs", "majorEvents"],
    existing: { title: "등대의 마지막 불빛", plan: playablePlan },
  },
];

function positiveRuns(raw: string | undefined): number {
  const parsed = Number(raw ?? 1);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 3) : 1;
}

async function runFixture(fixture: Fixture, run: number) {
  const system = buildScenarioDraftSystemPrompt();
  const changingFields = previewDraftOverwrite({
    mode: fixture.mode,
    existing: fixture.existing,
    selectedFields: fixture.selectedFields,
  });
  const user = buildScenarioDraftUserPrompt({
    worldName: fixture.worldName,
    worldSummary: fixture.worldSummary,
    worldContent: fixture.worldContent,
    worldSelected: fixture.worldSelected,
    mode: fixture.mode,
    existing: fixture.existing,
    selectedFields: fixture.selectedFields,
  });
  const primaryMaxTokens = scenarioDraftOutputMaxTokens({
    mode: fixture.mode,
    changingFields,
  });
  const primaryTimeoutMs = scenarioDraftPrimaryTimeoutMs(primaryMaxTokens);
  const attempts: Array<{
    stage: "primary" | "repair";
    maxTokens: number;
    timeoutMs: number;
    latencyMs: number;
    result?: TrpgAuthoringCallResult;
    errorClass?: string;
  }> = [];
  let mergedReadiness = false;
  let parseOk = false;
  let errorClass = "";
  const started = Date.now();
  try {
    const generated = await completeTrpgAuthoringJson({
      kind: "scenario_draft",
      system,
      user,
      expectedFields: changingFields,
      primaryMaxTokens,
      primaryTimeoutMs,
      repairMaxTokens: Math.min(primaryMaxTokens, TRPG_SCENARIO_DRAFT_REPAIR_OUTPUT_TOKENS),
      repairTimeoutMs: TRPG_SCENARIO_DRAFT_REPAIR_TIMEOUT_MS,
      complete: async ({ system: callSystem, user: callUser, stage = "primary", maxTokens, timeoutMs }) => {
        const callStarted = Date.now();
        try {
          const result = await callTrpgAuthoringModel({
            system: callSystem,
            user: callUser,
            maxTokens,
            timeoutMs,
          });
          attempts.push({
            stage,
            maxTokens: maxTokens ?? 4096,
            timeoutMs: timeoutMs ?? 90_000,
            latencyMs: Date.now() - callStarted,
            result,
          });
          return result;
        } catch (error) {
          attempts.push({
            stage,
            maxTokens: maxTokens ?? 4096,
            timeoutMs: timeoutMs ?? 90_000,
            latencyMs: Date.now() - callStarted,
            errorClass: error instanceof Error ? error.name : "Error",
          });
          throw error;
        }
      },
    });
    parseOk = true;
    const merged = mergeScenarioDraft({
      mode: fixture.mode,
      existing: fixture.existing,
      generated,
      selectedFields: fixture.selectedFields,
      provenance: makeDraftProvenance({ worldId: fixture.worldSelected ? 1 : null }),
    });
    const lint = lintTrpgScenarioPlan({
      plan: merged.plan,
      title: merged.title,
      summary: merged.summary,
      npcs: merged.npcs,
      startInventory: merged.startInventory,
    });
    mergedReadiness =
      hasPlayableScenarioPlan(merged.plan) &&
      lint.every((issue) => issue.level !== "error");
  } catch (error) {
    errorClass = isTrpgAuthoringTimeoutError(error)
      ? "TimeoutError"
      : error instanceof Error
        ? error.name
        : "Error";
  }
  const primary = attempts.find((attempt) => attempt.stage === "primary");
  const repair = attempts.find((attempt) => attempt.stage === "repair");
  console.log(
    JSON.stringify({
      FIXTURE: fixture.name,
      RUN: run,
      SCENARIO_DRAFT_MODEL: TRPG_SCENARIO_DRAFT_MODEL,
      WORLD_SELECTED: fixture.worldSelected,
      WORLD_SUMMARY_CHARS: fixture.worldSummary.length,
      WORLD_CONTENT_CHARS: fixture.worldContent.length,
      EXISTING_TITLE_CHARS: fixture.existing.title?.length ?? 0,
      EXISTING_SUMMARY_CHARS: fixture.existing.summary?.length ?? 0,
      EXISTING_CONTENT_CHARS: fixture.existing.content?.length ?? 0,
      EXISTING_SECRET_CONTENT_CHARS: fixture.existing.secretContent?.length ?? 0,
      PROMPT_CHARS: system.length + user.length,
      PROVIDER_CALLS: attempts.length,
      INPUT_CHARS: user.length,
      INPUT_TOKENS: attempts.reduce((sum, attempt) => sum + (attempt.result?.usage?.inputTokens ?? 0), 0),
      OUTPUT_TOKENS: attempts.reduce((sum, attempt) => sum + (attempt.result?.usage?.outputTokens ?? 0), 0),
      MAX_TOKENS: primary?.maxTokens ?? primaryMaxTokens,
      LATENCY_MS: Date.now() - started,
      TIMEOUT_MS: primary?.timeoutMs ?? primaryTimeoutMs,
      FINISH_REASON: primary?.result?.finishReason ?? "",
      PARSE_OK: parseOk,
      REPAIR_USED: Boolean(repair),
      REPAIR_TIMEOUT_MS: repair?.timeoutMs ?? 0,
      READINESS_OK: mergedReadiness,
      ERROR_CLASS: errorClass || primary?.errorClass || "",
    })
  );
}

async function main() {
  const runs = positiveRuns(process.env.TRPG_SCENARIO_DRAFT_BENCH_RUNS);
  const filter = new Set(
    String(process.env.TRPG_SCENARIO_DRAFT_BENCH_FIXTURES ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
  );
  for (const fixture of fixtures.filter((item) => filter.size === 0 || filter.has(item.name))) {
    for (let run = 1; run <= runs; run += 1) {
      await runFixture(fixture, run);
    }
  }
}

void main().catch((error) => {
  console.error(
    JSON.stringify({
      ERROR_CLASS: error instanceof Error ? error.name : "Error",
      ERROR: error instanceof Error ? error.message.slice(0, 160) : "benchmark failed",
    })
  );
  process.exitCode = 1;
});
