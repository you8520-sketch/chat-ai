#!/usr/bin/env npx tsx
/**
 * Exploratory micro-bench: GPT-5.6 Luna vs Gemini 3.1 Flash-Lite (CheaperInference).
 * Requires RUN_REAL_LUNA_GEMINI_MICRO=1 and CHEAPER_INFERENCE_API_KEY.
 * Does NOT change production defaults or model registry.
 */
import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import {
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  adaptCheaperInferenceChatBody,
  assertCheaperInferenceEndpoint,
  buildCheaperInferenceHeaders,
  resolveCheaperInferenceApiKey,
} from "@/lib/cheaperInferenceConfig";
import { parseOpenRouterUsage } from "@/lib/openRouterUsage";
import { estimateTokens } from "@/lib/tokenEstimate";

const OUT_DIR = path.join(process.cwd(), "docs/audits/pr2-luna-vs-gemini31-micro");
const LUNA_MODEL = "gpt-5.6-luna";
const GEMINI_MODEL = "gemini-3.1-flash-lite";
const MICRO_FIXTURE_COUNT = 5;
const REQUESTS_PER_MODEL = 5;
const PLANNED_TOTAL_REQUESTS = 10;
const MAX_TOKENS = 15_000;
const TEMPERATURE = 0.3;
const TIMEOUT_MS = 120_000;

type MicroFixture = {
  id: string;
  category: string;
  source: string;
  invariants?: {
    placeholders?: string[];
    exactTokens?: string[];
    requiredStructure?: string[];
  };
};

type PlannedCall = {
  globalIndex: number;
  fixtureId: string;
  model: string;
  blindLabel: "A" | "B";
};

type RequestResult = {
  globalRequestIndex: number;
  fixtureId: string;
  blindLabel: "A" | "B";
  requestedModel: string;
  responseModelId: string | null;
  status: "success" | "failure";
  sourceChars: number;
  outputChars: number;
  rawOutput: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  finishReason: string | null;
  latencyMs: number;
  providerReportedCostUsd: number | null;
  segmentComplete: boolean;
  placeholderPreserved: boolean | null;
  segmentFailure: boolean;
  placeholderFailure: boolean;
  exactTokenFailure: boolean;
  error: null | {
    errorClass: string;
    sanitizedError: string;
    httpStatus: number | null;
  };
};

