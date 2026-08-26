/**
 * Status widget bench — production extractStatusWidgetValuesForTurn pipeline.
 * Model isolation: injected CI caller, fallbackModelId=null, no cross-model recovery.
 */
import {
  benchModelId,
  createIsolatedCiCaller,
  resolveBenchCallTimeoutMs,
  type BenchModel,
  type DirectCallResult,
} from "./background-model-ab-bench-lib";
import { DEFAULT_STATUS_WIDGET } from "../src/lib/statusWidget/defaultTemplate";
import { cloneStatusWidgetTemplate } from "../src/lib/statusWidget/builtinTemplates";
import {
  extractStatusWidgetValuesForTurn,
  type StatusWidgetExtractCaller,
} from "../src/lib/statusWidget/extract";
import {
  orderedWidgetsForRender,
  resolveStatusWidgetTurn,
} from "../src/lib/statusWidget/resolve";
import {
  renderStatusWidgetsForTurn,
  type StatusWidgetProfileNames,
} from "../src/lib/statusWidget/render";
import {
  shouldShowStatusWidgetOnMessage,
  statusWidgetSourceValuesHaveContent,
} from "../src/lib/statusWidget/displayPolicy";
import { serializeStatusWidget } from "../src/lib/statusWidget/serialize";
import { collectWidgetJsonKeys } from "../src/lib/statusWidget/prompt";
import { extractJsonObjectFromWidgetText } from "../src/lib/statusWidget/extractNormalize";
import type { ParsedStatusWidgetTurnValues, StatusWidgetValues } from "../src/lib/statusWidget/types";

const CHAR = "레온";
const PERSONA = "렌";

export type StatusScenario = {
  id: string;
  userMessage: string;
  assistantProse: string;
  previousCharacter: Record<string, string>;
  previousUser: Record<string, string>;
  userNote?: string;
};

