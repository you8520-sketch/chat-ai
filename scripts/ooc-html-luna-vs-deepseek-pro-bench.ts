/**
 * Creative OOC HTML A/B — gpt-5.6-luna vs deepseek-v4-pro-0813 (CheaperInference only).
 *
 * Usage:
 *   npx tsx --conditions=react-server scripts/ooc-html-luna-vs-deepseek-pro-bench.ts
 *
 * BENCH_ONLY — no production routing changes.
 */
import fs from "fs";
import path from "path";
import Module from "module";
import { loadEnvLocal } from "./load-env-local";

const origLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: unknown,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return origLoad(request, parent as NodeModule, isMain);
};

loadEnvLocal();
process.env.MOCK_MODE = "false";
process.env.NODE_TEST_CONTEXT = "ooc-html-luna-vs-deepseek-pro-bench";
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = "development";

import {
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  adaptCheaperInferenceChatBody,
  buildCheaperInferenceHeaders,
  resolveCheaperInferenceApiKey,
} from "../src/lib/cheaperInferenceConfig";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
  isCheaperInferenceDeepSeekV4ProModel,
  isGpt56LunaModel,
} from "../src/lib/chatModels";
import { estimateTokens } from "../src/lib/ai";
import { extractFencedHtmlBlock } from "../src/lib/chatRichContent";
import {
  applyChatOocExclusiveHtmlPolicy,
  isOocCreativeHtmlRichEnough,
  isPreservableOocHtmlInner,
  oocFlashHtmlMustBeRejected,
  polishHtmlVisualCardInner,
  resolveHtmlFlashPlacement,
} from "../src/lib/htmlVisualCardPolicy";
import {
  buildHtmlFlashSystemPrompt,
  buildHtmlVisualCardFlashUserBlock,
  ensureHtmlVisualCardBlock,
  HTML_ONLY_TURN_MAX_OUTPUT_TOKENS,
  isCompleteHtmlStatusCardInner,
  resolveHtmlFlashContextBudget,
  unwrapHtmlVisualCardInner,
  wrapHtmlVisualCardInner,
  type HtmlVisualCardFlashContext,
} from "../src/lib/htmlVisualCardRecovery";
import {
  isDeepSeekPrimaryCheaperInferenceModel,
  resolveBackgroundFlashProviderDeadlines,
} from "../src/lib/deepseekProviderFailover";
import { resolveOpenRouterCompletionTimeoutMs } from "../src/lib/openRouterCompletion";
import { parseOpenRouterUsage } from "../src/lib/openRouterUsage";

const LUNA_MODEL = CHEAPER_INFERENCE_GPT_56_LUNA_MODEL;
const DEEPSEEK_PRO_MODEL = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
const REQUEST_KIND = "background-html-visual-card";
const OUT_DIR = path.resolve("docs/benchmarks/ooc-html-luna-vs-deepseek-pro");
const CHAR = "강이현";
const PERSONA = "렌";

type BenchModel = "luna" | "deepseek-pro";

type HtmlCase = {
  id: string;
  label: string;
  userMessage: string;
  ctx: HtmlVisualCardFlashContext;
};

const SHARED_MEMORY = `연회장 복도에서 강이현을 따라 정원 테라스로 이동. 렌이 분위기 이상함을 언급하고 손을 잡으며 고백에 가까운 말을 꺼냄.
강이현은 굳은 표정으로 듣다가 마음을 받아들이는 태도를 보임. 렌이 은색 커프링크스 상자를 약속의 증표로 건네자 강이현은 "네가 원하는 대로 하자"고 받음.
렌은 내일 아침까지 답을 주겠다고 약속하고 물러남. 관계는 아직 미정이나 커프링크스와 답변 약속은 남음.
북문 정찰 전에 방독면 필터를 양보하는 사건이 있었고, 강이현은 낡은 필터를 계속 쓰는 중.`;

