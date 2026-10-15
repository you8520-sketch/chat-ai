"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AttendanceBanner from "@/components/AttendanceBanner";
import StatusNotice from "@/components/StatusNotice";
import { type PointUsageLog } from "@/lib/pointUsageLog";
import { POINT_USAGE_HASH } from "@/lib/pointUi";
import { POINT_CHARGE_PACKAGES, pointChargePackageTotalPoints } from "@/lib/plans";
import {
  PORTONE_REVIEWER_TEST_CONFIRMED_MESSAGE,
  runPortOnePointCharge,
} from "@/lib/portoneBrowser";
import { cn, studioSurface, studioType } from "@/lib/studioDesign";
import PointBalanceSummary from "./PointBalanceSummary";
import PointGiftForm from "./PointGiftForm";
import PointHistory from "./PointHistory";

export type { PointUsageLog };

type Note = { tone: "success" | "error"; text: string };

export default function PointsClient({
  points,
  paidPoints,
  freePoints,
  giftableFreePoints,
  attendanceFreePoints = 0,
  usageLogs: initialUsageLogs,
  usagePage: initialUsagePage,
  usageTotal: initialUsageTotal,
  usageTotalPages: initialUsageTotalPages,
  paidLogs: initialPaidLogs,
  paidPage: initialPaidPage,
  paidTotal: initialPaidTotal,
  paidTotalPages: initialPaidTotalPages,
  freeLogs: initialFreeLogs,
  freePage: initialFreePage,
  freeTotal: initialFreeTotal,
  freeTotalPages: initialFreeTotalPages,
  initialCheckedIn,
  initialAttendanceStreak,
  portoneEnabled = false,
  paymentsEnabled = true,
  userEmail = "",
  userNickname = "",
}: {
  points: number;
  paidPoints: number;
  freePoints: number;
  giftableFreePoints?: number;
  attendanceFreePoints?: number;
  usageLogs: PointUsageLog[];
  usagePage: number;
  usageTotal: number;
  usageTotalPages: number;
  paidLogs: PointUsageLog[];
  paidPage: number;
  paidTotal: number;
  paidTotalPages: number;
  freeLogs: PointUsageLog[];
  freePage: number;
  freeTotal: number;
  freeTotalPages: number;
  initialCheckedIn: boolean;
  initialAttendanceStreak: number;
  portoneEnabled?: boolean;
  paymentsEnabled?: boolean;
  userEmail?: string;
  userNickname?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState("");
  const [returnNote, setReturnNote] = useState<Note | null>(null);
  const [chargeNote, setChargeNote] = useState<Note | null>(null);

  const usage = useMemo(
    () => ({ logs: initialUsageLogs, page: initialUsagePage, total: initialUsageTotal, totalPages: initialUsageTotalPages }),
    [initialUsageLogs, initialUsagePage, initialUsageTotal, initialUsageTotalPages],
  );
  const paid = useMemo(
    () => ({ logs: initialPaidLogs, page: initialPaidPage, total: initialPaidTotal, totalPages: initialPaidTotalPages }),
    [initialPaidLogs, initialPaidPage, initialPaidTotal, initialPaidTotalPages],
  );
  const free = useMemo(
    () => ({ logs: initialFreeLogs, page: initialFreePage, total: initialFreeTotal, totalPages: initialFreeTotalPages }),
    [initialFreeLogs, initialFreePage, initialFreeTotal, initialFreeTotalPages],
  );

  const giftableFree = giftableFreePoints ?? Math.max(0, Math.round((freePoints - attendanceFreePoints) * 10) / 10);
  const checkoutOpen = paymentsEnabled && portoneEnabled;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.search.includes("reviewerTest=1")) {
      setReturnNote({ tone: "success", text: PORTONE_REVIEWER_TEST_CONFIRMED_MESSAGE });
    } else if (window.location.search.includes("charged=1")) {
      setReturnNote({ tone: "success", text: "포인트 충전이 완료되었습니다." });
    }
    if (window.location.hash !== `#${POINT_USAGE_HASH}`) return;
    const el = document.getElementById(POINT_USAGE_HASH);
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  async function chargePortOne(packageId: string) {
    const pkg = POINT_CHARGE_PACKAGES.find((p) => p.id === packageId)!;
    const totalPoints = pkg.paidPoints + pkg.bonusPoints;
    setLoading(packageId);
    setChargeNote(null);
    try {
      const charged = await runPortOnePointCharge(packageId, {
        customerEmail: userEmail || undefined,
        customerName: userNickname || undefined,
      });
      if (!charged.completed) {
        return;
      }
      const testConfirmed =
        charged.completed.checkoutKind === "reviewer_kg_test" || charged.completed.credited === false;
      setChargeNote({
        tone: "success",
        text: testConfirmed
          ? PORTONE_REVIEWER_TEST_CONFIRMED_MESSAGE
          : `포인트 ${totalPoints.toLocaleString()}P 충전이 완료되었습니다.`,
      });
      router.refresh();
    } catch (e) {
      setChargeNote({ tone: "error", text: (e as Error).message || "결제에 실패했습니다." });
    } finally {
      setLoading("");
    }
  }

  function charge(packageId: string) {
    if (!portoneEnabled) {
      setChargeNote({ tone: "error", text: "PortOne 결제 설정이 완료되지 않아 포인트를 충전할 수 없습니다." });
      return;
    }
    return void chargePortOne(packageId);
  }

  return (
    <div className="mx-auto mt-4 w-full min-w-0 max-w-3xl space-y-6 pb-8">
      <AttendanceBanner
        loggedIn
        initialCheckedIn={initialCheckedIn}
        initialStreak={initialAttendanceStreak}
        onClaimed={() => router.refresh()}
      />

      {returnNote && <StatusNotice tone={returnNote.tone} testId="points-return-notice">{returnNote.text}</StatusNotice>}

      <PointBalanceSummary total={points} paid={paidPoints} free={giftableFree} attendance={attendanceFreePoints} />

      <section aria-labelledby="points-products-title" data-testid="points-products" className={studioSurface.section}>
        <div>
          <h2 id="points-products-title" className={studioType.sectionTitle}>
            포인트 상품
          </h2>
          <p className={cn(studioType.helper, "mt-1")}>
            결제 금액만큼 <b className="text-zinc-200">유료 포인트</b>가 지급되고, 보너스는 <b className="text-violet-300">무료 포인트</b>로 따로
            적립돼요.{" "}
            <Link href="/refund" className="text-violet-300 underline-offset-2 hover:underline">
              결제 및 환불 정책
            </Link>
            에서 상품·유효기간·결제 취소 조건을 확인할 수 있어요.
          </p>
        </div>

        {!checkoutOpen && (
          <div data-testid="points-checkout-closed" className="rounded-xl border border-amber-300/25 bg-amber-400/[0.06] px-4 py-3">
            <p className="text-sm font-semibold text-amber-100">포인트 충전 준비 중</p>
            <p className={cn(studioType.helper, "mt-0.5")}>
              결제 설정이 완료되지 않아 현재 포인트 충전을 사용할 수 없습니다. 상품 구성만 확인할 수 있어요.
            </p>
          </div>
        )}

        <ul className="space-y-2.5">
          {POINT_CHARGE_PACKAGES.map((p) => {
            const totalPoints = pointChargePackageTotalPoints(p);
            const busy = loading === p.id;
            const body = (
              <>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-xs font-medium text-zinc-400">결제 금액</span>
                  <span className="text-xl font-semibold tabular-nums leading-tight text-zinc-50">₩{p.price.toLocaleString()}</span>
                  <span className="mt-1 text-[13px] leading-snug text-zinc-400">
                    유료 {p.paidPoints.toLocaleString()}P
                    {p.bonusPoints > 0 ? (
                      <>
                        {" + "}
                        <span className="font-medium text-violet-300">무료 보너스 {p.bonusPoints.toLocaleString()}P</span>
                      </>
                    ) : (
                      <span className="text-zinc-500"> · 보너스 없음</span>
                    )}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end text-right">
                  {p.bonusTag && (
                    <span className="mb-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-xs font-semibold text-violet-200">{p.bonusTag}</span>
                  )}
                  <span className="text-xs font-medium text-zinc-400">지급 합계</span>
                  <span className="text-lg font-semibold tabular-nums leading-tight text-zinc-50">{totalPoints.toLocaleString()}P</span>
                  {checkoutOpen && (
                    <span className="mt-1 text-xs font-semibold text-violet-300">{busy ? "결제창 여는 중…" : "충전하기 ›"}</span>
                  )}
                </span>
              </>
            );
            const rowClass = "flex min-h-[5.5rem] w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#0e1120] px-4 py-3 text-left";
            if (paymentsEnabled && portoneEnabled) {
              return (
                <li key={p.id} data-testid={`charge-row-${p.id}`}>
                  <button
                    onClick={() => charge(p.id)}
                    disabled={Boolean(loading)}
                    aria-busy={busy}
                    className={cn(rowClass, "transition hover:border-violet-500/50 hover:bg-violet-500/[0.06] disabled:opacity-60")}
                  >
                    {body}
                  </button>
                </li>
              );
            }
            return (
              <li key={p.id} data-testid={`charge-row-${p.id}`}>
                <article key={p.id} className={rowClass}>
                  {body}
                </article>
              </li>
            );
          })}
        </ul>

        {checkoutOpen && (
          <p className={studioType.helper}>PortOne 결제창으로 충전하며, 서버 결제 검증이 끝난 뒤에 포인트가 지급돼요.</p>
        )}
        {chargeNote && (
          <StatusNotice tone={chargeNote.tone} testId="points-charge-notice">
            {chargeNote.text}
          </StatusNotice>
        )}
      </section>

      <PointGiftForm
        paidPoints={paidPoints}
        giftableFreePoints={giftableFree}
        attendanceFreePoints={attendanceFreePoints}
        onGifted={() => router.refresh()}
      />

      <PointHistory usage={usage} paid={paid} free={free} anchorId={POINT_USAGE_HASH} onRefresh={() => router.refresh()} />
    </div>
  );
}