export const STATUS_SCENARIOS: StatusScenario[] = [
  {
    id: "general_dual_pov",
    userMessage: "걱정되며 다가간다.",
    assistantProse:
      "레온은 명령서를 접으며 표정을 굳힌다. 렌은 복도 끝에서 그를 걱정스럽게 바라본다. 시각 14:20, 장소 사령부 복도.",
    previousCharacter: { 시간: "14:00", 장소: "사령부", 속마음: "담담", 현재상황: "대기", 의식의흐름: "지휘부 명령을 기다린다" },
    previousUser: { 시간: "14:00", 장소: "사령부", 속마음: "평온", 현재상황: "대기", 의식의흐름: "별일 없기를 바란다" },
  },
  {
    id: "time_advance",
    userMessage: "두 시간 기다린다",
    assistantProse:
      "복도에서 발걸음을 멈춘 채 그를 바라본다. 대기실 시계는 분명히 움직였고, 두 시간이 지난 뒤에도 그는 그 자리에 있다.",
    previousCharacter: { 시간: "18:30", 장소: "복도", 속마음: "초조", 현재상황: "대기", 의식의흐름: "연락이 올까 기다린다" },
    previousUser: { 시간: "18:30", 장소: "복도", 속마음: "불안", 현재상황: "대기", 의식의흐름: "너무 오래 걸린다" },
  },
  {
    id: "final_scene",
    userMessage: "따라간다.",
    assistantProse:
      "오전 9시, 숙소에서 짐을 챙긴다. 복도를 지나 엘리베이터를 탄다. 카페에 잠깐 들렀다가, 밤 11시 옥상으로 이동한다.",
    previousCharacter: { 시간: "09:00", 장소: "숙소", 속마음: "침착", 현재상황: "이동", 의식의흐름: "일정을 확인한다" },
    previousUser: { 시간: "09:00", 장소: "숙소", 속마음: "기대", 현재상황: "이동", 의식의흐름: "함께 가고 싶다" },
  },
  {
    id: "explicit_override",
    userMessage: "지금은 도서관이다. 이전 카페 얘기는 잊어.",
    assistantProse:
      "레온은 책장을 쓰다듬으며 낮게 말한다. 형광등 아래 조용한 도서관. 시각 16:10.",
    previousCharacter: { 시간: "15:00", 장소: "카페", 속마음: "여유", 현재상황: "커피", 의식의흐름: "쉬고 싶다" },
    previousUser: { 시간: "15:00", 장소: "카페", 속마음: "편안", 현재상황: "휴식", 의식의흐름: "조용히 쉬자" },
  },
  {
    id: "previous_value_echo_change",
    userMessage: "이제 출발한다. 더는 기다리지 않겠어.",
    assistantProse:
      "레온은 잠깐 망설이다가 고개를 끄덕인다. 복도 끝 문이 열리고, 차가운 바람이 들어온다. 시각 17:05, 장소 지휘동 정문.",
    previousCharacter: {
      시간: "16:40",
      장소: "지휘동 복도",
      속마음: "아직 결정 못 내렸다",
      현재상황: "대기",
      의식의흐름: "더 기다릴까 말까",
    },
    previousUser: {
      시간: "16:40",
      장소: "지휘동 복도",
      속마음: "답답하다",
      현재상황: "대기",
      의식의흐름: "언제까지 기다리지",
    },
  },
  {
    id: "dual_pov_subject_separation",
    userMessage: "작전 브리핑을 듣는다.",
    assistantProse:
      "레온은 지도 위에 붉은 표시를 그으며 냉정하게 설명한다. 렌은 메모를 적으며 질문한다. 시각 08:15, 장소 작전실.",
    previousCharacter: {
      시간: "08:00",
      장소: "숙소",
      속마음: "집중",
      현재상황: "출근",
      의식의흐름: "오늘도 실수 없이",
    },
    previousUser: {
      시간: "08:00",
      장소: "숙소",
      속마음: "긴장",
      현재상황: "출근",
      의식의흐름: "잘해야 한다",
    },
  },
  {
    id: "sparse_no_change",
    userMessage: "…",
    assistantProse: "레온은 잠시 침묵한다. 시계바늘만 움직인다.",
    previousCharacter: {
      시간: "22:10",
      장소: "옥상",
      속마음: "생각 정리",
      현재상황: "대기",
      의식의흐름: "말을 고른다",
    },
    previousUser: {
      시간: "22:10",
      장소: "옥상",
      속마음: "조용",
      현재상황: "대기",
      의식의흐름: "기다린다",
    },
  },
  {
    id: "long_korean_scene_with_ooc",
    userMessage:
      "(OOC: 다음 턴부터 말투는 존댓말 유지해줘.) 연회장 복도 끝에서 그를 기다린다.",
    assistantProse:
      "레온은 연회장 복도 끝에서 낮은 목소리로 인사한다. 샹들리에 불빛 아래 사람들의 웃음소리가 멀게 들리고, 그는 렌 쪽으로 한 걸음 다가선다. 시각 21:40, 장소 연회장 복도. 속마음은 차분하지만, 눈빛에는 오래 숨겨 둔 말이 맴돈다. 의식의 흐름은 ‘지금 말해야 하나, 아직은 이르지 않나’ 사이를 오간다. 바깥 창문 너머로 비가 내리기 시작한다.",
    previousCharacter: {
      시간: "21:10",
      장소: "연회장 홀",
      속마음: "긴장",
      현재상황: "행사 참석",
      의식의흐름: "말할 타이밍을 재고 있다",
    },
    previousUser: {
      시간: "21:10",
      장소: "연회장 홀",
      속마음: "설렘",
      현재상황: "행사 참석",
      의식의흐름: "그가 다가오길 기다린다",
    },
    userNote: "OOC 존댓말 유지 요청",
  },
];

function productionWidgets() {
  const characterWidget = cloneStatusWidgetTemplate(DEFAULT_STATUS_WIDGET);
  const userWidget = cloneStatusWidgetTemplate(DEFAULT_STATUS_WIDGET);
  userWidget.name = "유저 상태";
  return { characterWidget, userWidget };
}

function normalizedKeys(values: ParsedStatusWidgetTurnValues): string[] {
  const keys: string[] = [];
  for (const side of ["character", "user"] as const) {
    const row = values[side];
    if (!row) continue;
    for (const [k, v] of Object.entries(row)) {
      if (String(v ?? "").trim()) keys.push(`${side}.${k}`);
    }
  }
  return keys.sort();
}

function requiredProductionFieldsOk(
  values: ParsedStatusWidgetTurnValues,
  characterKeys: string[],
  userKeys: string[]
): boolean {
  const charRow = values.character ?? {};
  const userRow = values.user ?? {};
  const charOk = characterKeys.every((k) => {
    const v = charRow[k];
    return typeof v === "string" && v.trim().length > 0 && v.trim() !== "—";
  });
  const userOk = userKeys.every((k) => {
    const v = userRow[k];
    return typeof v === "string" && v.trim().length > 0 && v.trim() !== "—";
  });
  return charOk && userOk;
}

