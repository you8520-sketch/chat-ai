"use client";

import { useRef, useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import StatusNotice from "@/components/StatusNotice";
import {
  estimateGiftBreakdown,
  MIN_POINT_GIFT_AMOUNT,
  POINT_GIFT_FEE_RATE_FREE,
  POINT_GIFT_FEE_RATE_PAID,
  resolveGiftMutationKey,
  type GiftBreakdown,
  type GiftMutationIntent,
} from "@/lib/pointGiftsShared";
import { giftInputProblem } from "@/lib/pointsPageView";
import { cn, studioInputClass, studioSurface, studioType } from "@/lib/studioDesign";

type Props = {
  paidPoints: number;
  giftableFreePoints: number;
  attendanceFreePoints: number;
  onGifted: () => void;
};

type Note = { tone: "success" | "error"; text: string };

function p(value: number): string {
  return `${value.toLocaleString("ko-KR")}P`;
}

function BreakdownRows({ breakdown, feePctPaid, feePctFree }: { breakdown: GiftBreakdown; feePctPaid: number; feePctFree: number }) {
  return (
    <dl className="divide-y divide-white/5 rounded-xl border border-white/10 bg-[#0e1120] text-sm" data-testid="gift-breakdown">
      <div className="flex items-baseline justify-between gap-3 px-4 py-2.5">
        <dt className="text-zinc-300">내 포인트에서 차감</dt>
        <dd className="font-semibold tabular-nums text-zinc-50">-{p(breakdown.gross)}</dd>
      </div>
      <div className="flex items-baseline justify-between gap-3 px-4 py-2.5">
        <dt className="text-zinc-300">
          수수료
          <span className="block text-xs text-zinc-400">
            유료 {feePctPaid}% · 무료 {feePctFree}%
          </span>
        </dt>
        <dd className="font-semibold tabular-nums text-rose-300">-{p(breakdown.fee)}</dd>
      </div>
      <div className="flex items-baseline justify-between gap-3 px-4 py-2.5">
        <dt className="text-zinc-100">상대 수령액</dt>
        <dd className="text-base font-semibold tabular-nums text-violet-300">{p(breakdown.net)}</dd>
      </div>
      <div className="px-4 py-2 text-xs text-zinc-400">
        차감 구성: 유료 {p(breakdown.paidGross)} · 무료 {p(breakdown.freeGross)} (만료 임박 우선)
      </div>
    </dl>
  );
}

export default function PointGiftForm({ paidPoints, giftableFreePoints, attendanceFreePoints, onGifted }: Props) {
  const [nickname, setNickname] = useState("");
  const [amountText, setAmountText] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [fieldError, setFieldError] = useState("");
  const [note, setNote] = useState<Note | null>(null);
  /** Mutation-intent key: stable across double-click/retry of the same submit. */
  const mutationKeyRef = useRef<GiftMutationIntent | null>(null);
  const inflight = useRef(false);

  const feePctPaid = Math.round(POINT_GIFT_FEE_RATE_PAID * 100);
  const feePctFree = Math.round(POINT_GIFT_FEE_RATE_FREE * 100);
  const giftableTotal = Math.round((paidPoints + giftableFreePoints) * 10) / 10;
  const amount = amountText ? Number(amountText) : 0;
  const preview =
    Number.isFinite(amount) && amount >= MIN_POINT_GIFT_AMOUNT && amount <= giftableTotal
      ? estimateGiftBreakdown(amount, giftableFreePoints, paidPoints)
      : null;
  const trimmedNickname = nickname.trim();
  const liveHint =
    amountText && amount < MIN_POINT_GIFT_AMOUNT
      ? `최소 ${MIN_POINT_GIFT_AMOUNT}P부터 선물할 수 있어요.`
      : amountText && amount > giftableTotal
        ? `선물 가능한 ${p(giftableTotal)}를 넘었어요.`
        : "";

  function requestConfirm() {
    setNote(null);
    const problem = giftInputProblem({ nickname, amount, giftableTotal })?.message ?? "";
    setFieldError(problem);
    if (problem) return;
    setConfirmOpen(true);
  }

  async function send() {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    const generateKey =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? () => crypto.randomUUID()
        : () => `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    const intent = resolveGiftMutationKey(mutationKeyRef.current, `nick:${trimmedNickname.toLowerCase()}`, amount, generateKey);
    mutationKeyRef.current = intent;
    try {
      const res = await fetch("/api/points/gift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientNickname: trimmedNickname, amount, clientMutationId: intent.key }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        mutationKeyRef.current = null;
        setNote({
          tone: "success",
          text: `${data.recipientNickname}님에게 ${p(data.net)}를 선물했어요. (차감 ${p(data.gross)} · 수수료 ${p(data.fee)})`,
        });
        setNickname("");
        setAmountText("");
        setFieldError("");
        onGifted();
      } else {
        setNote({ tone: "error", text: data.error || "선물에 실패했습니다. 입력한 내용은 그대로 남아 있어요." });
      }
    } catch {
      setNote({ tone: "error", text: "네트워크 오류가 발생했습니다. 입력한 내용은 그대로 남아 있어요. 다시 시도해 주세요." });
    } finally {
      inflight.current = false;
      setBusy(false);
      setConfirmOpen(false);
    }
  }

  return (
    <section aria-labelledby="points-gift-title" data-testid="gift-form" className={studioSurface.section}>
      <div>
        <h2 id="points-gift-title" className={studioType.sectionTitle}>
          포인트 선물
        </h2>
        <p className={cn(studioType.helper, "mt-1")}>
          선물 가능 <b className="tabular-nums text-zinc-100">{p(giftableTotal)}</b> (유료 {p(paidPoints)} + 무료 {p(giftableFreePoints)}
          {attendanceFreePoints > 0 ? `, 출석 ${p(attendanceFreePoints)} 제외` : ""}) · 최소 {MIN_POINT_GIFT_AMOUNT}P
        </p>
      </div>

      <form
        className="space-y-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) requestConfirm();
        }}
      >
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className={studioType.label}>받는 사람 닉네임</span>
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="정확한 닉네임 입력"
              autoComplete="off"
              autoCapitalize="none"
              enterKeyHint="next"
              maxLength={40}
              disabled={busy}
              data-testid="gift-nickname"
              className={cn(studioInputClass, "min-h-12 scroll-mb-28")}
            />
          </label>
          <label className="block">
            <span className={studioType.label}>선물 금액 (차감액)</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value.replace(/[^0-9]/g, "").slice(0, 9))}
              placeholder={`최소 ${MIN_POINT_GIFT_AMOUNT}P`}
              autoComplete="off"
              enterKeyHint="send"
              disabled={busy}
              data-testid="gift-amount"
              className={cn(studioInputClass, "min-h-12 scroll-mb-28 tabular-nums")}
            />
          </label>
        </div>

        {liveHint && !fieldError && (
          <p data-testid="gift-hint" className="text-[13px] leading-relaxed text-amber-200">
            {liveHint}
          </p>
        )}

        {preview && <BreakdownRows breakdown={preview} feePctPaid={feePctPaid} feePctFree={feePctFree} />}

        {fieldError && (
          <StatusNotice tone="error" testId="gift-error">
            {fieldError}
          </StatusNotice>
        )}

        <button
          type="submit"
          disabled={busy}
          aria-busy={busy}
          data-testid="gift-submit"
          className="min-h-12 w-full rounded-xl bg-violet-600 px-5 text-base font-semibold text-white transition hover:bg-violet-500 disabled:opacity-60"
        >
          {busy ? "처리 중…" : "포인트 선물하기"}
        </button>
      </form>

      {note && (
        <StatusNotice tone={note.tone} testId="gift-notice">
          {note.text}
        </StatusNotice>
      )}

      <ConfirmDialog
        touchTargets
        open={confirmOpen}
        title="포인트를 선물할까요?"
        message={
          preview ? (
            <div className="space-y-3">
              <p className="text-zinc-300">
                <b className="break-all text-zinc-50">{trimmedNickname}</b>님에게 선물해요.
              </p>
              <BreakdownRows breakdown={preview} feePctPaid={feePctPaid} feePctFree={feePctFree} />
              <p className="text-xs text-zinc-400">실제 차감은 만료 임박·무료 우선이며, 출석 포인트는 선물할 수 없습니다.</p>
            </div>
          ) : null
        }
        confirmLabel={busy ? "처리 중…" : "선물하기"}
        confirmDisabled={busy}
        onConfirm={() => void send()}
        onCancel={() => {
          if (!busy) setConfirmOpen(false);
        }}
      />
    </section>
  );
}
