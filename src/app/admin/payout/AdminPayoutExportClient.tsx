"use client";

import { useState } from "react";

export default function AdminPayoutExportClient() {
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, "0"));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

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
    <div className="mx-auto mt-8 max-w-lg space-y-6">
      <div>
        <h1 className="text-xl font-black text-white">월별 정산 CSV</h1>
        <p className="mt-1 text-sm text-gray-400">
          지급완료(APPROVED)된 크리에이터 출금 내역을 세무 신고용 CSV로 내보냅니다.
        </p>
      </div>

      <section className="rounded-2xl border border-white/10 bg-[#131626] p-5">
        <div className="grid grid-cols-2 gap-3">
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

        <button
          type="button"
          disabled={busy}
          onClick={download}
          className="mt-4 w-full rounded-xl bg-violet-600 py-2.5 text-sm font-bold text-white hover:bg-violet-500 disabled:opacity-40"
        >
          {busy ? "생성 중…" : "CSV 다운로드"}
        </button>

        {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}
        {msg && <p className="mt-3 text-sm text-emerald-400">{msg}</p>}
      </section>

      <p className="text-[11px] leading-relaxed text-gray-600">
        CSV 헤더: 지급일자, 크리에이터명, 주민등록번호, 은행명, 계좌번호, 총지급액, 원천징수세액(국세),
        지방세, 실수령액 · UTF-8(BOM) · Excel 호환
      </p>
    </div>
  );
}
