"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AttendanceBanner from "@/components/AttendanceBanner";
import ChargeCancelButton from "@/components/ChargeCancelButton";
import PointsBalanceTooltip from "@/components/PointsBalanceTooltip";
import {
  canShowChargeCancelButton,
  type PointUsageLog,
  USAGE_PAGE_SIZE,
  CHARGE_PAGE_SIZE,
} from "@/lib/pointUsageLog";
import { POINT_USAGE_HASH } from "@/lib/pointUi";
import { FREE_POINTS_VALID_MONTHS, POINT_CHARGE_PACKAGES } from "@/lib/plans";
import { runPortOnePointCharge } from "@/lib/portoneBrowser";
import {
  computeGiftBreakdown,
  MIN_POINT_GIFT_AMOUNT,
  POINT_GIFT_FEE_RATE,
} from "@/lib/pointGiftsShared";

export type { PointUsageLog };

type HistoryTab = "usage" | "paid" | "free";

type CreditPageState = {
  logs: PointUsageLog[];
  page: number;
  total: number;
  totalPages: number;
  loading: boolean;
};

function CreditPagination({
  page,
  totalPages,
  loading,
  onPage,
}: {
  page: number;
  totalPages: number;
  loading: boolean;
  onPage: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-center gap-2">
      <button
        type="button"
        disabled={page <= 1 || loading}
        onClick={() => onPage(page - 1)}
        className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-gray-300 transition hover:border-violet-500/40 hover:text-white disabled:opacity-40"
      >
        이전
      </button>
      <span className="text-xs tabular-nums text-gray-400">
        {page} / {totalPages}
      </span>
      <button
        type="button"
        disabled={page >= totalPages || loading}
        onClick={() => onPage(page + 1)}
        className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-gray-300 transition hover:border-violet-500/40 hover:text-white disabled:opacity-40"
      >
        다음
      </button>
    </div>
  );
}

