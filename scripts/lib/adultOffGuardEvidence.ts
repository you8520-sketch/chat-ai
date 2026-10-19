/**
 * 성인 OFF 출력 검사 실측 증거 해석 규칙. 공급자 호출 없이 순수 계산만 한다.
 *
 * - 화면 본문은 이벤트 텍스트를 이어 붙이지 않고 replace/delta/reset/done.finalContent 의미대로 재구성한다.
 * - 메시지 API는 HTTP 상태와 JSON 파싱 결과의 content 를 저장 본문과 비교한다.
 * - 지연은 공급자·분류기·전체 완료를 구분하고 겹치지 않는 나머지를 따로 계산한다.
 * - 비용은 확정·추정·미확정으로 나누고 미완료(started) 후속 호출을 숨기지 않는다.
 */

export type SseEvent = Record<string, unknown>;

export function applySseEventToScreen(screen: string, event: SseEvent): string {
  switch (event.type) {
    case "reset":
      return "";
    case "replace":
      return typeof event.text === "string" ? event.text : screen;
    case "delta":
    case "append":
      return typeof event.text === "string" ? screen + event.text : screen;
    case "done":
      return typeof event.finalContent === "string" ? event.finalContent : screen;
    default:
      return screen;
  }
}

export function reconstructScreenText(events: readonly SseEvent[]): string {
  let screen = "";
  for (const event of events) screen = applySseEventToScreen(screen, event);
  return screen;
}

export type ScreenTimelinePoint = { atMs: number; type: string | null; screenChars: number };

export function reconstructScreenTimeline(
  events: ReadonlyArray<{ atMs: number; event: SseEvent }>
): ScreenTimelinePoint[] {
  let screen = "";
  return events.map(({ atMs, event }) => {
    screen = applySseEventToScreen(screen, event);
    return { atMs, type: typeof event.type === "string" ? event.type : null, screenChars: screen.length };
  });
}

/** 승인 전(첫 본문 이벤트 이전)과 승인 후(마지막)의 화면 본문 길이를 비교한다. */
export function screenBeforeAndAfter(timeline: readonly ScreenTimelinePoint[]): {
  charsBeforeFirstBodyEvent: number;
  firstBodyAtMs: number | null;
  charsAtEnd: number;
} {
  const first = timeline.find((point) => point.screenChars > 0);
  const lastChars = timeline.length ? timeline[timeline.length - 1].screenChars : 0;
  if (!first) return { charsBeforeFirstBodyEvent: 0, firstBodyAtMs: null, charsAtEnd: lastChars };
  const before = timeline.filter((point) => point.atMs < first.atMs);
  const charsBefore = before.length ? Math.max(...before.map((point) => point.screenChars)) : 0;
  return { charsBeforeFirstBodyEvent: charsBefore, firstBodyAtMs: first.atMs, charsAtEnd: lastChars };
}

export type MessageApiCheck = {
  httpStatus: number;
  jsonParsed: boolean;
  apiContentChars: number | null;
  matchesStored: boolean;
  reason: "ok" | "http_error" | "invalid_json" | "missing_content" | "content_mismatch";
};

export function checkMessageApiResponse(input: {
  status: number;
  bodyText: string;
  storedContent: string;
}): MessageApiCheck {
  const base = { httpStatus: input.status, jsonParsed: false, apiContentChars: null, matchesStored: false };
  if (input.status !== 200) return { ...base, reason: "http_error" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.bodyText);
  } catch {
    return { ...base, reason: "invalid_json" };
  }
  const content = (parsed as { content?: unknown } | null)?.content;
  if (typeof content !== "string") return { ...base, jsonParsed: true, reason: "missing_content" };
  const matchesStored = content === input.storedContent;
  return {
    httpStatus: input.status,
    jsonParsed: true,
    apiContentChars: content.length,
    matchesStored,
    reason: matchesStored ? "ok" : "content_mismatch",
  };
}

