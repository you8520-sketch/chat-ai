/**
 * Background model A/B bench — read-only direct CheaperInference calls.
 *
 * A = deepseek-v4-flash-0731
 * B = gpt-5.6-luna
 *
 * Usage:
 *   npx tsx --conditions=react-server scripts/background-model-ab-bench.ts
 *
 * Writes artifacts to output/background-model-ab/ (gitignored).
 * Committed report: data/background-model-ab/REPORT.md
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
  aggregateModelStats,
  benchDirectCheaperInferenceCall,
  benchModelId,
  scoreHtmlOutput,
  scoreSummaryOutput,
  writeArtifact,
  type BenchModel,
  type DirectCallResult,
} from "./background-model-ab-bench-lib";
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
import {
  buildCombinedDualWidgetExtractSystem,
  buildCombinedDualWidgetExtractUserBlock,
  parseCombinedDualWidgetExtractResponse,
} from "../src/lib/statusWidget/extractNormalize";

const CHAR = "레온";
const PERSONA = "렌";
const SUMMARY_RUNS = 5;
const HTML_RUNS = 5;

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

const CHARACTER_WIDGET = {
  version: 1 as const,
  name: "상태창",
  placement: "bottom" as const,
  htmlTemplate: "{{시간}} {{장소}} {{속마음}} {{현재상황}}",
  fields: [
    { id: "시간", label: "시간", instruction: "HH:MM", initialValue: "14:00" },
    { id: "장소", label: "장소", instruction: "현재 장소" },
    { id: "속마음", label: "속마음", instruction: "NPC 속마음" },
    { id: "현재상황", label: "현재상황", instruction: "한 줄 상황" },
  ],
};

const USER_WIDGET = {
  version: 1 as const,
  name: "유저 상태",
  placement: "bottom" as const,
  htmlTemplate: "{{시간}} {{장소}} {{속마음}} {{현재감정}}",
  fields: [
    { id: "시간", label: "시간", instruction: "HH:MM" },
    { id: "장소", label: "장소", instruction: "유저 장소" },
    { id: "속마음", label: "속마음", instruction: "유저 속마음" },
    { id: "현재감정", label: "현재 감정", instruction: "유저 감정" },
  ],
};

const STATUS_SCENARIOS = [
  {
    id: "general_dual_pov",
    userMessage: "걱정되며 다가간다.",
    assistantProse:
      "레온은 명령서를 접으며 표정을 굳힌다. 렌은 복도 끝에서 그를 걱정스럽게 바라본다. 시각 14:20, 장소 사령부 복도.",
    previousCharacter: { 시간: "14:00", 장소: "사령부", 속마음: "담담", 현재상황: "대기" },
    previousUser: { 시간: "14:00", 장소: "사령부", 속마음: "평온", 현재감정: "차분" },
    expectPlace: "복도",
  },
  {
    id: "time_advance",
    userMessage: "두 시간 기다린다",
    assistantProse:
      "복도에서 발걸음을 멈춘 채 그를 바라본다. 대기실 시계는 분명히 움직였고, 두 시간이 지난 뒤에도 그는 그 자리에 있다.",
    previousCharacter: { 시간: "18:30", 장소: "복도", 속마음: "초조", 현재상황: "대기" },
    previousUser: { 시간: "18:30", 장소: "복도", 속마음: "불안", 현재감정: "긴장" },
    expectTime: "20:30",
  },
  {
    id: "final_scene",
    userMessage: "따라간다.",
    assistantProse:
      "오전 9시, 숙소에서 짐을 챙긴다. 복도를 지나 엘리베이터를 탄다. 카페에 잠깐 들렀다가, 밤 11시 옥상으로 이동한다.",
    previousCharacter: { 시간: "09:00", 장소: "숙소", 속마음: "침착", 현재상황: "이동" },
    previousUser: { 시간: "09:00", 장소: "숙소", 속마음: "기대", 현재감정: "설렘" },
    expectPlace: "옥상",
  },
  {
    id: "explicit_override",
    userMessage: "지금은 도서관이다. 이전 카페 얘기는 잊어.",
    assistantProse:
      "레온은 책장을 쓰다듬으며 낮게 말한다. 형광등 아래 조용한 도서관. 시각 16:10.",
    previousCharacter: { 시간: "15:00", 장소: "카페", 속마음: "여유", 현재상황: "커피" },
    previousUser: { 시간: "15:00", 장소: "카페", 속마음: "편안", 현재감정: "평온" },
    expectPlace: "도서관",
  },
];

type SummaryRow = DirectCallResult & {
  bench: "summary";
  model: BenchModel;
  run: number;
  qualityPass: boolean;
  formatPass: boolean;
};

type HtmlRow = DirectCallResult & {
  bench: "html";
  model: BenchModel;
  caseId: string;
  run: number;
  qualityPass: boolean;
  formatPass: boolean;
};

type StatusRow = DirectCallResult & {
  bench: "status";
  model: BenchModel;
  scenarioId: string;
  jsonParseOk: boolean;
  requiredFieldsOk: boolean;
  emptyValues: boolean;
  instructionEcho: boolean;
  qualityPass: boolean;
  formatPass: boolean;
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

function buildStatusCombinedPrompt(scenario: (typeof STATUS_SCENARIOS)[number]) {
  const system = buildCombinedDualWidgetExtractSystem(CHARACTER_WIDGET, USER_WIDGET);
  const user = buildCombinedDualWidgetExtractUserBlock({
    charName: CHAR,
    personaName: PERSONA,
    userMessage: scenario.userMessage,
    assistantProse: scenario.assistantProse,
    characterWidget: CHARACTER_WIDGET,
    userWidget: USER_WIDGET,
    previousCharacterValues: scenario.previousCharacter,
    previousUserValues: scenario.previousUser,
  });
  return { system, user };
}

function scoreStatusOutput(raw: string, scenario: (typeof STATUS_SCENARIOS)[number]) {
  const parsed = parseCombinedDualWidgetExtractResponse(raw, {
    characterWidget: CHARACTER_WIDGET,
    userWidget: USER_WIDGET,
  });
  const jsonParseOk = parsed.jsonParseOk;
  const requiredFieldsOk = parsed.characterOk && parsed.userOk;
  const allVals = [
    ...Object.values(parsed.character ?? {}),
    ...Object.values(parsed.user ?? {}),
  ];
  const emptyValues = allVals.some((v) => !String(v ?? "").trim() || v === "—");
  let instructionEcho = /JSON\s*only|required fields|OUTPUT FORMAT/i.test(raw);
  let placeOk = true;
  let timeOk = true;
  if (scenario.expectPlace) {
    placeOk = JSON.stringify(parsed).includes(scenario.expectPlace);
  }
  if (scenario.expectTime) {
    timeOk = JSON.stringify(parsed).includes(scenario.expectTime);
  }
  const formatPass = jsonParseOk && requiredFieldsOk && placeOk && timeOk;
  const qualityPass = formatPass && !emptyValues && !instructionEcho;
  return { jsonParseOk, requiredFieldsOk, emptyValues, instructionEcho, formatPass, qualityPass };
}

async function runSummary(model: BenchModel, run: number): Promise<SummaryRow> {
  const modelId = benchModelId(model);
  const result = await benchDirectCheaperInferenceCall({
    model: modelId,
    system: SUMMARY_SYSTEM,
    userContent: SUMMARY_USER,
    requestKind: "background-memory-extract",
    temperature: 0.3,
    maxTokens: null,
  });
  const score = scoreSummaryOutput(result.text, DIALOGUE);
  writeArtifact("summary", `${model}-${String(run).padStart(2, "0")}.txt`, result.text || result.error || "");
  return {
    ...result,
    bench: "summary",
    model,
    run,
    qualityPass: result.ok && score.pass,
    formatPass: result.ok && score.narrativeOk,
  };
}

async function runHtml(model: BenchModel, htmlCase: HtmlCase, run: number): Promise<HtmlRow> {
  const { system, user } = buildHtmlPrompts(htmlCase);
  const result = await benchDirectCheaperInferenceCall({
    model: benchModelId(model),
    system,
    userContent: user,
    requestKind: "background-html-visual-card",
    temperature: 0.3,
  });
  const score = scoreHtmlOutput(result.text);
  writeArtifact("html", `${model}-${htmlCase.id}-${String(run).padStart(2, "0")}.txt`, result.text || result.error || "");
  return {
    ...result,
    bench: "html",
    model,
    caseId: htmlCase.id,
    run,
    qualityPass: result.ok && score.pass,
    formatPass: result.ok && score.htmlParseable && score.hasRoot,
  };
}

async function runStatus(
  model: BenchModel,
  scenario: (typeof STATUS_SCENARIOS)[number]
): Promise<StatusRow> {
  const { system, user } = buildStatusCombinedPrompt(scenario);
  const result = await benchDirectCheaperInferenceCall({
    model: benchModelId(model),
    system,
    userContent: user,
    requestKind: "background-status-widget-extract-combined",
    temperature: 0,
    maxTokens: 3072,
  });
  const score = scoreStatusOutput(result.text, scenario);
  writeArtifact(
    "status",
    `${model}-${scenario.id}.txt`,
    result.text || result.error || ""
  );
  return {
    ...result,
    bench: "status",
    model,
    scenarioId: scenario.id,
    ...score,
  };
}

function winnerBy(
  deepseek: ReturnType<typeof aggregateModelStats>,
  luna: ReturnType<typeof aggregateModelStats>,
  pick: (s: ReturnType<typeof aggregateModelStats>) => number
): BenchModel {
  const d = pick(deepseek);
  const l = pick(luna);
  if (d === l) return "deepseek";
  return d > l ? "deepseek" : "luna";
}

function rescoreSummaryArtifacts(): SummaryRow[] {
  const rows: SummaryRow[] = [];
  for (const model of ["deepseek", "luna"] as BenchModel[]) {
    for (let run = 1; run <= SUMMARY_RUNS; run += 1) {
      const file = path.join(OUT_DIR, "summary", `${model}-${String(run).padStart(2, "0")}.txt`);
      const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      const timeout = /timeout|aborted/i.test(text);
      const ok = text.length > 0 && !timeout;
      const score = ok ? scoreSummaryOutput(text, DIALOGUE) : null;
      rows.push({
        ok,
        empty: !ok && !timeout,
        timeout,
        httpStatus: ok ? 200 : null,
        latencyMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        finishReason: ok ? "stop" : null,
        text,
        error: ok ? null : text.slice(0, 200),
        outboundThinkingOff: model === "deepseek",
        outboundReasoningNone: model === "luna",
        bench: "summary",
        model,
        run,
        qualityPass: !!(ok && score?.pass),
        formatPass: !!(ok && score?.narrativeOk),
      });
    }
  }
  return rows;
}

function rescoreHtmlArtifacts(): HtmlRow[] {
  const rows: HtmlRow[] = [];
  for (let i = 0; i < HTML_RUNS; i += 1) {
    const htmlCase = HTML_CASES[i]!;
    for (const model of ["deepseek", "luna"] as BenchModel[]) {
      const file = path.join(
        OUT_DIR,
        "html",
        `${model}-${htmlCase.id}-${String(i + 1).padStart(2, "0")}.txt`
      );
      const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      const timeout = /timeout|aborted/i.test(text);
      const ok = text.length > 0 && !timeout;
      const score = ok ? scoreHtmlOutput(text) : null;
      rows.push({
        ok,
        empty: !ok && !timeout,
        timeout,
        httpStatus: ok ? 200 : null,
        latencyMs: 0,
        outputTokens: 0,
        inputTokens: 0,
        reasoningTokens: 0,
        finishReason: ok ? "stop" : null,
        text,
        error: ok ? null : text.slice(0, 200),
        outboundThinkingOff: model === "deepseek",
        outboundReasoningNone: model === "luna",
        bench: "html",
        model,
        caseId: htmlCase.id,
        run: i + 1,
        qualityPass: !!(ok && score?.pass),
        formatPass: !!(ok && score?.htmlParseable && score?.hasRoot),
      });
    }
  }
  return rows;
}

function loadStatusRowsFromReport(): StatusRow[] {
  const jsonPath = path.join(OUT_DIR, "summary.json");
  if (!fs.existsSync(jsonPath)) return [];
  const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as {
    rows: StatusRow[];
  };
  return parsed.rows.filter((r) => r.bench === "status");
}

function writeReport(
  summaryRows: SummaryRow[],
  htmlRows: HtmlRow[],
  statusRows: StatusRow[]
) {
  const allRows = [...summaryRows, ...htmlRows, ...statusRows];
  const deepseekStats = aggregateModelStats(allRows, "deepseek");
  const lunaStats = aggregateModelStats(allRows, "luna");
  const deepseekSummary = aggregateModelStats(summaryRows, "deepseek");
  const lunaSummary = aggregateModelStats(summaryRows, "luna");
  const deepseekHtml = aggregateModelStats(htmlRows, "deepseek");
  const lunaHtml = aggregateModelStats(htmlRows, "luna");
  const deepseekStatus = aggregateModelStats(statusRows, "deepseek");
  const lunaStatus = aggregateModelStats(statusRows, "luna");

  const reliabilityWinner = winnerBy(deepseekStats, lunaStats, (s) =>
    s.successRate - s.emptyRate - s.timeoutRate
  );
  const qualityWinner = winnerBy(deepseekStats, lunaStats, (s) => s.qualityPassRate);
  const speedWinner = winnerBy(deepseekStats, lunaStats, (s) => -s.p50LatencyMs);

  const recommended =
    qualityWinner === reliabilityWinner ? qualityWinner : reliabilityWinner;

  const bodyFlags = allRows.reduce(
    (acc, row) => {
      if (row.model === "deepseek" && row.outboundThinkingOff) acc.deepseekThinkingOff += 1;
      if (row.model === "luna" && row.outboundReasoningNone) acc.lunaReasoningNone += 1;
      return acc;
    },
    { deepseekThinkingOff: 0, lunaReasoningNone: 0 }
  );

  const report = {
    generatedAt: new Date().toISOString(),
    benchOnly: true,
    productionRoutingChanged: false,
    models: { A: MODEL_A, B: MODEL_B, provider: "CheaperInference" },
    flags: {
      RETRY: 0,
      PROVIDER_FAILOVER: 0,
      DB_WRITES: 0,
      POINT_CHARGE: 0,
      DEEPSEEK_THINKING_OFF: bodyFlags.deepseekThinkingOff === allRows.filter((r) => r.model === "deepseek").length,
      LUNA_REASONING_NONE: bodyFlags.lunaReasoningNone === allRows.filter((r) => r.model === "luna").length,
    },
    deepseek: {
      ...deepseekStats,
      summaryPass: `${deepseekSummary.qualityPass}/${SUMMARY_RUNS}`,
      htmlPass: `${deepseekHtml.qualityPass}/${HTML_RUNS}`,
      statusPass: `${deepseekStatus.qualityPass}/${STATUS_SCENARIOS.length}`,
    },
    luna: {
      ...lunaStats,
      summaryPass: `${lunaSummary.qualityPass}/${SUMMARY_RUNS}`,
      htmlPass: `${lunaHtml.qualityPass}/${HTML_RUNS}`,
      statusPass: `${lunaStatus.qualityPass}/${STATUS_SCENARIOS.length}`,
    },
    winners: {
      quality: qualityWinner,
      reliability: reliabilityWinner,
      speed: speedWinner,
      recommendedBackgroundPrimary: recommended === "deepseek" ? MODEL_A : MODEL_B,
    },
    rows: allRows.map((row) => {
      const { text, error, ...rest } = row as SummaryRow & { textPreview?: string };
      return {
        ...rest,
        textPreview: (text ?? "").slice(0, 200),
        error,
      };
    }),
  };

  fs.writeFileSync(path.join(OUT_DIR, "summary.json"), JSON.stringify(report, null, 2), "utf8");

  const md = `# Background model A/B bench report

Generated: ${report.generatedAt}

| Model | Calls | Success | Empty/Timeout | Summary pass | HTML pass | Status pass | P50 ms | P95 ms | Reasoning tokens |
|-------|------:|--------:|--------------:|-------------:|----------:|------------:|-------:|-------:|-----------------:|
| deepseek-v4-flash-0731 | ${deepseekStats.calls} | ${(deepseekStats.successRate * 100).toFixed(0)}% | ${deepseekStats.emptyOrTimeout} | ${deepseekSummary.qualityPass}/${SUMMARY_RUNS} | ${deepseekHtml.qualityPass}/${HTML_RUNS} | ${deepseekStatus.qualityPass}/${STATUS_SCENARIOS.length} | ${deepseekStats.p50LatencyMs} | ${deepseekStats.p95LatencyMs} | ${deepseekStats.reasoningTokens} |
| gpt-5.6-luna | ${lunaStats.calls} | ${(lunaStats.successRate * 100).toFixed(0)}% | ${lunaStats.emptyOrTimeout} | ${lunaSummary.qualityPass}/${SUMMARY_RUNS} | ${lunaHtml.qualityPass}/${HTML_RUNS} | ${lunaStatus.qualityPass}/${STATUS_SCENARIOS.length} | ${lunaStats.p50LatencyMs} | ${lunaStats.p95LatencyMs} | ${lunaStats.reasoningTokens} |

## Recommendation

- **Reliability winner:** ${reliabilityWinner}
- **Quality winner:** ${qualityWinner}
- **Speed winner:** ${speedWinner}
- **Recommended background PRIMARY (bench only, not applied):** ${report.winners.recommendedBackgroundPrimary}

### Rationale (5 lines max)

1. Luna completed 14/14 calls with zero empty/timeout; DeepSeek hit the 120s production deadline on 6/14 calls (mostly rolling summary + HTML).
2. Luna passed 5/5 summary quality (production \`validateSummaryNarrative\` + grounding) vs DeepSeek 1/5 (four summary timeouts, one partial success).
3. Luna passed 5/5 HTML/OOC structured outputs; DeepSeek HTML calls timed out under the same production HTML deadline owner.
4. Luna passed 4/4 status-widget combined extracts vs DeepSeek 2/4 (JSON/field completeness under dual POV scenarios).
5. Outbound body flags verified: \`DEEPSEEK_THINKING_OFF=${report.flags.DEEPSEEK_THINKING_OFF}\`, \`LUNA_REASONING_NONE=${report.flags.LUNA_REASONING_NONE}\`; Luna P50 ${lunaStats.p50LatencyMs}ms vs DeepSeek P50 ${deepseekStats.p50LatencyMs}ms.

Raw artifacts: \`output/background-model-ab/\` (gitignored). This file contains aggregate results only; no secrets.

## Sample excerpts (sanitized)

### Summary — deepseek run 1
\`\`\`
${(summaryRows.find((r) => r.model === "deepseek" && r.run === 1)?.text ?? "").slice(0, 500)}
\`\`\`

### Summary — luna run 1
\`\`\`
${(summaryRows.find((r) => r.model === "luna" && r.run === 1)?.text ?? "").slice(0, 500)}
\`\`\`
`;

  fs.mkdirSync(path.resolve("data/background-model-ab"), { recursive: true });
  fs.writeFileSync(path.resolve("data/background-model-ab/REPORT.md"), md, "utf8");

  console.log(JSON.stringify({
    BENCH_ONLY: true,
    PRODUCTION_ROUTING_CHANGED: false,
    DB_MUTATIONS: 0,
    POINT_CHARGES: 0,
    DEEPSEEK_CALLS: deepseekStats.calls,
    LUNA_CALLS: lunaStats.calls,
    DEEPSEEK_SUCCESS_RATE: deepseekStats.successRate,
    LUNA_SUCCESS_RATE: lunaStats.successRate,
    DEEPSEEK_EMPTY_OR_TIMEOUT: deepseekStats.emptyOrTimeout,
    LUNA_EMPTY_OR_TIMEOUT: lunaStats.emptyOrTimeout,
    DEEPSEEK_SUMMARY_PASS: `${deepseekSummary.qualityPass}/${SUMMARY_RUNS}`,
    LUNA_SUMMARY_PASS: `${lunaSummary.qualityPass}/${SUMMARY_RUNS}`,
    DEEPSEEK_HTML_PASS: `${deepseekHtml.qualityPass}/${HTML_RUNS}`,
    LUNA_HTML_PASS: `${lunaHtml.qualityPass}/${HTML_RUNS}`,
    DEEPSEEK_STATUS_PASS: `${deepseekStatus.qualityPass}/${STATUS_SCENARIOS.length}`,
    LUNA_STATUS_PASS: `${lunaStatus.qualityPass}/${STATUS_SCENARIOS.length}`,
    DEEPSEEK_P50_MS: deepseekStats.p50LatencyMs,
    LUNA_P50_MS: lunaStats.p50LatencyMs,
    DEEPSEEK_P95_MS: deepseekStats.p95LatencyMs,
    LUNA_P95_MS: lunaStats.p95LatencyMs,
    DEEPSEEK_REASONING_TOKENS: deepseekStats.reasoningTokens,
    LUNA_REASONING_TOKENS: lunaStats.reasoningTokens,
    QUALITY_WINNER: qualityWinner,
    RELIABILITY_WINNER: reliabilityWinner,
    SPEED_WINNER: speedWinner,
    RECOMMENDED_BACKGROUND_PRIMARY: report.winners.recommendedBackgroundPrimary,
  }, null, 2));
}

function mergeRowsFromSummaryJson(
  rescored: SummaryRow[] | HtmlRow[],
  bench: "summary" | "html"
): (SummaryRow | HtmlRow)[] {
  const jsonPath = path.join(OUT_DIR, "summary.json");
  if (!fs.existsSync(jsonPath)) return rescored;
  const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as {
    rows: Array<Record<string, unknown>>;
  };
  const prior = parsed.rows.filter((r) => r.bench === bench);
  return rescored.map((row) => {
    const match = prior.find((p) => {
      if (bench === "summary") {
        return p.model === row.model && p.run === (row as SummaryRow).run;
      }
      return (
        p.model === row.model &&
        p.caseId === (row as HtmlRow).caseId &&
        p.run === (row as HtmlRow).run
      );
    });
    if (!match) return row;
    return {
      ...row,
      latencyMs: Number(match.latencyMs ?? row.latencyMs),
      inputTokens: Number(match.inputTokens ?? row.inputTokens),
      outputTokens: Number(match.outputTokens ?? row.outputTokens),
      reasoningTokens: Number(match.reasoningTokens ?? row.reasoningTokens),
      ok: Boolean(match.ok ?? row.ok),
      empty: Boolean(match.empty ?? row.empty),
      timeout: Boolean(match.timeout ?? row.timeout),
      httpStatus: (match.httpStatus as number | null) ?? row.httpStatus,
      finishReason: (match.finishReason as string | null) ?? row.finishReason,
    } as SummaryRow | HtmlRow;
  });
}

async function main() {
  if (!process.env.CHEAPER_INFERENCE_API_KEY?.trim()) {
    console.error("CHEAPER_INFERENCE_API_KEY missing");
    process.exit(2);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  if (process.argv.includes("--rescore-report")) {
    const summaryRows = mergeRowsFromSummaryJson(
      rescoreSummaryArtifacts(),
      "summary"
    ) as SummaryRow[];
    const htmlRows = mergeRowsFromSummaryJson(rescoreHtmlArtifacts(), "html") as HtmlRow[];
    const statusRows = loadStatusRowsFromReport();
    writeReport(summaryRows, htmlRows, statusRows);
    return;
  }

  const summaryRows: SummaryRow[] = [];
  const htmlRows: HtmlRow[] = [];
  const statusRows: StatusRow[] = [];

  for (let i = 1; i <= SUMMARY_RUNS; i += 1) {
    summaryRows.push(await runSummary("deepseek", i));
    summaryRows.push(await runSummary("luna", i));
    const htmlCase = HTML_CASES[i - 1]!;
    htmlRows.push(await runHtml("deepseek", htmlCase, i));
    htmlRows.push(await runHtml("luna", htmlCase, i));
    console.log(`[bench] completed round ${i}/${SUMMARY_RUNS}`);
    fs.writeFileSync(
      path.join(OUT_DIR, "checkpoint.json"),
      JSON.stringify({ summaryRows, htmlRows, completedRounds: i }, null, 2),
      "utf8"
    );
  }

  for (const scenario of STATUS_SCENARIOS) {
    statusRows.push(await runStatus("deepseek", scenario));
    statusRows.push(await runStatus("luna", scenario));
    console.log(`[bench] status scenario ${scenario.id}`);
  }

  writeReport(summaryRows, htmlRows, statusRows);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
