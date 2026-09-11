/**
 * Gemini 3.7 Flash TTFT investigation — controlled CheaperInference A/B harness.
 * Production provider path only. No merge/deploy candidate without evidence.
 *
 *   node --conditions=react-server --import tsx scripts/gemini-37-flash-ttft-ab.ts
 *   AB_SAMPLES=8 node --conditions=react-server --import tsx scripts/gemini-37-flash-ttft-ab.ts
 *   AB_EXPERIMENTS=A node ...   # A only (reasoning low vs none)
 *   AB_EXPERIMENTS=B node ...   # B only (X-CI-Route:auto)
 *   AB_FIXTURE=quiet|action|long node ...
 */
import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { buildContext } from "../src/services/contextBuilder";
import { assemblePrimaryRpRequest } from "../src/lib/openRouterAdult";
import {
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  buildCheaperInferenceHeaders,
  resolveCheaperInferenceApiKey,
} from "../src/lib/cheaperInferenceConfig";
import { CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL } from "../src/lib/chatModels";
import { DEFAULT_TARGET_RESPONSE_CHARS } from "../src/lib/responseLengthConstants";
import { TERRA_PROMPT_CANARY_GREETING_NEUTRAL } from "../src/lib/terraPromptCanary";
import { parseOpenRouterUsage } from "../src/lib/openRouterUsage";
import { loadEnvLocal } from "./load-env-local";
import {
  readCheaperInferenceResponseDiagnostics,
  type CheaperInferenceResponseDiagnostics,
} from "../src/lib/turnPhaseLatencyAudit";
import type { ChatMsg } from "../src/lib/ai";

loadEnvLocal();

const MODEL = CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL;
const OUT_DIR = path.join(process.cwd(), "docs/audits/gemini-37-flash-ttft-investigation");
const ARTIFACT_DIR = path.join("/opt/cursor/artifacts", "gemini-37-flash-ttft-ab");
const SAMPLES = Math.max(3, Number(process.env.AB_SAMPLES ?? "5") || 5);
const EXPERIMENTS = (process.env.AB_EXPERIMENTS ?? "A,B").split(",").map((s) => s.trim());
const FIXTURE = process.env.AB_FIXTURE ?? "quiet";

const T1_USER = "나는 렌이라고… 본 기억이 안 나는데… 나 알아?";
const T2_USER = "같이 갈래? *두리번*";
const ACTION_USER =
  "*갑자기 경보음이 울리며* 복도 끝에서 붉은 불빛이 번쩍였다. \"뭐야?\" *몸을 돌리며*";

const JO_TAEHYUNG_CARD = `너는 조태형이다. 에이지스 본부 S급 특수계 음압 센티넬. 고위험 폭주형.
북극곰 귀 흰 후드티, 유광 블랙 재킷, 녹색 눈, 검은 네일, 은반지, 여자 향수.
목에 전자 초커. 낙천적이고 능청스러우며 사람을 옭아매는 관찰력이 있다.
렌 곁에서는 이명이 가라앉는다.`;

type PhaseMarks = {
  T10_PROVIDER_FETCH_START?: number;
  T11_PROVIDER_RESPONSE_HEADERS?: number;
  T12_PROVIDER_FIRST_SSE?: number;
  T13_PROVIDER_FIRST_VISIBLE_TOKEN?: number;
};

type SampleResult = {
  sample: number;
  httpStatus: number;
  failure: string | null;
  resolvedModel: string | null;
  finishReason: string | null;
  marks: PhaseMarks;
  FETCH_TO_FIRST_VISIBLE_MS: number | null;
  FETCH_TO_HEADERS_MS: number | null;
  HEADERS_TO_FIRST_SSE_MS: number | null;
  FIRST_SSE_TO_VISIBLE_MS: number | null;
  totalLatencyMs: number;
  promptTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  visibleOutputTokens: number;
  billedCostUsd: number | null;
  cheaperInferenceDiagnostics: CheaperInferenceResponseDiagnostics;
  visiblePreview: string;
};

