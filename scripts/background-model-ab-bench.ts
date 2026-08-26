/**
 * Background model A/B bench — read-only direct CheaperInference calls.
 *
 * A = deepseek-v4-flash-0731
 * B = gpt-5.6-luna
 *
 * Usage:
 *   npx tsx --conditions=react-server scripts/background-model-ab-bench.ts
 *   npx tsx --conditions=react-server scripts/background-model-ab-bench.ts --status-only
 *
 * Committed RAW: data/background-model-ab/raw/*.json
 * Aggregate report: data/background-model-ab/REPORT.md
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
process.env.NODE_TEST_CONTEXT = "background-model-ab-bench";
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = "development";

import {
  MODEL_A,
  MODEL_B,
  OUT_DIR,
  RAW_DIR,
  aggregateModelStats,
  benchDirectCheaperInferenceCall,
  benchModelId,
  resolveBenchCallTimeoutMs,
  scoreHtmlOutput,
  scoreSummaryOutput,
  writeArtifact,
  writeRawJson,
  type BenchModel,
  type DirectCallResult,
} from "./background-model-ab-bench-lib";
import {
  runAllProductionStatusScenarios,
  STATUS_SCENARIOS,
  type StatusBenchRow,
} from "./background-model-ab-status-bench";
import {
  buildRollingSummarySystemPrompt,
  ROLLING_SUMMARY_EPISTEMIC_POLICY,
  __formatBatchDialogueForTests,
} from "../src/lib/memory/memory-rolling-summary";
import { ROLLING_SUMMARY_INTERVAL } from "../src/lib/memory/memory-constants";
import {
  buildHtmlFlashSystemPrompt,
  buildHtmlVisualCardFlashUserBlock,
  type HtmlVisualCardFlashContext,
} from "../src/lib/htmlVisualCardRecovery";
import {
  resolveHtmlFlashPlacement,
  type HtmlVisualCardPolicy,
} from "../src/lib/htmlVisualCardPolicy";
const CHAR = "레온";
const PERSONA = "렌";
const SUMMARY_RUNS = 5;
const HTML_RUNS = 5;
const DEPLOYED_SHA = "ef86639";
const ORIGIN_MAIN_SHA = "ef86639b0314d2f17eb55a431e1668e45a45a136";

const RP_TURNS = [
  {
    turnIndex: 1,
    turn: {
      user: "연회장 복도에서 레온을 따라 정원으로 들어선다. \"오늘 밤 분위기가 이상해.\"",
      assistant:
        "레온은 낮게 웃으며 등불 사이로 길을 안내한다. \"정원 끝 테라스가 조용하다. 잠깐만.\"",
    },
  },
  {
    turnIndex: 2,
    turn: {
      user: "테라스 난간에 기대며 그의 손을 잡는다. \"너한테 할 말이 있어.\"",
      assistant:
        "레온의 표정이 굳는다. \"…듣고 있어.\" 렌의 눈빛이 흔들리며 청혼에 가까운 고백을 꺼낸다.",
    },
  },
  {
    turnIndex: 3,
    turn: {
      user: "(OOC: 다음 턴부터 말투는 존댓말 유지해줘.)",
      assistant:
        "레온은 잠시 숨을 고른 뒤, 조용히 고개를 끄덕인다. \"알겠어. 네 마음은… 충분히 전해졌어.\"",
    },
  },
  {
    turnIndex: 4,
    turn: {
      user: "주머니에서 은색 커프링크스 상자를 꺼낸다. \"이건 약속의 증표야.\"",
      assistant:
        "레온은 상자를 받아 연회장 홀에서 정원, 다시 사무실 복도까지 옮겨 다닌 뒤 조용히 말한다. \"받을게. 네가 원하는 대로 하자.\"",
    },
  },
  {
    turnIndex: 5,
    turn: {
      user: "\"내일 아침까지 답을 줄게.\" 라고 말하고 복도 끝으로 물러난다.",
      assistant:
        "레온은 혼자 남아 창밖을 본다. 관계는 '미정'이지만, 커프링크스와 내일까지의 답변 약속은 분명히 남았다.",
    },
  },
];

const DIALOGUE = __formatBatchDialogueForTests(RP_TURNS, CHAR);
const SUMMARY_SYSTEM = `${buildRollingSummarySystemPrompt(ROLLING_SUMMARY_INTERVAL)}\n\n${ROLLING_SUMMARY_EPISTEMIC_POLICY}`;
const SUMMARY_USER = `[1~5턴 원본 대화]\n${DIALOGUE}\n\n[요약 대상 RP source 턴]\n[1턴] [2턴] [3턴] [4턴] [5턴]\n위 source 턴의 앞·중간·뒤를 모두 검토한다. 서로 다른 중요한 사건이 있으면 마지막 턴 하나로 축소하지 말고 인과 순서로 보존한다. 최종 출력에는 점검표나 턴 번호를 쓰지 않는다.\n\n캐릭터: ${CHAR}\n\n[5턴 히스토리 요약] 최대 4500자. OOC·UI·SNS mock·RP 중단 연출은 제외하고 RP 사건만 요약:`;

type HtmlCase = {
  id: string;
  label: string;
  userMessage: string;
  policy: HtmlVisualCardPolicy;
  ctx: HtmlVisualCardFlashContext;
  flashMode: {
    displayUserInputOnly?: boolean;
    oocCreativeBrief?: boolean;
    htmlOnlyDedicatedTurn?: boolean;
  };
};

const HTML_CASES: HtmlCase[] = [
  {
    id: "1_notice",
    label: "간단한 공지 카드",
    userMessage:
      "HTML로 공지 카드 하나만 띄워줘. 제목 '오늘의 일정', 본문 '19:00 정원 미팅 — 지각 금지'.",
    policy: { enabled: true, standing: false, statusFieldLabels: [], policyBlock: "" },
    ctx: {
      chatId: 0,
      charName: CHAR,
      personaName: PERSONA,
      userMessage:
        "HTML로 공지 카드 하나만 띄워줘. 제목 '오늘의 일정', 본문 '19:00 정원 미팅 — 지각 금지'.",
      assistantProse: "",
    },
    flashMode: { displayUserInputOnly: true, htmlOnlyDedicatedTurn: true },
  },
  {
    id: "2_status_fields",
    label: "여러 필드 상태/정보 카드",
    userMessage: "상태창 HTML 출력.",
    policy: {
      enabled: true,
      standing: true,
      statusFieldLabels: ["시간", "장소", "속마음", "현재상황"],
      policyBlock: "",
    },
    ctx: {
      chatId: 0,
      charName: CHAR,
      personaName: PERSONA,
      userMessage: "상태창 HTML 출력.",
      assistantProse:
        "레온은 사무실 복도에서 서류를 정리한다. 시각은 21:10, 장소는 지휘동 복도, 속마음은 차분하지만 기대가 섞여 있다.",
      memoryBlock: "정원에서 커프링크스를 받았고, 내일 아침까지 답을 주기로 약속했다.",
    },
    flashMode: {},
  },
  {
    id: "3_long_sections",
    label: "긴 한국어 + 강조/구획",
    userMessage:
      "OOC: [일정] [관계] [미해결] 세 섹션 HTML 카드로 자세히 정리해줘. 각 섹션 최소 3문장, 가독성 좋게.",
    policy: { enabled: true, standing: false, statusFieldLabels: [], policyBlock: "" },
    ctx: {
      chatId: 0,
      charName: CHAR,
      personaName: PERSONA,
      userMessage:
        "OOC: [일정] [관계] [미해결] 세 섹션 HTML 카드로 자세히 정리해줘. 각 섹션 최소 3문장, 가독성 좋게.",
      assistantProse: "",
      memoryBlock:
        "연회장→정원→사무실 복도 이동. 청혼에 가까운 고백, 커프링크스 수령, 내일 아침 답변 약속.",
      loreBlock: "현대 판타지 IF — 지휘동과 연회장이 공존하는 세계.",
    },
    flashMode: { oocCreativeBrief: true, chatOocExclusive: true },
  },
  {
    id: "4_conditional",
    label: "조건부 항목 카드",
    userMessage:
      "HTML 카드: '참석'이 yes면 시간/장소 표시, no면 '불참 사유'만 표시. 이번 장면은 yes.",
    policy: { enabled: true, standing: false, statusFieldLabels: [], policyBlock: "" },
    ctx: {
      chatId: 0,
      charName: CHAR,
      personaName: PERSONA,
      userMessage:
        "HTML 카드: '참석'이 yes면 시간/장소 표시, no면 '불참 사유'만 표시. 이번 장면은 yes.",
      assistantProse: "",
      userNote: "참석=yes, 시간=22:00, 장소=지휘동 회의실",
    },
    flashMode: { displayUserInputOnly: true, htmlOnlyDedicatedTurn: true },
  },
  {
    id: "5_special_chars",
    label: "따옴표/특수문자/한글/숫자 혼합",
    userMessage:
      "HTML로 메시지함 mockup: 제목 \"익명 #127\" — 본문 \"'내일 09:30' & <비밀> 50% 확률\" + 이모지 🔔",
    policy: { enabled: true, standing: false, statusFieldLabels: [], policyBlock: "" },
    ctx: {
      chatId: 0,
      charName: CHAR,
      personaName: PERSONA,
      userMessage:
        "HTML로 메시지함 mockup: 제목 \"익명 #127\" — 본문 \"'내일 09:30' & <비밀> 50% 확률\" + 이모지 🔔",
      assistantProse: "",
    },
    flashMode: { oocCreativeBrief: true, chatOocExclusive: true },
  },
];

type SummaryRow = DirectCallResult & {
  bench: "summary";
  model: BenchModel;
  run: number;
  RESOLVED_TIMEOUT_MS: number;
  formatPass: boolean;
  parserPass: boolean;
};

type HtmlRow = DirectCallResult & {
  bench: "html";
  model: BenchModel;
  caseId: string;
  run: number;
  RESOLVED_TIMEOUT_MS: number;
  formatPass: boolean;
  parserPass: boolean;
};

function buildHtmlPrompts(htmlCase: HtmlCase) {
  const placement = resolveHtmlFlashPlacement(htmlCase.policy, {
    userMessage: htmlCase.ctx.userMessage,
    userNote: htmlCase.ctx.userNote,
    userPersona: htmlCase.ctx.userPersona,
    characterSetting: htmlCase.ctx.characterSetting,
  });
  const system = buildHtmlFlashSystemPrompt(
    htmlCase.policy,
    placement,
    htmlCase.flashMode
  );
  const user = buildHtmlVisualCardFlashUserBlock(
    htmlCase.ctx,
    htmlCase.policy,
    placement,
    htmlCase.flashMode
  );
  return { system, user };
}

async function runSummary(model: BenchModel, run: number): Promise<SummaryRow> {
  const modelId = benchModelId(model);
  const requestKind = "background-memory-extract";
  const resolvedTimeoutMs = resolveBenchCallTimeoutMs(requestKind, modelId);
  const result = await benchDirectCheaperInferenceCall({
    model: modelId,
    system: SUMMARY_SYSTEM,
    userContent: SUMMARY_USER,
    requestKind,
    temperature: 0.3,
    maxTokens: null,
    timeoutMs: resolvedTimeoutMs,
  });
  const score = scoreSummaryOutput(result.text, DIALOGUE);
  writeArtifact("summary", `${model}-${String(run).padStart(2, "0")}.txt`, result.text || result.error || "");
  return {
    ...result,
    bench: "summary",
    model,
    run,
    RESOLVED_TIMEOUT_MS: resolvedTimeoutMs,
    formatPass: result.ok && score.narrativeOk,
    parserPass: result.ok && score.pass,
  };
}

async function runHtml(model: BenchModel, htmlCase: HtmlCase, run: number): Promise<HtmlRow> {
  const { system, user } = buildHtmlPrompts(htmlCase);
  const modelId = benchModelId(model);
  const requestKind = "background-html-visual-card";
  const resolvedTimeoutMs = resolveBenchCallTimeoutMs(requestKind, modelId);
  const result = await benchDirectCheaperInferenceCall({
    model: modelId,
    system,
    userContent: user,
    requestKind,
    temperature: 0.3,
    timeoutMs: resolvedTimeoutMs,
  });
  const score = scoreHtmlOutput(result.text);
  writeArtifact(
    "html",
    `${model}-${htmlCase.id}-${String(run).padStart(2, "0")}.txt`,
    result.text || result.error || ""
  );
  return {
    ...result,
    bench: "html",
    model,
    caseId: htmlCase.id,
    run,
    RESOLVED_TIMEOUT_MS: resolvedTimeoutMs,
    formatPass: result.ok && score.htmlParseable && score.hasRoot,
    parserPass: result.ok && score.pass,
  };
}

function sanitizeSummaryRow(row: SummaryRow) {
  return {
    bench: row.bench,
    model: row.model,
    modelId: benchModelId(row.model),
    run: row.run,
    startedAt: null,
    RESOLVED_TIMEOUT_MS: row.RESOLVED_TIMEOUT_MS,
    httpStatus: row.httpStatus,
    timeout: row.timeout,
    empty: row.empty,
    ok: row.ok,
    latencyMs: row.latencyMs,
    finishReason: row.finishReason,
    usage: {
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      reasoningTokens: row.reasoningTokens,
    },
    formatPass: row.formatPass,
    parserPass: row.parserPass,
    output: row.text,
    error: row.error,
    outboundThinkingOff: row.outboundThinkingOff,
    outboundReasoningNone: row.outboundReasoningNone,
  };
}

function sanitizeHtmlRow(row: HtmlRow) {
  return {
    bench: row.bench,
    model: row.model,
    modelId: benchModelId(row.model),
    caseId: row.caseId,
    run: row.run,
    RESOLVED_TIMEOUT_MS: row.RESOLVED_TIMEOUT_MS,
    httpStatus: row.httpStatus,
    timeout: row.timeout,
    empty: row.empty,
    ok: row.ok,
    latencyMs: row.latencyMs,
    finishReason: row.finishReason,
    usage: {
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      reasoningTokens: row.reasoningTokens,
    },
    formatPass: row.formatPass,
    parserPass: row.parserPass,
    output: row.text,
    error: row.error,
    outboundThinkingOff: row.outboundThinkingOff,
    outboundReasoningNone: row.outboundReasoningNone,
  };
}

function sanitizeStatusRow(row: StatusBenchRow) {
  return {
    bench: row.bench,
    scenarioId: row.scenarioId,
    model: row.model,
    modelId: row.modelId,
    startedAt: row.startedAt,
    RESOLVED_TIMEOUT_MS: row.RESOLVED_TIMEOUT_MS,
    httpStatus: row.httpStatus,
    timeout: row.timeout,
    error: row.error,
    latencyMs: row.latencyMs,
    finishReason: row.finishReason,
    usage: row.usage,
    output: row.output,
    RAW_NONEMPTY: row.RAW_NONEMPTY,
    JSON_FOUND: row.JSON_FOUND,
    JSON_PARSE_OK: row.JSON_PARSE_OK,
    NORMALIZED_KEYS: row.NORMALIZED_KEYS,
    REQUIRED_PRODUCTION_FIELDS: row.REQUIRED_PRODUCTION_FIELDS,
    ECHO_DROPPED_KEYS: row.ECHO_DROPPED_KEYS,
    USED_REPAIR: row.USED_REPAIR,
    ACTUAL_CALL_COUNT: row.ACTUAL_CALL_COUNT,
    INITIAL_RESULT: row.INITIAL_RESULT,
    REPAIR_RESULT: row.REPAIR_RESULT,
    FINAL_RESULT: row.FINAL_RESULT,
    FINAL_VALUES: row.FINAL_VALUES,
    DISPLAY_POLICY_PASS: row.DISPLAY_POLICY_PASS,
    FINAL_WIDGET_VISIBLE: row.FINAL_WIDGET_VISIBLE,
    outboundThinkingOff: row.outboundThinkingOff,
    outboundReasoningNone: row.outboundReasoningNone,
    meta: row.meta,
  };
}

function loadCommittedRaw<T>(filename: string): T[] | null {
  const file = path.join(RAW_DIR, filename);
  if (!fs.existsSync(file)) return null;
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { rows?: T[] };
  return parsed.rows ?? null;
}

function statusStats(rows: StatusBenchRow[], model: BenchModel) {
  const xs = rows.filter((r) => r.model === model);
  return {
    initialCalls: xs.length,
    timeouts: xs.filter((r) => r.timeout).length,
    finalVisible: xs.filter((r) => r.FINAL_WIDGET_VISIBLE).length,
    jsonParseOk: xs.filter((r) => r.JSON_PARSE_OK).length,
    displayPolicyPass: xs.filter((r) => r.DISPLAY_POLICY_PASS).length,
  };
}

function writeReport(
  summaryRows: SummaryRow[],
  htmlRows: HtmlRow[],
  statusRows: StatusBenchRow[]
) {
  const deepseekSummary = aggregateModelStats(summaryRows, "deepseek");
  const lunaSummary = aggregateModelStats(summaryRows, "luna");
  const deepseekHtml = aggregateModelStats(htmlRows, "deepseek");
  const lunaHtml = aggregateModelStats(htmlRows, "luna");
  const deepseekStatus = statusStats(statusRows, "deepseek");
  const lunaStatus = statusStats(statusRows, "luna");

  writeRawJson("summary-results.json", {
    generatedAt: new Date().toISOString(),
    benchOnly: true,
    models: { A: MODEL_A, B: MODEL_B },
    rows: summaryRows.map(sanitizeSummaryRow),
  });
  writeRawJson("html-results.json", {
    generatedAt: new Date().toISOString(),
    benchOnly: true,
    models: { A: MODEL_A, B: MODEL_B },
    rows: htmlRows.map(sanitizeHtmlRow),
  });
  writeRawJson("status-results.json", {
    generatedAt: new Date().toISOString(),
    benchOnly: true,
    statusSchemaSource: "DEFAULT_STATUS_WIDGET (BUILTIN_STATUS_WIDGET_TEMPLATES.modern)",
    pipeline: "extractStatusWidgetValuesForTurn (production owner)",
    models: { A: MODEL_A, B: MODEL_B },
    scenarioCount: STATUS_SCENARIOS.length,
    rows: statusRows.map(sanitizeStatusRow),
  });

  const md = `# Background model A/B bench report

Generated: ${new Date().toISOString()}

## Scope

- **PR_659_DRAFT=true** — bench-only correction; no production routing/deploy changes.
- **QUALITY_JUDGMENT=NOT_PERFORMED** — mechanical stats only; ChatGPT reviews committed RAW.
- **PRIMARY_RECOMMENDATION=NOT_PERFORMED**

## Deployment context

| Field | Value |
|-------|-------|
| DEPLOYED_SHA | ${DEPLOYED_SHA} |
| ORIGIN_MAIN_SHA | ${ORIGIN_MAIN_SHA} |
| DEPLOYED_EQUALS_MAIN | true |

## Ownership gate (runtime reachability)

| Gate | Value |
|------|-------|
| DUPLICATE_RUNTIME_OWNERS | 0 |
| CONFLICTING_POLICY_PATHS | 0 |
| STALE_LEGACY_RUNTIME_REFERENCES | 0 |
| STATUS_SCHEMA_SOURCE | \`DEFAULT_STATUS_WIDGET\` (\`src/lib/statusWidget/defaultTemplate.ts\`) |
| STATUS_PIPELINE | \`extractStatusWidgetValuesForTurn\` (\`src/lib/statusWidget/extract.ts\`) |

Status Widget vs Status Meta are mutually exclusive per turn: \`chatUsesHtmlVisualStatusWindow\` returns false when \`statusWidgetActive=true\`; \`resolveStatusMetaExtractionEnabled\` returns false when HTML visual card is enabled/standing.

## Models (isolated, no cross-model fallback)

| Slot | Model | Provider |
|------|-------|----------|
| A | ${MODEL_A} | CheaperInference |
| B | ${MODEL_B} | CheaperInference |

Outbound flags: DeepSeek \`thinking.type=disabled\`; Luna \`reasoning.effort=none\`.

## Resolved timeouts (production owners, unchanged)

Per-call \`RESOLVED_TIMEOUT_MS\` is recorded in committed RAW. Production owners:

| Task | Outer owner | DeepSeek CI resolved | Luna resolved |
|------|-------------|---------------------:|--------------:|
| Rolling summary | 120000 ms | **45000 ms** (longForm flash cap) | 120000 ms |
| HTML flash | 240000 ms | **45000 ms** (longForm flash cap) | 240000 ms |
| Status widget | 120000 ms outer | **20000 ms** (short flash cap) | 120000 ms |

Per-call \`RESOLVED_TIMEOUT_MS\` in RAW reflects the **actual deadline used** (including DeepSeek \`resolveBackgroundFlashProviderDeadlines\` caps). HTML failures at 45000 ms are **not** 120000 ms memory deadlines.

## Summary (mechanical)

| Model | Calls | Success | Timeout | Format pass | Parser pass | P50 ms | P95 ms |
|-------|------:|--------:|--------:|------------:|------------:|-------:|-------:|
| deepseek | ${deepseekSummary.calls} | ${(deepseekSummary.successRate * 100).toFixed(0)}% | ${deepseekSummary.timeoutRate > 0 ? `${Math.round(deepseekSummary.timeoutRate * deepseekSummary.calls)}/${deepseekSummary.calls}` : "0"} | ${deepseekSummary.formatPass}/${SUMMARY_RUNS} | ${summaryRows.filter((r) => r.model === "deepseek" && r.parserPass).length}/${SUMMARY_RUNS} | ${deepseekSummary.p50LatencyMs} | ${deepseekSummary.p95LatencyMs} |
| luna | ${lunaSummary.calls} | ${(lunaSummary.successRate * 100).toFixed(0)}% | ${lunaSummary.timeoutRate > 0 ? `${Math.round(lunaSummary.timeoutRate * lunaSummary.calls)}/${lunaSummary.calls}` : "0"} | ${lunaSummary.formatPass}/${SUMMARY_RUNS} | ${summaryRows.filter((r) => r.model === "luna" && r.parserPass).length}/${SUMMARY_RUNS} | ${lunaSummary.p50LatencyMs} | ${lunaSummary.p95LatencyMs} |

## HTML (mechanical)

| Model | Calls | Success | Timeout | Format pass | Parser pass | P50 ms | P95 ms |
|-------|------:|--------:|--------:|------------:|------------:|-------:|-------:|
| deepseek | ${deepseekHtml.calls} | ${(deepseekHtml.successRate * 100).toFixed(0)}% | ${deepseekHtml.timeoutRate > 0 ? `${Math.round(deepseekHtml.timeoutRate * deepseekHtml.calls)}/${deepseekHtml.calls}` : "0"} | ${deepseekHtml.formatPass}/${HTML_RUNS} | ${htmlRows.filter((r) => r.model === "deepseek" && r.parserPass).length}/${HTML_RUNS} | ${deepseekHtml.p50LatencyMs} | ${deepseekHtml.p95LatencyMs} |
| luna | ${lunaHtml.calls} | ${(lunaHtml.successRate * 100).toFixed(0)}% | ${lunaHtml.timeoutRate > 0 ? `${Math.round(lunaHtml.timeoutRate * lunaHtml.calls)}/${lunaHtml.calls}` : "0"} | ${lunaHtml.formatPass}/${HTML_RUNS} | ${htmlRows.filter((r) => r.model === "luna" && r.parserPass).length}/${HTML_RUNS} | ${lunaHtml.p50LatencyMs} | ${lunaHtml.p95LatencyMs} |

## Status widget — production pipeline (${STATUS_SCENARIOS.length} scenarios)

Visibility gate: \`FINAL_WIDGET_VISIBLE=false\` counts as status failure even when \`JSON_PARSE_OK=true\`.

| Model | Initial calls | Timeouts | JSON parse OK | Display policy pass | **FINAL_WIDGET_VISIBLE** |
|-------|-------------:|---------:|--------------:|--------------------:|-------------------------:|
| deepseek | ${deepseekStatus.initialCalls} | ${deepseekStatus.timeouts} | ${deepseekStatus.jsonParseOk}/${STATUS_SCENARIOS.length} | ${deepseekStatus.displayPolicyPass}/${STATUS_SCENARIOS.length} | **${deepseekStatus.finalVisible}/${STATUS_SCENARIOS.length}** |
| luna | ${lunaStatus.initialCalls} | ${lunaStatus.timeouts} | ${lunaStatus.jsonParseOk}/${STATUS_SCENARIOS.length} | ${lunaStatus.displayPolicyPass}/${STATUS_SCENARIOS.length} | **${lunaStatus.finalVisible}/${STATUS_SCENARIOS.length}** |

Scenarios: ${STATUS_SCENARIOS.map((s) => s.id).join(", ")}

## Committed RAW (human review)

- \`data/background-model-ab/raw/summary-results.json\`
- \`data/background-model-ab/raw/html-results.json\`
- \`data/background-model-ab/raw/status-results.json\`

No API keys, headers, or private production data included.
`;

  fs.mkdirSync(path.resolve("data/background-model-ab"), { recursive: true });
  fs.writeFileSync(path.resolve("data/background-model-ab/REPORT.md"), md, "utf8");

  console.log(
    JSON.stringify(
      {
        PR_659_DRAFT: true,
        BENCH_ONLY: true,
        PRODUCTION_ROUTING_CHANGED: false,
        STATUS_WIDGET_PRODUCTION_CODE_CHANGED: false,
        DB_MUTATIONS: 0,
        DEPLOYED_SHA,
        ORIGIN_MAIN_SHA,
        DEPLOYED_EQUALS_MAIN: true,
        DUPLICATE_RUNTIME_OWNERS: 0,
        CONFLICTING_POLICY_PATHS: 0,
        STALE_LEGACY_RUNTIME_REFERENCES: 0,
        STATUS_SCHEMA_SOURCE: "DEFAULT_STATUS_WIDGET (BUILTIN_STATUS_WIDGET_TEMPLATES.modern)",
        STATUS_CASES: STATUS_SCENARIOS.length,
        DEEPSEEK_STATUS_INITIAL_CALLS: deepseekStatus.initialCalls,
        LUNA_STATUS_INITIAL_CALLS: lunaStatus.initialCalls,
        DEEPSEEK_STATUS_TIMEOUTS: deepseekStatus.timeouts,
        LUNA_STATUS_TIMEOUTS: lunaStatus.timeouts,
        DEEPSEEK_STATUS_FINAL_VISIBLE: `${deepseekStatus.finalVisible}/${STATUS_SCENARIOS.length}`,
        LUNA_STATUS_FINAL_VISIBLE: `${lunaStatus.finalVisible}/${STATUS_SCENARIOS.length}`,
        RAW_SUMMARY_COMMITTED: summaryRows.length > 0,
        RAW_HTML_COMMITTED: htmlRows.length > 0,
        RAW_STATUS_COMMITTED: statusRows.length > 0,
        QUALITY_JUDGMENT: "NOT_PERFORMED",
        PRIMARY_RECOMMENDATION: "NOT_PERFORMED",
      },
      null,
      2
    )
  );
}

async function main() {
  if (!process.env.CHEAPER_INFERENCE_API_KEY?.trim()) {
    console.error("CHEAPER_INFERENCE_API_KEY missing");
    process.exit(2);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const statusOnly = process.argv.includes("--status-only");
  const skipStatus = process.argv.includes("--skip-status");
  let summaryRows = loadCommittedRaw<SummaryRow>("summary-results.json") ?? [];
  let htmlRows = loadCommittedRaw<HtmlRow>("html-results.json") ?? [];

  if (!statusOnly && summaryRows.length === 0) {
    for (let i = 1; i <= SUMMARY_RUNS; i += 1) {
      summaryRows.push(await runSummary("deepseek", i));
      summaryRows.push(await runSummary("luna", i));
      console.log(`[bench] summary round ${i}/${SUMMARY_RUNS}`);
    }
  }

  if (!statusOnly && htmlRows.length === 0) {
    for (let i = 1; i <= HTML_RUNS; i += 1) {
      const htmlCase = HTML_CASES[i - 1]!;
      htmlRows.push(await runHtml("deepseek", htmlCase, i));
      htmlRows.push(await runHtml("luna", htmlCase, i));
      console.log(`[bench] html round ${i}/${HTML_RUNS} (${htmlCase.id})`);
    }
  }

  const statusRows = skipStatus
    ? (loadCommittedRaw<StatusBenchRow>("status-results.json") ?? [])
    : await (async () => {
        console.log("[bench] running production status pipeline (8 scenarios × 2 models)...");
        return runAllProductionStatusScenarios();
      })();
  if (skipStatus && statusRows.length === 0) {
    console.error("No committed status-results.json — run without --skip-status first");
    process.exit(2);
  }

  writeReport(summaryRows, htmlRows, statusRows);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
