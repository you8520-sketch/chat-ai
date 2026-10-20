/**
 * 기존 live 실측 JSON을 공급자 호출 없이 다시 해석한다(오프라인).
 *
 *   node --conditions=react-server --import tsx scripts/adult-off-guard-reanalyze.ts
 *
 * 입력: docs/audits/adult-off-output-guard/live/<model>.json, classifier-probe.json
 * 출력: 같은 폴더의 reanalysis.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseAdultOffClassifierOutput } from "../src/lib/adultOffOutputGuard";
import {
  resolveCacheReadUsdPerM,
  resolveCacheWriteUsdPerM,
  resolveOpenRouterModelRates,
} from "../src/lib/openRouterModelPricing";
import {
  classifyCostRows,
  estimateUsdFromUsage,
  reconstructScreenTimeline,
  screenBeforeAndAfter,
  splitLatency,
  type CostLedgerRow,
  type SseEvent,
  type UsageTokens,
} from "./lib/adultOffGuardEvidence";

const DIR = process.env.LIVE_MEASURE_OUT_DIR?.trim() || "docs/audits/adult-off-output-guard/live";
const MODEL_FILES = ["gemini-3.8-flash", "gpt-6.1-sol", "claude-opus-5.5", "gemini-4-argon"];
const SAMPLE_LABEL = "밤에 머무는 로맨스 대화 (relationship_turn_safe)";
const PRIOR_SPENT_KRW = 62;
const CAP_KRW = 1000;

type LiveEntry = {
  modelId: string;
  timings: { totalMs: number; providerStreamMs: number | null; classifierMs: number | null };
  sseEventTimeline: Array<{ atMs: number; type: string | null; textChars?: number }>;
  rawProviderOutput: { text: string; usage: { usage?: UsageTokens } | null };
  guardCheck: { classifierResponseBody: string[]; recordedDecision: unknown };
  userDelivered: {
    status: string | null;
    sseText: string;
    persistedText: string;
    messageApiContainsPersisted: boolean | null;
  };
  cost: { ledger: CostLedgerRow[]; usdKrwEffective: number; ledgerKrwEffective: number };
};

type ProbeRow = {
  id: string;
  group: string;
  expected: "allow" | "restrict";
  verdict: { decision: string; category: string; confidence: string; firstParagraph: number };
};

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(DIR, `${name}.json`), "utf8")) as T;
}

function reparseVerdict(body: string) {
  const completion = JSON.parse(body) as { choices?: Array<{ message?: { content?: string } }> };
  const content = completion.choices?.[0]?.message?.content ?? "";
  const verdict = parseAdultOffClassifierOutput(content);
  return {
    decision: verdict.decision,
    category: verdict.category,
    confidence: verdict.confidence,
    firstParagraph: verdict.firstParagraph,
    wouldBlockAsUncertain: verdict.decision === "allow" && verdict.confidence === "low",
  };
}

/**
 * 저장된 sseText 는 replace(본문)와 done.finalContent(저장 본문)를 단순 연결한 값이다.
 * 타임라인의 replace textChars 로 두 구간을 나눠 원래 이벤트 의미로 복원한다.
 */
function rebuildEvents(entry: LiveEntry): Array<{ atMs: number; event: SseEvent }> {
  const replaceChars = entry.sseEventTimeline.find((e) => e.type === "replace")?.textChars ?? 0;
  const replaceText = entry.userDelivered.sseText.slice(0, replaceChars);
  const finalContent = entry.userDelivered.sseText.slice(replaceChars);
  return entry.sseEventTimeline.map((e) => {
    if (e.type === "replace") return { atMs: e.atMs, event: { type: "replace", text: replaceText } };
    if (e.type === "done") return { atMs: e.atMs, event: { type: "done", finalContent } };
    return { atMs: e.atMs, event: { type: e.type } };
  });
}