type VariantResult = {
  variant: string;
  reasoningEffort: string | null;
  ciRoute: string | null;
  frozenBodySha256: string;
  samples: SampleResult[];
  stats: ReturnType<typeof aggregateStats>;
};

function save(name: string, content: string | object) {
  for (const dir of [OUT_DIR, ARTIFACT_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, name),
      typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`,
      "utf8"
    );
  }
}

function percentile(nums: number[], p: number): number | null {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

function aggregateStats(samples: SampleResult[]) {
  const ok = samples.filter((s) => !s.failure);
  const pick = (fn: (s: SampleResult) => number | null) =>
    ok.map(fn).filter((n): n is number => n != null);
  const ttft = pick((s) => s.FETCH_TO_FIRST_VISIBLE_MS);
  const fetchHeaders = pick((s) => s.FETCH_TO_HEADERS_MS);
  const headersSse = pick((s) => s.HEADERS_TO_FIRST_SSE_MS);
  const sseVisible = pick((s) => s.FIRST_SSE_TO_VISIBLE_MS);
  return {
    samples: samples.length,
    failures: samples.length - ok.length,
    MEDIAN_TTFT: percentile(ttft, 0.5),
    P25_TTFT: percentile(ttft, 0.25),
    P75_TTFT: percentile(ttft, 0.75),
    MIN_TTFT: ttft.length ? Math.min(...ttft) : null,
    MAX_TTFT: ttft.length ? Math.max(...ttft) : null,
    MEDIAN_FETCH_TO_HEADERS: percentile(fetchHeaders, 0.5),
    MEDIAN_HEADERS_TO_FIRST_SSE: percentile(headersSse, 0.5),
    MEDIAN_FIRST_SSE_TO_VISIBLE: percentile(sseVisible, 0.5),
    MEDIAN_PROMPT_TOKENS: percentile(
      ok.map((s) => s.promptTokens),
      0.5
    ),
    MEDIAN_CACHED_TOKENS: percentile(
      ok.map((s) => s.cachedTokens),
      0.5
    ),
    MEDIAN_REASONING_TOKENS: percentile(
      ok.map((s) => s.reasoningTokens),
      0.5
    ),
    MEDIAN_VISIBLE_OUTPUT_TOKENS: percentile(
      ok.map((s) => s.visibleOutputTokens),
      0.5
    ),
    MEDIAN_BILLED_COST: percentile(
      ok.map((s) => s.billedCostUsd ?? NaN).filter(Number.isFinite),
      0.5
    ),
    slowestRequestId: ok.reduce<{ ms: number; id: string | null }>(
      (best, s) => {
        const ms = s.FETCH_TO_FIRST_VISIBLE_MS ?? 0;
        const id = s.cheaperInferenceDiagnostics["x-ci-request-id"] ?? null;
        return ms > best.ms ? { ms, id } : best;
      },
      { ms: -1, id: null }
    ).id,
    fastestRequestId: ok.reduce<{ ms: number; id: string | null }>(
      (best, s) => {
        const ms = s.FETCH_TO_FIRST_VISIBLE_MS ?? Number.MAX_SAFE_INTEGER;
        const id = s.cheaperInferenceDiagnostics["x-ci-request-id"] ?? null;
        if (ms < best.ms) return { ms, id };
        return best;
      },
      { ms: Number.MAX_SAFE_INTEGER, id: null }
    ).id,
  };
}

function buildFixture(): { label: string; history: ChatMsg[]; userLine: string } {
  const greetingHistory: ChatMsg[] = [
    { role: "assistant", content: TERRA_PROMPT_CANARY_GREETING_NEUTRAL },
  ];
  if (FIXTURE === "action") {
    return {
      label: "action-event",
      history: [
        ...greetingHistory,
        { role: "user", content: T1_USER },
        {
          role: "assistant",
          content:
            "조태형이 고개를 갸웃하며 녹색 눈을 가늘게 떴다. \"렌? 처음 듣는 이름인데.\"",
        },
      ],
      userLine: ACTION_USER,
    };
  }
  if (FIXTURE === "long") {
    const filler = Array.from({ length: 8 }, (_, i) => [
      { role: "user" as const, content: `*로비를 걸으며* ${i + 1}번째 질문이야. 여기 분위기 어때?` },
      {
        role: "assistant" as const,
        content: `태형이 어깨를 으쓱했다. \"${i + 1}번째? 꽤 오래 붙어 있는데.\" *후드의 곰 귀가 흔들렸다.*`,
      },
    ]).flat();
    return {
      label: "long-context",
      history: [...greetingHistory, ...filler],
      userLine: T2_USER,
    };
  }
  return { label: "quiet-interaction", history: greetingHistory, userLine: T1_USER };
}

