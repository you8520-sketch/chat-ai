/**
 * Gemini 3.7 Flash live implicit-cache discriminator (T1→T2).
 * Production assembly: buildContext → assemblePrimaryRpRequest → adaptCheaperInferenceChatBody
 * Max 2 provider generation calls · no runtime source changes.
 *
 *   node --conditions=react-server --import tsx scripts/gemini37-live-cache-discriminator.ts
 */
import Module from "module";
import fs from "node:fs";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { execSync } from "node:child_process";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import { buildContext } from "../src/services/contextBuilder";
import { assemblePrimaryRpRequest } from "../src/lib/openRouterAdult";
import {
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  adaptCheaperInferenceChatBody,
  buildCheaperInferenceHeaders,
} from "../src/lib/cheaperInferenceConfig";
import { CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL } from "../src/lib/chatModels";
import { DEFAULT_TARGET_RESPONSE_CHARS } from "../src/lib/responseLengthConstants";
import { estimateTokens } from "../src/lib/tokenEstimate";
import { parseOpenRouterUsage } from "../src/lib/openRouterUsage";
import { flattenOpenRouterMessageContent } from "../src/lib/openRouterClient";
import type { ChatMsg } from "../src/lib/ai";

const MODEL = CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL;
const OUT_DIR = path.join(
  process.cwd(),
  "docs/audits/main-rp-cache-health-2026-09-19"
);
const THRESHOLD = 4096;
const MAX_TOKENS = 16;
const WARM_WAIT_MS = 50_000;
const T1_COST_CEILING_USD = 0.01;
const CUMULATIVE_COST_CEILING_USD = 0.02;
const MAIN_SHA_EXPECTED = "15bb412e7e8b844f4c0900fa6214b86b721d5457";

const USER_T1 = "나는 렌이라고… 본 기억이 안 나는데… 나 알아?";
const USER_T2 = "같이 갈래? *두리번*";

const JO_TAEHYUNG_CARD = `너는 조태형이다. 에이지스 본부 S급 특수계 음압 센티넬. 고위험 폭주형.
북극곰 귀 흰 후드티, 유광 블랙 재킷, 녹색 눈, 검은 네일, 은반지, 여자 향수.
목에 전자 초커. 낙천적이고 능청스러우며 사람을 옭아매는 관찰력이 있다.
렌 곁에서는 이명이 가라앉는다.`;

function resolveRuntimeSha(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function longestCommonPrefix(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i += 1;
  return i;
}

function wireMessagesText(messages: { role: string; content: unknown }[]): string {
  return messages
    .map((m) => {
      const body =
        typeof m.content === "string"
          ? m.content
          : flattenOpenRouterMessageContent(
              m.content as Parameters<typeof flattenOpenRouterMessageContent>[0]
            );
      return `[${m.role}]\n${body}`;
    })
    .join("\n---\n");
}

function buildProductionBody(history: ChatMsg[], currentUserMessage: string) {
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
    shortTermHistory: history,
    currentUserMessage,
    nsfw: false,
    gender: "male",
    provider: "cheaperinference",
    modelId: MODEL,
    targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
    completedTurns: history.filter((m) => m.role === "assistant").length,
    narrativePov: { mode: "third_person", povCharacterName: "조태형" },
    geminiStaticDynamicMode: false,
  });

  const assembled = assemblePrimaryRpRequest({
    system: built.systemPrompt ?? "",
    history: built.history,
    modelId: MODEL,
    targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
    stream: false,
    messageOpts: {
      transportProvider: "cheaperinference",
      systemSplit: built.openRouterSystemSplit,
      charName: "조태형",
    },
  });

  const body = adaptCheaperInferenceChatBody(
    assembled.requestBody as Record<string, unknown>
  ) as Record<string, unknown>;
  body.stream = false;
  body.max_tokens = MAX_TOKENS;
  return body;
}

function injectAuditMarker(body: Record<string, unknown>, marker: string): Record<string, unknown> {
  const next = structuredClone(body) as Record<string, unknown>;
  const messages = (Array.isArray(next.messages) ? next.messages : []) as {
    role: string;
    content: unknown;
  }[];
  const sysIdx = messages.findIndex((m) => m.role === "system");
  if (sysIdx < 0) throw new Error("NO_SYSTEM_MESSAGE");
  const sys = messages[sysIdx]!;
  const prior =
    typeof sys.content === "string"
      ? sys.content
      : flattenOpenRouterMessageContent(
          sys.content as Parameters<typeof flattenOpenRouterMessageContent>[0]
        );
  messages[sysIdx] = { ...sys, content: `${marker}\n\n${prior}` };
  next.messages = messages;
  return next;
}

