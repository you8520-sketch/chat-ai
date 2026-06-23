"use client";

import Link from "next/link";
import { useState } from "react";
import { DAILY_ATTENDANCE_REWARD } from "@/lib/attendanceConstants";
import { dispatchPointsRefunded } from "@/lib/pointsEvents";

type Props = {
  loggedIn: boolean;
  initialCheckedIn: boolean;
};

export default function AttendanceBanner({ loggedIn, initialCheckedIn }: Props) {
  const [checkedIn, setCheckedIn] = useState(initialCheckedIn);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleCheckIn() {
    if (!loggedIn || checkedIn || loading) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/attendance", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "출석 처리에 실패했습니다.");
        return;
      }
      if (data.alreadyClaimed) {
        setCheckedIn(true);
        setMessage("오늘은 이미 출석했어요.");
        return;
      }
      setCheckedIn(true);
      setMessage(`+${data.reward.toLocaleString()}P 지급 완료!`);
      dispatchPointsRefunded({
        remainingPoints: data.points,
        paidPoints: data.paidPoints,
        freePoints: data.freePoints,
        refundedAmount: data.reward,
      });
    } catch {
      setMessage("네트워크 오류가 발생했습니다. 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-2 rounded-2xl bg-gradient-to-r from-amber-900/50 via-orange-900/40 to-violet-900/50 p-6">
      <h1 className="text-2xl font-black text-white">매일 출석하고 무료 포인트 받기</h1>
      <p className="mt-1 text-sm text-gray-300">
        매일 자정(0시)에 갱신 · 출석 체크 시 무료 포인트{" "}
        <span className="font-bold text-amber-300">{DAILY_ATTENDANCE_REWARD.toLocaleString()}P</span> 지급
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {loggedIn ? (
          <>
            <button
              type="button"
              onClick={handleCheckIn}
              disabled={checkedIn || loading}
              className={`rounded-xl px-5 py-2.5 text-sm font-bold transition ${
                checkedIn
                  ? "cursor-default bg-white/10 text-zinc-400"
                  : "bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-60"
              }`}
            >
              {loading ? "처리 중…" : checkedIn ? "오늘 출석 완료 ✓" : "출석 체크"}
            </button>
            <p className="text-xs text-zinc-500">
              {checkedIn
                ? "내일 0시 이후 다시 출석할 수 있어요."
                : "버튼을 눌러 오늘의 출석 보상을 받으세요."}
            </p>
          </>
        ) : (
          <>
            <Link
              href="/login"
              className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-bold text-black hover:bg-amber-400"
            >
              로그인하고 출석하기
            </Link>
            <p className="text-xs text-zinc-500">
              로그인 후 매일 {DAILY_ATTENDANCE_REWARD.toLocaleString()}P를 받을 수 있어요.
            </p>
          </>
        )}
      </div>

      {message && (
        <p className={`mt-3 text-xs font-semibold ${message.includes("완료") ? "text-amber-300" : "text-zinc-400"}`}>
          {message}
        </p>
      )}
    </div>
  );
}
