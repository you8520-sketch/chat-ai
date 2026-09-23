"use client";

import { useState } from "react";
import Link from "next/link";
import type {
  AdminFinanceSummary,
  FinanceMonthlyAdjustments,
} from "@/lib/adminFinance";
import type { SchedulerRunOverview } from "@/lib/schedulerRunShared";
import {
  formatFinanceMarginRate,
  formatFinanceNetProfit,
} from "@/lib/adminFinanceMarginDisplay";
import type {
  AdminHistoricalCorrelationCandidate,
  AdminHistoricalCorrelationState,
  AdminProviderRequestForensicRecord,
} from "@/lib/adminProviderRequestLookup";
import {
  BROADER_CORRELATION_WINDOW_SECONDS,
  DEFAULT_CORRELATION_WINDOW_SECONDS,
  LEDGER_CREATED_AT_SEMANTICS,
  LEDGER_INPUT_TOKEN_SEMANTICS,
} from "@/lib/adminProviderRequestLookupShared";

function won(value: number) {
  return `${Math.round(value).toLocaleString()}원`;
}

function rate(
  value: number | null,
  coverage: AdminFinanceSummary["marginCoverage"] | undefined,
  paidRevenueKrw: number
) {
  return formatFinanceMarginRate(value, coverage, paidRevenueKrw);
}

function profit(
  value: number | null,
  coverage: AdminFinanceSummary["marginCoverage"] | undefined,
  paidRevenueKrw: number
) {
  return formatFinanceNetProfit(value, coverage, paidRevenueKrw);
}

function Metric({
  label,
  value,
  tone = "normal",
}: {
  label: string;
  value: string;
  tone?: "normal" | "good" | "bad";
}) {
  const color =
    tone === "good" ? "text-emerald-300" : tone === "bad" ? "text-rose-300" : "text-zinc-50";
  return (
    <div className="rounded-2xl border border-white/10 bg-[#11131a] p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`mt-2 text-xl font-black ${color}`}>{value}</p>
    </div>
  );
}

const numberFields: Array<{
  key: keyof FinanceMonthlyAdjustments;
  label: string;
  hint: string;
}> = [
  { key: "railwayUsageKrw", label: "Railway 사용료", hint: "대시보드의 이번 달 사용액" },
  { key: "railwayTaxKrw", label: "Railway 세금", hint: "청구서에 표시된 VAT·판매세" },
  { key: "paymentGatewayFeesKrw", label: "결제·PG 수수료", hint: "카드·PortOne 실제 수수료" },
  { key: "creatorTransferFeesKrw", label: "크리에이터 송금 수수료", hint: "은행·지급대행 비용" },
  { key: "creatorExtraIncentivesKrw", label: "추가 인센티브", hint: "기본 CP 보상 외 지급액" },
  { key: "otherCostsKrw", label: "기타 유지비", hint: "도메인·스토리지·기타 비용" },
];

