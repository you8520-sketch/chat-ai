"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  type AdminPayoutApplicationRow,
  type AdminPayoutAutomation,
  type AdminPayoutCounts,
  type AdminPayoutTaxPreview,
} from "@/lib/adminPayoutShared";
import { withdrawalStatusLabel } from "@/lib/creatorShared";

const FILTERS = [
  { id: "all", label: "전체" },
  { id: "PENDING", label: "지급 대기" },
  { id: "APPROVED", label: "지급 완료" },
  { id: "FAILED", label: "지급 실패" },
] as const;

function won(value: number) {
  return `₩${Math.round(value).toLocaleString()}`;
}

function cp(value: number) {
  return `${Number(value).toLocaleString()}CP`;
}

function statusClass(status: string) {
  switch (status) {
    case "APPROVED":
      return "text-emerald-300";
    case "FAILED":
    case "REJECTED":
      return "text-rose-300";
    case "PENDING":
      return "text-amber-300";
    default:
      return "text-zinc-300";
  }
}

export default function AdminPayoutExportClient() {
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, "0"));
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [rows, setRows] = useState<AdminPayoutApplicationRow[]>([]);
  const [counts, setCounts] = useState<AdminPayoutCounts | null>(null);
  const [automation, setAutomation] = useState<AdminPayoutAutomation | null>(null);
  const [taxPreview, setTaxPreview] = useState<AdminPayoutTaxPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const res = await fetch(
      `/api/admin/payout?status=${encodeURIComponent(filter)}&year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}`,
      { cache: "no-store" }
    );
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error || "목록을 불러오지 못했습니다.");
      return;
    }
    setRows(data.applications ?? []);
    setCounts(data.counts ?? null);
    setAutomation(data.automation ?? null);
    setTaxPreview(data.taxPreview ?? null);
  }, [filter, year, month]);

  useEffect(() => {
    void load();
  }, [load]);

  async function download() {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const res = await fetch(
        `/api/admin/payout/export?year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}`
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "다운로드에 실패했습니다.");
      }
      const blob = await res.blob();
      const count = res.headers.get("X-Export-Count") ?? "?";
      const filename = `정산내역_${year}_${String(month).padStart(2, "0")}.csv`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMsg(`${filename} 다운로드 완료 (${count}건)`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-8 w-full max-w-6xl space-y-6 px-4 pb-12">
      <div>
        <Link href="/settings" className="text-sm text-zinc-500 hover:text-zinc-200">
          ← 설정
        </Link>
        <h1 className="mt-2 text-xl font-black text-white">크리에이터 정산</h1>
        <p className="mt-1 text-sm text-gray-400">
          출금은 관리자 승인 없이 {automation?.scheduleLabel ?? "매월 15일 03:00 (Asia/Seoul)"}에
          자동 지급됩니다. 이 화면에서는 신청내역 확인과 세금계산 CSV 출력만 합니다.
        </p>
      </div>

      {automation && !automation.enabled && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          월간 자동 지급 스케줄러가 꺼져 있습니다. 프로덕션에서{" "}
          <code className="rounded bg-black/30 px-1">DISABLE_PAYOUT_SCHEDULER</code>를 제거하면
          매월 15일 대기 건이 자동 처리됩니다.
        </p>
      )}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="전체 신청" value={counts?.all ?? 0} />
        <SummaryCard label="지급 대기" value={counts?.pending ?? 0} tone="warn" />
        <SummaryCard label="지급 완료" value={counts?.approved ?? 0} tone="good" />
        <SummaryCard label="지급 실패" value={counts?.failed ?? 0} tone="bad" />
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#131626] p-5">
        <h2 className="text-sm font-bold text-white">세금계산 출력물</h2>
        <p className="mt-1 text-xs text-gray-400">
          선택한 달에 지급 완료된 건만 원천징수 신고용 CSV로 받습니다. 주민등록번호·실계좌는
          이 파일에만 들어갑니다.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-gray-400">연도</label>
            <input
              type="number"
              min={2000}
              max={2100}
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-[#0e1120] px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-400">월</label>
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-[#0e1120] px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
            >
              {Array.from({ length: 12 }, (_, i) => {
                const m = String(i + 1).padStart(2, "0");
                return (
                  <option key={m} value={m}>
                    {m}월
                  </option>
                );
              })}
            </select>
          </div>
        </div>

        {taxPreview && (
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-zinc-300 sm:grid-cols-5">
            <TaxStat label="지급 건수" value={`${taxPreview.count}건`} />
            <TaxStat label="총지급액" value={won(taxPreview.grossAmount)} />
            <TaxStat label="원천징수(국세)" value={won(taxPreview.nationalTax)} />
            <TaxStat label="지방세" value={won(taxPreview.localTax)} />
            <TaxStat label="실수령 합계" value={won(taxPreview.netPayout)} />
          </div>
        )}

        <button
          type="button"
          disabled={busy}
          onClick={() => void download()}
          className="mt-4 w-full rounded-xl bg-violet-600 py-2.5 text-sm font-bold text-white hover:bg-violet-500 disabled:opacity-40"
        >
          {busy ? "생성 중…" : "세금계산 CSV 다운로드"}
        </button>

        {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}
        {msg && <p className="mt-3 text-sm text-emerald-400">{msg}</p>}

        <p className="mt-3 text-[11px] leading-relaxed text-gray-600">
          CSV 헤더: 지급일자, 크리에이터명, 주민등록번호, 은행명, 계좌번호, 총지급액,
          원천징수세액(국세), 지방세, 실수령액 · UTF-8(BOM) · Excel 호환
        </p>
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#131626] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-white">출금 신청내역</h2>
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                  filter === item.id
                    ? "bg-violet-600 text-white"
                    : "bg-white/5 text-zinc-400 hover:bg-white/10"
                }`}
              >
                {item.label}
                {counts
                  ? ` (${
                      item.id === "all"
                        ? counts.all
                        : item.id === "PENDING"
                          ? counts.pending
                          : item.id === "APPROVED"
                            ? counts.approved
                            : counts.failed
                    })`
                  : ""}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <p className="mt-4 text-sm text-zinc-500">불러오는 중…</p>
        ) : rows.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">해당 조건의 신청이 없습니다.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {rows.map((row) => (
              <li
                key={row.id}
                className="rounded-xl border border-white/5 bg-[#0e1120] px-4 py-3 text-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-white">
                      #{row.id} {row.creatorName}
                      <span className="ml-2 text-xs font-normal text-zinc-500">
                        {row.nickname}
                        {row.email ? ` · ${row.email}` : ""}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-zinc-400">{row.accountLabel}</p>
                    <p className="mt-1 text-[11px] text-zinc-500">
                      신청 {row.createdAt}
                      {row.processedAt ? ` · 처리 ${row.processedAt}` : ""}
                    </p>
                    {row.failureReason ? (
                      <p className="mt-1 text-xs text-rose-300">실패 사유: {row.failureReason}</p>
                    ) : null}
                  </div>
                  <div className="text-right text-xs text-zinc-300">
                    <p className={`font-bold ${statusClass(row.status)}`}>
                      {withdrawalStatusLabel(row.status)}
                    </p>
                    <p className="mt-1 text-emerald-300">{won(row.payoutAmount)}</p>
                    <p className="text-[11px] text-zinc-500">
                      {cp(row.requestedCp)} · 세금 {cp(row.taxAmount)} · 수수료 {cp(row.platformFee)}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone = "normal",
}: {
  label: string;
  value: number;
  tone?: "normal" | "good" | "warn" | "bad";
}) {
  const color =
    tone === "good"
      ? "text-emerald-300"
      : tone === "warn"
        ? "text-amber-300"
        : tone === "bad"
          ? "text-rose-300"
          : "text-white";
  return (
    <div className="rounded-2xl border border-white/10 bg-[#11131a] p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`mt-2 text-xl font-black ${color}`}>{value.toLocaleString()}건</p>
    </div>
  );
}

function TaxStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-black/20 px-3 py-2">
      <p className="text-[10px] text-zinc-500">{label}</p>
      <p className="mt-0.5 font-semibold text-zinc-100">{value}</p>
    </div>
  );
}