function buildMicroFixtures(): MicroFixture[] {
  return [
    {
      id: "M01",
      category: "personality_relationship",
      source: [
        "이름: 강이현. 나이: 29. 소속: 검은 장미단 부단장.",
        "성격: 겉으로는 냉정하고 계산적이지만, {{user}} 앞에서는 말끝을 흐리며 감정을 숨긴다.",
        "권태현과는 격렬한 라이벌이나, 둘 다 서로의 실력을 인정한다.",
        "관계: {{user}}는 어릴 적부터 함께 자란 친구. 강이현은 '괜찮아'라고 말하지만 눈빛은 걱정을 숨기지 못한다.",
        "감정 묘사: '별일 아니야'라고 말할 때마다 손끝이 떨린다. 직설적인 한국어 표현을 영어로 옮길 때 어색한 직역이 되지 않도록, 간접적이고 층위 있는 말투를 유지해야 한다.",
        "트라우마: 왕실 수호대 견습 시절 실패한 임무. 그날 이후 자신에게 '약한 사람을 지키지 못했다'는 죄책감을 품는다.",
        "말투: 짧은 문장과 생략된 주어가 많으며, 감정을 드러낼수록 문장이 더욱 간접적이 된다.",
      ].join("\n\n"),
    },
    {
      id: "M02",
      category: "world_lore_proper_nouns",
      source: [
        "【세계관】 엘라리아 왕국 수도 실버헤이븐은 1247년에 건국되었다.",
        "왕실 수호대는 왕궁과 외곽 요새를 지키며, 검은 장미단은 지하 정보망을 통해 왕실의 비밀을 거래한다.",
        "달의 신전은 북쪽 숲 글림에 있으며, 북부 연합과의 협상은 1263년 검은 장미단 반란 이후 중단되었다.",
        "주요 인물: 권태현(왕실 수호대장, 31세), 리나 볼트(암살 길드 마스터, 27세), 솔레아(달의 신전 수녀, 22세).",
        "세력 관계: 왕실 수호대 ↔ 검은 장미단(적대), 달의 신전 ↔ 북부 연합(중립 중재), 암살 길드 ↔ 모든 세력(고용 관계).",
        "지명: 실버헤이븐 왕궁 지하 수련장, 사막 오아시스 솔렌, 폐허 도시 노바. 날짜: 1288년 시간 금기술 봉인.",
        "번역 주의: 고유명사는 서로 바뀌거나 혼동되지 않도록, 세력·인물·장소의 정체성을 일관되게 유지할 것.",
      ].join("\n\n"),
    },
    {
      id: "M03",
      category: "strict_rules_placeholders",
      source: [
        "규칙: HP가 0이 되면 {{char}}는 전투 불능 상태가 된다. MP는 하루 1회 전량 회복.",
        "전투 수치: HP 100 / MP 50. 사건 날짜: 2026-08-28. 이동 거리: 3km. 성공 확률: 42%.",
        "조건부: IF HP<30 THEN 대화 톤 긴급. IF {{user}} 신뢰도>=70 THEN 비밀 고백 가능.",
        "금지: OOC 메타 발언, {{user}} 행동 대리, {{char}} 강제 행동 묘사.",
        "IF 밤 THEN 시야 -2. IF 비 THEN 이동 속도 50% 감소. IF 전투 중 THEN 회복 아이템 1회 제한.",
        "추가 규칙: {{user}}와 {{char}}의 선택을 항상 존중한다. NPC는 플레이어 의도를 추측하지 않는다.",
        "상태창: [상태] HP / MP / 【버프】는 번역 후에도 동일 토큰이 유지되어야 한다.",
      ].join("\n\n"),
      invariants: {
        placeholders: ["{{user}}", "{{char}}"],
        exactTokens: ["HP", "MP", "2026-08-28", "42%", "3km"],
      },
    },
    {
      id: "M04",
      category: "formatting_stress",
      source: [
        "# 배경",
        "- 항목1: 폐허 도시 노바",
        "- 항목2: 마법 학원 아르카디움",
        "- 항목3: 왕궁 지하 수련장",
        "【세계관】 엘라리아 왕국은 달의 신전을 중심으로 마법 체계가 유지된다.",
        "[상태] HP: 100 / MP: 80 / 【버프】가속",
        "JSON: {\"trait\":\"cold\",\"mood\":\"guarded\",\"likes\":[\"tea\",\"rain\"]}",
        "필드: 이름: 은우 / 직업: 기록관련 / (특수) 왼손 화상 흉터",
        "괄호 테스트: （전각） (반각) 【각주】",
        "규칙 요약: Markdown 헤더, 불릿, 대괄호 라벨, JSON 조각, 콜론 필드가 구조 손상 없이 유지되어야 한다.",
        "추가 메모: 번역 시 목록 순서, JSON 키, 괄호 종류(전각/반각/중괄호)를 바꾸거나 누락하지 말 것.",
      ].join("\n"),
      invariants: {
        requiredStructure: ["# 배경", "【세계관】", "[상태]"],
      },
    },
    {
      id: "M05",
      category: "colloquial_rp_nuance",
      source: [
        "캐릭터: 은우(24). 상황: {{user}}가 늦게 도착한 뒤의 대화.",
        "은우: \"야, 너 진짜 눈치 없다.\" (장난 섞인 투덜거림이지만 실은 안도감)",
        "은우: \"됐어. 내가 괜히 말했네.\" (스스로를 탓하며 {{user}}를 배려)",
        "은우: \"웃기지 마.\" (부끄러움을 가린 짧은 반박)",
        "은우: \"그런 뜻으로 한 말 아니거든.\" (오해를 풀려는 간접 표현)",
        "맥락: 겉말과 속뜻이 다른 한국어 구어체. 직역하면 어색하므로, 영어에서도 자연스러운 대화체와 감정 온도를 유지해야 한다.",
        "{{user}}와 {{char}}는 오래된 친구이며, 존댓말 없이 반말을 쓴다.",
        "배경: 비가 온 뒤라 공기가 차갑고, 둘 사이에 미묘한 긴장과 안도가 동시에 남아 있다.",
      ].join("\n\n"),
      invariants: {
        placeholders: ["{{user}}", "{{char}}"],
      },
    },
  ];
}