function schedulerStateLabel(state: SchedulerRunOverview["state"]): string {
  switch (state) {
    case "SUCCEEDED":
      return "정상 완료";
    case "RUNNING":
      return "실행 중";
    case "FAILED":
      return "실패";
    case "STALE_BLOCKED":
      return "stale · 수동 확인 필요";
    case "MISSING":
      return "예정 실행 누락";
    case "NOT_DUE":
      return "아직 실행 시각 전";
    case "PRE_ACTIVATION":
      return "registry 적용 전 슬롯";
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

function schedulerStateClass(state: SchedulerRunOverview["state"]): string {
  if (state === "SUCCEEDED") return "text-emerald-300";
  if (state === "RUNNING") return "text-cyan-300";
  if (state === "FAILED" || state === "STALE_BLOCKED" || state === "MISSING") {
    return "text-rose-300";
  }
  return "text-zinc-400";
}

export default function AdminFinanceClient({
  initialSummary,
  initialSchedulerRuns,
}: {
  initialSummary: AdminFinanceSummary;
  initialSchedulerRuns: SchedulerRunOverview[];
}) {
  const [summary, setSummary] = useState(initialSummary);
  const [form, setForm] = useState(initialSummary.adjustments);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [providerRequestIdQuery, setProviderRequestIdQuery] = useState("");
  const [providerRequestLookupLoading, setProviderRequestLookupLoading] = useState(false);
  const [providerRequestLookupError, setProviderRequestLookupError] = useState("");
  const [providerRequestLookupResult, setProviderRequestLookupResult] =
    useState<AdminProviderRequestForensicRecord | null>(null);
  const [providerRequestMatchingRowCount, setProviderRequestMatchingRowCount] = useState(0);
  const [providerRequestDuplicateDetected, setProviderRequestDuplicateDetected] = useState(false);
  const [providerRequestLookupSearched, setProviderRequestLookupSearched] = useState(false);
  const [correlationForm, setCorrelationForm] = useState({
    provider: "cheaperinference",
    model: "gpt-5.6-luna",
    requestedAtUtc: "",
    durationMs: "",
    originalInputTokens: "",
    sentToModelTokens: "",
    outputTokens: "",
    windowSeconds: String(DEFAULT_CORRELATION_WINDOW_SECONDS),
  });
  const [correlationLoading, setCorrelationLoading] = useState(false);
  const [correlationError, setCorrelationError] = useState("");
  const [correlationState, setCorrelationState] = useState<AdminHistoricalCorrelationState | null>(
    null
  );
  const [correlationCandidates, setCorrelationCandidates] = useState<
    AdminHistoricalCorrelationCandidate[]
  >([]);
  const [correlationExpectedCompletionUtc, setCorrelationExpectedCompletionUtc] = useState("");
  const [correlationWindowSeconds, setCorrelationWindowSeconds] = useState(
    DEFAULT_CORRELATION_WINDOW_SECONDS
  );
  const [correlationSearched, setCorrelationSearched] = useState(false);

  async function loadMonth(monthKey: string) {
    const res = await fetch(`/api/admin/finance?month=${encodeURIComponent(monthKey)}`);
    const data = await res.json();
    if (!res.ok) return setMessage(data.error || "불러오지 못했습니다.");
    setSummary(data.summary);
    setForm(data.summary.adjustments);
  }

  async function lookupProviderRequest() {
    const trimmed = providerRequestIdQuery.trim();
    if (!trimmed) {
      setProviderRequestLookupError("Provider Request ID를 입력하세요.");
      setProviderRequestLookupResult(null);
      setProviderRequestMatchingRowCount(0);
      setProviderRequestDuplicateDetected(false);
      setProviderRequestLookupSearched(false);
      return;
    }
    setProviderRequestLookupLoading(true);
    setProviderRequestLookupError("");
    setProviderRequestLookupResult(null);
    setProviderRequestMatchingRowCount(0);
    setProviderRequestDuplicateDetected(false);
    setProviderRequestLookupSearched(false);
    try {
      const res = await fetch(
        `/api/admin/finance/provider-request?providerRequestId=${encodeURIComponent(trimmed)}`
      );
      const data = (await res.json()) as {
        error?: string;
        found?: boolean;
        event?: AdminProviderRequestForensicRecord | null;
        matchingRowCount?: number;
        duplicateDetected?: boolean;
      };
      if (!res.ok) {
        setProviderRequestLookupError(data.error || "조회하지 못했습니다.");
        return;
      }
      setProviderRequestLookupSearched(true);
      setProviderRequestLookupResult(data.found ? (data.event ?? null) : null);
      setProviderRequestMatchingRowCount(data.matchingRowCount ?? 0);
      setProviderRequestDuplicateDetected(Boolean(data.duplicateDetected));
      if (!data.found) {
        setProviderRequestLookupError("canonical ledger에 해당 Request ID가 없습니다.");
      }
    } catch {
      setProviderRequestLookupError("조회하지 못했습니다.");
    } finally {
      setProviderRequestLookupLoading(false);
    }
  }

  async function correlateHistoricalLedger(useBroaderWindow = false) {
    const durationMs = Number(correlationForm.durationMs);
    const originalInputTokens = Number(correlationForm.originalInputTokens);
    const sentToModelTokens = Number(correlationForm.sentToModelTokens);
    const outputTokens = Number(correlationForm.outputTokens);
    const windowSeconds = useBroaderWindow
      ? BROADER_CORRELATION_WINDOW_SECONDS
      : Number(correlationForm.windowSeconds) || DEFAULT_CORRELATION_WINDOW_SECONDS;

    if (!correlationForm.requestedAtUtc.trim()) {
      setCorrelationError("requestedAtUtc를 입력하세요.");
      setCorrelationState(null);
      setCorrelationCandidates([]);
      setCorrelationSearched(false);
      return;
    }
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      setCorrelationError("durationMs를 입력하세요.");
      return;
    }
    if (
      !Number.isFinite(originalInputTokens) ||
      !Number.isFinite(sentToModelTokens) ||
      !Number.isFinite(outputTokens)
    ) {
      setCorrelationError("토큰 필드를 입력하세요.");
      return;
    }

    setCorrelationLoading(true);
    setCorrelationError("");
    setCorrelationState(null);
    setCorrelationCandidates([]);
    setCorrelationExpectedCompletionUtc("");
    setCorrelationSearched(false);
    try {
      const res = await fetch("/api/admin/finance/provider-request/correlate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: correlationForm.provider.trim() || "cheaperinference",
          model: correlationForm.model.trim(),
          requestedAtUtc: correlationForm.requestedAtUtc.trim(),
          durationMs,
          originalInputTokens,
          sentToModelTokens,
          outputTokens,
          windowSeconds,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        state?: AdminHistoricalCorrelationState;
        candidates?: AdminHistoricalCorrelationCandidate[];
        expectedCompletionUtc?: string;
        windowSeconds?: number;
      };
      if (!res.ok) {
        setCorrelationError(data.error || "상관 조회하지 못했습니다.");
        return;
      }
      setCorrelationSearched(true);
      setCorrelationState(data.state ?? null);
      setCorrelationCandidates(data.candidates ?? []);
      setCorrelationExpectedCompletionUtc(data.expectedCompletionUtc ?? "");
      setCorrelationWindowSeconds(data.windowSeconds ?? windowSeconds);
    } catch {
      setCorrelationError("상관 조회하지 못했습니다.");
    } finally {
      setCorrelationLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    setMessage("");
    const res = await fetch("/api/admin/finance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) return setMessage(data.error || "저장하지 못했습니다.");
    setSummary(data.summary);
    setForm(data.summary.adjustments);
    setMessage("저장했습니다.");
  }

  const positive = summary.netProfitKrw != null && summary.netProfitKrw >= 0;
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 text-zinc-100">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/settings" className="text-sm text-zinc-500 hover:text-zinc-200">
            ← 설정
          </Link>
          <h1 className="mt-2 text-2xl font-black">사이트 유지비 · 실제 수익률</h1>
          <p className="mt-1 text-sm text-zinc-500">
            유료 포인트만 매출로 계산하고 무료 포인트는 원가만 반영합니다.
            순이익·수익률은 확정 원가 기준이며, AI 원가 커버리지를 함께 확인하세요.
          </p>
        </div>
        <input
          type="month"
          value={form.monthKey}
          onChange={(event) => void loadMonth(event.target.value)}
          className="rounded-xl border border-white/10 bg-[#11131a] px-3 py-2 text-sm"
        />
      </div>

      <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric
          label="최종 순이익"
          value={profit(
            summary.netProfitKrw,
            summary.marginCoverage,
            summary.chat.paidRevenueKrw + summary.image.paidRevenueKrw + summary.giftFeeRevenueKrw
          )}
          tone={summary.netProfitKrw == null ? "normal" : positive ? "good" : "bad"}
        />
        <Metric
          label="전체 순마진율"
          value={rate(
            summary.marginRate,
            summary.marginCoverage,
            summary.chat.paidRevenueKrw + summary.image.paidRevenueKrw + summary.giftFeeRevenueKrw
          )}
          tone={summary.marginRate == null ? "normal" : positive ? "good" : "bad"}
        />
        <Metric label="실제 결제 유입" value={won(summary.paymentsCollectedKrw)} />
        <Metric label="유료 포인트 사용 매출" value={won(summary.paidPointsConsumed)} />
        <Metric
          label={`전체 AI 원가${summary.aiCost.coveragePct == null ? "" : ` · 실제확정 ${summary.aiCost.coveragePct}%`}`}
          value={won(summary.aiCost.totalKrw)}
        />
        <Metric label="무료 포인트 사용" value={`${summary.freePointsConsumed.toLocaleString()}P`} />
        <Metric label="AI·이미지 API 원가" value={won(summary.totalApiCostKrw)} />
        <Metric label="Railway 총비용" value={won(summary.railwayCostKrw)} />
        <Metric label="선물 수수료 수익" value={won(summary.giftFeeRevenueKrw)} />
      </section>

      <section className="mt-6 rounded-2xl border border-sky-500/20 bg-sky-950/10 p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-bold">백그라운드 스케줄러 상태</h2>
            <p className="mt-1 text-xs text-zinc-500">
              DB durable slot 기준입니다. 프로세스 재시작·다중 replica에서도 동일 슬롯은 한 owner만 실행합니다.
            </p>
          </div>
          <p className="text-[11px] text-zinc-600">Asia/Seoul · read-only</p>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-y border-white/10 text-xs text-zinc-500">
              <tr>
                <th className="p-2">작업</th>
                <th className="p-2">현재 슬롯</th>
                <th className="p-2">상태</th>
                <th className="p-2">최근 실행</th>
                <th className="p-2">시도</th>
                <th className="p-2">트리거</th>
              </tr>
            </thead>
            <tbody>
              {initialSchedulerRuns.map((run) => {
                const observed = run.current ?? run.latest;
                return (
                  <tr key={run.jobName} className="border-b border-white/[0.06]">
                    <td className="p-2">
                      <p className="font-semibold">{run.label}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-zinc-600">
                        {run.jobName} · {run.cronExpression}
                      </p>
                    </td>
                    <td className="p-2 font-mono text-xs">{run.currentSlotKey}</td>
                    <td className={`p-2 font-bold ${schedulerStateClass(run.state)}`}>
                      {schedulerStateLabel(run.state)}
                      {run.state === "MISSING" && (
                        <span className="mt-1 block text-[10px] font-normal text-zinc-500">
                          다음 부팅 시 안전한 current-slot recovery 대상
                        </span>
                      )}
                    </td>
                    <td className="p-2 text-xs text-zinc-400">
                      {observed?.finished_at ?? observed?.heartbeat_at ?? "기록 없음"}
                      {observed?.last_error && (
                        <span className="mt-1 block max-w-[22rem] text-rose-300/80">
                          {observed.last_error}
                        </span>
                      )}
                    </td>
                    <td className="p-2">{observed?.attempt_count ?? 0}</td>
                    <td className="p-2 text-xs text-zinc-400">
                      {observed?.trigger_kind ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        {[
          ["채팅 전체", summary.chat],
          ["이미지 생성", summary.image],
        ].map(([label, item]) => {
          const value = item as AdminFinanceSummary["chat"];
          return (
            <article key={String(label)} className="rounded-2xl border border-white/10 bg-[#0e1016] p-5">
              <h2 className="font-bold">{String(label)}</h2>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-zinc-500">유료 매출</dt><dd className="mt-1 font-bold">{won(value.paidRevenueKrw)}</dd></div>
                <div><dt className="text-zinc-500">무료 사용</dt><dd className="mt-1 font-bold">{value.freePointSpend.toLocaleString()}P</dd></div>
                <div><dt className="text-zinc-500">API 원가</dt><dd className="mt-1 font-bold">{won(value.apiCostKrw)}</dd></div>
                <div><dt className="text-zinc-500">순마진</dt><dd className="mt-1 font-bold">{profit(value.netProfitKrw, value.marginCoverage, value.paidRevenueKrw)} · {rate(value.marginRate, value.marginCoverage, value.paidRevenueKrw)}</dd></div>
              </dl>
            </article>
          );
        })}
      </section>

      <section className="mt-6 rounded-2xl border border-cyan-500/20 bg-cyan-950/10 p-5">
        <h2 className="font-bold">Provider Request ID 조회</h2>
        <p className="mt-1 text-xs text-zinc-500">
          canonical <code className="text-zinc-400">api_cost_ledger</code>에서 정확한 Request ID로
          owner·원가·provenance를 조회합니다. 프롬프트·메시지 본문은 포함하지 않습니다.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="min-w-[min(100%,28rem)] flex-1 text-sm">
            <span className="font-semibold">Provider Request ID</span>
            <input
              type="text"
              value={providerRequestIdQuery}
              onChange={(event) => setProviderRequestIdQuery(event.target.value)}
              placeholder="db55b018-5ee0-4975-8bc7-dde23689c438"
              className="mt-1 w-full rounded-xl border border-white/10 bg-[#151821] px-3 py-2 font-mono text-xs"
            />
          </label>
          <button
            type="button"
            onClick={() => void lookupProviderRequest()}
            disabled={providerRequestLookupLoading}
            className="rounded-xl border border-cyan-500/30 bg-cyan-950/40 px-5 py-2.5 text-sm font-bold disabled:opacity-50"
          >
            {providerRequestLookupLoading ? "조회 중…" : "조회"}
          </button>
        </div>
        {providerRequestLookupError && (
          <p className="mt-3 text-sm text-amber-300/90">{providerRequestLookupError}</p>
        )}
        {providerRequestLookupResult && (
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-zinc-500">Owner / requestKind</dt>
              <dd className="mt-1 font-bold">
                {providerRequestLookupResult.canonicalOwner}
                <span className="mt-1 block font-mono text-xs font-normal text-zinc-400">
                  {providerRequestLookupResult.requestKind}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">Model</dt>
              <dd className="mt-1 font-bold">
                {providerRequestLookupResult.actualModel ?? providerRequestLookupResult.model}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">Tokens (in / out)</dt>
              <dd className="mt-1 font-bold">
                {providerRequestLookupResult.inputTokens.toLocaleString()} /{" "}
                {providerRequestLookupResult.outputTokens.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">Actual cost</dt>
              <dd className="mt-1 font-bold">
                {providerRequestLookupResult.actualCostUsd != null
                  ? `$${providerRequestLookupResult.actualCostUsd.toFixed(6)}`
                  : "—"}
                {providerRequestLookupResult.actualCostSource && (
                  <span className="mt-1 block text-xs font-normal text-zinc-500">
                    {providerRequestLookupResult.actualCostSource}
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">Timestamp</dt>
              <dd className="mt-1 font-bold">{providerRequestLookupResult.createdAt}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Linkage</dt>
              <dd className="mt-1 font-bold">
                {providerRequestLookupResult.turnLinked
                  ? `Turn-linked · message ${providerRequestLookupResult.assistantMessageId}`
                  : "Background (assistant_message_id=null)"}
                {providerRequestLookupResult.chatId != null && (
                  <span className="mt-1 block text-xs font-normal text-zinc-500">
                    chat {providerRequestLookupResult.chatId}
                    {providerRequestLookupResult.generationSequence != null
                      ? ` · gen ${providerRequestLookupResult.generationSequence}`
                      : ""}
                  </span>
                )}
              </dd>
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <dt className="text-zinc-500">Ledger identity</dt>
              <dd className="mt-1 font-bold">
                {providerRequestDuplicateDetected
                  ? `Ledger identity anomaly: ${providerRequestMatchingRowCount} matching rows`
                  : "Ledger identity: OK"}
              </dd>
              <dd className="mt-1 font-mono text-xs text-zinc-400">
                id={providerRequestLookupResult.id} · family={providerRequestLookupResult.family ?? "—"} ·
                phase={providerRequestLookupResult.executionPhase ?? "—"} · status=
                {providerRequestLookupResult.eventStatus ?? "—"} · attribution=
                {providerRequestLookupResult.costAttribution}
                {providerRequestDuplicateDetected
                  ? " · display=oldest row (no cost sum)"
                  : ""}
              </dd>
            </div>
          </dl>
        )}
        {providerRequestLookupSearched && !providerRequestLookupResult && !providerRequestLookupError && (
          <p className="mt-3 text-sm text-zinc-500">조회 결과 없음</p>
        )}

        <div className="mt-8 border-t border-cyan-500/20 pt-6">
          <h3 className="font-bold">Historical Ledger Correlation</h3>
          <p className="mt-1 text-xs text-zinc-500">
            Provider dashboard 타이밍·토큰으로 canonical ledger 후보를 좁힙니다. Request ID가
            없거나 ledger에 없을 때 보조 조회입니다. ledger input ={" "}
            <code className="text-zinc-400">{LEDGER_INPUT_TOKEN_SEMANTICS}</code>, created_at ≈{" "}
            <code className="text-zinc-400">{LEDGER_CREATED_AT_SEMANTICS}</code>.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["provider", "Provider", "cheaperinference"],
              ["model", "Model", "gpt-5.6-luna"],
              ["requestedAtUtc", "requestedAtUtc (ISO)", "2026-09-19T13:42:44.316Z"],
              ["durationMs", "durationMs", "12970"],
              ["originalInputTokens", "Original input tokens", "6564"],
              ["sentToModelTokens", "Sent to model tokens", "8553"],
              ["outputTokens", "Output tokens", "1655"],
              ["windowSeconds", `Window ±seconds (max ${BROADER_CORRELATION_WINDOW_SECONDS})`, String(DEFAULT_CORRELATION_WINDOW_SECONDS)],
            ].map(([key, label, placeholder]) => (
              <label key={key} className="text-sm">
                <span className="font-semibold">{label}</span>
                <input
                  type="text"
                  value={correlationForm[key as keyof typeof correlationForm]}
                  onChange={(event) =>
                    setCorrelationForm((prev) => ({ ...prev, [key]: event.target.value }))
                  }
                  placeholder={placeholder}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-[#151821] px-3 py-2 font-mono text-xs"
                />
              </label>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void correlateHistoricalLedger(false)}
              disabled={correlationLoading}
              className="rounded-xl border border-cyan-500/30 bg-cyan-950/40 px-5 py-2.5 text-sm font-bold disabled:opacity-50"
            >
              {correlationLoading ? "상관 조회 중…" : "상관 조회"}
            </button>
            <button
              type="button"
              onClick={() => void correlateHistoricalLedger(true)}
              disabled={correlationLoading}
              className="rounded-xl border border-amber-500/30 bg-amber-950/30 px-5 py-2.5 text-sm font-bold disabled:opacity-50"
            >
              ±{BROADER_CORRELATION_WINDOW_SECONDS}s 수동 fallback
            </button>
          </div>
          {correlationError && (
            <p className="mt-3 text-sm text-amber-300/90">{correlationError}</p>
          )}
          {correlationSearched && correlationState && (
            <div className="mt-4 space-y-4">
              <p className="text-sm">
                <span className="font-bold">State:</span>{" "}
                <code className="text-cyan-300">{correlationState}</code>
                {" · "}
                expected completion{" "}
                <code className="text-zinc-400">{correlationExpectedCompletionUtc}</code>
                {" · "}
                window ±{correlationWindowSeconds}s
              </p>
              {correlationState === "NO_CANDIDATE" && (
                <p className="text-sm text-zinc-400">
                  bounded window 내 canonical ledger 후보 없음 — 외부 호출 감사는 다음 단계.
                </p>
              )}
              {correlationCandidates.map((candidate, index) => (
                <article
                  key={candidate.event.id}
                  className="rounded-xl border border-white/10 bg-[#151821] p-4"
                >
                  <p className="text-xs font-bold text-zinc-400">
                    Candidate {index + 1} · owner interpretation:{" "}
                    <code className="text-amber-200">{candidate.ownerInterpretation}</code>
                  </p>
                  <p className="mt-2 text-sm font-bold">Correlation evidence:</p>
                  <ul className="mt-1 list-inside list-disc text-xs text-zinc-400">
                    <li>provider: {candidate.evidence.providerMatch ? "exact" : "mismatch"}</li>
                    <li>model: {candidate.evidence.modelMatch ? "exact" : "mismatch"}</li>
                    <li>
                      completion time:{" "}
                      {candidate.evidence.timeMatch
                        ? `within ${((candidate.evidence.timeDeltaMs ?? 0) / 1000).toFixed(1)}s`
                        : "outside window"}
                    </li>
                    <li>
                      output tokens:{" "}
                      {candidate.evidence.outputTokensMatch ? "exact" : "mismatch"}
                    </li>
                    <li>input tokens: {candidate.evidence.inputTokenMatchType.replace(/_/g, " ")}</li>
                    <li>
                      provider request id:{" "}
                      {candidate.evidence.providerRequestIdPresent ? "present" : "missing"}
                    </li>
                    <li>
                      linkage:{" "}
                      {candidate.evidence.turnLinked
                        ? `turn-linked · message ${candidate.evidence.assistantMessageId}`
                        : "background (assistant_message_id=null)"}
                    </li>
                  </ul>
                  <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <dt className="text-zinc-500">requestKind</dt>
                      <dd className="font-mono text-xs">{candidate.event.requestKind}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">createdAt</dt>
                      <dd className="font-mono text-xs">{candidate.event.createdAt}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">Tokens (in / out)</dt>
                      <dd>
                        {candidate.event.inputTokens.toLocaleString()} /{" "}
                        {candidate.event.outputTokens.toLocaleString()}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">Actual cost</dt>
                      <dd>
                        {candidate.event.actualCostUsd != null
                          ? `$${candidate.event.actualCostUsd.toFixed(6)}`
                          : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">Ledger id</dt>
                      <dd className="font-mono text-xs">{candidate.event.id}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">Canonical owner</dt>
                      <dd>{candidate.event.canonicalOwner}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-violet-500/20 bg-violet-950/10 p-5">
        <h2 className="font-bold">AI 실제 원가</h2>
        <p className="mt-1 text-xs text-zinc-500">
          provider 확정 원가 우선 · 추정 fallback 분리 · 미분류 포함 ·{" "}
          {summary.aiCost.lastRecordedAt
            ? `최근 기록 ${summary.aiCost.lastRecordedAt}`
            : "기록 없음"}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><p className="text-zinc-500">전체 실제 원가</p><p className="mt-1 font-bold">{won(summary.aiCost.totalKrw)}</p></div>
          <div><p className="text-zinc-500">실제 확정</p><p className="mt-1 font-bold">{won(summary.aiCost.totalActualKrw)}</p></div>
          <div><p className="text-zinc-500">추정 fallback</p><p className="mt-1 font-bold">{won(summary.aiCost.estimatedFallbackKrw)}</p></div>
          <div><p className="text-zinc-500">미분류</p><p className="mt-1 font-bold">{won(summary.aiCost.unattributedKrw)} ({summary.aiCost.unattributedCalls.toLocaleString()}회)</p></div>
          <div><p className="text-zinc-500">총 호출</p><p className="mt-1 font-bold">{summary.aiCost.calls.toLocaleString()}회</p></div>
          <div><p className="text-zinc-500">입력 / 출력 토큰</p><p className="mt-1 font-bold">{summary.aiCost.inputTokens.toLocaleString()} / {summary.aiCost.outputTokens.toLocaleString()}</p></div>
          <div><p className="text-zinc-500">실제 원가 커버리지</p><p className="mt-1 font-bold">{summary.aiCost.coveragePct == null ? "기록 없음" : `${summary.aiCost.coveragePct}%`}</p></div>
          <div><p className="text-zinc-500">환율</p><p className="mt-1 font-bold">₩{Math.round(summary.exchangeRateKrwPerUsd).toLocaleString()}/USD</p></div>
        </div>
        <h3 className="mt-5 text-sm font-bold text-zinc-300">기능별 AI 원가</h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-y border-white/10 text-xs text-zinc-500">
              <tr><th className="p-2">기능</th><th className="p-2">호출</th><th className="p-2">실제 원가</th><th className="p-2">추정</th><th className="p-2">비중</th></tr>
            </thead>
            <tbody>
              {summary.aiCost.byCenter.map((row) => (
                <tr key={row.center} className="border-b border-white/[0.06]">
                  <td className="p-2 font-semibold">{row.center}</td>
                  <td className="p-2">{row.calls.toLocaleString()}회</td>
                  <td className="p-2">{won(row.actualKrw)}</td>
                  <td className="p-2">{won(row.estimatedKrw)}</td>
                  <td className="p-2">{row.sharePct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6 overflow-hidden rounded-2xl border border-white/10">
        <div className="bg-[#11131a] px-5 py-4"><h2 className="font-bold">모델별 실제 원가 · 귀속매출 · 기여손익</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-y border-white/10 text-xs text-zinc-500">
              <tr><th className="p-3">모델</th><th className="p-3">구분</th><th className="p-3">호출</th><th className="p-3">유료 매출</th><th className="p-3">실제 원가</th><th className="p-3">추정</th><th className="p-3">기여손익</th><th className="p-3">상태</th></tr>
            </thead>
            <tbody>
              {summary.aiModelCosts.length ? summary.aiModelCosts.map((row) => (
                <tr key={`${row.kind}:${row.model}`} className="border-b border-white/[0.06]">
                  <td className="p-3 font-semibold">{row.model === "(unattributed model)" ? "미분류 모델" : row.model}</td>
                  <td className="p-3 text-zinc-400">{row.kind === "direct" ? "직접" : "간접 AI 비용"}</td>
                  <td className="p-3">{row.calls == null ? "-" : `${row.calls.toLocaleString()}회`}</td>
                  <td className="p-3">{row.kind === "direct" ? won(row.paidRevenueKrw) : "-"}</td>
                  <td className="p-3">{won(row.actualKrw)}</td>
                  <td className="p-3">{won(row.estimatedKrw)}</td>
                  <td className="p-3">
                    {row.contributionKrw == null
                      ? <span className="text-zinc-500">-</span>
                      : `${won(row.contributionKrw)}${row.marginRate == null ? "" : ` (${(row.marginRate * 100).toFixed(1)}%)`}`}
                  </td>
                  <td className="p-3 text-zinc-400">{
                    row.sourceState === "actual_auto" ? "실제확정"
                    : row.sourceState === "estimated_auto" ? "추정"
                    : "미확정"
                  }</td>
                </tr>
              )) : (
                <tr><td colSpan={8} className="p-8 text-center text-zinc-500">아직 집계할 결제 사용 내역이 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {summary.zeroUseModels.length > 0 && (
          <details className="border-t border-white/10 px-5 py-3 text-sm">
            <summary className="cursor-pointer text-zinc-400">
              사용량 0 모델 {summary.zeroUseModels.length}개
            </summary>
            <ul className="mt-2 space-y-1 text-zinc-500">
              {summary.zeroUseModels.map((m) => (
                <li key={m.id}>{m.label} <span className="text-zinc-600">({m.id})</span></li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="mt-6 rounded-2xl border border-white/10 bg-[#0e1016] p-5">
        <h2 className="font-bold">실제 청구 비용 입력</h2>
        <p className="mt-1 text-xs text-zinc-500">Railway와 결제 수수료는 청구서 확정액을 입력해야 정확합니다.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {numberFields.map((field) => (
            <label key={field.key} className="text-sm">
              <span className="font-semibold">{field.label}</span>
              <input
                type="number"
                min="0"
                step="1"
                value={String(form[field.key])}
                onChange={(event) => setForm({ ...form, [field.key]: Number(event.target.value) })}
                className="mt-1 w-full rounded-xl border border-white/10 bg-[#151821] px-3 py-2"
              />
              <span className="mt-1 block text-[11px] text-zinc-600">{field.hint}</span>
            </label>
          ))}
          <label className="text-sm">
            <span className="font-semibold">해외 API 결제 세율</span>
            <input
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={String(form.providerTaxRate * 100)}
              onChange={(event) => setForm({ ...form, providerTaxRate: Number(event.target.value) / 100 })}
              className="mt-1 w-full rounded-xl border border-white/10 bg-[#151821] px-3 py-2"
            />
            <span className="mt-1 block text-[11px] text-zinc-600">청구서 기준 %, 국가별로 달라 자동 가정하지 않음</span>
          </label>
        </div>
        <textarea
          value={form.note}
          onChange={(event) => setForm({ ...form, note: event.target.value })}
          placeholder="이번 달 비용 메모"
          className="mt-4 min-h-24 w-full rounded-xl border border-white/10 bg-[#151821] px-3 py-2 text-sm"
        />
        <div className="mt-3 flex items-center gap-3">
          <button onClick={() => void save()} disabled={saving} className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold disabled:opacity-50">
            {saving ? "저장 중…" : "비용 저장 · 다시 계산"}
          </button>
          {message && <span className="text-sm text-zinc-400">{message}</span>}
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-white/10 bg-[#0e1016] p-5 text-sm">
        <h2 className="font-bold">크리에이터 비용·현금흐름</h2>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div><p className="text-zinc-500">이번 달 발생 보상(CP)</p><p className="mt-1 font-bold">{won(summary.creatorAccruedKrw)}</p></div>
          <div><p className="text-zinc-500">실제 출금 송금액</p><p className="mt-1 font-bold">{won(summary.creatorPayoutCashKrw)}</p></div>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-zinc-500">
          발생 보상은 순이익 비용으로 반영합니다. 출금액은 이미 쌓인 보상을 지급한 현금흐름이므로 순이익에서 다시 차감하지 않습니다. 플랫폼 출금 수수료는 회사 귀속이며, 실제 송금대행 수수료만 위 비용 입력에서 차감합니다.
        </p>
      </section>
    </main>
  );
}
