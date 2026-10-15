"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ATTENDANCE_CYCLE_DAYS, ATTENDANCE_POINTS_VALID_DAYS } from "@/lib/attendanceConstants";
import { attendanceWeekView } from "@/lib/pointsPageView";
import { dispatchPointsRefunded } from "@/lib/pointsEvents";
import StatusNotice, { type StatusNoticeTone } from "@/components/StatusNotice";
import { cn, studioSurface, studioType } from "@/lib/studioDesign";

type Props = {
  loggedIn: boolean;
  initialCheckedIn: boolean;
  initialStreak?: number;
  onClaimed?: () => void;
};

type Notice = { tone: StatusNoticeTone; text: string };

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function AttendanceBanner({ loggedIn, initialCheckedIn, initialStreak = 0, onClaimed }: Props) {
  const [checkedIn, setCheckedIn] = useState(initialCheckedIn);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [streak, setStreak] = useState(initialStreak);
  const inflight = useRef(false);

  const { doneCount, todayDay, todayReward, cells } = attendanceWeekView({ streak, checkedIn, loggedIn });

  async function handleCheckIn() {
    if (!loggedIn || checkedIn || inflight.current) return;
    inflight.current = true;
    setLoading(true);
    setNotice(null);
    try {
      const res = await fetch("/api/attendance", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setNotice({ tone: "error", text: data.error ?? "출석 처리에 실패했습니다. 잠시 후 다시 시도해 주세요." });
        return;
      }
      if (data.alreadyClaimed) {
        setCheckedIn(true);
        setStreak(data.streak ?? streak);
        setNotice({ tone: "info", text: "오늘은 이미 출석했어요." });
        onClaimed?.();
        return;
      }
      setCheckedIn(true);
      setStreak(data.streak ?? streak);
      setNotice({
        tone: "success",
        text: data.cycleCompleted
          ? `이번 주 7번째 출석 완료! +${data.reward.toLocaleString()}P 지급 · 다음 주 월요일에 1회차부터 다시 시작해요.`
          : `출석 완료! +${data.reward.toLocaleString()}P가 지급됐어요.`,
      });
      dispatchPointsRefunded({
        remainingPoints: data.points,
        paidPoints: data.paidPoints,
        freePoints: data.freePoints,
        refundedAmount: data.reward,
      });
      onClaimed?.();
    } catch {
      setNotice({ tone: "error", text: "네트워크 오류가 발생했습니다. 다시 시도해 주세요." });
    } finally {
      inflight.current = false;
      setLoading(false);
    }
  }

  const statusLabel = loading ? "처리 중" : checkedIn ? "오늘 출석 완료" : "오늘 출석 전";

  return (
    <section
      aria-labelledby="attendance-title"
      data-testid="attendance-card"
      data-attendance-state={loading ? "loading" : checkedIn ? "done" : "pending"}
      className={cn(studioSurface.section, "mt-2")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 id="attendance-title" className="break-keep text-xl font-semibold leading-snug tracking-tight text-zinc-50">
            출석 체크
          </h1>
          <p className={cn(studioType.helper, "mt-1")}>
            이번 주 출석 횟수 순서대로 보상이 지급돼요. 연속 출석이 아니어도 돼요.
          </p>
        </div>
        {loggedIn && (
          <span
            data-testid="attendance-status"
            className={cn(
              "inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ring-1",
              checkedIn
                ? "bg-emerald-500/10 text-emerald-200 ring-emerald-400/30"
                : loading
                  ? "bg-white/[0.06] text-zinc-200 ring-white/15"
                  : "bg-violet-500/10 text-violet-200 ring-violet-400/30",
            )}
          >
            {checkedIn && <CheckIcon />}
            {statusLabel}
          </span>
        )}
      </div>

      <div>
        <p className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold text-zinc-100">이번 주 출석</span>
          <span className="text-sm tabular-nums text-zinc-300" data-testid="attendance-week-count">
            <b className="text-base text-zinc-50">{doneCount}</b> / {ATTENDANCE_CYCLE_DAYS}회
          </span>
        </p>
        <ol className="mt-2 grid grid-cols-7 gap-1.5 sm:gap-2" aria-label="이번 주 출석 보상">
          {cells.map(({ day, reward, state, isToday }) => {
            const done = state === "done";
            const stateLabel = done ? (isToday ? "오늘 완료" : "완료") : isToday ? "오늘 받을 보상" : "예정";
            return (
              <li
                key={day}
                data-testid={`attendance-cell-${day}`}
                data-cell-state={state}
                aria-current={isToday ? "step" : undefined}
                className={cn(
                  "flex min-h-[4.5rem] min-w-0 flex-col items-center justify-between rounded-lg border px-0.5 py-2 text-center",
                  done
                    ? "border-violet-400/40 bg-violet-500/15 text-violet-100"
                    : isToday
                      ? "border-violet-400/70 bg-violet-500/[0.06] text-zinc-50 ring-1 ring-violet-400/40"
                      : "border-white/10 bg-white/[0.02] text-zinc-400",
                )}
              >
                <span className="text-xs font-medium leading-none">{day}회</span>
                <span className="flex h-5 items-center justify-center text-violet-200" aria-hidden="true">
                  {done ? <CheckIcon /> : isToday ? <span className="text-xs font-semibold leading-none">오늘</span> : null}
                </span>
                <span className="text-xs font-semibold tabular-nums leading-none">{reward.toLocaleString()}P</span>
                <span className="sr-only">
                  {day}번째 출석 {reward.toLocaleString()}포인트 {stateLabel}
                </span>
              </li>
            );
          })}
        </ol>
        <p className={cn(studioType.helper, "mt-2")}>
          월요일에 1회차부터 다시 시작해요. 출석 포인트는 지급일로부터 {ATTENDANCE_POINTS_VALID_DAYS}일 유효하며 선물할 수 없어요.
        </p>
      </div>

      {loggedIn ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={handleCheckIn}
            disabled={checkedIn || loading}
            aria-busy={loading}
            data-testid="attendance-button"
            className={cn(
              "inline-flex min-h-12 w-full items-center justify-center rounded-xl px-5 text-base font-semibold transition sm:w-auto sm:min-w-56",
              checkedIn
                ? "cursor-default border border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                : "bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-60",
            )}
          >
            {loading
              ? "출석 처리 중…"
              : checkedIn
                ? "오늘 출석 완료"
                : `출석 체크 · +${todayReward.toLocaleString()}P`}
          </button>
          <p className={studioType.helper}>
            {checkedIn
              ? "내일 0시(KST) 이후 다시 출석할 수 있어요."
              : `오늘은 이번 주 ${todayDay}번째 출석이에요.`}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <Link
            href="/login"
            className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-violet-600 px-5 text-base font-semibold text-white hover:bg-violet-500 sm:w-auto sm:min-w-56"
          >
            로그인하고 출석하기
          </Link>
          <p className={studioType.helper}>로그인 후 주간 출석 보상을 받을 수 있어요.</p>
        </div>
      )}

      {notice && (
        <StatusNotice tone={notice.tone} testId="attendance-notice">
          {notice.text}
        </StatusNotice>
      )}
    </section>
  );
}