function extractAssistantText(json: Record<string, unknown>): string {
  const choices = json.choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return "";
  const content = (choices[0] as { message?: { content?: unknown } }).message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        typeof block === "string"
          ? block
          : block && typeof block === "object" && "text" in block
            ? String((block as { text?: string }).text ?? "")
            : ""
      )
      .join("");
  }
  return "";
}

type UsageRow = {
  request_id: string;
  created_at: string;
  model: string;
  status: string;
  prompt_tokens: number;
  completion_tokens: number;
  cache_read_input_tokens: number;
  cache_write_input_tokens: number;
  standard_input_tokens: number;
  billed_cost_usd: number;
  provider_attempt_count: number;
  cache_reporting_state: string | null;
  routing_overhead_ms: number | null;
  time_to_response_headers_ms: number | null;
};

async function fetchUsageRow(opts: {
  key: string;
  afterIso: string;
  model: string;
  promptTokensHint?: number;
  retries?: number;
}): Promise<UsageRow | null> {
  const retries = opts.retries ?? 8;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const endAt = new Date().toISOString().slice(0, 19).replace("T", " ");
    const params = new URLSearchParams({
      start_at: opts.afterIso.slice(0, 19).replace("T", " "),
      end_at: endAt,
      limit: "20",
    });
    const res = await fetch(
      `https://api.cheaperinference.com/v1/usage/requests?${params.toString()}`,
      {
        headers: { Authorization: `Bearer ${opts.key}`, Accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      }
    );
    if (!res.ok) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    const json = (await res.json()) as { data?: Record<string, unknown>[] };
    const rows = (json.data ?? [])
      .filter((r) => String(r.model ?? "") === opts.model)
      .map((r) => {
        const prompt = Number(r.prompt_tokens ?? 0);
        const cacheRead = Number(r.cache_read_input_tokens ?? 0);
        const cacheWrite = Number(r.cache_write_input_tokens ?? 0);
        return {
          request_id: String(r.request_id ?? ""),
          created_at: String(r.created_at ?? ""),
          model: String(r.model ?? ""),
          status: String(r.status ?? ""),
          prompt_tokens: prompt,
          completion_tokens: Number(r.completion_tokens ?? 0),
          cache_read_input_tokens: cacheRead,
          cache_write_input_tokens: cacheWrite,
          standard_input_tokens: Math.max(0, prompt - cacheRead - cacheWrite),
          billed_cost_usd: Number(r.billed_cost_usd ?? 0),
          provider_attempt_count: Number(r.provider_attempt_count ?? 1),
          cache_reporting_state:
            r.cache_reporting_state != null ? String(r.cache_reporting_state) : null,
          routing_overhead_ms:
            r.routing_overhead_ms != null ? Number(r.routing_overhead_ms) : null,
          time_to_response_headers_ms:
            r.time_to_response_headers_ms != null
              ? Number(r.time_to_response_headers_ms)
              : null,
        } satisfies UsageRow;
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at));

    const match =
      opts.promptTokensHint != null
        ? rows.find((r) => Math.abs(r.prompt_tokens - opts.promptTokensHint!) <= 64)
        : rows[0];
    if (match?.request_id) return match;
    await new Promise((r) => setTimeout(r, 2500));
  }
  return null;
}

async function callOnce(body: Record<string, unknown>, key: string) {
  const startedAt = new Date();
  const t0 = Date.now();
  const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: buildCheaperInferenceHeaders(key),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  const headersMs = Date.now() - t0;
  const rawText = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    json = { parseError: rawText.slice(0, 400) };
  }
  const usage = parseOpenRouterUsage(json.usage, res.headers);
  const billed =
    usage.cheaperInferenceBilledCostUsd ?? usage.upstreamCostUsd ?? 0;
  return {
    startedAt: startedAt.toISOString(),
    httpStatus: res.status,
    responseId: typeof json.id === "string" ? json.id : null,
    headersMs,
    usage,
    billedCostUsd: billed,
    resolvedModel: typeof json.model === "string" ? json.model : null,
    assistantText: extractAssistantText(json),
    reasoningEffort: body.reasoning_effort ?? null,
    maxTokens: body.max_tokens ?? null,
    partitionOk:
      usage.promptTokens ===
      usage.standardInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens,
  };
}

