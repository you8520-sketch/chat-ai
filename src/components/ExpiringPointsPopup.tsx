"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Summary = {
  total: number;
  paid: number;
  free: number;
  nearestExpiresAt: string | null;
  daysLeft: number | null;
};

export default function ExpiringPointsPopup() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    let ignore = false;
    fetch("/api/points/expiring")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!ignore && data?.total > 0) setSummary(data);
      })
      .catch(() => undefined);
    return () => {
      ignore = true;
    };
  }, []);

  if (closed || !summary || summary.total <= 0) return null;

  return (
    <div className="fixed bottom-20 left-1/2 z-50 w-[min(92vw,24rem)] -translate-x-1/2 rounded-2xl border border-amber-300/40 bg-[#17110a] p-4 text-sm text-amber-50 shadow-2xl shadow-black/50 sm:bottom-6 sm:left-auto sm:right-6 sm:translate-x-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-black text-amber-200">소멸 예정 포인트 알림</p>
          <p className="mt-1 text-xs text-amber-50/85">
            {summary.daysLeft ?? 3}일 안에 {summary.total.toLocaleString()}P가 만료될 예정입니다.
            {summary.free > 0 && ` 무료 ${summary.free.toLocaleString()}P`}
            {summary.paid > 0 && ` 유료 ${summary.paid.toLocaleString()}P`}
          </p>
        </div>
        <button type="button" onClick={() => setClosed(true)} className="rounded-full px-2 py-1 text-amber-100/70 hover:bg-white/10" aria-label="소멸 예정 포인트 알림 닫기">
          ×
        </button>
      </div>
      <Link href="/points#usage" className="mt-3 inline-flex rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-bold text-black hover:bg-amber-300">
        포인트 내역 보기
      </Link>
    </div>
  );
}
