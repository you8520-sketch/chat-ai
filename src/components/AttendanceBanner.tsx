"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ATTENDANCE_CYCLE_DAYS,
  formatAttendanceDayRewardLabel,
} from "@/lib/attendanceConstants";
import { dispatchPointsRefunded } from "@/lib/pointsEvents";

type Props = {
  loggedIn: boolean;
  initialCheckedIn: boolean;
  initialStreak?: number;
};

export default function AttendanceBanner({ loggedIn, initialCheckedIn, initialStreak = 0 }: Props) {
  const [checkedIn, setCheckedIn] = useState(initialCheckedIn);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [streak, setStreak] = useState(initialStreak);

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
      setStreak(data.streak ?? streak);
      setMessage(
        data.cycleCompleted
          ? `이번 주 7일차 완료! +${data.reward.toLocaleString()}P 지급 · 다음 주 월요일에 1일차부터 다시 시작해요.`
          : `+${data.reward.toLocaleString()}P 지급 완료!`
      );
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
        매주 월요일 1일차부터 시작 · 연속 출석이 아니어도 이번 주 출석 순서대로 지급
      </p>

      <div className="mt-5 grid grid-cols-7 gap-2" aria-label="주간 출석 차트">
        {Array.from({ length: ATTENDANCE_CYCLE_DAYS }, (_, i) => {
          const day = i + 1;
          const done = day <= streak;
          const isBonus = day === ATTENDANCE_CYCLE_DAYS;
          return (
            <div
              key={day}
              className={`rounded-xl border p-2 text-center ${
                done
                  ? "border-amber-300/70 bg-amber-300/20 text-amber-100"
                  : isBonus
                    ? "border-violet-300/40 bg-violet-400/10 text-violet-100"
                    : "border-white/10 bg-black/20 text-zinc-400"
              }`}
            >
              <div className="text-[11px] font-bold">{day}일차</div>
              <div className="mt-1 text-lg">{done ? "✓" : isBonus ? "🎁" : "•"}</div>
              <div className="text-[10px]">{formatAttendanceDayRewardLabel(day)}</div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-zinc-400">
        출석 포인트는 지급일로부터 1개월 유효합니다. 연속으로 못 나와도 이번 주 N번째 출석이 N일차
        보상을 받으며, 새 주(월요일)마다 1일차부터 다시 시작합니다.
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
            <p className="text-xs text-zinc-500">로그인 후 주간 출석 보상을 받을 수 있어요.</p>
          </>
        )}
      </div>

      {message && (
        <p
          className={`mt-3 text-xs font-semibold ${
            message.includes("완료") || message.includes("지급") ? "text-amber-300" : "text-zinc-400"
          }`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