function classifyResult(opts: {
  t1Executed: boolean;
  t2Executed: boolean;
  t1ProviderAttempts: number | null;
  t2ProviderAttempts: number | null;
  t2CacheRead: number;
  t2StablePrefixTokens: number;
}): {
  caseId: "A" | "B" | "C" | "D" | "STOP";
  g37LiveDiscriminator: string;
  g37ImplicitCache: string;
  appPrefixLayout: string;
  ciOrGoogleSemantics: string;
} {
  if (!opts.t1Executed) {
    return {
      caseId: "STOP",
      g37LiveDiscriminator: "NOT_RUN",
      g37ImplicitCache: "NOT_RUN",
      appPrefixLayout: "ELIGIBLE_OFFLINE",
      ciOrGoogleSemantics: "NOT_RUN",
    };
  }
  if (opts.t1ProviderAttempts != null && opts.t1ProviderAttempts !== 1) {
    return {
      caseId: "C",
      g37LiveDiscriminator: "CONFOUNDED_BY_PROVIDER_ROUTING",
      g37ImplicitCache: "INCONCLUSIVE",
      appPrefixLayout: "STILL_ELIGIBLE_OFFLINE",
      ciOrGoogleSemantics: "CI_ROUTING_CHURN_CONFIRMED_FOR_TEST_REQUEST",
    };
  }
  if (!opts.t2Executed) {
    return {
      caseId: "STOP",
      g37LiveDiscriminator: "T1_ONLY",
      g37ImplicitCache: "INCONCLUSIVE",
      appPrefixLayout: "ELIGIBLE_OFFLINE",
      ciOrGoogleSemantics: "NOT_RUN",
    };
  }
  if (opts.t2ProviderAttempts != null && opts.t2ProviderAttempts !== 1) {
    return {
      caseId: "D",
      g37LiveDiscriminator: "T2_CONFOUNDED_BY_PROVIDER_ROUTING",
      g37ImplicitCache: "INCONCLUSIVE",
      appPrefixLayout: "STILL_CONFIRMED",
      ciOrGoogleSemantics: "INCONCLUSIVE",
    };
  }
  if (opts.t2CacheRead >= THRESHOLD) {
    return {
      caseId: "A",
      g37LiveDiscriminator: "CLEAN_TWO_CALL",
      g37ImplicitCache: "CONFIRMED",
      appPrefixLayout: "CONTRADICTED",
      ciOrGoogleSemantics: "ROUTING_OR_PROVIDER_VARIABILITY_SUPPORTED_UNCONFIRMED",
    };
  }
  return {
    caseId: "B",
    g37LiveDiscriminator: "CLEAN_TWO_CALL",
    g37ImplicitCache: "ELIGIBLE_PREFIX_BUT_NO_IMPLICIT_HIT",
    appPrefixLayout: "CONTRADICTED",
    ciOrGoogleSemantics: "PRIMARY_UNCONFIRMED_OWNER",
  };
}

