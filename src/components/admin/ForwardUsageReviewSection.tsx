"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ProviderReconciliationResult } from "@/lib/providerCostReconciliation";

export default function ForwardUsageReviewSection({ reconciliation, allowReview = false, onReviewed }: {
  reconciliation: ProviderReconciliationResult | null | undefined;
  allowReview?: boolean;
  onReviewed?: () => Promise<void>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const audit = reconciliation?.forwardAudit;
  const review = reconciliation?.forwardOps;
  if (!audit?.observedSince) return null;

  async function archive() {
    if (busy || !review?.snapshotFingerprint) return;
    setBusy(true); setMessage("");
    try {
      const res = await fetch("/api/admin/finance/forward-review", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshotFingerprint: review.snapshotFingerprint }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "보관하지 못했습니다.");
      if (onReviewed) await onReviewed();
      router.refresh();
      setMessage("과거 미해결 기록으로 보관했습니다. 원가와 미연결 기록은 그대로 남습니다.");
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }

  return <section id="forward-usage-review" className="mt-6 rounded-2xl border border-white/10 bg-[#11131a] p-5">
    <h2 className="font-bold">공급자 미연결 사용량</h2>
    <p className="mt-2 text-xs leading-relaxed text-zinc-400">
      감사 기준 {audit.observedSince} · 최근 감사 {reconciliation?.ranAt || "미확정"}. 누적 {audit.unmatchedLedgerCount.toLocaleString()}건 / ${(audit.unmatchedSettledMicroUsd / 1e6).toFixed(6)}.
      보관은 해결·정상 승인이나 비용 삭제가 아닙니다. 이후 새 요청이나 금액 변경은 다시 경고합니다.
    </p>
    {!review?.available ? <p className="mt-3 text-sm text-amber-300">
      요청별 비교 자료가 없거나 감사가 불완전합니다. 경고를 유지하며, 정상 감사가 완료된 뒤 보관할 수 있습니다.
    </p> : <>
      <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {([
          ["미검토 운영 장부 누락", review.pendingProduction],
          ["미검토 출처 미확정", review.pendingUndetermined],
          ["보관한 과거 미해결", review.reviewedUnresolved],
          ["출처 확인된 실측", review.identifiedMeasurements],
        ] as const).map(([label, group]) => <div key={label} className="rounded-xl bg-white/5 p-3">
          <dt className="text-xs text-zinc-400">{label}</dt>
          <dd className="mt-1 font-bold">{group.count.toLocaleString()}건 · ${(group.microUsd / 1e6).toFixed(6)}</dd>
          {group.lastAt && <dd className="mt-1 break-all text-xs text-zinc-500">마지막 호출 {group.lastAt}</dd>}
        </div>)}
      </dl>
      <p className="mt-3 text-xs text-zinc-400">
        {review.reviewedAt ? `마지막 보관 ${review.reviewedAt}.` : "아직 보관한 감사 내역이 없습니다."}
        {" "}실측 분류는 청구 요청 ID로 확인한 용도이며, 실행 승인 여부와 운영 장부 연결을 대신하지 않습니다.
      </p>
      {review.evidenceSources.map((source, index) => <a key={source} href={source} target="_blank" rel="noreferrer" className="mr-4 mt-2 inline-block text-xs text-violet-300 underline">실측 증거 {index + 1}</a>)}
      {allowReview && review.pendingProduction.count + review.pendingUndetermined.count > 0 && <button
        type="button" disabled={busy} onClick={archive}
        className="mt-4 block rounded-xl border border-white/15 px-4 py-3 text-sm font-semibold disabled:opacity-50"
      >{busy ? "보관 중…" : "현재 내역을 과거 미해결로 보관"}</button>}
    </>}
    {!allowReview && <Link href="/admin/finance#forward-usage-review" className="mt-3 inline-block text-sm text-violet-300">재무 화면에서 검토·보관 →</Link>}
    {message && <p role="status" className="mt-3 text-sm text-zinc-300">{message}</p>}
  </section>;
}