function buildFrozenRequest() {
  const fixture = buildFixture();
  const built = buildContext({
    charName: "조태형",
    contentKind: "character",
    chunks: [
      {
        id: "c18-identity",
        characterId: "18",
        content: JO_TAEHYUNG_CARD,
        category: "identity",
        importance: "CRITICAL",
        tokenCount: 200,
        keywords: ["조태형", "센티넬"],
      },
      {
        id: "c18-world",
        characterId: "18",
        content: "에이지스 컨트롤 본부. 센티넬/가이드. 중앙 로비, 지원국, 동기화 챔버.",
        category: "world",
        importance: "CONTEXTUAL",
        tokenCount: 40,
        keywords: ["에이지스", "로비"],
      },
    ],
    userNickname: "렌",
    personaDisplayName: "렌",
    userPersona: "이름/호칭: 렌\n성별: 남성",
    userPersonaGender: "male",
    shortTermHistory: fixture.history,
    currentUserMessage: fixture.userLine,
    nsfw: false,
    gender: "male",
    provider: "cheaperinference",
    modelId: MODEL,
    targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
    completedTurns: fixture.history.filter((m) => m.role === "assistant").length,
    narrativePov: { mode: "third_person", povCharacterName: "조태형" },
  });
  const assembled = assemblePrimaryRpRequest({
    system: built.systemPrompt ?? "",
    history: built.history,
    modelId: MODEL,
    targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
    stream: true,
    messageOpts: {
      transportProvider: "cheaperinference",
      systemSplit: built.openRouterSystemSplit,
      charName: "조태형",
    },
  });
  return { fixture, assembled };
}

function redactedOutboundSnapshot(body: Record<string, unknown>, headerNames: string[]) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  return {
    endpoint: CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    model: body.model ?? null,
    stream: body.stream ?? null,
    max_tokens: body.max_tokens ?? null,
    temperature: body.temperature ?? null,
    reasoning_effort: body.reasoning_effort ?? null,
    thinking: body.thinking ?? null,
    reasoning: body.reasoning ?? null,
    requestHeaderNames: headerNames.sort(),
    messageCount: messages.length,
    providerPromptTokenCount: null as number | null,
    cachedTokenCount: null as number | null,
  };
}

function delta(a?: number, b?: number): number | null {
  if (a == null || b == null) return null;
  return Math.max(0, b - a);
}