function fixtureModelMap(): Record<string, { A: string; B: string }> {
  return {
    M01: { A: LUNA_MODEL, B: GEMINI_MODEL },
    M02: { A: GEMINI_MODEL, B: LUNA_MODEL },
    M03: { A: LUNA_MODEL, B: GEMINI_MODEL },
    M04: { A: GEMINI_MODEL, B: LUNA_MODEL },
    M05: { A: LUNA_MODEL, B: GEMINI_MODEL },
  };
}

function buildRequestPlan(): PlannedCall[] {
  const map = fixtureModelMap();
  const fixtures = buildMicroFixtures();
  const plan: PlannedCall[] = [];
  let globalIndex = 0;

  for (const fixture of fixtures) {
    const mapping = map[fixture.id]!;
    for (const entry of [
      { model: mapping.A, blindLabel: "A" as const },
      { model: mapping.B, blindLabel: "B" as const },
    ]) {
      globalIndex += 1;
      plan.push({
        globalIndex,
        fixtureId: fixture.id,
        model: entry.model,
        blindLabel: entry.blindLabel,
      });
    }
  }

  return plan;
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

function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/sk-[a-zA-Z0-9_-]+/g, "sk-[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/CHEAPER_INFERENCE_API_KEY=\S+/gi, "CHEAPER_INFERENCE_API_KEY=[REDACTED]")
    .replace(/OPENROUTER_API_KEY=\S+/gi, "OPENROUTER_API_KEY=[REDACTED]");
}

function captureError(error: unknown): {
  errorClass: string;
  sanitizedError: string;
  httpStatus: number | null;
} {
  if (error && typeof error === "object") {
    const err = error as { name?: string; message?: string; httpStatus?: number | null };
    return {
      errorClass: err.name ?? "Error",
      sanitizedError: sanitizeErrorMessage(String(err.message ?? error)),
      httpStatus: err.httpStatus ?? null,
    };
  }
  return {
    errorClass: "Error",
    sanitizedError: sanitizeErrorMessage(String(error)),
    httpStatus: null,
  };
}

function evaluateObjectiveChecks(
  fixture: MicroFixture,
  source: string,
  output: string | null,
  parseSegmentedResponse: (text: string, count: number) => string[] | null
): {
  segmentComplete: boolean;
  placeholderPreserved: boolean | null;
  segmentFailure: boolean;
  placeholderFailure: boolean;
  exactTokenFailure: boolean;
} {
  if (!output?.trim()) {
    return {
      segmentComplete: false,
      placeholderPreserved: null,
      segmentFailure: true,
      placeholderFailure: false,
      exactTokenFailure: false,
    };
  }

  const parsed = parseSegmentedResponse(output, 1);
  const segmentComplete = parsed != null && parsed[0]?.trim().length > 0;
  const segmentFailure = !segmentComplete;

  let placeholderFailure = false;
  if (fixture.invariants?.placeholders) {
    for (const token of fixture.invariants.placeholders) {
      if (countOccurrences(source, token) !== countOccurrences(output, token)) {
        placeholderFailure = true;
      }
    }
  }

  let exactTokenFailure = false;
  if (fixture.invariants?.exactTokens) {
    for (const token of fixture.invariants.exactTokens) {
      if (countOccurrences(source, token) !== countOccurrences(output, token)) {
        exactTokenFailure = true;
      }
    }
  }

  if (fixture.invariants?.requiredStructure) {
    for (const token of fixture.invariants.requiredStructure) {
      if (!output.includes(token)) {
        exactTokenFailure = true;
      }
    }
  }

  const placeholderPreserved = fixture.invariants?.placeholders ? !placeholderFailure : null;

  return {
    segmentComplete,
    placeholderPreserved,
    segmentFailure,
    placeholderFailure,
    exactTokenFailure,
  };
}

function buildSegmentPayload(source: string): string {
  return `⟦SEG 1⟧\n${source}\n⟦/SEG 1⟧`;
}