export type LatencyBreakdown = {
  totalMs: number;
  providerMs: number | null;
  classifierMs: number | null;
  /** total - provider - classifier. 둘이 겹치지 않는 직렬 구조에서만 의미가 있다. */
  otherMs: number | null;
  overlapMs: number;
};

export function splitLatency(input: {
  totalMs: number;
  providerMs: number | null;
  classifierMs: number | null;
}): LatencyBreakdown {
  const { totalMs, providerMs, classifierMs } = input;
  if (providerMs == null || classifierMs == null) {
    return { totalMs, providerMs, classifierMs, otherMs: null, overlapMs: 0 };
  }
  const sum = providerMs + classifierMs;
  return {
    totalMs,
    providerMs,
    classifierMs,
    otherMs: Math.max(0, totalMs - sum),
    overlapMs: Math.max(0, sum - totalMs),
  };
}

export type CostLedgerRow = {
  request_kind: string;
  model: string;
  actual_cost_usd: number | null;
  actual_cost_source: string | null;
  event_status: string | null;
};

export type CostClassification = {
  confirmedUsd: number;
  estimatedUsd: number;
  unconfirmedRows: Array<{ request_kind: string; model: string; event_status: string | null }>;
  confirmedRows: number;
  estimatedRows: number;
};

const TERMINAL_STATUSES = new Set(["settled", "completed_without_exact_cost"]);

/**
 * 확정: 상태가 settled 이고 비용이 있는 행. 추정: 공급자가 비용을 보고하지 않았고 usage 로 계산한 값을 준 행.
 * 미확정: 비용을 알 수 없는 나머지(미완료 started 포함). 값을 0으로 합산하지 않고 행 수로 남긴다.
 */
export function classifyCostRows(
  rows: readonly CostLedgerRow[],
  usageEstimatesUsd: ReadonlyMap<string, number> = new Map()
): CostClassification {
  const out: CostClassification = {
    confirmedUsd: 0,
    estimatedUsd: 0,
    unconfirmedRows: [],
    confirmedRows: 0,
    estimatedRows: 0,
  };
  for (const row of rows) {
    if (row.event_status === "settled" && row.actual_cost_usd != null) {
      out.confirmedUsd += row.actual_cost_usd;
      out.confirmedRows += 1;
      continue;
    }
    const estimate = row.event_status && TERMINAL_STATUSES.has(row.event_status)
      ? usageEstimatesUsd.get(row.request_kind)
      : undefined;
    if (estimate != null && row.actual_cost_usd == null) {
      out.estimatedUsd += estimate;
      out.estimatedRows += 1;
      continue;
    }
    if (row.actual_cost_usd != null) {
      out.confirmedUsd += row.actual_cost_usd;
      out.confirmedRows += 1;
      continue;
    }
    out.unconfirmedRows.push({
      request_kind: row.request_kind,
      model: row.model,
      event_status: row.event_status,
    });
  }
  return out;
}

export type UsageTokens = {
  prompt_tokens?: number;
  completion_tokens?: number;
  cache_creation_input_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number; cache_creation_input_tokens?: number };
};

export type TokenRatesUsdPerM = {
  inputUsdPerM: number;
  outputUsdPerM: number;
  cacheReadUsdPerM: number;
  cacheWriteUsdPerM: number;
};

export function estimateUsdFromUsage(usage: UsageTokens, rates: TokenRatesUsdPerM): number {
  const details = usage.prompt_tokens_details ?? {};
  const prompt = Number(usage.prompt_tokens ?? 0);
  const out = Number(usage.completion_tokens ?? 0);
  const cacheRead = details.cached_tokens ?? 0;
  const cacheWrite =
    details.cache_write_tokens ??
    details.cache_creation_input_tokens ??
    Number(usage.cache_creation_input_tokens ?? 0);
  const standard = Math.max(0, prompt - cacheRead - cacheWrite);
  return (
    (standard * rates.inputUsdPerM +
      cacheRead * rates.cacheReadUsdPerM +
      cacheWrite * rates.cacheWriteUsdPerM +
      out * rates.outputUsdPerM) /
    1_000_000
  );
}