async function runSample(opts: {
  frozenBody: Record<string, unknown>;
  headers: Record<string, string>;
  sampleIndex: number;
}): Promise<SampleResult> {
  const started = Date.now();
  const marks: PhaseMarks = {};
  marks.T10_PROVIDER_FETCH_START = Date.now();
  let res: Response;
  try {
    res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: opts.headers,
      body: JSON.stringify(opts.frozenBody),
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
  } catch (err) {
    return {
      sample: opts.sampleIndex,
      httpStatus: 0,
      failure: err instanceof Error ? err.message : String(err),
      resolvedModel: null,
      finishReason: null,
      marks,
      FETCH_TO_FIRST_VISIBLE_MS: null,
      FETCH_TO_HEADERS_MS: null,
      HEADERS_TO_FIRST_SSE_MS: null,
      FIRST_SSE_TO_VISIBLE_MS: null,
      totalLatencyMs: Date.now() - started,
      promptTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
      visibleOutputTokens: 0,
      billedCostUsd: null,
      cheaperInferenceDiagnostics: {},
      visiblePreview: "",
    };
  }
  marks.T11_PROVIDER_RESPONSE_HEADERS = Date.now();
  const ciDiag = readCheaperInferenceResponseDiagnostics(res.headers);

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => "");
    return {
      sample: opts.sampleIndex,
      httpStatus: res.status,
      failure: errText.slice(0, 240) || res.statusText,
      resolvedModel: null,
      finishReason: null,
      marks,
      FETCH_TO_FIRST_VISIBLE_MS: null,
      FETCH_TO_HEADERS_MS: delta(marks.T10_PROVIDER_FETCH_START, marks.T11_PROVIDER_RESPONSE_HEADERS),
      HEADERS_TO_FIRST_SSE_MS: null,
      FIRST_SSE_TO_VISIBLE_MS: null,
      totalLatencyMs: Date.now() - started,
      promptTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
      visibleOutputTokens: 0,
      billedCostUsd: null,
      cheaperInferenceDiagnostics: ciDiag,
      visiblePreview: "",
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let finishReason: string | null = null;
  let resolvedModel: string | null = null;
  let usageRaw: unknown = null;
  let cheaperInferenceRaw: unknown = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value?.byteLength && marks.T12_PROVIDER_FIRST_SSE == null) {
      marks.T12_PROVIDER_FIRST_SSE = Date.now();
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (typeof ev.model === "string") resolvedModel = ev.model;
      if (ev.usage) usageRaw = ev.usage;
      if (ev.cheaper_inference) cheaperInferenceRaw = ev.cheaper_inference;
      const choice0 = Array.isArray(ev.choices) ? ev.choices[0] : null;
      const choice =
        choice0 && typeof choice0 === "object" ? (choice0 as Record<string, unknown>) : {};
      if (typeof choice.finish_reason === "string" && choice.finish_reason) {
        finishReason = choice.finish_reason;
      }
      const deltaObj = (choice.delta ?? {}) as Record<string, unknown>;
      const piece = typeof deltaObj.content === "string" ? deltaObj.content : "";
      if (piece && marks.T13_PROVIDER_FIRST_VISIBLE_TOKEN == null) {
        marks.T13_PROVIDER_FIRST_VISIBLE_TOKEN = Date.now();
      }
      if (piece) text += piece;
    }
  }

  const usage = parseOpenRouterUsage(usageRaw, res.headers, cheaperInferenceRaw);
  const visibleChars = [...text.replace(/\s/g, "")].length;
  return {
    sample: opts.sampleIndex,
    httpStatus: res.status,
    failure: null,
    resolvedModel,
    finishReason,
    marks,
    FETCH_TO_FIRST_VISIBLE_MS: delta(
      marks.T10_PROVIDER_FETCH_START,
      marks.T13_PROVIDER_FIRST_VISIBLE_TOKEN
    ),
    FETCH_TO_HEADERS_MS: delta(
      marks.T10_PROVIDER_FETCH_START,
      marks.T11_PROVIDER_RESPONSE_HEADERS
    ),
    HEADERS_TO_FIRST_SSE_MS: delta(
      marks.T11_PROVIDER_RESPONSE_HEADERS,
      marks.T12_PROVIDER_FIRST_SSE
    ),
    FIRST_SSE_TO_VISIBLE_MS: delta(
      marks.T12_PROVIDER_FIRST_SSE,
      marks.T13_PROVIDER_FIRST_VISIBLE_TOKEN
    ),
    totalLatencyMs: Date.now() - started,
    promptTokens: usage.promptTokens,
    cachedTokens: usage.cacheReadTokens,
    reasoningTokens: usage.reasoningTokens,
    visibleOutputTokens: usage.completionTokens,
    billedCostUsd: usage.upstreamCostUsd ?? null,
    cheaperInferenceDiagnostics: ciDiag,
    visiblePreview: text.slice(0, 120),
  };
}