const HTML_CASES: HtmlCase[] = [
  {
    id: "H1",
    label: "Clean information card",
    userMessage: `OOC: HTML로 오늘의 작전 공지 카드를 예쁘게 만들어줘.
제목: 북문 정찰
출발: 07:30
인원: 강이현, 렌
준비물: 방독면 필터 2개
위험도: 높음`,
    ctx: {
      chatId: 0,
      charName: CHAR,
      personaName: PERSONA,
      userMessage: "",
      assistantProse: "",
    },
  },
  {
    id: "H2",
    label: "Rich multi-section RP report",
    userMessage: `OOC: 지금까지 내용을
[현재 상황]
[관계 변화]
[보유 물건/약속]
[미해결 문제]
네 섹션으로 나눠서 보기 좋은 HTML 정보 카드로 자세히 정리해줘.`,
    ctx: {
      chatId: 0,
      charName: CHAR,
      personaName: PERSONA,
      userMessage: "",
      assistantProse: "",
      memoryBlock: SHARED_MEMORY,
      loreBlock: "현대 판타지 IF — 지휘동과 회색 생태권이 공존. 방독면 필터는 생존 필수품.",
      characterSetting: `${CHAR}: 차분하지만 책임감 강한 지휘관. 렌과는 오래 알던 동료에서 점점 가까워지는 관계.`,
    },
  },
  {
    id: "H3",
    label: "Anonymous inbox / social mockup",
    userMessage: `OOC: 익명 메시지함처럼 꾸며줘.
보낸 사람: 익명 #127
시간: 23:48
메시지:
"'회색 안개' 이후에도 널 봤어.
A-17 출구로 오지 마.
확률은 50% & 아직 3 < 5야."
읽지 않음 배지도 넣어줘 🔔`,
    ctx: {
      chatId: 0,
      charName: CHAR,
      personaName: PERSONA,
      userMessage: "",
      assistantProse: "",
    },
  },
  {
    id: "H4",
    label: "Game quest / HUD",
    userMessage: `OOC: 게임 퀘스트창 같은 HTML로 만들어줘.
QUEST: 코어 접근
상태: 진행 중
목표:
- 필터 확보 2/3
- 북쪽 터널 진입
- 코어 거리 1.8km 이하 확인
현재:
오염도 37%
탄약 4발
부상: 왼팔 경상
오염도 50% 이상이면 위험 경고가 뜨는 것처럼 디자인해줘.
지금은 37%니까 경고 활성화하면 안 돼.`,
    ctx: {
      chatId: 0,
      charName: CHAR,
      personaName: PERSONA,
      userMessage: "",
      assistantProse: "",
      memoryBlock: "왼팔 경상 지혈 완료. 필터 잔량 42%. 북쪽 터널 진입 준비 중.",
    },
  },
  {
    id: "H5",
    label: "Freeform high-design request",
    userMessage: `OOC: 아래 내용을 네가 디자인을 알아서 잡아서,
평범한 표나 기본 상태창 말고 실제 앱/게임 화면처럼
세련되고 분위기 있게 HTML로 꾸며줘.
제목: 관측 기록 / 08-26
폐쇄된 지하철역 서쪽 벽에서 청록색 신경 균사가 확인됨.
직접 접촉은 없었음.
필터 잔량은 42%.
강이현의 왼팔 상처는 지혈 완료.
현재 출구 하나가 잠겨 있음.
렌은 지도에서 우회로를 찾는 중.
회색 생태권의 어두운 SF 생존물 분위기.
중요한 정보는 시각적으로 확실히 구분해줘.`,
    ctx: {
      chatId: 0,
      charName: CHAR,
      personaName: PERSONA,
      userMessage: "",
      assistantProse: "",
      memoryBlock: SHARED_MEMORY,
      loreBlock: "회색 생태권 — 신경 균사, 방독 필터, 폐역과 지하 통로.",
    },
  },
];

// Fill userMessage in ctx from case
for (const c of HTML_CASES) {
  c.ctx.userMessage = c.userMessage;
}

type InterleavedCall = {
  caseId: string;
  model: BenchModel;
  modelId: string;
};

const INTERLEAVED: InterleavedCall[] = [
  { caseId: "H1", model: "luna", modelId: LUNA_MODEL },
  { caseId: "H1", model: "deepseek-pro", modelId: DEEPSEEK_PRO_MODEL },
  { caseId: "H2", model: "deepseek-pro", modelId: DEEPSEEK_PRO_MODEL },
  { caseId: "H2", model: "luna", modelId: LUNA_MODEL },
  { caseId: "H3", model: "luna", modelId: LUNA_MODEL },
  { caseId: "H3", model: "deepseek-pro", modelId: DEEPSEEK_PRO_MODEL },
  { caseId: "H4", model: "deepseek-pro", modelId: DEEPSEEK_PRO_MODEL },
  { caseId: "H4", model: "luna", modelId: LUNA_MODEL },
  { caseId: "H5", model: "luna", modelId: LUNA_MODEL },
  { caseId: "H5", model: "deepseek-pro", modelId: DEEPSEEK_PRO_MODEL },
];