function analyzeLive(modelId: string) {
  const entry = readJson<LiveEntry>(modelId);
  const verdicts = entry.guardCheck.classifierResponseBody.map(reparseVerdict);
  const events = rebuildEvents(entry);
  const timeline = reconstructScreenTimeline(events);
  const screen = events.reduce(
    (text, { event }) =>
      event.type === "replace" ? String(event.text) : event.type === "done" ? String(event.finalContent) : text,
    ""
  );
  const naiveConcatChars = entry.userDelivered.sseText.length;
  const rates = resolveOpenRouterModelRates(entry.modelId);
  const usage = entry.rawProviderOutput.usage?.usage ?? {};
  const estimates = new Map<string, number>([
    [
      "main-rp",
      estimateUsdFromUsage(usage, {
        inputUsdPerM: rates.inputUsdPerM,
        outputUsdPerM: rates.outputUsdPerM,
        cacheReadUsdPerM: resolveCacheReadUsdPerM(rates),
        cacheWriteUsdPerM: resolveCacheWriteUsdPerM(rates),
      }),
    ],
  ]);
  const cost = classifyCostRows(entry.cost.ledger, estimates);
  const fx = entry.cost.usdKrwEffective;
  return {
    modelId,
    sample: SAMPLE_LABEL,
    scope: "정상 로맨스 표본. 키스·포옹 생성 검증이 아니다.",
    verdicts,
    recordedDecisionInUsageJson: entry.guardCheck.recordedDecision,
    screen: {
      ...screenBeforeAndAfter(timeline),
      reconstructedChars: screen.length,
      equalsPersisted: screen === entry.userDelivered.persistedText,
      naiveConcatChars,
      naiveConcatIsInvalid: naiveConcatChars !== screen.length,
      persistedChars: entry.userDelivered.persistedText.length,
    },
    messageApi: {
      status: "unverifiable",
      note: "HTTP 상태·JSON 본문을 저장하지 않았다. messageApiContainsPersisted 는 원문 문자열 포함 검사라 JSON 이스케이프 때문에 false 가 나올 수 있어 유효한 증거가 아니다.",
      legacyMessageApiContainsPersisted: entry.userDelivered.messageApiContainsPersisted,
    },
    latency: splitLatency({
      totalMs: entry.timings.totalMs,
      providerMs: entry.timings.providerStreamMs,
      classifierMs: entry.timings.classifierMs,
    }),
    cost: {
      confirmedKrw: cost.confirmedUsd * fx,
      estimatedKrw: cost.estimatedUsd * fx,
      confirmedRows: cost.confirmedRows,
      estimatedRows: cost.estimatedRows,
      unconfirmedRows: cost.unconfirmedRows,
      legacyLedgerKrwEffective: entry.cost.ledgerKrwEffective,
    },
  };
}

function analyzeProbe() {
  const probe = readJson<{ rows: ProbeRow[]; totalCostKrw: number }>("classifier-probe");
  const normal = probe.rows.filter((row) => row.expected === "allow");
  const uncertain = normal.filter(
    (row) => row.verdict.decision === "allow" && row.verdict.confidence === "low"
  );
  const blockedNormal = normal.filter((row) => row.verdict.decision !== "allow");
  return {
    normalRomanceSamples: normal.length,
    normalBlockedByUncertainty: uncertain.length,
    normalBlockedByRestrictVerdict: blockedNormal.length,
    note: "표본 수가 작아 비율 추정이 아니다. 실제 운영 분포의 불확실성 차단 비율은 미측정이며 usage.adultOffGuard.lowConfidenceAllow 로 수집한다.",
  };
}

function main(): void {
  const live = MODEL_FILES.map(analyzeLive);
  const probe = analyzeProbe();
  const confirmedKrw = live.reduce((sum, row) => sum + row.cost.confirmedKrw, 0);
  const estimatedKrw = live.reduce((sum, row) => sum + row.cost.estimatedKrw, 0);
  const unconfirmedCount = live.reduce((sum, row) => sum + row.cost.unconfirmedRows.length, 0);
  const probeKrw = readJson<{ totalCostKrw: number }>("classifier-probe").totalCostKrw;
  const totals = {
    liveConfirmedKrw: confirmedKrw,
    liveEstimatedKrw: estimatedKrw,
    liveUnconfirmedCalls: unconfirmedCount,
    probeConfirmedKrw: probeKrw,
    priorSpentKrw: PRIOR_SPENT_KRW,
    knownCumulativeKrw: PRIOR_SPENT_KRW + probeKrw + confirmedKrw + estimatedKrw,
    capKrw: CAP_KRW,
    note: "미확정 호출은 0으로 합산하지 않고 건수로만 보고한다.",
  };
  const out = { live, probe, totals };
  writeFileSync(join(DIR, "reanalysis.json"), JSON.stringify(out, null, 2));
  console.info(JSON.stringify(out, null, 2));
}

main();