async function main() {
  const key = process.env.CHEAPER_INFERENCE_API_KEY?.trim();
  if (!key) {
    console.error(JSON.stringify({ stop: "NO_CHEAPER_INFERENCE_KEY" }));
    process.exit(1);
  }

  const originMain = execSync("git rev-parse origin/main", { encoding: "utf8" }).trim();
  if (originMain !== MAIN_SHA_EXPECTED) {
    console.error(
      JSON.stringify({ stop: "STOP_MAIN_MOVED", expected: MAIN_SHA_EXPECTED, actual: originMain })
    );
    process.exit(2);
  }

  const auditId = randomBytes(8).toString("hex");
  const marker = `[CACHE AUDIT FIXTURE — inert metadata: g37-live-disc-2026-09-19-${auditId}]`;
  const markerSha = createHash("sha256").update(marker).digest("hex");

  const t1Base = buildProductionBody([], USER_T1);
  const t2Base = buildProductionBody(
    [{ role: "user", content: USER_T1 }, { role: "assistant", content: "<<ASSISTANT_PLACEHOLDER>>" }],
    USER_T2
  );

  const t1Body = injectAuditMarker(t1Base, marker);
  let t2Body = injectAuditMarker(t2Base, marker);

  const t1Messages = (t1Body.messages ?? []) as { role: string; content: unknown }[];
  const t2MessagesPre = (t2Body.messages ?? []) as { role: string; content: unknown }[];
  const t1Wire = wireMessagesText(t1Messages);
  const t2WirePre = wireMessagesText(t2MessagesPre);
  const prefixChars = longestCommonPrefix(t1Wire, t2WirePre);
  const prefixTokens = estimateTokens(t1Wire.slice(0, prefixChars));

  const preflight = {
    auditMarker: marker,
    auditMarkerSha256: markerSha,
    t1T2CommonPrefixChars: prefixChars,
    t1T2CommonPrefixTokens: prefixTokens,
    meets4096: prefixTokens >= THRESHOLD,
    model: MODEL,
    geminiStaticDynamicMode: false,
    maxTokens: MAX_TOKENS,
    reasoningEffort: t1Body.reasoning_effort ?? null,
    runtimeSha: resolveRuntimeSha(),
    sourceMainSha: MAIN_SHA_EXPECTED,
  };

  console.log(JSON.stringify({ phase: "preflight", ...preflight }));

  if (prefixTokens < THRESHOLD) {
    const out = {
      generatedAt: new Date().toISOString(),
      stop: "STOP_PREFIX_NOT_ELIGIBLE",
      preflight,
      clientGenerationRequests: 0,
    };
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(OUT_DIR, "g37-live-cache-discriminator.json"),
      `${JSON.stringify(out, null, 2)}\n`
    );
    process.exit(3);
  }

  const usageQueryStart = new Date(Date.now() - 60_000).toISOString();

  const t1 = await callOnce(t1Body, key);
  console.log(JSON.stringify({ phase: "T1", httpStatus: t1.httpStatus, billed: t1.billedCostUsd }));

  if (t1.httpStatus !== 200 || !t1.resolvedModel?.includes("gemini")) {
    const out = {
      generatedAt: new Date().toISOString(),
      stop: "T1_REQUEST_FAILED",
      preflight,
      t1: sanitizeTurn(t1),
      clientGenerationRequests: 1,
    };
    writeOut(out);
    process.exit(4);
  }

  if (t1.billedCostUsd > T1_COST_CEILING_USD) {
    const out = {
      generatedAt: new Date().toISOString(),
      stop: "T1_COST_CEILING",
      preflight,
      t1: sanitizeTurn(t1),
      clientGenerationRequests: 1,
    };
    writeOut(out);
    process.exit(5);
  }

  if (!t1.partitionOk) {
    const out = {
      generatedAt: new Date().toISOString(),
      stop: "T1_CACHE_TOKEN_ACCOUNTING_MALFORMED",
      preflight,
      t1: sanitizeTurn(t1),
      clientGenerationRequests: 1,
    };
    writeOut(out);
    process.exit(6);
  }

  const t1UsageRow = await fetchUsageRow({
    key,
    afterIso: usageQueryStart,
    model: MODEL,
    promptTokensHint: t1.usage.promptTokens,
  });

  const t1Gate = evaluateT1Gate(t1, t1UsageRow);
  console.log(JSON.stringify({ phase: "T1_GATE", ...t1Gate }));

  let t2: ReturnType<typeof callOnce> extends Promise<infer R> ? R : never | null = null;
  let t2UsageRow: UsageRow | null = null;
  let t2Wire = "";
  let t2PrefixTokens = 0;

  if (t1Gate.pass) {
    const assistant = t1.assistantText.trim() || `[audit-assistant-t1-${auditId}]`;
    const history: ChatMsg[] = [
      { role: "user", content: USER_T1 },
      { role: "assistant", content: assistant },
    ];
    t2Body = injectAuditMarker(buildProductionBody(history, USER_T2), marker);
    t2Wire = wireMessagesText((t2Body.messages ?? []) as { role: string; content: unknown }[]);
    t2PrefixTokens = estimateTokens(t1Wire.slice(0, longestCommonPrefix(t1Wire, t2Wire)));

    console.log(JSON.stringify({ phase: "WARM_WAIT_MS", ms: WARM_WAIT_MS }));
    await new Promise((r) => setTimeout(r, WARM_WAIT_MS));

    t2 = await callOnce(t2Body, key);
    console.log(JSON.stringify({ phase: "T2", httpStatus: t2.httpStatus, billed: t2.billedCostUsd }));

    t2UsageRow = await fetchUsageRow({
      key,
      afterIso: t1.startedAt,
      model: MODEL,
      promptTokensHint: t2.usage.promptTokens,
    });
  }

  const cumulativeCost = t1.billedCostUsd + (t2?.billedCostUsd ?? 0);
  const classification = classifyResult({
    t1Executed: true,
    t2Executed: t2 != null,
    t1ProviderAttempts: t1UsageRow?.provider_attempt_count ?? null,
    t2ProviderAttempts: t2UsageRow?.provider_attempt_count ?? null,
    t2CacheRead: t2?.usage.cacheReadTokens ?? 0,
    t2StablePrefixTokens: t2PrefixTokens,
  });

  const out = {
    generatedAt: new Date().toISOString(),
    audit: "g37-live-cache-discriminator",
    sourceMainSha: MAIN_SHA_EXPECTED,
    runtimeSha: resolveRuntimeSha(),
    preflight,
    warmWaitMs: t1Gate.pass ? WARM_WAIT_MS : null,
    t1: {
      ...sanitizeTurn(t1),
      usageApiRow: t1UsageRow,
      hardGate: t1Gate,
    },
    t2: t2
      ? {
          ...sanitizeTurn(t2),
          usageApiRow: t2UsageRow,
          t1T2ActualCommonPrefixTokens: t2PrefixTokens,
        }
      : null,
    cost: {
      t1Usd: t1.billedCostUsd,
      t2Usd: t2?.billedCostUsd ?? 0,
      cumulativeUsd: cumulativeCost,
      withinCeiling: cumulativeCost <= CUMULATIVE_COST_CEILING_USD,
    },
    classification,
    finalLabels: {
      G37_CURRENT_PREFIX_CACHE_ELIGIBILITY: "ELIGIBLE",
      G37_LIVE_CACHE_DISCRIMINATOR: classification.g37LiveDiscriminator,
      G37_CURRENT_IMPLICIT_CACHE_FUNCTIONALITY: classification.g37ImplicitCache,
      APP_PREFIX_LAYOUT_ROOT_CAUSE: classification.appPrefixLayout,
      CI_OR_GOOGLE_IMPLICIT_CACHE_SEMANTICS: classification.ciOrGoogleSemantics,
      CLIENT_GENERATION_REQUESTS: t2 ? 2 : 1,
      RUNTIME_CHANGE: 0,
      MERGE: "NO",
    },
  };

  writeOut(out);
  console.log(JSON.stringify({ phase: "done", classification: classification.caseId, out: out.finalLabels }));
}