function sliceValues(values: StatusWidgetValues | undefined): Record<string, string> | null {
  if (!values) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    if (typeof v === "string" && v.trim()) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

export type StatusBenchRow = {
  bench: "status";
  scenarioId: string;
  model: BenchModel;
  modelId: string;
  startedAt: string;
  RESOLVED_TIMEOUT_MS: number;
  httpStatus: number | null;
  timeout: boolean;
  error: string | null;
  latencyMs: number;
  finishReason: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
  } | null;
  output: string;
  RAW_NONEMPTY: boolean;
  JSON_FOUND: boolean;
  JSON_PARSE_OK: boolean;
  NORMALIZED_KEYS: string[];
  REQUIRED_PRODUCTION_FIELDS: boolean;
  ECHO_DROPPED_KEYS: string[];
  USED_REPAIR: boolean;
  ACTUAL_CALL_COUNT: number;
  INITIAL_RESULT: { character: Record<string, string> | null; user: Record<string, string> | null };
  REPAIR_RESULT: { character: Record<string, string> | null; user: Record<string, string> | null } | null;
  FINAL_RESULT: { character: Record<string, string> | null; user: Record<string, string> | null };
  FINAL_VALUES: ParsedStatusWidgetTurnValues;
  DISPLAY_POLICY_PASS: boolean;
  FINAL_WIDGET_VISIBLE: boolean;
  outboundThinkingOff: boolean;
  outboundReasoningNone: boolean;
  meta: {
    extractMode: string;
    usedFallback: boolean;
    exhausted: boolean;
    attemptStages: string[];
  };
};