async function runVariant(opts: {
  label: string;
  reasoningEffort: "low" | "none" | "production";
  ciRoute: "off" | "auto";
  frozenBase: Record<string, unknown>;
  apiKey: string;
}): Promise<VariantResult> {
  const body = structuredClone(opts.frozenBase) as Record<string, unknown>;
  if (opts.reasoningEffort === "production") {
    body.reasoning_effort = "low";
  } else {
    body.reasoning_effort = opts.reasoningEffort;
  }
  delete body.thinking;
  delete body.reasoning;
  const bodySha = crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex");

  const headers = buildCheaperInferenceHeaders(opts.apiKey);
  if (opts.ciRoute === "auto") {
    headers["X-CI-Route"] = "auto";
  }

  const samples: SampleResult[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    samples.push(
      await runSample({
        frozenBody: body,
        headers,
        sampleIndex: i + 1,
      })
    );
  }
  return {
    variant: opts.label,
    reasoningEffort: typeof body.reasoning_effort === "string" ? body.reasoning_effort : null,
    ciRoute: opts.ciRoute === "auto" ? "auto" : null,
    frozenBodySha256: bodySha,
    samples,
    stats: aggregateStats(samples),
  };
}

function ownerAudit() {
  return {
    GEMINI37_MODEL_ID_OWNER: "src/lib/chatModels.ts — CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL",
    GEMINI37_PROVIDER_OWNER: "src/lib/openRouterAdult.ts — resolveCompatibleTransport(cheaperinference)",
    CHEAPER_INFERENCE_ENDPOINT_OWNER: "src/lib/cheaperInferenceConfig.ts — CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL",
    CHEAPER_INFERENCE_HEADER_OWNER: "src/lib/cheaperInferenceConfig.ts — buildCheaperInferenceHeaders",
    CHEAPER_INFERENCE_BODY_ADAPTER_OWNER: "src/lib/cheaperInferenceConfig.ts — adaptCheaperInferenceChatBody",
    GEMINI37_REASONING_OWNER:
      "src/lib/cheaperInferenceConfig.ts — applyCheaperInferenceModelReasoningPolicy (reasoning_effort=low)",
    STREAM_FETCH_OWNER: "src/lib/openRouterAdult.ts — streamOpenRouterAdult fetchOpenRouterChatWithCreditRetry",
    FIRST_HTTP_RESPONSE_OWNER: "turnPhaseLatencyAudit T11_PROVIDER_RESPONSE_HEADERS",
    FIRST_SSE_OWNER: "turnPhaseLatencyAudit T12_PROVIDER_FIRST_SSE",
    FIRST_VISIBLE_TOKEN_OWNER: "turnPhaseLatencyAudit T13_PROVIDER_FIRST_VISIBLE_TOKEN",
    FIRST_VISIBLE_SERVER_WRITE_OWNER: "turnPhaseLatencyAudit T14_SERVER_FIRST_VISIBLE_WRITE",
    TTFT_TELEMETRY_OWNER: "src/lib/turnPhaseLatencyAudit.ts (GEMINI_TTFT_PHASE_AUDIT=1)",
  };
}