function sanitizeTurn(turn: {
  startedAt: string;
  httpStatus: number;
  responseId: string | null;
  headersMs: number;
  usage: ReturnType<typeof parseOpenRouterUsage>;
  billedCostUsd: number;
  resolvedModel: string | null;
  assistantText: string;
  reasoningEffort: unknown;
  maxTokens: unknown;
  partitionOk: boolean;
}) {
  return {
    timestamp: turn.startedAt,
    responseId: turn.responseId,
    httpStatus: turn.httpStatus,
    resolvedModel: turn.resolvedModel,
    promptTokens: turn.usage.promptTokens,
    standardInputTokens: turn.usage.standardInputTokens,
    cacheReadInputTokens: turn.usage.cacheReadTokens,
    cacheWriteInputTokens: turn.usage.cacheWriteTokens,
    completionTokens: turn.usage.completionTokens,
    reasoningTokens: turn.usage.reasoningTokens,
    billedCostUsd: turn.billedCostUsd,
    cacheReportingEvidence: turn.usage.reportingEvidence,
    timeToResponseHeadersMs: turn.headersMs,
    reasoningEffort: turn.reasoningEffort,
    maxTokens: turn.maxTokens,
    partitionOk: turn.partitionOk,
    assistantChars: turn.assistantText.length,
  };
}

function evaluateT1Gate(
  t1: { httpStatus: number; resolvedModel: string | null; billedCostUsd: number; partitionOk: boolean },
  row: UsageRow | null
) {
  const reasons: string[] = [];
  if (t1.httpStatus !== 200) reasons.push("http_not_200");
  if (!t1.resolvedModel?.includes("gemini")) reasons.push("model_mismatch");
  if (!t1.partitionOk) reasons.push("cache_token_accounting_malformed");
  if (t1.billedCostUsd > T1_COST_CEILING_USD) reasons.push("t1_cost_ceiling");
  if (!row) reasons.push("usage_attribution_unavailable");
  else {
    if (row.provider_attempt_count !== 1) reasons.push("provider_attempt_count_not_1");
    if (row.model !== MODEL) reasons.push("usage_model_mismatch");
  }
  return {
    pass: reasons.length === 0,
    classification: reasons.includes("provider_attempt_count_not_1")
      ? "STOP_INTERNAL_PROVIDER_ATTEMPT_CONFOUND"
      : reasons.length
        ? "STOP_T1_GATE"
        : "PASS",
    reasons,
    providerAttemptCount: row?.provider_attempt_count ?? null,
  };
}

function writeOut(obj: unknown) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, "g37-live-cache-discriminator.json"),
    `${JSON.stringify(obj, null, 2)}\n`
  );
}

main().catch((err) => {
  console.error(JSON.stringify({ fatal: String(err) }));
  process.exit(99);
});