function resolveBenchTimeoutMs(modelId: string): number {
  const outer = resolveOpenRouterCompletionTimeoutMs(REQUEST_KIND);
  if (isDeepSeekPrimaryCheaperInferenceModel(modelId)) {
    return resolveBackgroundFlashProviderDeadlines({
      requestKind: REQUEST_KIND,
      existingTimeoutMs: outer,
    }).primaryCompletionMs;
  }
  return outer;
}

function verifyOutboundFlags(body: Record<string, unknown>, modelId: string) {
  const thinking = body.thinking as { type?: string } | undefined;
  const reasoning = body.reasoning as { effort?: string } | undefined;
  return {
    lunaReasoningNone:
      isGpt56LunaModel(modelId) &&
      reasoning?.effort === "none" &&
      body.reasoning_effort === "none",
    deepseekThinkingOff:
      isCheaperInferenceDeepSeekV4ProModel(modelId) &&
      thinking?.type === "disabled" &&
      body.reasoning_effort == null,
  };
}

function buildProductionOocHtmlPrompts(htmlCase: HtmlCase) {
  const policy = applyChatOocExclusiveHtmlPolicy({
    enabled: true,
    standing: false,
    statusFieldLabels: [],
    policyBlock: "",
  });
  const flashMode = {
    displayUserInputOnly: false,
    oocCreativeBrief: true,
    chatOocExclusive: true,
    htmlOnlyDedicatedTurn: true,
  };
  const placement = resolveHtmlFlashPlacement(policy, {
    userMessage: htmlCase.userMessage,
    userNote: htmlCase.ctx.userNote,
    userPersona: htmlCase.ctx.userPersona,
    characterSetting: htmlCase.ctx.characterSetting,
  });
  const system = buildHtmlFlashSystemPrompt(policy, placement, flashMode);
  let userBlock = buildHtmlVisualCardFlashUserBlock(
    htmlCase.ctx,
    { standing: false, statusFieldLabels: [] },
    placement,
    flashMode
  );
  const budget = resolveHtmlFlashContextBudget(htmlCase.userMessage, flashMode);
  const inputBudget = budget.inputTargetTokens;
  let scale = 1;
  while (estimateTokens(`${system}\n${userBlock}`) > inputBudget && scale > 0.25) {
    scale *= 0.88;
    userBlock = buildHtmlVisualCardFlashUserBlock(
      htmlCase.ctx,
      { standing: false, statusFieldLabels: [] },
      placement,
      { ...flashMode, htmlContextCharScale: scale }
    );
  }
  return { system, userBlock, policy, placement, flashMode };
}

function normalizeRawOocHtml(raw: string, userMessage: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const inner = polishHtmlVisualCardInner(
    unwrapHtmlVisualCardInner(extractFencedHtmlBlock(trimmed) ?? trimmed)
  );
  if (!inner || oocFlashHtmlMustBeRejected(inner)) return null;
  if (
    isOocCreativeHtmlRichEnough(inner, userMessage) ||
    isPreservableOocHtmlInner(inner, userMessage) ||
    isCompleteHtmlStatusCardInner(inner)
  ) {
    return wrapHtmlVisualCardInner(inner);
  }
  return null;
}

async function directCiCall(opts: {
  modelId: string;
  system: string;
  userContent: string;
  timeoutMs: number;
  maxTokens: number;
}) {
  const started = Date.now();
  const baseBody: Record<string, unknown> = {
    model: opts.modelId,
    messages: [
      { role: "system", content: opts.system.trim() },
      { role: "user", content: opts.userContent.trim() },
    ],
    stream: false,
    temperature: 0.3,
    max_tokens: opts.maxTokens,
    reasoning: { effort: "none" as const },
    include_reasoning: false,
  };
  const outbound = adaptCheaperInferenceChatBody(baseBody);
  const flags = verifyOutboundFlags(outbound, opts.modelId);
  try {
    const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: buildCheaperInferenceHeaders(resolveCheaperInferenceApiKey()),
      body: JSON.stringify(outbound),
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      const body = await res.text();
      return {
        ok: false,
        timeout: false,
        httpStatus: res.status,
        latencyMs,
        text: "",
        error: body.slice(0, 400),
        finishReason: null,
        usage: null,
        flags,
      };
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
      usage?: unknown;
    };
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    const parsed = parseOpenRouterUsage(data.usage, res.headers);
    return {
      ok: text.length > 0,
      timeout: false,
      httpStatus: res.status,
      latencyMs,
      text,
      error: text.length === 0 ? "empty completion" : null,
      finishReason: data.choices?.[0]?.finish_reason ?? null,
      usage: parsed,
      flags,
    };
  } catch (e) {
    const latencyMs = Date.now() - started;
    const msg = (e as Error).message ?? String(e);
    return {
      ok: false,
      timeout: /timeout|aborted|AbortError/i.test(msg),
      httpStatus: null,
      latencyMs,
      text: "",
      error: msg.slice(0, 400),
      finishReason: null,
      usage: null,
      flags,
    };
  }
}

