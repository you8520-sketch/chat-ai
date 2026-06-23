"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  computeGiftBreakdown,
  MIN_POINT_GIFT_AMOUNT,
  POINT_GIFT_FEE_RATE,
} from "@/lib/pointGiftsShared";

type Props = {
  recipientId: number;
  recipientNickname: string;
  paidPoints: number;
  loggedIn: boolean;
  loginRedirect: string;
  /** 액션 버튼 행(캐릭터 페이지) 등 레이아웃 맞춤 */
  buttonClassName?: string;
  modalTitle?: string;
};

const DEFAULT_BUTTON_CLASS =
  "inline-flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-bold text-amber-200 transition hover:bg-amber-500/20";

const ACTION_ROW_BUTTON_CLASS =
  "inline-flex items-center gap-1.5 rounded-full px-6 py-3 font-semibold border border-amber-500/40 bg-amber-500/10 text-amber-200 transition hover:bg-amber-500/20";

const QUICK_AMOUNTS = [100, 500, 1000, 5000];

export { ACTION_ROW_BUTTON_CLASS };

export default function CreatorGiftPanel({
  recipientId,
  recipientNickname,
  paidPoints,
  loggedIn,
  loginRedirect,
  buttonClassName,
  modalTitle,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const feePct = Math.round(POINT_GIFT_FEE_RATE * 100);
  const btnClass = buttonClassName ?? DEFAULT_BUTTON_CLASS;
  const giftTitle = modalTitle ?? `@${recipientNickname}에게 선물`;
  const preview = (() => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return null;
    return computeGiftBreakdown(n);
  })();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !loading) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, loading]);

  function resetForm() {
    setAmount("");
    setError("");
    setSuccess("");
  }

  function closeModal() {
    if (loading) return;
    setOpen(false);
    resetForm();
  }

  async function sendGift() {
    const gross = Number(amount);
    if (!Number.isFinite(gross) || gross < MIN_POINT_GIFT_AMOUNT) {
      setError(`최소 선물 금액은 ${MIN_POINT_GIFT_AMOUNT}P입니다.`);
      return;
    }
    if (paidPoints < gross) {
      setError("유료 포인트가 부족합니다. (무료 포인트는 선물할 수 없습니다)");
      return;
    }

    const breakdown = computeGiftBreakdown(gross);
    if (
      !confirm(
        `@${recipientNickname}님에게 유료 포인트를 선물할까요?\n\n차감: ${breakdown.gross.toLocaleString()}P (유료)\n수수료 ${feePct}%: ${breakdown.fee.toLocaleString()}P\n상대 수령: ${breakdown.net.toLocaleString()}P`
      )
    ) {
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");

    const res = await fetch("/api/points/gift", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipientId, amount: gross }),
    });
    const data = await res.json();
    setLoading(false);

    if (res.ok) {
      setSuccess(
        `@${data.recipientNickname ?? recipientNickname}님에게 ${data.net.toLocaleString()}P를 선물했습니다.`
      );
      setAmount("");
      router.refresh();
      return;
    }

    setError(data.error || "선물에 실패했습니다.");
  }

  if (!loggedIn) {
    return (
      <Link
        href={`/login?redirect=${encodeURIComponent(loginRedirect)}`}
        className={btnClass}
      >
        🎁 포인트 선물
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          resetForm();
          setOpen(true);
        }}
        className={btnClass}
      >
        🎁 포인트 선물
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/65 p-4"
          role="presentation"
          onClick={closeModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="creator-gift-title"
            className="w-full max-w-md rounded-2xl border border-white/10 bg-[#131626] p-5 shadow-2xl shadow-black/50"
            onClick={(e) => e.stopPropagation()}
          >
            <p id="creator-gift-title" className="text-lg font-black text-white">
              {giftTitle}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-gray-400">
              <b className="text-gray-200">유료 포인트</b>만 선물할 수 있습니다. 수수료 {feePct}%를 제외한 금액이
              제작자에게 전달됩니다.
            </p>
            <p className="mt-2 text-xs text-gray-500">
              보유 유료 포인트: <b className="text-white">{paidPoints.toLocaleString()}P</b> · 최소{" "}
              {MIN_POINT_GIFT_AMOUNT}P
            </p>

            {success && (
              <p className="mt-3 rounded-xl bg-emerald-600/10 p-3 text-sm text-emerald-300">{success}</p>
            )}
            {error && <p className="mt-3 rounded-xl bg-rose-600/10 p-3 text-sm text-rose-300">{error}</p>}

            {!success && (
              <>
                <div className="mt-4 flex flex-wrap gap-2">
                  {QUICK_AMOUNTS.map((v) => (
                    <button
                      key={v}
                      type="button"
                      disabled={loading || paidPoints < v}
                      onClick={() => setAmount(String(v))}
                      className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:border-violet-500/40 hover:text-white disabled:opacity-40"
                    >
                      {v.toLocaleString()}P
                    </button>
                  ))}
                </div>

                <label className="mt-4 block">
                  <span className="text-xs font-semibold text-gray-400">선물 금액 (차감액)</span>
                  <input
                    type="number"
                    min={MIN_POINT_GIFT_AMOUNT}
                    step={1}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder={`최소 ${MIN_POINT_GIFT_AMOUNT}P`}
                    disabled={loading}
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-500/50 disabled:opacity-50"
                  />
                </label>

                {preview && (
                  <div className="mt-3 rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-3 text-sm text-gray-300">
                    차감 <b className="text-white">{preview.gross.toLocaleString()}P</b>
                    <span className="mx-2 text-gray-600">→</span>
                    수수료 <b className="text-rose-300">{preview.fee.toLocaleString()}P</b>
                    <span className="mx-2 text-gray-600">→</span>
                    수령 <b className="text-emerald-300">{preview.net.toLocaleString()}P</b>
                  </div>
                )}

                {paidPoints < MIN_POINT_GIFT_AMOUNT && (
                  <p className="mt-3 text-xs text-amber-300/90">
                    유료 포인트가 부족합니다.{" "}
                    <Link href="/points" className="underline hover:text-amber-200">
                      포인트 충전
                    </Link>
                  </p>
                )}

                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    disabled={loading}
                    className="rounded-lg bg-white/5 px-4 py-2 text-sm font-semibold text-zinc-300 hover:bg-white/10 disabled:opacity-50"
                  >
                    {success ? "닫기" : "취소"}
                  </button>
                  <button
                    type="button"
                    onClick={sendGift}
                    disabled={loading || paidPoints < MIN_POINT_GIFT_AMOUNT}
                    className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
                  >
                    {loading ? "처리 중…" : "선물하기"}
                  </button>
                </div>
              </>
            )}

            {success && (
              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500"
                >
                  닫기
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
