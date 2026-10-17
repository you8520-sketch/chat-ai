"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatPoints } from "@/lib/billingDisplay";
import { POINTS_DEDUCTED_EVENT, POINTS_REFUNDED_EVENT, type PointsDeductedDetail, type PointsRefundedDetail } from "@/lib/pointsEvents";
import { POINT_USAGE_HASH } from "@/lib/pointUi";
import PointsBalanceTooltip from "./PointsBalanceTooltip";

export default function AnimatedPointsBadge({
  initialPoints,
  initialPaid,
  initialFree,
}: {
  initialPoints: number;
  initialPaid: number;
  initialFree: number;
}) {
  const [paid, setPaid] = useState(initialPaid);
  const [free, setFree] = useState(initialFree);
  const [displayPoints, setDisplayPoints] = useState(initialPoints);
  const pointsRef = useRef<HTMLSpanElement>(null);
  const displayRef = useRef(initialPoints);
  const animRef = useRef<number | null>(null);

  function renderPoints(value: number) {
    displayRef.current = value;
    setDisplayPoints(value);
    if (pointsRef.current) pointsRef.current.textContent = `${formatPoints(value)}P`;
  }

  useEffect(() => {
    renderPoints(initialPoints);
    setPaid(initialPaid);
    setFree(initialFree);
  }, [initialPoints, initialPaid, initialFree]);

  useEffect(() => {
    function onDeducted(e: Event) {
      const detail = (e as CustomEvent<PointsDeductedDetail>).detail;
      const from = displayRef.current;
      const to = detail.remainingPoints;
      setPaid(detail.paidPoints);
      setFree(detail.freePoints);
      if (from === to) return;

      if (animRef.current != null) cancelAnimationFrame(animRef.current);

      const start = performance.now();
      const duration = 900;

      function tick(now: number) {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        const value = from + (to - from) * eased;
        const rounded = Math.round(value * 10) / 10;
        renderPoints(rounded);
        if (t < 1) {
          animRef.current = requestAnimationFrame(tick);
        } else {
          renderPoints(to);
          animRef.current = null;
        }
      }

      animRef.current = requestAnimationFrame(tick);
    }

    function onRefunded(e: Event) {
      const detail = (e as CustomEvent<PointsRefundedDetail>).detail;
      const from = displayRef.current;
      const to = detail.remainingPoints;
      setPaid(detail.paidPoints);
      setFree(detail.freePoints);
      if (from === to) return;

      if (animRef.current != null) cancelAnimationFrame(animRef.current);

      const start = performance.now();
      const duration = 900;

      function tick(now: number) {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        const value = from + (to - from) * eased;
        const rounded = Math.round(value * 10) / 10;
        renderPoints(rounded);
        if (t < 1) {
          animRef.current = requestAnimationFrame(tick);
        } else {
          renderPoints(to);
          animRef.current = null;
        }
      }

      animRef.current = requestAnimationFrame(tick);
    }

    window.addEventListener(POINTS_DEDUCTED_EVENT, onDeducted);
    window.addEventListener(POINTS_REFUNDED_EVENT, onRefunded);
    return () => {
      window.removeEventListener(POINTS_DEDUCTED_EVENT, onDeducted);
      window.removeEventListener(POINTS_REFUNDED_EVENT, onRefunded);
      if (animRef.current != null) cancelAnimationFrame(animRef.current);
    };
  }, []);

  return (
    <PointsBalanceTooltip total={displayPoints} paid={paid} free={free} enableClickToggle={false} align="end">
      <Link
        href={`/points#${POINT_USAGE_HASH}`}
        title="포인트 사용 내역"
        aria-label={`보유 포인트 ${formatPoints(displayPoints)}P — 사용 내역 보기`}
        className="relative z-50 inline-flex min-h-9 max-w-full min-w-0 items-center rounded-xl border border-violet-400/20 bg-violet-500/10 px-2 text-xs font-semibold tabular-nums text-violet-200 transition hover:border-violet-400/35 hover:bg-violet-500/15 max-[359px]:px-1.5 min-[400px]:px-2.5 sm:px-3"
      >
        <span ref={pointsRef}>{formatPoints(initialPoints)}P</span>
      </Link>
    </PointsBalanceTooltip>
  );
}