function classifyRootCause(experimentA: VariantResult[], experimentB: VariantResult[]) {
  const low = experimentA.find((v) => v.variant.includes("production") || v.variant.includes("low"));
  const none = experimentA.find((v) => v.variant.includes("none"));
  const routeOff = experimentB.find((v) => v.ciRoute == null);
  const routeAuto = experimentB.find((v) => v.ciRoute === "auto");

  const median = (v?: VariantResult) => v?.stats.MEDIAN_TTFT ?? null;
  const lowMed = median(low);
  const noneMed = median(none);
  const routeOffMed = median(routeOff);
  const routeAutoMed = median(routeAuto);

  const findings: string[] = [];
  let status:
    | "ROOT_CAUSE_UNCONFIRMED"
    | "UPSTREAM_PROVIDER_BOUNDARY_LATENCY_CONFIRMED"
    | "ROOT_CAUSE_FIXED" = "ROOT_CAUSE_UNCONFIRMED";

  if (lowMed != null && noneMed != null) {
    const rel = (lowMed - noneMed) / lowMed;
    const abs = lowMed - noneMed;
    if (rel >= 0.2 || abs >= 3000) {
      findings.push(
        `Experiment A: reasoning=none median TTFT ${noneMed}ms vs low ${lowMed}ms (Δ${abs}ms, ${Math.round(rel * 1000) / 10}%). Quality gate + repeatability review required before production change.`
      );
    } else {
      findings.push(
        `Experiment A: reasoning=none did not materially beat low (median ${noneMed}ms vs ${lowMed}ms).`
      );
    }
  }

  if (routeOffMed != null && routeAutoMed != null) {
    const rel = (routeOffMed - routeAutoMed) / routeOffMed;
    const abs = routeOffMed - routeAutoMed;
    if (rel >= 0.2 || abs >= 3000) {
      findings.push(
        `Experiment B: X-CI-Route:auto median TTFT ${routeAutoMed}ms vs baseline ${routeOffMed}ms (Δ${abs}ms). Verify model identity + billing before any header change.`
      );
    } else if (routeAutoMed > routeOffMed) {
      findings.push(
        `Experiment B: X-CI-Route:auto did not improve latency (median ${routeAutoMed}ms vs ${routeOffMed}ms).`
      );
    }
  }

  const ref = low ?? routeOff;
  if (ref && ref.stats.MEDIAN_FETCH_TO_HEADERS != null && ref.stats.MEDIAN_TTFT != null) {
    const headersShare = ref.stats.MEDIAN_FETCH_TO_HEADERS / ref.stats.MEDIAN_TTFT;
    const postHeaders =
      (ref.stats.MEDIAN_HEADERS_TO_FIRST_SSE ?? 0) + (ref.stats.MEDIAN_FIRST_SSE_TO_VISIBLE ?? 0);
    if (headersShare >= 0.7 && ref.stats.MEDIAN_TTFT >= 10000 && postHeaders < 2000) {
      status = "UPSTREAM_PROVIDER_BOUNDARY_LATENCY_CONFIRMED";
      findings.unshift(
        `Production reasoning=low: T10→T11 ≈${Math.round(headersShare * 1000) / 10}% of provider-visible TTFT (median ${ref.stats.MEDIAN_TTFT}ms); post-header phases ≈${postHeaders}ms.`
      );
    }
  }

  if (!findings.length) {
    findings.push("Insufficient paired data for classification.");
  }

  return { status, note: findings.join(" ") };
}

