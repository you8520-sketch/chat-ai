/**
 * PR-2 translation A/B harness core — failure-resilient benchmark loop.
 * Used by scripts/bench-pr2-translation-ab.ts and zero-call resilience tests.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { CharacterChunk } from "@/types";
import type { TokenUsage } from "@/lib/ai";

export const DEFAULT_OUT_DIR = path.join(process.cwd(), "docs/audits/pr2-translation-ab");
export const REQUEST_BUDGET_MAX = 40;
export const PRODUCTION_OUTCOME_ENGLISH = "ENGLISH_PUBLISHED" as const;
export const PRODUCTION_OUTCOME_KOREAN_FALLBACK = "KOREAN_FALLBACK" as const;

export type ProductionOutcome =
  | typeof PRODUCTION_OUTCOME_ENGLISH
  | typeof PRODUCTION_OUTCOME_KOREAN_FALLBACK;

export type FixtureInvariants = {
  exactTokens?: string[];
  properNouns?: string[];
  placeholders?: string[];
  requiredHeadings?: string[];
  requiredBracketLabels?: string[];
};

export type Fixture = {
  id: string;
  category: string;
  chunks: CharacterChunk[];
  invariants?: FixtureInvariants;
};

export type TranslationPlanAudit = {
  f12SourceChars: number;
  f12ProductionChunkCount: number;
  f12BatchCountPerModel: number;
  maxBatchSourceChars: number;
  oversizedBatchCount: number;
  oversizedBatches: Array<{
    fixtureId: string;
    batchIndex: number;
    sourceChars: number;
    chunks: Array<{ id: string; category: string; chars: number }>;
  }>;
  plannedProviderRequestCount: number;
  requestBudgetLe40: boolean;
};

export type TranslationAbCallFn = (
  system: string,
  history: Array<{ role: "user" | "assistant" | "system"; content: string }>,
  modelId: string
) => Promise<{ text: string; usage: TokenUsage }>;

export type RequestUsageSnapshot = {
  responseModelId?: string | null;
  upstreamCostUsd?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  reasoningOutputTokens?: number | null;
  finishReason?: string | null;
  estimated?: boolean;
};

export type AbRequestRecord = {
  globalRequestIndex: number;
  fixtureId: string;
  label: "A" | "B";
  model: string;
  batchIndex: number;
  requestedModel: string;
  status: "success" | "failure";
  text: string | null;
  usage: RequestUsageSnapshot | null;
  error: null | {
    errorClass: string;
    errorMessageSanitized: string;
    httpStatus: number | null;
    finishReason: string | null;
  };
  latencyMs: number;
};

export type RunState = {
  runId: string;
  startedAt: string;
  harnessHead: string;
  plannedProviderRequestCount: number;
  attemptedProviderRequestCount: number;
  successfulProviderRequestCount: number;
  failedProviderRequestCount: number;
  nextFixture: string | null;
  nextLabel: "A" | "B" | null;
  nextBatch: number | null;
  completed: boolean;
};

export type FixtureModelResult = {
  fixtureId: string;
  category: string;
  label: "A" | "B";
  model: string;
  productionTranslationSuccess: boolean;
  productionOutcome: ProductionOutcome;
  logicalChunkCount: number;
  batchCount: number;
  successfulBatchCount: number;
  failedBatchCount: number;
  segmentComplete: boolean;
  placeholdersOk: boolean;
  invariantResults: Record<string, unknown>;
  rawSuccessfulBatchOutputs: string[];
  productionPublishedOutput: string | null;
  requests: AbRequestRecord[];
  aggregate: {
    requestCount: number;
    successfulRequestCount: number;
    failedRequestCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalReasoningTokens: number;
    totalProviderReportedCostUsd: number | null;
    totalLatencyMs: number;
  };
};

type PlannedRequest = {
  globalIndex: number;
  fixtureIndex: number;
  fixtureId: string;
  label: "A" | "B";
  model: string;
  batchIndex: number;
};

type PromptTranslationModule = typeof import("@/lib/promptTranslation");

function buildF12LongMixedSource(): string {
  const characters = [
    "은우(24, 대학생, 왕실 기록관련)",
    "강이현(29, 검은 장미단 부단장)",
    "권태현(31, 왕실 수호대장)",
    "리나 볼트(27, 암살 길드 마스터)",
    "카일 드렉스(35, 북부 연합 사령관)",
    "솔레아(22, 달의 신전 수녀)",
    "마르텐(40, 실버헤이븐 대장장이)",
    "헤라(19, 오아시스 상인)",
    "드레이븐(33, 시간 금기술 연구자)",
    "유리(26, 왕실 정보관)",
    "노아(28, 해상 민병대장)",
    "세라(30, 엘라리아 외교관)",
  ];
  const factions = [
    "왕실 수호대",
    "검은 장미단",
    "암살 길드",
    "북부 연합",
    "달의 신전",
    "실버헤이븐 상회",
  ];
  const locations = [
    "실버헤이븐 수도",
    "얼음 협곡",
    "사막 오아시스 솔렌",
    "왕궁 지하 수련장",
    "마법 학원 아르카디움",
    "폐허 도시 노바",
    "항구 도시 마레",
    "동쪽 숲 글림",
  ];
  const sections: string[] = [
    "# 배경",
    "【세계관】 엘라리아 왕국은 1247년에 건국되었고 수도는 실버헤이븐이다.",
    "{{user}}와 {{char}}는 왕궁 지하 수련장에서 첫 대결을 벌인다.",
    "[상태] HP: 100 / MP: 80 / 【버프】가속",
    "사건 날짜: 2026-08-28. 거리: 3km. 확률: 42%. 온도: -12°C.",
    "# 인물",
    ...characters.map((c, i) => `${i + 1}. ${c}`),
    "# 조직/세력",
    ...factions.map((f) => `- ${f}: 목표와 규율이 상이하며, 비밀 협정 금지.`),
    "# 지리",
    ...locations.map((loc) => `- ${loc}: 고유 자원과 통행 규칙 보유.`),
    "# 관계",
    "은우↔강이현: 어릴 적 경쟁 관계. 권태현↔리나: 적대적 추적-회피.",
    "카일↔솔레아: 신전과 연합 사이 중재 필요. {{user}}는 모든 NPC 선택을 존중해야 한다.",
    "# 외형/복장",
    "은우: 은색 단발, 검은 외투. 강이현: 붉은 머리, 장미 문양 망토.",
    "# 연표",
    "1198: 북부 연합 결성. 1220: 암살 길드 공개. 1247: 엘라리아 건국.",
    "1263: 검은 장미단 반란. 1288: 시간 금기술 봉인.",
    "# 전투/게임 규칙",
    "규칙: HP 0 시 전투 불능. MP는 하루 1회 전량 회복.",
    "선공 판정: d20. 크리티컬: 20. 회복 아이템: 전투 중 1회.",
    "금지: OOC 메타 발언, {{user}} 행동 대리, 세계관 붕괴.",
    "# 인벤토리/아이템",
    "은우 소지: 실버키(왕실 기록실), 연금술 키트, 북부 지도.",
    "강이현 소지: 장미단 표식, 독침 3개, 암호 노트.",
    "# 조건부 규칙",
    "IF HP<30 THEN 대화 톤 긴급. IF 밤 THEN 시야 -2.",
    "IF {{char}} 신뢰도>=70 THEN 비밀 고백 가능.",
    "# 대화/슬랭",
    "야 뭐해? ㅋㅋ 말 좀 가려. 진지할 땐 존댓말 금지.",
    '{"trait":"cold","mood":"angry","likes":["tea","rain"]}',
    "캐릭터: 은우. 목표: 실버헤이븐 왕실 기록실 침입.",
    "추가 규칙: NPC는 {{user}} 선택 존중.",
  ];

  let text = sections.join("\n\n");
  let padIndex = 0;
  while (text.length < 8000 && padIndex < 16) {
    const blockLines = [`# 부록 기록 ${padIndex}`];
    for (let j = 0; j < 7; j += 1) {
      const loc = locations[(padIndex + j) % locations.length];
      const fac = factions[(padIndex + j) % factions.length];
      const who = characters[(padIndex + j) % characters.length];
      blockLines.push(
        `- ${loc} / ${fac}: ${1247 + padIndex + j}년 협상 메모. ${who} 관련 인물·조직·장소 교차 기록.`
      );
    }
    text += `\n\n${blockLines.join("\n")}`;
    padIndex += 1;
  }
  if (text.length > 10000) {
    text = text.slice(0, 10000);
  }
  return text;
}

export const F12_SOURCE = buildF12LongMixedSource();

function chunk(
  id: string,
  content: string,
  category: CharacterChunk["category"]
): CharacterChunk {
  return {
    id,
    characterId: "bench",
    content,
    category,
    importance: "CRITICAL",
    tokenCount: Math.max(1, content.length),
    keywords: [],
  };
}

function buildManualFixtures(): Fixture[] {
  return [
    {
      id: "F01",
      category: "general_character",
      chunks: [
        chunk("f01-1", "이름: 은우. 나이: 24. 직업: 대학생.", "identity"),
        chunk("f01-2", "성격: 겉으로는 차갑지만 가까운 사람에게는 다정함.", "personality"),
      ],
    },
    {
      id: "F02",
      category: "dense_personality",
      chunks: [
        chunk("f02-1", "성격: 자존심이 강하고 승부욕이 큼.", "personality"),
        chunk("f02-2", "관계: {{user}}는 어릴 적 소꿉친구.", "relationship"),
        chunk("f02-3", "트라우마: 왼손 화상 흉터.", "background"),
      ],
      invariants: { placeholders: ["{{user}}", "{{char}}"] },
    },
    {
      id: "F03",
      category: "world_lore",
      chunks: [chunk("f03-1", "【세계관】 마법 왕국 엘라리아. 달의 신전이 중심지.", "world")],
      invariants: { requiredBracketLabels: ["【세계관】"] },
    },
    {
      id: "F04",
      category: "strict_rules",
      chunks: [
        chunk("f04-1", "규칙: HP가 0이면 전투 불능.", "rules"),
        chunk("f04-2", "금지: OOC 메타 발언, {{user}} 행동 대리.", "rules"),
      ],
      invariants: { placeholders: ["{{user}}"] },
    },
    {
      id: "F05",
      category: "korean_proper_nouns",
      chunks: [
        chunk("f05-1", "인물: 강이현, 권태현, 지명: 하늘 도시, 조직: 검은 장미단.", "identity"),
      ],
      invariants: { properNouns: ["강이현", "권태현", "하늘 도시", "검은 장미단"] },
    },
    {
      id: "F06",
      category: "placeholders",
      chunks: [
        chunk("f06-1", "{{user}}가 {{char}}에게 말했다. {{user}} {{char}}", "identity"),
      ],
      invariants: { placeholders: ["{{user}}", "{{char}}"] },
    },
    {
      id: "F07",
      category: "markdown",
      chunks: [chunk("f07-1", "# 배경\n- 항목1: 폐허 도시\n- 항목2: 마법 학원", "background")],
      invariants: { requiredHeadings: ["# 배경"] },
    },
    {
      id: "F08",
      category: "brackets_status",
      chunks: [chunk("f08-1", "[상태] HP: 100 / MP: 50 （특수） 【버프】가속", "rules")],
      invariants: { requiredBracketLabels: ["[상태]", "【버프】"] },
    },
    {
      id: "F09",
      category: "json_wpp_like",
      chunks: [
        chunk("f09-1", '{"trait":"cold","mood":"angry","likes":["tea","rain"]}', "personality"),
      ],
    },
    {
      id: "F10",
      category: "numbers_dates_units",
      chunks: [
        chunk("f10-1", "사건 날짜: 2026-08-28. 거리: 3km. 확률: 42%. 온도: -12°C.", "background"),
      ],
      invariants: {
        exactTokens: ["2026-08-28", "3km", "42%", "-12°C"],
      },
    },
    {
      id: "F11",
      category: "slang_crude",
      chunks: [chunk("f11-1", "야 뭐해? ㅋㅋ 진짜 미친듯이 웃김. 말 좀 가려 씨.", "speech_style")],
    },
  ];
}

export async function buildFixtures(): Promise<Fixture[]> {
  const { parseCharacterSetting } = await import("@/utils/characterParser");
  const f12ProductionChunks = parseCharacterSetting({
    characterId: "f12",
    systemPrompt: F12_SOURCE,
    world: "",
    exampleDialog: "",
    characterName: "은우",
    gender: "other",
  });

  const manual = buildManualFixtures();
  const f12: Fixture = {
    id: "F12",
    category: "long_mixed_8k",
    chunks: f12ProductionChunks,
    invariants: {
      placeholders: ["{{user}}", "{{char}}"],
      requiredHeadings: ["# 배경"],
      requiredBracketLabels: ["[상태]", "【버프】"],
      exactTokens: ["2026-08-28", "3km", "42%", "-12°C"],
      properNouns: ["강이현", "권태현", "검은 장미단", "실버헤이븐"],
    },
  };

  return [...manual, f12];
}

function batchSourceChars(batch: CharacterChunk[]): number {
  return batch.reduce((sum, c) => sum + c.content.length, 0);
}

export async function auditTranslationPlan(fixtures: Fixture[]): Promise<TranslationPlanAudit> {
  const promptTranslation = await import("@/lib/promptTranslation");
  const { splitTranslationBatches, isTranslatableChunk, TRANSLATION_BATCH_MAX_SOURCE_CHARS } =
    promptTranslation;

  let maxBatchSourceChars = 0;
  let oversizedBatchCount = 0;
  const oversizedBatches: TranslationPlanAudit["oversizedBatches"] = [];
  let totalBatchesAllFixtures = 0;

  let f12ProductionChunkCount = 0;
  let f12BatchCountPerModel = 0;

  for (const fixture of fixtures) {
    const translatable = fixture.chunks.filter(isTranslatableChunk);
    const batches = splitTranslationBatches(translatable);
    totalBatchesAllFixtures += batches.length;

    if (fixture.id === "F12") {
      f12ProductionChunkCount = translatable.length;
      f12BatchCountPerModel = batches.length;
    }

    batches.forEach((batch, batchIndex) => {
      const sourceChars = batchSourceChars(batch);
      maxBatchSourceChars = Math.max(maxBatchSourceChars, sourceChars);
      if (sourceChars > TRANSLATION_BATCH_MAX_SOURCE_CHARS) {
        oversizedBatchCount += 1;
        oversizedBatches.push({
          fixtureId: fixture.id,
          batchIndex,
          sourceChars,
          chunks: batch.map((c) => ({ id: c.id, category: c.category, chars: c.content.length })),
        });
      }
    });
  }

  const plannedProviderRequestCount = totalBatchesAllFixtures * 2;

  return {
    f12SourceChars: F12_SOURCE.length,
    f12ProductionChunkCount,
    f12BatchCountPerModel,
    maxBatchSourceChars,
    oversizedBatchCount,
    oversizedBatches,
    plannedProviderRequestCount,
    requestBudgetLe40: plannedProviderRequestCount <= REQUEST_BUDGET_MAX,
  };
}

export function validateF12SourceChars(): void {
  if (F12_SOURCE.length < 8000 || F12_SOURCE.length > 10000) {
    throw new Error(`F12 source length ${F12_SOURCE.length} outside required 8000-10000 range`);
  }
}

export function printAuditReport(
  audit: TranslationPlanAudit,
  promptTranslation: PromptTranslationModule
): void {
  console.log(`F12_SOURCE_CHARS=${audit.f12SourceChars}`);
  console.log(`F12_PRODUCTION_CHUNK_COUNT=${audit.f12ProductionChunkCount}`);
  console.log(`F12_BATCH_COUNT_PER_MODEL=${audit.f12BatchCountPerModel}`);
  console.log(
    `TRANSLATION_BATCH_MAX_SOURCE_CHARS=${promptTranslation.TRANSLATION_BATCH_MAX_SOURCE_CHARS}`
  );
  console.log(`MAX_BATCH_SOURCE_CHARS=${audit.maxBatchSourceChars}`);
  console.log(`OVERSIZED_BATCH_COUNT=${audit.oversizedBatchCount}`);
  console.log(`PLANNED_PROVIDER_REQUEST_COUNT=${audit.plannedProviderRequestCount}`);
  console.log(`REQUEST_BUDGET_LE_40=${audit.requestBudgetLe40}`);
}

function countOccurrences(text: string, token: string): number {
  let count = 0;
  let idx = 0;
  while (idx <= text.length) {
    const found = text.indexOf(token, idx);
    if (found < 0) break;
    count += 1;
    idx = found + token.length;
  }
  return count;
}

export function evaluateInvariants(source: string, output: string, invariants?: FixtureInvariants) {
  const results: Record<string, unknown> = {};
  if (!invariants) return results;

  if (invariants.exactTokens) {
    results.exactTokens = Object.fromEntries(
      invariants.exactTokens.map((token) => [
        token,
        {
          sourceCount: countOccurrences(source, token),
          outputCount: countOccurrences(output, token),
          preserved: countOccurrences(source, token) === countOccurrences(output, token),
        },
      ])
    );
  }
  if (invariants.properNouns) {
    results.properNouns = Object.fromEntries(
      invariants.properNouns.map((noun) => [noun, output.includes(noun)])
    );
  }
  if (invariants.placeholders) {
    results.placeholders = Object.fromEntries(
      invariants.placeholders.map((token) => [
        token,
        countOccurrences(source, token) === countOccurrences(output, token),
      ])
    );
  }
  if (invariants.requiredHeadings) {
    results.requiredHeadings = Object.fromEntries(
      invariants.requiredHeadings.map((heading) => [heading, output.includes(heading)])
    );
  }
  if (invariants.requiredBracketLabels) {
    results.requiredBracketLabels = Object.fromEntries(
      invariants.requiredBracketLabels.map((label) => [label, output.includes(label)])
    );
  }
  return results;
}

export function fixtureModelRuns(
  fixtureIndex: number,
  lunaModel: string,
  flashModel: string
): Array<{ label: "A" | "B"; model: string }> {
  return fixtureIndex % 2 === 0
    ? [
        { label: "A", model: lunaModel },
        { label: "B", model: flashModel },
      ]
    : [
        { label: "A", model: flashModel },
        { label: "B", model: lunaModel },
      ];
}

function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/sk-[a-zA-Z0-9_-]+/g, "sk-[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/CHEAPER_INFERENCE_API_KEY=\S+/gi, "CHEAPER_INFERENCE_API_KEY=[REDACTED]")
    .replace(/OPENROUTER_API_KEY=\S+/gi, "OPENROUTER_API_KEY=[REDACTED]");
}

function usageSnapshot(usage: TokenUsage | null | undefined): RequestUsageSnapshot | null {
  if (!usage) return null;
  return {
    responseModelId: usage.responseModelId ?? null,
    upstreamCostUsd: usage.upstreamCostUsd ?? null,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    reasoningOutputTokens: usage.reasoningOutputTokens ?? null,
    finishReason: usage.finishReason ?? null,
    estimated: usage.estimated,
  };
}

export function captureRequestError(error: unknown): {
  errorClass: string;
  errorMessageSanitized: string;
  httpStatus: number | null;
  finishReason: string | null;
  usage: RequestUsageSnapshot | null;
} {
  if (error && typeof error === "object") {
    const err = error as {
      name?: string;
      message?: string;
      httpStatus?: number | null;
      finishReason?: string | null;
      usage?: TokenUsage | null;
    };
    return {
      errorClass: err.name ?? "Error",
      errorMessageSanitized: sanitizeErrorMessage(String(err.message ?? error)),
      httpStatus: err.httpStatus ?? null,
      finishReason: err.finishReason ?? null,
      usage: usageSnapshot(err.usage ?? null),
    };
  }
  return {
    errorClass: "Error",
    errorMessageSanitized: sanitizeErrorMessage(String(error)),
    httpStatus: null,
    finishReason: null,
    usage: null,
  };
}

function atomicWriteJson(filePath: string, value: unknown): void {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2));
  fs.renameSync(tmpPath, filePath);
}

function atomicWriteText(filePath: string, text: string): void {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, text);
  fs.renameSync(tmpPath, filePath);
}

function buildPerFixtureModelMap(
  fixtures: Fixture[],
  lunaModel: string,
  flashModel: string
): Record<string, { A: string; B: string }> {
  const perFixtureModelMap: Record<string, { A: string; B: string }> = {};
  for (let i = 0; i < fixtures.length; i++) {
    const runs = fixtureModelRuns(i, lunaModel, flashModel);
    perFixtureModelMap[fixtures[i]!.id] = {
      A: runs.find((run) => run.label === "A")!.model,
      B: runs.find((run) => run.label === "B")!.model,
    };
  }
  return perFixtureModelMap;
}

function buildRequestPlan(
  fixtures: Fixture[],
  lunaModel: string,
  flashModel: string,
  promptTranslation: PromptTranslationModule
): PlannedRequest[] {
  const plan: PlannedRequest[] = [];
  let globalIndex = 0;
  for (let fixtureIndex = 0; fixtureIndex < fixtures.length; fixtureIndex += 1) {
    const fixture = fixtures[fixtureIndex]!;
    const translatable = fixture.chunks.filter(promptTranslation.isTranslatableChunk);
    const batches = promptTranslation.splitTranslationBatches(translatable);
    const modelRuns = fixtureModelRuns(fixtureIndex, lunaModel, flashModel);
    for (const run of modelRuns) {
      batches.forEach((_batch, batchIndex) => {
        globalIndex += 1;
        plan.push({
          globalIndex,
          fixtureIndex,
          fixtureId: fixture.id,
          label: run.label,
          model: run.model,
          batchIndex,
        });
      });
    }
  }
  return plan;
}

function checkpointRunState(outDir: string, state: RunState): void {
  atomicWriteJson(path.join(outDir, "run-state.json"), state);
}

function checkpointRawRequests(outDir: string, records: AbRequestRecord[]): void {
  atomicWriteText(
    path.join(outDir, "raw-requests.jsonl"),
    records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : "")
  );
}

function buildBlindOutput(result: FixtureModelResult): string {
  if (result.productionTranslationSuccess) {
    return result.productionPublishedOutput ?? "(missing)";
  }
  const hasTransportFailure = result.requests.some((request) => request.status === "failure");
  if (hasTransportFailure) {
    return "[TRANSPORT FAILURE — production result would use Korean fallback]";
  }
  return "[TRANSLATION FAILURE — production result would use Korean fallback]";
}

export type RunTranslationAbBenchmarkResult = {
  fixtureCount: number;
  logicalChunkCount: number;
  batchCount: number;
  attemptedProviderRequestCount: number;
  successfulProviderRequestCount: number;
  failedProviderRequestCount: number;
  rawResults: FixtureModelResult[];
  perFixtureModelMap: Record<string, { A: string; B: string }>;
};

export async function runTranslationAbBenchmark(opts: {
  outDir: string;
  fixtures: Fixture[];
  audit: TranslationPlanAudit;
  lunaModel: string;
  flashModel: string;
  callPromptTranslation: TranslationAbCallFn;
  promptTranslation: PromptTranslationModule;
  harnessHead: string;
  runId?: string;
}): Promise<RunTranslationAbBenchmarkResult> {
  const {
    outDir,
    fixtures,
    audit,
    lunaModel,
    flashModel,
    callPromptTranslation,
    promptTranslation,
    harnessHead,
  } = opts;
  const runId = opts.runId ?? randomUUID();
  const startedAt = new Date().toISOString();

  fs.mkdirSync(outDir, { recursive: true });

  const perFixtureModelMap = buildPerFixtureModelMap(fixtures, lunaModel, flashModel);
  const requestPlan = buildRequestPlan(fixtures, lunaModel, flashModel, promptTranslation);

  fs.writeFileSync(
    path.join(outDir, "fixtures.json"),
    JSON.stringify(
      fixtures.map((f) => ({
        id: f.id,
        category: f.category,
        source: f.chunks.map((c) => c.content).join("\n\n"),
        invariants: f.invariants ?? null,
        productionChunkCount: f.chunks.filter(promptTranslation.isTranslatableChunk).length,
      })),
      null,
      2
    )
  );
  fs.writeFileSync(path.join(outDir, "model-map.json"), JSON.stringify(perFixtureModelMap, null, 2));

  const logicalChunkCount = fixtures.reduce((n, f) => n + f.chunks.length, 0);
  const batchCount = fixtures.reduce(
    (n, f) =>
      n +
      promptTranslation.splitTranslationBatches(f.chunks.filter(promptTranslation.isTranslatableChunk))
        .length,
    0
  );

  const allRequestRecords: AbRequestRecord[] = [];
  const rawResults: FixtureModelResult[] = [];
  const blindByFixture = new Map<
    string,
    { source: string; a?: string; b?: string }
  >();

  let attemptedProviderRequestCount = 0;
  let successfulProviderRequestCount = 0;
  let failedProviderRequestCount = 0;

  const writeRunState = (nextPlan: PlannedRequest | null, completed: boolean) => {
    checkpointRunState(outDir, {
      runId,
      startedAt,
      harnessHead,
      plannedProviderRequestCount: audit.plannedProviderRequestCount,
      attemptedProviderRequestCount,
      successfulProviderRequestCount,
      failedProviderRequestCount,
      nextFixture: nextPlan?.fixtureId ?? null,
      nextLabel: nextPlan?.label ?? null,
      nextBatch: nextPlan != null ? nextPlan.batchIndex : null,
      completed,
    });
  };

  writeRunState(requestPlan[0] ?? null, false);
  checkpointRawRequests(outDir, allRequestRecords);

  type FixtureRunAccumulator = {
    fixture: Fixture;
    label: "A" | "B";
    model: string;
    translatable: CharacterChunk[];
    batches: CharacterChunk[][];
    sourceText: string;
    runStarted: number;
    requestRecords: AbRequestRecord[];
    rawSuccessfulBatchOutputs: string[];
    translatedParts: Array<string | null>;
    failedBatchCount: number;
    successfulBatchCount: number;
  };

  const pendingByKey = new Map<string, FixtureRunAccumulator>();

  for (let planIndex = 0; planIndex < requestPlan.length; planIndex += 1) {
    const planned = requestPlan[planIndex]!;
    const fixture = fixtures[planned.fixtureIndex]!;
    const translatable = fixture.chunks.filter(promptTranslation.isTranslatableChunk);
    const batches = promptTranslation.splitTranslationBatches(translatable);
    const batch = batches[planned.batchIndex];
    if (!batch) {
      throw new Error(`missing batch ${planned.fixtureId} index ${planned.batchIndex}`);
    }

    const runKey = `${planned.fixtureId}:${planned.label}`;
    if (!pendingByKey.has(runKey)) {
      const sourceText = fixture.chunks.map((c) => c.content).join("\n\n");
      const existing = blindByFixture.get(planned.fixtureId);
      if (existing) {
        existing.source = sourceText;
      } else {
        blindByFixture.set(planned.fixtureId, { source: sourceText });
      }
      pendingByKey.set(runKey, {
        fixture,
        label: planned.label,
        model: planned.model,
        translatable,
        batches,
        sourceText,
        runStarted: Date.now(),
        requestRecords: [],
        rawSuccessfulBatchOutputs: [],
        translatedParts: [],
        failedBatchCount: 0,
        successfulBatchCount: 0,
      });
    }

    const accumulator = pendingByKey.get(runKey)!;
    const payload = batch
      .map((c, idx) => `⟦SEG ${idx + 1}⟧\n${c.content}\n⟦/SEG ${idx + 1}⟧`)
      .join("\n\n");
    const reqStarted = Date.now();

    attemptedProviderRequestCount += 1;
    let record: AbRequestRecord;

    try {
      const { text, usage } = await callPromptTranslation(
        promptTranslation.CHARACTER_TRANSLATION_SYSTEM_PROMPT,
        [{ role: "user", content: payload }],
        planned.model
      );
      const latencyMs = Date.now() - reqStarted;
      record = {
        globalRequestIndex: planned.globalIndex,
        fixtureId: planned.fixtureId,
        label: planned.label,
        model: planned.model,
        batchIndex: planned.batchIndex,
        requestedModel: planned.model,
        status: "success",
        text,
        usage: usageSnapshot(usage),
        error: null,
        latencyMs,
      };
      successfulProviderRequestCount += 1;

      const parsed = promptTranslation.parseSegmentedResponse(text, batch.length);
      if (!parsed || parsed.some((part) => !part.trim())) {
        accumulator.failedBatchCount += 1;
        accumulator.translatedParts.push(null);
      } else {
        accumulator.successfulBatchCount += 1;
        accumulator.rawSuccessfulBatchOutputs.push(parsed.join("\n\n"));
        accumulator.translatedParts.push(parsed.join("\n\n"));
      }
    } catch (error) {
      const captured = captureRequestError(error);
      const latencyMs = Date.now() - reqStarted;
      record = {
        globalRequestIndex: planned.globalIndex,
        fixtureId: planned.fixtureId,
        label: planned.label,
        model: planned.model,
        batchIndex: planned.batchIndex,
        requestedModel: planned.model,
        status: "failure",
        text: null,
        usage: captured.usage,
        error: {
          errorClass: captured.errorClass,
          errorMessageSanitized: captured.errorMessageSanitized,
          httpStatus: captured.httpStatus,
          finishReason: captured.finishReason,
        },
        latencyMs,
      };
      failedProviderRequestCount += 1;
      accumulator.failedBatchCount += 1;
      accumulator.translatedParts.push(null);
    }

    accumulator.requestRecords.push(record);
    allRequestRecords.push(record);
    checkpointRawRequests(outDir, allRequestRecords);
    writeRunState(requestPlan[planIndex + 1] ?? null, false);

    const nextPlanned = requestPlan[planIndex + 1];
    const finishedCurrentRun =
      !nextPlanned ||
      nextPlanned.fixtureId !== planned.fixtureId ||
      nextPlanned.label !== planned.label;

    if (finishedCurrentRun) {
      const allBatchesSucceeded =
        accumulator.failedBatchCount === 0 &&
        accumulator.translatedParts.length === accumulator.batches.length &&
        accumulator.translatedParts.every((part) => part != null && part.trim().length > 0);

      const productionTranslationSuccess = allBatchesSucceeded;
      const productionPublishedOutput = productionTranslationSuccess
        ? accumulator.translatedParts.filter((part): part is string => part != null).join("\n\n")
        : null;
      const productionOutcome = productionTranslationSuccess
        ? PRODUCTION_OUTCOME_ENGLISH
        : PRODUCTION_OUTCOME_KOREAN_FALLBACK;

      const outputForInvariants = productionPublishedOutput ?? "";
      const invariantResults = evaluateInvariants(
        accumulator.sourceText,
        outputForInvariants,
        accumulator.fixture.invariants
      );

      const aggregate = {
        requestCount: accumulator.requestRecords.length,
        successfulRequestCount: accumulator.requestRecords.filter((r) => r.status === "success")
          .length,
        failedRequestCount: accumulator.requestRecords.filter((r) => r.status === "failure").length,
        totalInputTokens: accumulator.requestRecords.reduce(
          (n, r) => n + Number(r.usage?.inputTokens ?? 0),
          0
        ),
        totalOutputTokens: accumulator.requestRecords.reduce(
          (n, r) => n + Number(r.usage?.outputTokens ?? 0),
          0
        ),
        totalReasoningTokens: accumulator.requestRecords.reduce(
          (n, r) => n + Number(r.usage?.reasoningOutputTokens ?? 0),
          0
        ),
        totalProviderReportedCostUsd: accumulator.requestRecords.some(
          (r) => r.usage?.upstreamCostUsd != null
        )
          ? accumulator.requestRecords.reduce(
              (n, r) => n + Number(r.usage?.upstreamCostUsd ?? 0),
              0
            )
          : null,
        totalLatencyMs: Date.now() - accumulator.runStarted,
      };

      const result: FixtureModelResult = {
        fixtureId: accumulator.fixture.id,
        category: accumulator.fixture.category,
        label: accumulator.label,
        model: accumulator.model,
        productionTranslationSuccess,
        productionOutcome,
        logicalChunkCount: accumulator.translatable.length,
        batchCount: accumulator.batches.length,
        successfulBatchCount: accumulator.successfulBatchCount,
        failedBatchCount: accumulator.failedBatchCount,
        segmentComplete: productionTranslationSuccess,
        placeholdersOk: productionPublishedOutput
          ? promptTranslation.validateTranslationPlaceholderPreservation(
              accumulator.sourceText,
              productionPublishedOutput
            )
          : false,
        invariantResults,
        rawSuccessfulBatchOutputs: [...accumulator.rawSuccessfulBatchOutputs],
        productionPublishedOutput,
        requests: [...accumulator.requestRecords],
        aggregate,
      };

      rawResults.push(result);
      pendingByKey.delete(runKey);

      const blindSlot = blindByFixture.get(accumulator.fixture.id)!;
      const blindOutput = buildBlindOutput(result);
      if (accumulator.label === "A") blindSlot.a = blindOutput;
      else blindSlot.b = blindOutput;
    }
  }

  for (const fixture of fixtures) {
    const mapping = perFixtureModelMap[fixture.id]!;
    if (mapping.A === mapping.B) {
      throw new Error(`fixture ${fixture.id}: A and B must differ`);
    }
    for (const label of ["A", "B"] as const) {
      const row = rawResults.find((entry) => entry.fixtureId === fixture.id && entry.label === label);
      if (!row) throw new Error(`missing ${fixture.id} label ${label}`);
      if (row.model !== mapping[label]) {
        throw new Error(`model-map mismatch for ${fixture.id} ${label}`);
      }
    }
  }

  fs.writeFileSync(
    path.join(outDir, "raw-results.jsonl"),
    rawResults.map((r) => JSON.stringify(r)).join("\n") + "\n"
  );

  const blindLines: string[] = [];
  for (const fixture of fixtures) {
    const slot = blindByFixture.get(fixture.id)!;
    blindLines.push(`Fixture ${fixture.id}`);
    blindLines.push("SOURCE:");
    blindLines.push(slot.source);
    blindLines.push("OUTPUT A:");
    blindLines.push(slot.a ?? "(missing)");
    blindLines.push("OUTPUT B:");
    blindLines.push(slot.b ?? "(missing)");
    blindLines.push("");
  }
  fs.writeFileSync(path.join(outDir, "blind-review.md"), blindLines.join("\n"));

  fs.writeFileSync(
    path.join(outDir, "summary.md"),
    [
      "# PR-2 Translation A/B Summary",
      "",
      `- fixture_count: ${fixtures.length}`,
      `- logical_chunk_count: ${logicalChunkCount}`,
      `- batch_count: ${batchCount}`,
      `- attempted_provider_request_count: ${attemptedProviderRequestCount}`,
      `- successful_provider_request_count: ${successfulProviderRequestCount}`,
      `- failed_provider_request_count: ${failedProviderRequestCount}`,
      `- F12_SOURCE_CHARS: ${audit.f12SourceChars}`,
      `- F12_PRODUCTION_CHUNK_COUNT: ${audit.f12ProductionChunkCount}`,
      `- F12_BATCH_COUNT_PER_MODEL: ${audit.f12BatchCountPerModel}`,
      `- PLANNED_PROVIDER_REQUEST_COUNT: ${audit.plannedProviderRequestCount}`,
      `- AB_PER_FIXTURE_MODEL_MAP_TEST: PASS`,
    ].join("\n")
  );

  writeRunState(null, true);

  return {
    fixtureCount: fixtures.length,
    logicalChunkCount,
    batchCount,
    attemptedProviderRequestCount,
    successfulProviderRequestCount,
    failedProviderRequestCount,
    rawResults,
    perFixtureModelMap,
  };
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
