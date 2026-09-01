"use client";

import { useState } from "react";
import Link from "next/link";
import type {
  AdminFinanceSummary,
  FinanceMonthlyAdjustments,
} from "@/lib/adminFinance";

function won(value: number) {
  return `${Math.round(value).toLocaleString()}원`;
}

function rate(value: number | null, coverage?: AdminFinanceSummary["marginCoverage"]) {
  if (value != null) {
    return `${(value * 100).toFixed(1)}%`;
  }
  if (coverage === "partial") return "부분 집계 · 미확정";
  if (coverage === "estimated") return "추정 원가 포함 · 미확정";
  if (coverage === "unavailable") return "원가 미확정";
  return "매출 없음";
}

function profit(value: number | null, coverage?: AdminFinanceSummary["marginCoverage"]) {
  if (value == null) {
    if (coverage === "partial") return "부분 집계 · 미확정";
    if (coverage === "estimated") return "추정 원가 포함 · 미확정";
    if (coverage === "unavailable") return "원가 미확정";
    return "미확정";
  }
  return won(value);
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

export default function AdminFinanceClient({
  initialSummary,
}: {
  initialSummary: AdminFinanceSummary;
}) {
  const [summary, setSummary] = useState(initialSummary);
  const [form, setForm] = useState(initialSummary.adjustments);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function loadMonth(monthKey: string) {
    const res = await fetch(`/api/admin/finance?month=${encodeURIComponent(monthKey)}`);
    const data = await res.json();
    if (!res.ok) return setMessage(data.error || "불러오지 못했습니다.");
    setSummary(data.summary);
    setForm(data.summary.adjustments);
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
          value={profit(summary.netProfitKrw, summary.marginCoverage)}
          tone={summary.netProfitKrw == null ? "normal" : positive ? "good" : "bad"}
        />
        <Metric
          label="전체 순마진율"
          value={rate(summary.marginRate, summary.marginCoverage)}
          tone={summary.marginRate == null ? "normal" : positive ? "good" : "bad"}
        />
        <Metric label="실제 결제 유입" value={won(summary.paymentsCollectedKrw)} />
        <Metric label="유료 포인트 사용 매출" value={won(summary.paidPointsConsumed)} />
        <Metric label="무료 포인트 사용" value={`${summary.freePointsConsumed.toLocaleString()}P`} />
        <Metric label="AI·이미지 API 원가" value={won(summary.totalApiCostKrw)} />
        <Metric label="Railway 총비용" value={won(summary.railwayCostKrw)} />
        <Metric label="선물 수수료 수익" value={won(summary.giftFeeRevenueKrw)} />
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
                <div><dt className="text-zinc-500">순마진</dt><dd className="mt-1 font-bold">{profit(value.netProfitKrw, value.marginCoverage)} · {rate(value.marginRate, value.marginCoverage)}</dd></div>
              </dl>
            </article>
          );
        })}
      </section>

      <section className="mt-6 rounded-2xl border border-violet-500/20 bg-violet-950/10 p-5">
        <h2 className="font-bold">DeepSeek V4 Flash · 이번 달 실제 원가</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><p className="text-zinc-500">호출</p><p className="mt-1 font-bold">{summary.deepSeekV4Flash.calls.toLocaleString()}회</p></div>
          <div><p className="text-zinc-500">입력 / 출력</p><p className="mt-1 font-bold">{summary.deepSeekV4Flash.inputTokens.toLocaleString()} / {summary.deepSeekV4Flash.outputTokens.toLocaleString()}</p></div>
          <div><p className="text-zinc-500">세전 원가</p><p className="mt-1 font-bold">{won(summary.deepSeekV4Flash.costBeforeTaxKrw)}</p></div>
          <div><p className="text-zinc-500">환율·세금 포함</p><p className="mt-1 font-bold">{won(summary.deepSeekV4Flash.costWithTaxKrw)}</p></div>
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          환율 ₩{Math.round(summary.exchangeRateKrwPerUsd).toLocaleString()}/USD 적용 · 매일 12:00 KST 저장
        </p>
      </section>

      <section className="mt-6 overflow-hidden rounded-2xl border border-white/10">
        <div className="bg-[#11131a] px-5 py-4"><h2 className="font-bold">채팅 모델별 평균 마진</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="border-y border-white/10 text-xs text-zinc-500">
              <tr><th className="p-3">모델</th><th className="p-3">유료 매출</th><th className="p-3">무료 사용</th><th className="p-3">API 원가</th><th className="p-3">순마진</th></tr>
            </thead>
            <tbody>
              {summary.modelBreakdown.length ? summary.modelBreakdown.map((row) => (
                <tr key={row.model} className="border-b border-white/[0.06]">
                  <td className="p-3 font-semibold">{row.model}</td>
                  <td className="p-3">{won(row.paidRevenueKrw)}</td>
                  <td className="p-3">{row.freePointSpend.toLocaleString()}P</td>
                  <td className="p-3">{won(row.apiCostKrw)}</td>
                  <td className="p-3">{profit(row.netProfitKrw, row.marginCoverage)} · {rate(row.marginRate, row.marginCoverage)}</td>
                </tr>
              )) : (
                <tr><td colSpan={5} className="p-8 text-center text-zinc-500">아직 집계할 결제 사용 내역이 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
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