async function main() {
  const apiKey = resolveCheaperInferenceApiKey();
  const { fixture, assembled } = buildFrozenRequest();
  const productionBody = assembled.requestBody as Record<string, unknown>;
  const headerNames = Object.keys(buildCheaperInferenceHeaders(apiKey));
  const snapshot = redactedOutboundSnapshot(productionBody, headerNames);

  const experimentA: VariantResult[] = [];
  const experimentB: VariantResult[] = [];

  if (EXPERIMENTS.includes("A")) {
    experimentA.push(
      await runVariant({
        label: "A_production_low",
        reasoningEffort: "production",
        ciRoute: "off",
        frozenBase: productionBody,
        apiKey,
      })
    );
    experimentA.push(
      await runVariant({
        label: "A_reasoning_none",
        reasoningEffort: "none",
        ciRoute: "off",
        frozenBase: productionBody,
        apiKey,
      })
    );
  }

  if (EXPERIMENTS.includes("B")) {
    experimentB.push(
      await runVariant({
        label: "B_baseline_headers",
        reasoningEffort: "production",
        ciRoute: "off",
        frozenBase: productionBody,
        apiKey,
      })
    );
    experimentB.push(
      await runVariant({
        label: "B_ci_route_auto",
        reasoningEffort: "production",
        ciRoute: "auto",
        frozenBase: productionBody,
        apiKey,
      })
    );
  }

  if (experimentA[0]?.samples[0]) {
    snapshot.providerPromptTokenCount = experimentA[0].samples[0].promptTokens;
    snapshot.cachedTokenCount = experimentA[0].samples[0].cachedTokens;
  }

  const { status, note } = classifyRootCause(experimentA, experimentB);

  const report = {
    generatedAt: new Date().toISOString(),
    classification: status,
    classificationNote: note,
    invariants: {
      CHEAPER_INFERENCE_ROUTE_REQUIRED: true,
      endpoint: CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
      model: MODEL,
      DO_NOT_MERGE: true,
      DO_NOT_DEPLOY: true,
    },
    ownerAudit: ownerAudit(),
    fixture: fixture.label,
    samplesPerArm: SAMPLES,
    redactedOutboundSnapshot: snapshot,
    experimentA,
    experimentB,
    experimentBRouteSemantics: {
      X_CI_Route_auto_documentation:
        "CheaperInference docs: opts into model routing for eligible prompts; may substitute provider route — exact gemini-3.7-flash identity must be verified per response model + billing.",
      productionCandidateRequires: {
        MODEL_IDENTITY_PRESERVED: "response.model === gemini-3.7-flash",
        CHEAPER_INFERENCE_PROVIDER_PRESERVED: true,
        BILLING_POLICY_PRESERVED: true,
        TTFT_REPEATABLE_IMPROVEMENT: ">=20% median or >=3s absolute",
      },
    },
    summaryTable: [...experimentA, ...experimentB].map((v) => ({
      VARIANT: v.variant,
      SAMPLES: v.stats.samples,
      MEDIAN_TTFT: v.stats.MEDIAN_TTFT,
      P25: v.stats.P25_TTFT,
      P75: v.stats.P75_TTFT,
      MIN: v.stats.MIN_TTFT,
      MAX: v.stats.MAX_TTFT,
      MEDIAN_FETCH_TO_HEADERS: v.stats.MEDIAN_FETCH_TO_HEADERS,
      MEDIAN_HEADERS_TO_FIRST_SSE: v.stats.MEDIAN_HEADERS_TO_FIRST_SSE,
      PROMPT_TOKENS: v.stats.MEDIAN_PROMPT_TOKENS,
      CACHED_TOKENS: v.stats.MEDIAN_CACHED_TOKENS,
      REASONING_TOKENS: v.stats.MEDIAN_REASONING_TOKENS,
      VISIBLE_OUTPUT_TOKENS: v.stats.MEDIAN_VISIBLE_OUTPUT_TOKENS,
      BILLED_COST: v.stats.MEDIAN_BILLED_COST,
      FAILURES: v.stats.failures,
      slowest_ci_request_id: v.stats.slowestRequestId,
      fastest_ci_request_id: v.stats.fastestRequestId,
    })),
  };

  const reportMd = `# Gemini 3.7 Flash TTFT investigation

**Classification:** \`${status}\`

${note}

## Redacted outbound snapshot (production assembler)

\`\`\`json
${JSON.stringify(snapshot, null, 2)}
\`\`\`

## Summary table

| VARIANT | SAMPLES | MEDIAN_TTFT | P25 | P75 | MIN | MAX | MEDIAN_FETCH_TO_HEADERS | MEDIAN_HEADERS_TO_FIRST_SSE | PROMPT | CACHED | REASONING | OUT | COST | FAIL |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${report.summaryTable
  .map(
    (r) =>
      `| ${r.VARIANT} | ${r.SAMPLES} | ${r.MEDIAN_TTFT ?? "n/a"} | ${r.P25 ?? "n/a"} | ${r.P75 ?? "n/a"} | ${r.MIN ?? "n/a"} | ${r.MAX ?? "n/a"} | ${r.MEDIAN_FETCH_TO_HEADERS ?? "n/a"} | ${r.MEDIAN_HEADERS_TO_FIRST_SSE ?? "n/a"} | ${r.PROMPT_TOKENS ?? "n/a"} | ${r.CACHED_TOKENS ?? "n/a"} | ${r.REASONING_TOKENS ?? "n/a"} | ${r.VISIBLE_OUTPUT_TOKENS ?? "n/a"} | ${r.BILLED_COST ?? "n/a"} | ${r.FAILURES} |`
  )
  .join("\n")}

## Owner audit

\`\`\`json
${JSON.stringify(ownerAudit(), null, 2)}
\`\`\`

**DO NOT MERGE. DO NOT DEPLOY.** Investigation branch only.
`;

  save(`RUNTIME-${fixture.label}.json`, report);
  save(`REPORT-${fixture.label}.md`, reportMd);
  save("RUNTIME.json", report);
  save("REPORT.md", reportMd);

  console.log(JSON.stringify({ classification: status, summaryTable: report.summaryTable }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