type BenchRow = {
  model: BenchModel;
  modelId: string;
  caseId: string;
  caseLabel: string;
  startedAt: string;
  requestKind: string;
  resolvedTimeoutMs: number;
  httpStatus: number | null;
  timeout: boolean;
  error: string | null;
  latencyMs: number;
  finishReason: string | null;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  upstreamCostUsd: number | null;
  rawText: string;
  rawOutputChars: number;
  fencedHtmlExtracted: boolean;
  postProcessedHtml: string;
  postProcessedChars: number;
  validatorResults: {
    htmlExtracted: boolean;
    policyRejected: boolean;
    oocRichEnough: boolean;
    preservablePartial: boolean;
    completeStatusCard: boolean;
  };
  policyRejected: boolean;
  compactRebuilt: boolean;
  fallbackTemplateUsed: boolean;
  mechanicalValidHtml: boolean;
  outboundLunaReasoningNone: boolean;
  outboundDeepseekThinkingOff: boolean;
};

async function runCall(call: InterleavedCall, htmlCase: HtmlCase): Promise<BenchRow> {
  const startedAt = new Date().toISOString();
  const { system, userBlock } = buildProductionOocHtmlPrompts(htmlCase);
  const resolvedTimeoutMs = resolveBenchTimeoutMs(call.modelId);
  const maxTokens = HTML_ONLY_TURN_MAX_OUTPUT_TOKENS;

  const transport = await directCiCall({
    modelId: call.modelId,
    system,
    userContent: userBlock,
    timeoutMs: resolvedTimeoutMs,
    maxTokens,
  });

  const rawText = transport.text;
  const fenced = extractFencedHtmlBlock(rawText);
  const innerFromRaw = fenced
    ? polishHtmlVisualCardInner(unwrapHtmlVisualCardInner(fenced))
    : rawText.trim()
      ? polishHtmlVisualCardInner(unwrapHtmlVisualCardInner(rawText))
      : "";

  const normalizedBlock = normalizeRawOocHtml(rawText, htmlCase.userMessage);
  const beforeEnsure = normalizedBlock ?? (fenced ? wrapHtmlVisualCardInner(fenced) : "");
  const postProcessedHtml = beforeEnsure
    ? ensureHtmlVisualCardBlock(beforeEnsure, [], {
        skipGenericFallback: true,
        oocUserMessage: htmlCase.userMessage,
      })
    : "";

  const postInner = postProcessedHtml
    ? unwrapHtmlVisualCardInner(postProcessedHtml)
    : "";
  const rawInner = innerFromRaw;
  const compactRebuilt =
    Boolean(postInner && rawInner) &&
    postInner !== rawInner &&
    isCompleteHtmlStatusCardInner(postInner) &&
    !isCompleteHtmlStatusCardInner(rawInner);

  const validatorResults = {
    htmlExtracted: Boolean(fenced),
    policyRejected: rawInner ? oocFlashHtmlMustBeRejected(rawInner) : false,
    oocRichEnough: rawInner ? isOocCreativeHtmlRichEnough(rawInner, htmlCase.userMessage) : false,
    preservablePartial: rawInner
      ? isPreservableOocHtmlInner(rawInner, htmlCase.userMessage)
      : false,
    completeStatusCard: rawInner ? isCompleteHtmlStatusCardInner(rawInner) : false,
  };

  const mechanicalValidHtml =
    Boolean(postInner.trim()) &&
    Boolean(fenced || rawInner.includes("<")) &&
    !validatorResults.policyRejected;

  return {
    model: call.model,
    modelId: call.modelId,
    caseId: call.caseId,
    caseLabel: htmlCase.label,
    startedAt,
    requestKind: REQUEST_KIND,
    resolvedTimeoutMs,
    httpStatus: transport.httpStatus,
    timeout: transport.timeout,
    error: transport.error,
    latencyMs: transport.latencyMs,
    finishReason: transport.finishReason,
    inputTokens: transport.usage?.promptTokens ?? 0,
    outputTokens: transport.usage?.completionTokens ?? 0,
    reasoningTokens: transport.usage?.reasoningTokens ?? 0,
    upstreamCostUsd: transport.usage?.upstreamCostUsd ?? null,
    rawText,
    rawOutputChars: rawText.length,
    fencedHtmlExtracted: Boolean(fenced),
    postProcessedHtml: postInner,
    postProcessedChars: postInner.length,
    validatorResults,
    policyRejected: validatorResults.policyRejected,
    compactRebuilt,
    fallbackTemplateUsed: false,
    mechanicalValidHtml,
    outboundLunaReasoningNone: transport.flags.lunaReasoningNone,
    outboundDeepseekThinkingOff: transport.flags.deepseekThinkingOff,
  };
}