export async function runProductionStatusBench(
  model: BenchModel,
  scenario: StatusScenario
): Promise<StatusBenchRow> {
  const modelId = benchModelId(model);
  const startedAt = new Date().toISOString();
  const { characterWidget, userWidget } = productionWidgets();
  const characterKeys = collectWidgetJsonKeys(characterWidget);
  const userKeys = collectWidgetJsonKeys(userWidget);
  const resolved = resolveStatusWidgetTurn({
    characterWidgetJson: serializeStatusWidget(characterWidget),
    userWidgetJson: serializeStatusWidget(userWidget),
    chatMode: "both",
    displayMode: "both",
  });
  const requestKind = "background-status-widget-extract-combined";
  const resolvedTimeoutMs = resolveBenchCallTimeoutMs(requestKind, modelId);

  let lastRaw = "";
  let lastTransport: DirectCallResult | null = null;
  const { caller, flags } = createIsolatedCiCaller(modelId, {
    onResult: (raw, transport) => {
      lastRaw = raw;
      lastTransport = transport;
    },
  });

  const previousValues: ParsedStatusWidgetTurnValues = {
    character: { ...scenario.previousCharacter },
    user: { ...scenario.previousUser },
  };

  let extractResult: Awaited<ReturnType<typeof extractStatusWidgetValuesForTurn>>;
  const started = Date.now();
  try {
    extractResult = await extractStatusWidgetValuesForTurn({
      charName: CHAR,
      personaName: PERSONA,
      userMessage: scenario.userMessage,
      assistantProse: scenario.assistantProse,
      userNote: scenario.userNote,
      resolved,
      previousValues,
      caller: caller as StatusWidgetExtractCaller,
      primaryModelId: modelId,
      fallbackModelId: null,
    });
  } catch (e) {
    const latencyMs = Date.now() - started;
    return {
      bench: "status",
      scenarioId: scenario.id,
      model,
      modelId,
      startedAt,
      RESOLVED_TIMEOUT_MS: resolvedTimeoutMs,
      httpStatus: lastTransport?.httpStatus ?? null,
      timeout: lastTransport?.timeout ?? /timeout|aborted/i.test(String(e)),
      error: e instanceof Error ? e.message : String(e),
      latencyMs,
      finishReason: lastTransport?.finishReason ?? null,
      usage: null,
      output: lastRaw,
      RAW_NONEMPTY: lastRaw.trim().length > 0,
      JSON_FOUND: extractJsonObjectFromWidgetText(lastRaw) != null,
      JSON_PARSE_OK: false,
      NORMALIZED_KEYS: [],
      REQUIRED_PRODUCTION_FIELDS: false,
      ECHO_DROPPED_KEYS: [],
      USED_REPAIR: false,
      ACTUAL_CALL_COUNT: 0,
      INITIAL_RESULT: { character: null, user: null },
      REPAIR_RESULT: null,
      FINAL_RESULT: { character: null, user: null },
      FINAL_VALUES: {},
      DISPLAY_POLICY_PASS: false,
      FINAL_WIDGET_VISIBLE: false,
      outboundThinkingOff: flags.deepseekThinkingOff,
      outboundReasoningNone: flags.lunaReasoningNone,
      meta: { extractMode: "dual_combined", usedFallback: false, exhausted: true, attemptStages: [] },
    };
  }

  const latencyMs = Date.now() - started;
  const values = extractResult.values;
  const meta = extractResult.meta;
  const jsonFound = extractJsonObjectFromWidgetText(lastRaw) != null;
  const jsonParseOk =
    statusWidgetSourceValuesHaveContent(values.character) ||
    statusWidgetSourceValuesHaveContent(values.user);
  const normKeys = normalizedKeys(values);
  const requiredOk = requiredProductionFieldsOk(values, characterKeys, userKeys);
  const echoDropped = [
    ...(meta.character?.echoDroppedKeys ?? []),
    ...(meta.user?.echoDroppedKeys ?? []),
  ];
  const names: StatusWidgetProfileNames = { charName: CHAR, personaName: PERSONA };
  const renderItems = orderedWidgetsForRender(resolved, values);
  const rendered = renderStatusWidgetsForTurn(renderItems, names);
  const displayPolicyPass = shouldShowStatusWidgetOnMessage({
    statusWidgetTurnActive: resolved.active,
    statusWidgetValues: values,
  });
  const finalWidgetVisible =
    displayPolicyPass &&
    rendered.length > 0 &&
    rendered.some((row) => row.html.trim().length > 20);

  const initialCharacter = meta.character?.stages.includes("initial")
    ? sliceValues(values.character)
    : null;
  const initialUser = meta.user?.stages.includes("initial") ? sliceValues(values.user) : null;
  const usedRepair = meta.usedRepair;
  const repairResult =
    usedRepair
      ? {
          character: sliceValues(values.character),
          user: sliceValues(values.user),
        }
      : null;

  return {
    bench: "status",
    scenarioId: scenario.id,
    model,
    modelId,
    startedAt,
    RESOLVED_TIMEOUT_MS: resolvedTimeoutMs,
    httpStatus: lastTransport?.httpStatus ?? (jsonParseOk ? 200 : null),
    timeout: lastTransport?.timeout ?? false,
    error: lastTransport?.error ?? null,
    latencyMs,
    finishReason: lastTransport?.finishReason ?? null,
    usage: extractResult.usage
      ? {
          inputTokens: extractResult.usage.inputTokens,
          outputTokens: extractResult.usage.outputTokens,
          reasoningTokens: extractResult.usage.reasoningTokens ?? 0,
        }
      : lastTransport
        ? {
            inputTokens: lastTransport.inputTokens,
            outputTokens: lastTransport.outputTokens,
            reasoningTokens: lastTransport.reasoningTokens,
          }
        : null,
    output: lastRaw,
    RAW_NONEMPTY: lastRaw.trim().length > 0,
    JSON_FOUND: jsonFound,
    JSON_PARSE_OK: jsonParseOk,
    NORMALIZED_KEYS: normKeys,
    REQUIRED_PRODUCTION_FIELDS: requiredOk,
    ECHO_DROPPED_KEYS: echoDropped,
    USED_REPAIR: usedRepair,
    ACTUAL_CALL_COUNT: meta.actualCallCount,
    INITIAL_RESULT: { character: initialCharacter, user: initialUser },
    REPAIR_RESULT: repairResult,
    FINAL_RESULT: {
      character: sliceValues(values.character),
      user: sliceValues(values.user),
    },
    FINAL_VALUES: values,
    DISPLAY_POLICY_PASS: displayPolicyPass,
    FINAL_WIDGET_VISIBLE: finalWidgetVisible,
    outboundThinkingOff: flags.deepseekThinkingOff,
    outboundReasoningNone: flags.lunaReasoningNone,
    meta: {
      extractMode: meta.extractMode,
      usedFallback: meta.usedFallback,
      exhausted: meta.exhausted,
      attemptStages: meta.attemptDiagnostics.map((d) => d.stage),
    },
  };
}

export async function runAllProductionStatusScenarios(): Promise<StatusBenchRow[]> {
  const rows: StatusBenchRow[] = [];
  for (const scenario of STATUS_SCENARIOS) {
    for (const model of ["deepseek", "luna"] as BenchModel[]) {
      rows.push(await runProductionStatusBench(model, scenario));
      console.log(
        `[status-bench] ${scenario.id} ${model} visible=${rows.at(-1)?.FINAL_WIDGET_VISIBLE} calls=${rows.at(-1)?.ACTUAL_CALL_COUNT}`
      );
    }
  }
  return rows;
}
