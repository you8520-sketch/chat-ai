"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  WITHDRAWAL_MIN_CP,
  WITHDRAWAL_PLATFORM_FEE_RATE,
  WITHDRAWAL_TAX_RATE,
  WITHDRAWAL_TOTAL_DEDUCTION_RATE,
  calcWithdrawalBreakdown,
  formatAccountInfoLabel,
  type WithdrawalEligibility,
  type WithdrawalRequestRow,
} from "@/lib/creatorShared";
import { formatPoints } from "@/lib/billingDisplay";
import {
  formatResidentNumberDisplay,
  isValidResidentNumber,
} from "@/lib/residentId";

function fmt(n: number) {
  return formatPoints(n);
}

type Props = {
  creatorPoints: number;
  hasPendingWithdrawal: boolean;
  recentWithdrawals: WithdrawalRequestRow[];
  withdrawal: WithdrawalEligibility;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  onRefresh: () => Promise<void>;
};

export default function WithdrawalForm({
  creatorPoints,
  hasPendingWithdrawal,
  recentWithdrawals,
  withdrawal,
  onSuccess,
  onError,
  onRefresh,
}: Props) {
  const [requestedCp, setRequestedCp] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [residentNumber, setResidentNumber] = useState("");
  const [taxConsent, setTaxConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const verifiedRealName = withdrawal.verifiedRealName;
  const amountNum = Number(requestedCp);
  const breakdown = useMemo(() => {
    if (!amountNum || amountNum <= 0) return null;
    return calcWithdrawalBreakdown(amountNum);
  }, [amountNum]);

  const taxPct = Math.round(WITHDRAWAL_TAX_RATE * 1000) / 10;
  const platformPct = Math.round(WITHDRAWAL_PLATFORM_FEE_RATE * 1000) / 10;
  const totalPct = Math.round(WITHDRAWAL_TOTAL_DEDUCTION_RATE * 100);

  const formDisabled = hasPendingWithdrawal || busy || !withdrawal.canWithdraw;
  const canSubmit =
    !formDisabled &&
    taxConsent &&
    isValidResidentNumber(residentNumber) &&
    !!bankName.trim() &&
    !!accountNumber.trim() &&
    amountNum >= WITHDRAWAL_MIN_CP &&
    amountNum <= creatorPoints;

  function onResidentChange(raw: string) {
    setResidentNumber(formatResidentNumberDisplay(raw));
  }

  async function submit() {
    if (!withdrawal.canWithdraw) {
      setError(withdrawal.blockReason ?? "출금 신청 조건을 충족하지 않습니다.");
      return;
    }
    if (!amountNum || amountNum < WITHDRAWAL_MIN_CP) {
      const msg = `${WITHDRAWAL_MIN_CP.toLocaleString()} CP 이상부터 출금 신청이 가능합니다.`;
      setError(msg);
      onError(msg);
      return;
    }
    if (amountNum > creatorPoints) {
      const msg = `보유 CP(${fmt(creatorPoints)})보다 많은 금액은 출금할 수 없습니다.`;
      setError(msg);
      onError(msg);
      return;
    }
    if (!taxConsent) {
      setError("원천징수 신고 목적의 주민등록번호 수집·이용에 동의해 주세요.");
      return;
    }
    if (!isValidResidentNumber(residentNumber)) {
      setError("주민등록번호 13자리를 입력해 주세요.");
      return;
    }
    if (!breakdown) return;

    if (
      !confirm(
        [
          "출금을 신청할까요?",
          "",
          `신청 CP: ${fmt(breakdown.requestedCp)}CP`,
          `원천징수 세금 (${taxPct}%): -${fmt(breakdown.taxAmount)}CP`,
          `플랫폼 이용료 (${platformPct}%): -${fmt(breakdown.platformFee)}CP`,
          `실수령 예정: ₩${breakdown.payoutAmount.toLocaleString()}`,
          "",
          `예금주: ${verifiedRealName} (본인인증 실명)`,
          `은행: ${bankName}`,
        ].join("\n")
      )
    ) {
      return;
    }

    setBusy(true);
    setError("");
    const res = await fetch("/api/creator/withdraw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: amountNum,
        bankName,
        accountNumber,
        residentNumber,
        taxConsent: true,
      }),
    });
    setBusy(false);
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || "출금 신청에 실패했습니다.");
      onError(json.error || "출금 신청에 실패했습니다.");
      return;
    }
    setError("");
    onSuccess(
      `출금 신청이 접수되었습니다. 실수령 ₩${json.payoutAmount.toLocaleString()} (매월 일괄 입금)`
    );
    setRequestedCp("");
    setAccountNumber("");
    setResidentNumber("");
    setTaxConsent(false);
    await onRefresh();
  }

  return (
    <section className="rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-5">
      <h2 className="text-sm font-bold text-emerald-200">CP → 현금 출금 신청</h2>
      <p className="mt-1 text-xs text-gray-300">
        최소 {WITHDRAWAL_MIN_CP.toLocaleString()}CP · 1CP = ₩1 · 본인 명의 계좌만 가능
      </p>

      {!withdrawal.canWithdraw && (
        <p className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {withdrawal.blockReason}{" "}
          <Link href="/verify" className="font-semibold underline hover:text-rose-100">
            성인인증 하러 가기
          </Link>
        </p>
      )}

      {withdrawal.canWithdraw && (
        <p className="mt-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100/90">
          출금 계좌는 <strong className="text-white">본인인증 실명({verifiedRealName})</strong>과
          동일한 예금주만 등록할 수 있습니다. 신분증·통장 사본은 받지 않습니다.
        </p>
      )}

      {hasPendingWithdrawal && (
        <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          처리 대기(PENDING) 중인 출금 신청이 있습니다. 승인·반려 후 새로 신청할 수 있습니다.
        </p>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs text-gray-300">출금 CP</label>
          <input
            type="number"
            min={WITHDRAWAL_MIN_CP}
            step={1}
            value={requestedCp}
            onChange={(e) => setRequestedCp(e.target.value)}
            placeholder={`최소 ${WITHDRAWAL_MIN_CP.toLocaleString()} · 보유 ${fmt(creatorPoints)}CP`}
            disabled={formDisabled}
            className="w-full rounded-xl border border-white/10 bg-[#0e1120] px-3 py-2 text-sm text-white outline-none focus:border-emerald-500 disabled:opacity-50"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs text-gray-300">예금주 (본인인증 실명)</label>
          <div className="rounded-xl border border-white/10 bg-[#0e1120]/80 px-3 py-2 text-sm text-emerald-200">
            {verifiedRealName || "—"}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-300">은행명</label>
          <input
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            placeholder="예: 카카오뱅크"
            disabled={formDisabled}
            className="w-full rounded-xl border border-white/10 bg-[#0e1120] px-3 py-2 text-sm text-white outline-none focus:border-emerald-500 disabled:opacity-50"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-300">계좌번호</label>
          <input
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            placeholder="- 없이 입력"
            disabled={formDisabled}
            className="w-full rounded-xl border border-white/10 bg-[#0e1120] px-3 py-2 text-sm text-white outline-none focus:border-emerald-500 disabled:opacity-50"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs text-gray-300">주민등록번호 (13자리)</label>
          <input
            value={residentNumber}
            onChange={(e) => onResidentChange(e.target.value)}
            placeholder="000000-0000000"
            inputMode="numeric"
            autoComplete="off"
            maxLength={14}
            disabled={formDisabled}
            className="w-full rounded-xl border border-white/10 bg-[#0e1120] px-3 py-2 font-mono text-sm tracking-wider text-white outline-none focus:border-emerald-500 disabled:opacity-50"
          />
        </div>
      </div>

      <label className="mt-4 flex cursor-pointer items-start gap-2 text-xs text-gray-300">
        <input
          type="checkbox"
          checked={taxConsent}
          onChange={(e) => setTaxConsent(e.target.checked)}
          disabled={formDisabled}
          className="mt-0.5 accent-emerald-500"
        />
        <span>
          원천징수 신고 목적의 주민등록번호 수집 및 이용에 동의합니다{" "}
          <span className="text-rose-400/90">(필수)</span>
        </span>
      </label>

      {breakdown && amountNum > 0 && (
        <div className="mt-4 rounded-xl border border-emerald-500/20 bg-black/25 px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-400/80">
            예상 수령액 (실시간)
          </p>
          <p className="mt-2 text-2xl font-black text-emerald-300">
            ₩{breakdown.payoutAmount.toLocaleString()}
          </p>
          <ul className="mt-2 space-y-1 text-xs text-gray-300">
            <li className="flex justify-between">
              <span>신청 CP</span>
              <span className="text-white">{fmt(breakdown.requestedCp)}CP</span>
            </li>
            <li className="flex justify-between">
              <span>원천징수 세금 ({taxPct}%)</span>
              <span className="text-rose-300/90">-{fmt(breakdown.taxAmount)}CP</span>
            </li>
            <li className="flex justify-between">
              <span>플랫폼 이용료 ({platformPct}%)</span>
              <span className="text-rose-300/90">-{fmt(breakdown.platformFee)}CP</span>
            </li>
            <li className="flex justify-between border-t border-white/5 pt-1 font-semibold">
              <span>실수령 ({100 - totalPct}%)</span>
              <span className="text-emerald-300">₩{breakdown.payoutAmount.toLocaleString()}</span>
            </li>
          </ul>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={formDisabled || creatorPoints < WITHDRAWAL_MIN_CP}
          onClick={() =>
            setRequestedCp(String(Math.max(WITHDRAWAL_MIN_CP, Math.floor(creatorPoints))))
          }
          className="rounded-xl border border-white/10 px-3 py-2 text-xs text-zinc-300 hover:bg-white/5 disabled:opacity-40"
        >
          전액
        </button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={submit}
          className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-40"
        >
          {busy ? "신청 중…" : "출금 신청"}
        </button>
      </div>

      {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}

      <p className="mt-4 text-[11px] leading-relaxed text-gray-300/90">
        💡 세금 {taxPct}% 포함 총 {totalPct}%의 수수료가 공제된 금액이 입금됩니다.
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-gray-300/80">
        주민등록번호는 암호화되어 보관되며, 계좌 예금주는 신청 시 자동 확인됩니다.
      </p>

      {recentWithdrawals.length > 0 && (
        <div className="mt-5 border-t border-white/5 pt-4">
          <h3 className="mb-2 text-xs font-bold text-gray-300">출금 신청 내역</h3>
          <ul className="space-y-2 text-xs">
            {recentWithdrawals.map((w) => (
              <li
                key={w.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/5 bg-[#0e1120] px-3 py-2"
              >
                <div className="min-w-0 text-gray-300">
                  <p>{formatAccountInfoLabel(w.account_info)}</p>
                  <p className="text-[10px] text-zinc-400">{w.created_at}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-emerald-300">₩{w.payout_amount.toLocaleString()}</p>
                  <p className="text-[10px] text-zinc-400">
                    {fmt(w.requested_cp)}CP · 세금 {fmt(w.tax_amount)} · 수수료{" "}
                    {fmt(w.platform_fee)} · <WithdrawalStatusLabel status={w.status} />
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function WithdrawalStatusLabel({ status }: { status: string }) {
  if (status === "APPROVED") return <span className="text-emerald-400">승인·입금</span>;
  if (status === "REJECTED") return <span className="text-rose-400">반려</span>;
  if (status === "FAILED") return <span className="text-rose-400">지급실패·CP복구</span>;
  return <span className="text-amber-400">검토중</span>;
}