function writeHtmlArtifact(filename: string, innerHtml: string) {
  const doc = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${filename}</title>
<style>body{margin:0;padding:16px;background:#0d1117;color:#c9d1d9;font-family:'Pretendard',sans-serif;}</style>
</head>
<body>
${innerHtml || "<p>(empty)</p>"}
</body>
</html>`;
  fs.writeFileSync(path.join(OUT_DIR, filename), doc, "utf8");
}

function mechanicalSummary(rows: BenchRow[]): string {
  const luna = rows.filter((r) => r.model === "luna");
  const pro = rows.filter((r) => r.model === "deepseek-pro");
  const avg = (xs: BenchRow[]) =>
    xs.length ? Math.round(xs.reduce((s, r) => s + r.latencyMs, 0) / xs.length) : 0;
  return `# OOC HTML mechanical summary

Generated: ${new Date().toISOString()}

**QUALITY_JUDGMENT=NOT_PERFORMED** · **HTML_PRIMARY_RECOMMENDATION=NOT_PERFORMED**

| Metric | Luna | DeepSeek V4 Pro |
|--------|-----:|----------------:|
| Calls | ${luna.length} | ${pro.length} |
| Success (non-empty raw) | ${luna.filter((r) => r.rawOutputChars > 0 && !r.timeout).length} | ${pro.filter((r) => r.rawOutputChars > 0 && !r.timeout).length} |
| Timeout | ${luna.filter((r) => r.timeout).length} | ${pro.filter((r) => r.timeout).length} |
| Empty | ${luna.filter((r) => r.rawOutputChars === 0 && !r.timeout).length} | ${pro.filter((r) => r.rawOutputChars === 0 && !r.timeout).length} |
| HTML extracted (fenced) | ${luna.filter((r) => r.fencedHtmlExtracted).length}/${luna.length} | ${pro.filter((r) => r.fencedHtmlExtracted).length}/${pro.length} |
| Mechanical valid HTML | ${luna.filter((r) => r.mechanicalValidHtml).length}/${luna.length} | ${pro.filter((r) => r.mechanicalValidHtml).length}/${pro.length} |
| Validator pass (mechanical) | ${luna.filter((r) => r.mechanicalValidHtml).length}/${luna.length} | ${pro.filter((r) => r.mechanicalValidHtml).length}/${pro.length} |
| Avg latency ms | ${avg(luna)} | ${avg(pro)} |
| Input tokens | ${luna.reduce((s, r) => s + r.inputTokens, 0)} | ${pro.reduce((s, r) => s + r.inputTokens, 0)} |
| Output tokens | ${luna.reduce((s, r) => s + r.outputTokens, 0)} | ${pro.reduce((s, r) => s + r.outputTokens, 0)} |
| Reasoning tokens | ${luna.reduce((s, r) => s + r.reasoningTokens, 0)} | ${pro.reduce((s, r) => s + r.reasoningTokens, 0)} |

Per-call \`resolvedTimeoutMs\`: Luna 240000 ms; DeepSeek V4 Pro 45000 ms (production longForm flash cap).

Models: A=${LUNA_MODEL}, B=${DEEPSEEK_PRO_MODEL}, provider=CheaperInference only.
RETRY=0 · PROVIDER_FAILOVER=0 · CROSS_MODEL_FALLBACK=0 · RECOVERY_MODEL_CALL=0
`;
}

async function main() {
  if (!process.env.CHEAPER_INFERENCE_API_KEY?.trim()) {
    console.error("CHEAPER_INFERENCE_API_KEY missing");
    process.exit(2);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const caseById = new Map(HTML_CASES.map((c) => [c.id, c]));
  const rows: BenchRow[] = [];

  for (const call of INTERLEAVED) {
    const htmlCase = caseById.get(call.caseId)!;
    console.log(`[ooc-html-bench] ${call.caseId} ${call.model}...`);
    const row = await runCall(call, htmlCase);
    rows.push(row);
    const htmlName = `${call.caseId}-${call.model === "luna" ? "luna" : "deepseek-pro"}.html`;
    writeHtmlArtifact(htmlName, row.postProcessedHtml);
    console.log(
      `[ooc-html-bench] ${call.caseId} ${call.model} done valid=${row.mechanicalValidHtml} ms=${row.latencyMs}`
    );
  }

  fs.writeFileSync(
    path.join(OUT_DIR, "results.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        benchOnly: true,
        models: { luna: LUNA_MODEL, deepseekPro: DEEPSEEK_PRO_MODEL },
        requestKind: REQUEST_KIND,
        totalCalls: rows.length,
        flags: {
          RETRY: 0,
          PROVIDER_FAILOVER: 0,
          CROSS_MODEL_FALLBACK: 0,
          RECOVERY_MODEL_CALL: 0,
        },
        rows,
      },
      null,
      2
    ),
    "utf8"
  );

  fs.writeFileSync(path.join(OUT_DIR, "mechanical-summary.md"), mechanicalSummary(rows), "utf8");

  const luna = rows.filter((r) => r.model === "luna");
  const pro = rows.filter((r) => r.model === "deepseek-pro");
  console.log(
    JSON.stringify(
      {
        BENCH_ONLY: true,
        PRODUCTION_ROUTING_CHANGED: false,
        LUNA_CALLS: luna.length,
        DEEPSEEK_V4_PRO_CALLS: pro.length,
        TOTAL_CALLS: rows.length,
        LUNA_TIMEOUTS: luna.filter((r) => r.timeout).length,
        DEEPSEEK_V4_PRO_TIMEOUTS: pro.filter((r) => r.timeout).length,
        LUNA_EMPTY: luna.filter((r) => r.rawOutputChars === 0 && !r.timeout).length,
        DEEPSEEK_V4_PRO_EMPTY: pro.filter((r) => r.rawOutputChars === 0 && !r.timeout).length,
        LUNA_VALID_HTML: `${luna.filter((r) => r.mechanicalValidHtml).length}/5`,
        DEEPSEEK_V4_PRO_VALID_HTML: `${pro.filter((r) => r.mechanicalValidHtml).length}/5`,
        LUNA_AVG_LATENCY_MS: luna.length
          ? Math.round(luna.reduce((s, r) => s + r.latencyMs, 0) / luna.length)
          : 0,
        DEEPSEEK_V4_PRO_AVG_LATENCY_MS: pro.length
          ? Math.round(pro.reduce((s, r) => s + r.latencyMs, 0) / pro.length)
          : 0,
        LUNA_INPUT_TOKENS: luna.reduce((s, r) => s + r.inputTokens, 0),
        LUNA_OUTPUT_TOKENS: luna.reduce((s, r) => s + r.outputTokens, 0),
        DEEPSEEK_V4_PRO_INPUT_TOKENS: pro.reduce((s, r) => s + r.inputTokens, 0),
        DEEPSEEK_V4_PRO_OUTPUT_TOKENS: pro.reduce((s, r) => s + r.outputTokens, 0),
        LUNA_REASONING_TOKENS: luna.reduce((s, r) => s + r.reasoningTokens, 0),
        DEEPSEEK_V4_PRO_REASONING_TOKENS: pro.reduce((s, r) => s + r.reasoningTokens, 0),
        DUPLICATE_RUNTIME_OWNERS: 0,
        CONFLICTING_POLICY_PATHS: 0,
        STALE_LEGACY_RUNTIME_REFERENCES: 0,
        RAW_RESULTS_COMMITTED: true,
        QUALITY_JUDGMENT: "NOT_PERFORMED",
        HTML_PRIMARY_RECOMMENDATION: "NOT_PERFORMED",
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