async function callCheaperInferenceTranslation(
  model: string,
  userPayload: string,
  systemPrompt: string
): Promise<{
  text: string;
  responseModelId: string | null;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number | null;
  finishReason: string | null;
  providerReportedCostUsd: number | null;
}> {
  assertCheaperInferenceEndpoint(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL);
  const headers = buildCheaperInferenceHeaders(resolveCheaperInferenceApiKey());
  const baseBody = {
    model,
    messages: [
      { role: "system", content: systemPrompt.trim() },
      { role: "user", content: userPayload },
    ],
    stream: false,
    temperature: TEMPERATURE,
    max_tokens: MAX_TOKENS,
  };
  const body = adaptCheaperInferenceChatBody(baseBody);

  const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const errText = await res.text();
    const error = Object.assign(
      new Error(`CheaperInference ${res.status}: ${errText.slice(0, 240)}`),
      { name: "CheaperInferenceHttpError", httpStatus: res.status }
    );
    throw error;
  }

  const data = (await res.json()) as {
    model?: string;
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    usage?: Record<string, unknown>;
  };

  const text = data.choices?.[0]?.message?.content?.trim() ?? "";
  const parsedUsage = parseOpenRouterUsage(data.usage, res.headers);
  const inputTokens =
    parsedUsage.promptTokens ||
    estimateTokens(systemPrompt + userPayload);
  const outputTokens = parsedUsage.completionTokens || estimateTokens(text);

  if (!text) {
    const error = Object.assign(
      new Error(
        `CheaperInference empty completion (finish=${data.choices?.[0]?.finish_reason ?? "unknown"})`
      ),
      {
        name: "CheaperInferenceEmptyCompletion",
        httpStatus: res.status,
        finishReason: data.choices?.[0]?.finish_reason ?? null,
      }
    );
    throw error;
  }

  return {
    text,
    responseModelId: typeof data.model === "string" ? data.model : model,
    inputTokens,
    outputTokens,
    reasoningTokens: parsedUsage.reasoningTokens > 0 ? parsedUsage.reasoningTokens : null,
    finishReason: data.choices?.[0]?.finish_reason ?? null,
    providerReportedCostUsd: parsedUsage.upstreamCostUsd ?? null,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function printPreflight(fixtures: MicroFixture[]): void {
  console.log(`MICRO_FIXTURE_COUNT=${fixtures.length}`);
  console.log(`PLANNED_LUNA_REQUESTS=${REQUESTS_PER_MODEL}`);
  console.log(`PLANNED_GEMINI_REQUESTS=${REQUESTS_PER_MODEL}`);
  console.log(`PLANNED_TOTAL_REQUESTS=${PLANNED_TOTAL_REQUESTS}`);
  for (const fixture of fixtures) {
    console.log(`${fixture.id}_SOURCE_CHARS=${fixture.source.length}`);
  }
}

async function runMicroBenchmark(): Promise<void> {
  const fixtures = buildMicroFixtures();
  if (fixtures.length !== MICRO_FIXTURE_COUNT) {
    throw new Error(`expected ${MICRO_FIXTURE_COUNT} fixtures, got ${fixtures.length}`);
  }

  printPreflight(fixtures);

  if (process.env.RUN_REAL_LUNA_GEMINI_MICRO !== "1") {
    console.log("REAL_PROVIDER_CALLS=0");
    console.log("MICRO_STATUS=NOT_RUN");
    process.exit(0);
  }

  if (!process.env.CHEAPER_INFERENCE_API_KEY?.trim()) {
    console.log("MICRO_STATUS=NOT_RUN — missing CHEAPER_INFERENCE_API_KEY");
    console.log("REAL_PROVIDER_CALLS=0");
    process.exit(0);
  }

  if (process.env.OPENROUTER_API_KEY?.trim()) {
    console.warn("OPENROUTER_API_KEY is set; micro-bench requires it empty for provider purity");
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const promptTranslation = await import("@/lib/promptTranslation");
  const systemPrompt = promptTranslation.CHARACTER_TRANSLATION_SYSTEM_PROMPT;
  const parseSegmentedResponse = promptTranslation.parseSegmentedResponse;

  const perFixtureModelMap = fixtureModelMap();
  const requestPlan = buildRequestPlan();
  if (requestPlan.length !== PLANNED_TOTAL_REQUESTS) {
    throw new Error(`planned ${PLANNED_TOTAL_REQUESTS} requests, got ${requestPlan.length}`);
  }

  fs.writeFileSync(
    path.join(OUT_DIR, "fixtures.json"),
    JSON.stringify(
      fixtures.map((f) => ({
        id: f.id,
        category: f.category,
        source: f.source,
        sourceChars: f.source.length,
        invariants: f.invariants ?? null,
      })),
      null,
      2
    )
  );
  fs.writeFileSync(path.join(OUT_DIR, "model-map.json"), JSON.stringify(perFixtureModelMap, null, 2));

  const fixtureById = new Map(fixtures.map((f) => [f.id, f]));
  const results: RequestResult[] = [];
  const blindOutputs = new Map<string, { source: string; a?: string; b?: string }>();

  for (const fixture of fixtures) {
    blindOutputs.set(fixture.id, { source: fixture.source });
  }

  for (const planned of requestPlan) {
    const fixture = fixtureById.get(planned.fixtureId)!;
    const payload = buildSegmentPayload(fixture.source);
    const started = Date.now();

    try {
      const response = await callCheaperInferenceTranslation(
        planned.model,
        payload,
        systemPrompt
      );
      const checks = evaluateObjectiveChecks(
        fixture,
        fixture.source,
        response.text,
        parseSegmentedResponse
      );
      const result: RequestResult = {
        globalRequestIndex: planned.globalIndex,
        fixtureId: planned.fixtureId,
        blindLabel: planned.blindLabel,
        requestedModel: planned.model,
        responseModelId: response.responseModelId,
        status: "success",
        sourceChars: fixture.source.length,
        outputChars: response.text.length,
        rawOutput: response.text,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        reasoningTokens: response.reasoningTokens,
        finishReason: response.finishReason,
        latencyMs: Date.now() - started,
        providerReportedCostUsd: response.providerReportedCostUsd,
        segmentComplete: checks.segmentComplete,
        placeholderPreserved: checks.placeholderPreserved,
        segmentFailure: checks.segmentFailure,
        placeholderFailure: checks.placeholderFailure,
        exactTokenFailure: checks.exactTokenFailure,
        error: null,
      };
      results.push(result);

      const parsed = parseSegmentedResponse(response.text, 1);
      const blindText = parsed?.[0]?.trim() ? parsed[0]! : response.text;
      const slot = blindOutputs.get(planned.fixtureId)!;
      if (planned.blindLabel === "A") slot.a = blindText;
      else slot.b = blindText;
    } catch (error) {
      const captured = captureError(error);
      const result: RequestResult = {
        globalRequestIndex: planned.globalIndex,
        fixtureId: planned.fixtureId,
        blindLabel: planned.blindLabel,
        requestedModel: planned.model,
        responseModelId: null,
        status: "failure",
        sourceChars: fixture.source.length,
        outputChars: 0,
        rawOutput: null,
        inputTokens: null,
        outputTokens: null,
        reasoningTokens: null,
        finishReason: null,
        latencyMs: Date.now() - started,
        providerReportedCostUsd: null,
        segmentComplete: false,
        placeholderPreserved: null,
        segmentFailure: true,
        placeholderFailure: false,
        exactTokenFailure: false,
        error: captured,
      };
      results.push(result);

      const slot = blindOutputs.get(planned.fixtureId)!;
      const failureLine = "[TRANSPORT FAILURE — no English output produced]";
      if (planned.blindLabel === "A") slot.a = failureLine;
      else slot.b = failureLine;
    }
  }

  fs.writeFileSync(
    path.join(OUT_DIR, "raw-results.jsonl"),
    results.map((row) => JSON.stringify(row)).join("\n") + "\n"
  );

  const blindLines: string[] = [];
  for (const fixture of fixtures) {
    const slot = blindOutputs.get(fixture.id)!;
    blindLines.push(`Fixture ${fixture.id}`);
    blindLines.push("SOURCE:");
    blindLines.push(slot.source);
    blindLines.push("OUTPUT A:");
    blindLines.push(slot.a ?? "(missing)");
    blindLines.push("OUTPUT B:");
    blindLines.push(slot.b ?? "(missing)");
    blindLines.push("");
  }
  fs.writeFileSync(path.join(OUT_DIR, "blind-review.md"), blindLines.join("\n"));

  const lunaResults = results.filter((r) => r.requestedModel === LUNA_MODEL);
  const geminiResults = results.filter((r) => r.requestedModel === GEMINI_MODEL);
  const lunaSuccess = lunaResults.filter((r) => r.status === "success");
  const geminiSuccess = geminiResults.filter((r) => r.status === "success");
  const lunaLatencies = lunaSuccess.map((r) => r.latencyMs);
  const geminiLatencies = geminiSuccess.map((r) => r.latencyMs);

  const summaryLines = [
    "# Luna vs Gemini 3.1 Flash-Lite Micro-Bench Summary",
    "",
    `- harness_head: ${execSync("git rev-parse HEAD", { encoding: "utf8" }).trim()}`,
    `- fixture_count: ${fixtures.length}`,
    `- planned_provider_requests: ${PLANNED_TOTAL_REQUESTS}`,
    `- actual_provider_requests: ${results.length}`,
    `- luna_model: ${LUNA_MODEL}`,
    `- gemini_model: ${GEMINI_MODEL}`,
    "",
    "## Reliability",
    `- luna_success_count: ${lunaSuccess.length}/${REQUESTS_PER_MODEL}`,
    `- luna_failure_count: ${lunaResults.length - lunaSuccess.length}`,
    `- gemini_success_count: ${geminiSuccess.length}/${REQUESTS_PER_MODEL}`,
    `- gemini_failure_count: ${geminiResults.length - geminiSuccess.length}`,
    "",
    "## Latency (ms, n=5 per model — descriptive only)",
    `- luna_latency_min_ms: ${lunaLatencies.length ? Math.min(...lunaLatencies) : "n/a"}`,
    `- luna_latency_median_ms: ${median(lunaLatencies) ?? "n/a"}`,
    `- luna_latency_mean_ms: ${mean(lunaLatencies) ?? "n/a"}`,
    `- luna_latency_max_ms: ${lunaLatencies.length ? Math.max(...lunaLatencies) : "n/a"}`,
    `- gemini_latency_min_ms: ${geminiLatencies.length ? Math.min(...geminiLatencies) : "n/a"}`,
    `- gemini_latency_median_ms: ${median(geminiLatencies) ?? "n/a"}`,
    `- gemini_latency_mean_ms: ${mean(geminiLatencies) ?? "n/a"}`,
    `- gemini_latency_max_ms: ${geminiLatencies.length ? Math.max(...geminiLatencies) : "n/a"}`,
    "",
    "## Tokens",
    `- luna_total_input_tokens: ${lunaSuccess.reduce((n, r) => n + (r.inputTokens ?? 0), 0)}`,
    `- luna_total_output_tokens: ${lunaSuccess.reduce((n, r) => n + (r.outputTokens ?? 0), 0)}`,
    `- luna_total_reasoning_tokens: ${lunaSuccess.reduce((n, r) => n + (r.reasoningTokens ?? 0), 0)}`,
    `- luna_provider_reported_cost_usd: ${
      lunaSuccess.some((r) => r.providerReportedCostUsd != null)
        ? lunaSuccess.reduce((n, r) => n + (r.providerReportedCostUsd ?? 0), 0)
        : "n/a"
    }`,
    `- gemini_total_input_tokens: ${geminiSuccess.reduce((n, r) => n + (r.inputTokens ?? 0), 0)}`,
    `- gemini_total_output_tokens: ${geminiSuccess.reduce((n, r) => n + (r.outputTokens ?? 0), 0)}`,
    `- gemini_total_reasoning_tokens: ${geminiSuccess.reduce((n, r) => n + (r.reasoningTokens ?? 0), 0)}`,
    `- gemini_provider_reported_cost_usd: ${
      geminiSuccess.some((r) => r.providerReportedCostUsd != null)
        ? geminiSuccess.reduce((n, r) => n + (r.providerReportedCostUsd ?? 0), 0)
        : "n/a"
    }`,
    "",
    "## Objective failures (by model)",
    `- luna_segment_failures: ${lunaResults.filter((r) => r.segmentFailure).length}`,
    `- gemini_segment_failures: ${geminiResults.filter((r) => r.segmentFailure).length}`,
    `- luna_placeholder_failures: ${lunaResults.filter((r) => r.placeholderFailure).length}`,
    `- gemini_placeholder_failures: ${geminiResults.filter((r) => r.placeholderFailure).length}`,
    `- luna_exact_token_failures: ${lunaResults.filter((r) => r.exactTokenFailure).length}`,
    `- gemini_exact_token_failures: ${geminiResults.filter((r) => r.exactTokenFailure).length}`,
  ];
  fs.writeFileSync(path.join(OUT_DIR, "summary.md"), summaryLines.join("\n"));

  console.log(`ACTUAL_PROVIDER_REQUESTS=${results.length}`);
  console.log(`LUNA_SUCCESS_COUNT=${lunaSuccess.length}/${REQUESTS_PER_MODEL}`);
  console.log(`GEMINI_SUCCESS_COUNT=${geminiSuccess.length}/${REQUESTS_PER_MODEL}`);
  console.log("MICRO_STATUS=RUN complete");
}

runMicroBenchmark().catch((err) => {
  console.error(err);
  process.exit(1);
});