function formatLogTimestamp(iso: string): string {
  const d = new Date(iso.includes("T") ? iso : `${iso}Z`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
}

function formatLogReason(reason: string, createdAt: string) {
  const timestamp = (
    <span className="mt-0.5 block text-[10px] tabular-nums text-gray-500">{formatLogTimestamp(createdAt)}</span>
  );
  const withModel = reason.match(/^대화 · (.+?) \((.+)\)$/);
  if (withModel) {
    return (
      <span className="min-w-0 text-gray-300">
        대화 · <span className="font-semibold text-violet-300">{withModel[1]}</span>
        <span className="mt-0.5 block text-xs text-gray-500">{withModel[2]}</span>
        {timestamp}
      </span>
    );
  }
  return (
    <span className="min-w-0 text-gray-300">
      {reason}
      {timestamp}
    </span>
  );
}

function PointLogList({
  logs,
  onToast,
  onRefresh,
}: {
  logs: PointUsageLog[];
  onToast: (text: string) => void;
  onRefresh: () => void;
}) {
  if (logs.length === 0) {
    return <p className="p-4 text-sm text-gray-500">내역이 없습니다.</p>;
  }

  return (
    <>
      {logs.map((l) => (
        <div key={l.id ?? `${l.created_at}-${l.reason}`} className="flex items-start justify-between gap-3 p-3 text-sm">
          {formatLogReason(l.reason, l.created_at)}
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className={l.delta >= 0 ? "font-semibold text-emerald-400" : "font-semibold text-rose-400"}>
              {l.delta >= 0 ? "+" : ""}
              {l.delta.toLocaleString()}P
            </span>
            {canShowChargeCancelButton(l) && (
              <ChargeCancelButton
                pointLogId={l.id ?? 0}
                cancelled={!!l.charge_cancelled}
                disabled={!l.can_cancel_charge}
                blockReason={l.charge_cancel_block_reason}
                onToast={onToast}
                onCancelled={onRefresh}
              />
            )}
          </div>
        </div>
      ))}
    </>
  );
}

export default function PointsClient({
  points,
  paidPoints,
  freePoints,
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
  portoneEnabled = false,
  paymentsEnabled = true,
  userEmail = "",
  userNickname = "",
}: {
  points: number;
  paidPoints: number;
  freePoints: number;
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
  portoneEnabled?: boolean;
  paymentsEnabled?: boolean;
  userEmail?: string;
  userNickname?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [giftNickname, setGiftNickname] = useState("");
  const [giftAmount, setGiftAmount] = useState("");
  const [historyTab, setHistoryTab] = useState<HistoryTab>("usage");
  const [usageLogs, setUsageLogs] = useState(initialUsageLogs);
  const [usagePage, setUsagePage] = useState(initialUsagePage);
  const [usageTotal, setUsageTotal] = useState(initialUsageTotal);
  const [usageTotalPages, setUsageTotalPages] = useState(initialUsageTotalPages);
  const [usageLoading, setUsageLoading] = useState(false);
  const [paid, setPaid] = useState<CreditPageState>({
    logs: initialPaidLogs,
    page: initialPaidPage,
    total: initialPaidTotal,
    totalPages: initialPaidTotalPages,
    loading: false,
  });
  const [free, setFree] = useState<CreditPageState>({
    logs: initialFreeLogs,
    page: initialFreePage,
    total: initialFreeTotal,
    totalPages: initialFreeTotalPages,
    loading: false,
  });

  useEffect(() => {
    setUsageLogs(initialUsageLogs);
    setUsagePage(initialUsagePage);
    setUsageTotal(initialUsageTotal);
    setUsageTotalPages(initialUsageTotalPages);
  }, [initialUsageLogs, initialUsagePage, initialUsageTotal, initialUsageTotalPages]);

  useEffect(() => {
    setPaid((prev) => ({
      ...prev,
      logs: initialPaidLogs,
      page: initialPaidPage,
      total: initialPaidTotal,
      totalPages: initialPaidTotalPages,
    }));
  }, [initialPaidLogs, initialPaidPage, initialPaidTotal, initialPaidTotalPages]);

  useEffect(() => {
    setFree((prev) => ({
      ...prev,
      logs: initialFreeLogs,
      page: initialFreePage,
      total: initialFreeTotal,
      totalPages: initialFreeTotalPages,
    }));
  }, [initialFreeLogs, initialFreePage, initialFreeTotal, initialFreeTotalPages]);

  const loadUsagePage = useCallback(async (page: number) => {
    setUsageLoading(true);
    try {
      const res = await fetch(`/api/points/logs?type=usage&page=${page}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        logs: PointUsageLog[];
        page: number;
        total: number;
        totalPages: number;
      };
      setUsageLogs(data.logs);
      setUsagePage(data.page);
      setUsageTotal(data.total);
      setUsageTotalPages(data.totalPages);
    } finally {
      setUsageLoading(false);
    }
  }, []);

  const loadCreditPage = useCallback(async (kind: "paid" | "free", page: number) => {
    const setState = kind === "paid" ? setPaid : setFree;
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const res = await fetch(`/api/points/logs?type=${kind}&page=${page}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        logs: PointUsageLog[];
        page: number;
        total: number;
        totalPages: number;
      };
      setState({
        logs: data.logs,
        page: data.page,
        total: data.total,
        totalPages: data.totalPages,
        loading: false,
      });
    } finally {
      setState((prev) => ({ ...prev, loading: false }));
    }
  }, []);

  const giftPreview = (() => {
    const n = Number(giftAmount);
    if (!Number.isFinite(n) || n <= 0) return null;
    return computeGiftBreakdown(n);
  })();
  const feePct = Math.round(POINT_GIFT_FEE_RATE * 100);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.search.includes("charged=1")) {
      setMsg("포인트 충전이 완료되었습니다.");
    }
    if (window.location.hash !== `#${POINT_USAGE_HASH}`) return;
    const el = document.getElementById(POINT_USAGE_HASH);
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  async function chargeMock(packageId: string) {
    const pkg = POINT_CHARGE_PACKAGES.find((p) => p.id === packageId)!;
    const totalPoints = pkg.paidPoints + pkg.bonusPoints;
    const breakdown =
      pkg.bonusPoints > 0
        ? `유료 ${pkg.paidPoints.toLocaleString()}P + 무료 보너스 ${pkg.bonusPoints.toLocaleString()}P`
        : `유료 ${pkg.paidPoints.toLocaleString()}P`;
    if (
      !confirm(
        `총 ${totalPoints.toLocaleString()}P (${breakdown})를 ₩${pkg.price.toLocaleString()}에 충전할까요?\n\n※ 모의 결제 — 즉시 충전됩니다.`
      )
    )
      return;
    setLoading(packageId);
    setError("");
    const res = await fetch("/api/points/charge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packageId }),
    });
    setLoading("");
    if (res.ok) {
      setMsg("충전이 완료되었습니다! (모의 결제)");
      router.refresh();
    }
  }

  async function chargePortOne(packageId: string) {
    const pkg = POINT_CHARGE_PACKAGES.find((p) => p.id === packageId)!;
    const totalPoints = pkg.paidPoints + pkg.bonusPoints;
    setLoading(packageId);
    setError("");
    setMsg("");
    try {
      await runPortOnePointCharge(packageId, {
        customerEmail: userEmail || undefined,
        customerName: userNickname || undefined,
      });
      setMsg(`포인트 ${totalPoints.toLocaleString()}P 충전이 완료되었습니다.`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message || "결제에 실패했습니다.");
    } finally {
      setLoading("");
    }
  }

  function charge(packageId: string) {
    if (portoneEnabled) return void chargePortOne(packageId);
    return void chargeMock(packageId);
  }

  async function sendGift() {
    const amount = Number(giftAmount);
    if (!giftNickname.trim()) {
      setError("받는 사람 닉네임을 입력해 주세요.");
      return;
    }
    if (!Number.isFinite(amount) || amount < MIN_POINT_GIFT_AMOUNT) {
      setError(`최소 선물 금액은 ${MIN_POINT_GIFT_AMOUNT}P입니다.`);
      return;
    }
    if (paidPoints < amount) {
      setError("유료 포인트가 부족합니다. (무료 포인트는 선물할 수 없습니다)");
      return;
    }

    const preview = computeGiftBreakdown(amount);
    if (
      !confirm(
        `${giftNickname.trim()}님에게 유료 포인트를 선물할까요?\n\n차감: ${preview.gross.toLocaleString()}P (유료)\n수수료 ${feePct}%: ${preview.fee.toLocaleString()}P\n상대 수령: ${preview.net.toLocaleString()}P`
      )
    ) {
      return;
    }

    setLoading("gift");
    setError("");
    setMsg("");
    const res = await fetch("/api/points/gift", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipientNickname: giftNickname.trim(), amount }),
    });
    setLoading("");
    const data = await res.json();
    if (res.ok) {
      setMsg(
        `${data.recipientNickname}님에게 ${data.net.toLocaleString()}P를 선물했습니다. (차감 ${data.gross.toLocaleString()}P, 수수료 ${data.fee.toLocaleString()}P)`
      );
      setGiftNickname("");
      setGiftAmount("");
      router.refresh();
    } else {
      setError(data.error || "선물에 실패했습니다.");
    }
  }

  return (
    <div className="mx-auto mt-4 max-w-3xl">
      <div className="rounded-2xl bg-gradient-to-r from-violet-900/60 to-indigo-900/40 p-6">
        <p className="text-sm text-gray-300">보유 포인트</p>
        <PointsBalanceTooltip total={points} paid={paidPoints} free={freePoints}>
          <p className="text-3xl font-black text-white">{points.toLocaleString()}P</p>
        </PointsBalanceTooltip>
        <p className="mt-2 text-xs text-amber-300/90">
          무료 포인트는 지급일로부터 <b>{FREE_POINTS_VALID_MONTHS}개월</b>간 유효합니다 (충전 보너스·이벤트 포함).
        </p>
      </div>

      {msg && <p className="mt-4 rounded-xl bg-emerald-600/10 p-3 text-sm text-emerald-300">{msg}</p>}
      {error && <p className="mt-4 rounded-xl bg-rose-600/10 p-3 text-sm text-rose-300">{error}</p>}

      <div className="mt-6">
        <AttendanceBanner loggedIn initialCheckedIn={initialCheckedIn} />
      </div>

      {!paymentsEnabled && (
        <div className="mt-8 rounded-2xl border border-violet-500/25 bg-violet-950/30 p-5">
          <p className="text-sm font-bold text-violet-200">클로즈베타 기간</p>
          <p className="mt-2 text-sm text-gray-400">
            포인트 구매·결제는 오픈 전까지 제공되지 않습니다. 무료 포인트가 필요하면 신청해 주세요.
          </p>
          <Link
            href="/events/beta-free-points"
            className="mt-4 inline-block rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-bold text-black hover:bg-emerald-400"
          >
            무료 포인트 신청하기
          </Link>
        </div>
      )}

      {paymentsEnabled && (
        <>
      <h2 className="mt-8 text-lg font-bold text-white">포인트 충전</h2>
      <p className="mt-1 text-xs text-gray-500">
        결제 금액과 동일한 <b className="text-gray-300">유료 포인트</b>가 지급됩니다 (₩10,000 = 10,000P). 보너스는{" "}
        <b className="text-amber-200/90">무료 포인트</b>로 별도 적립됩니다.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        {POINT_CHARGE_PACKAGES.map((p) => {
          const totalPoints = p.paidPoints + p.bonusPoints;
          return (
            <button
              key={p.id}
              onClick={() => charge(p.id)}
              disabled={loading === p.id}
              className="rounded-2xl border border-white/5 bg-[#131626] p-4 text-left hover:border-violet-500/40 disabled:opacity-50"
            >
              <p className="text-lg font-black text-white">{totalPoints.toLocaleString()}P</p>
              <p className="mt-0.5 text-[11px] text-gray-400">
                유료 {p.paidPoints.toLocaleString()}P
                {p.bonusPoints > 0 && (
                  <>
                    {" "}
                    + 무료 <span className="text-amber-300/90">{p.bonusPoints.toLocaleString()}P</span>
                  </>
                )}
              </p>
              {p.bonusTag && <p className="text-[11px] font-semibold text-emerald-400">{p.bonusTag}</p>}
              <p className="mt-2 text-sm text-gray-400">₩{p.price.toLocaleString()}</p>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-gray-600">
        {portoneEnabled
          ? "※ PortOne V2 결제창으로 충전합니다. (테스트 카드는 포트원 문서 참고)"
          : "※ PortOne 미설정 — 모의 결제로 즉시 충전됩니다."}
      </p>
        </>
      )}

      <h2 className="mt-8 text-lg font-bold text-white">포인트 선물</h2>
      <div className="mt-3 rounded-2xl border border-white/5 bg-[#131626] p-5">
        <p className="text-xs leading-relaxed text-gray-400">
          <b className="text-gray-200">유료 포인트</b>만 선물할 수 있습니다. 입력한 금액이 그대로 차감되고, 받는 사람은{" "}
          <b className="text-amber-200/90">수수료 {feePct}%</b>를 제외한 금액을 받습니다.
        </p>
        <p className="mt-1 text-xs text-gray-500">
          보유 유료 포인트: <b className="text-white">{paidPoints.toLocaleString()}P</b> · 최소{" "}
          {MIN_POINT_GIFT_AMOUNT}P
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold text-gray-400">받는 사람 닉네임</span>
            <input
              type="text"
              value={giftNickname}
              onChange={(e) => setGiftNickname(e.target.value)}
              placeholder="정확한 닉네임 입력"
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-500/50"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-400">선물 금액 (차감액)</span>
            <input
              type="number"
              min={MIN_POINT_GIFT_AMOUNT}
              step={1}
              value={giftAmount}
              onChange={(e) => setGiftAmount(e.target.value)}
              placeholder={`최소 ${MIN_POINT_GIFT_AMOUNT}P`}
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-500/50"
            />
          </label>
        </div>
        {giftPreview && (
          <div className="mt-3 rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-3 text-sm text-gray-300">
            <p>
              차감 <b className="text-white">{giftPreview.gross.toLocaleString()}P</b>
              <span className="mx-2 text-gray-600">→</span>
              수수료 <b className="text-rose-300">{giftPreview.fee.toLocaleString()}P</b>
              <span className="mx-2 text-gray-600">→</span>
              상대 수령 <b className="text-emerald-300">{giftPreview.net.toLocaleString()}P</b>
            </p>
          </div>
        )}
        <button
          onClick={sendGift}
          disabled={loading === "gift"}
          className="mt-4 w-full rounded-xl bg-violet-600 py-3 font-bold text-white hover:bg-violet-500 disabled:opacity-50"
        >
          {loading === "gift" ? "처리 중…" : "유료 포인트 선물하기"}
        </button>
      </div>

      <div id={POINT_USAGE_HASH} className="mt-8 scroll-mt-28">
        <h2 className="text-lg font-bold text-white">포인트 내역</h2>
        <div
          className="mt-3 flex gap-1 rounded-xl border border-white/5 bg-[#0e1120] p-1"
          role="tablist"
          aria-label="포인트 내역 탭"
        >
          {(
            [
              ["usage", "사용 내역"],
              ["paid", "유료 충전"],
              ["free", "무료 적립"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={historyTab === id}
              onClick={() => setHistoryTab(id)}
              className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${
                historyTab === id ? "bg-violet-600 text-white" : "text-gray-300 hover:text-gray-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {historyTab === "usage" && usageTotal > 0 && (
          <p className="mt-2 text-xs text-gray-500">
            최근 {Math.min(usageTotal, 100).toLocaleString()}건 · {USAGE_PAGE_SIZE}건씩 표시
          </p>
        )}
        {historyTab === "paid" && paid.total > 0 && (
          <p className="mt-2 text-xs text-gray-500">
            최근 {Math.min(paid.total, 100).toLocaleString()}건 · {CHARGE_PAGE_SIZE}건씩 · 결제 충전·선물 수령
          </p>
        )}
        {historyTab === "free" && free.total > 0 && (
          <p className="mt-2 text-xs text-gray-500">
            최근 {Math.min(free.total, 100).toLocaleString()}건 · {CHARGE_PAGE_SIZE}건씩 · 출석·이벤트·보너스
          </p>
        )}

        <div
          className="mt-3 divide-y divide-white/5 rounded-2xl border border-white/5 bg-[#131626]"
          role="tabpanel"
        >
          {historyTab === "usage" ? (
            usageLoading ? (
              <p className="p-4 text-sm text-gray-500">불러오는 중…</p>
            ) : (
              <PointLogList
                logs={usageLogs}
                onToast={(text) => setMsg(text)}
                onRefresh={() => router.refresh()}
              />
            )
          ) : historyTab === "paid" ? (
            paid.loading ? (
              <p className="p-4 text-sm text-gray-500">불러오는 중…</p>
            ) : (
              <PointLogList
                logs={paid.logs}
                onToast={(text) => setMsg(text)}
                onRefresh={() => router.refresh()}
              />
            )
          ) : free.loading ? (
            <p className="p-4 text-sm text-gray-500">불러오는 중…</p>
          ) : (
            <PointLogList
              logs={free.logs}
              onToast={(text) => setMsg(text)}
              onRefresh={() => router.refresh()}
            />
          )}
        </div>

        {historyTab === "usage" && (
          <CreditPagination
            page={usagePage}
            totalPages={usageTotalPages}
            loading={usageLoading}
            onPage={(page) => void loadUsagePage(page)}
          />
        )}
        {historyTab === "paid" && (
          <CreditPagination
            page={paid.page}
            totalPages={paid.totalPages}
            loading={paid.loading}
            onPage={(page) => void loadCreditPage("paid", page)}
          />
        )}
        {historyTab === "free" && (
          <CreditPagination
            page={free.page}
            totalPages={free.totalPages}
            loading={free.loading}
            onPage={(page) => void loadCreditPage("free", page)}
          />
        )}
      </div>
    </div>
  );
}
