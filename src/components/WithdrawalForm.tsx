"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import {
  WITHDRAWAL_MIN_CP,
  WITHDRAWAL_PLATFORM_RETAINED_RATE,
  WITHDRAWAL_WITHHOLDING_RATE,
  WITHDRAWAL_TOTAL_DEDUCTION_RATE,
  calcWithdrawalBreakdown,
  formatAccountInfoLabel,
  withdrawalStatusLabel,
  type WithdrawalEligibility,
  type WithdrawalRequestRow,
} from "@/lib/creatorShared";
import { formatPoints } from "@/lib/billingDisplay";
import {
  formatResidentNumberDisplay,
  isValidResidentNumber,
} from "@/lib/residentId";
import { withdrawalGate } from "@/lib/creatorDashboardView";
import { WithdrawalGateBanner } from "@/components/creator/CreatorDashboardParts";
import { ScopedNotice } from "@/components/studio/PersonaPageParts";
import StudioButton from "@/components/studio/StudioButton";
import { cn, studioInputClass, studioSurface, studioType } from "@/lib/studioDesign";

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
  const uid = useId();
  const ids = {
    amount: `${uid}-amount`,
    bank: `${uid}-bank`,
    account: `${uid}-account`,
    resident: `${uid}-resident`,
    hint: `${uid}-hint`,
  };

  const verifiedRealName = withdrawal.verifiedRealName;
  const amountNum = Number(requestedCp);
  const breakdown = useMemo(() => {
    if (!amountNum || amountNum <= 0) return null;
    return calcWithdrawalBreakdown(amountNum);
  }, [amountNum]);

  const taxPct = Math.round(WITHDRAWAL_WITHHOLDING_RATE * 1000) / 10;
  const platformPct = Math.round(WITHDRAWAL_PLATFORM_RETAINED_RATE * 1000) / 10;
  const totalPct = Math.round(WITHDRAWAL_TOTAL_DEDUCTION_RATE * 100);

  const gate = withdrawalGate({ creatorPoints, hasPendingWithdrawal, withdrawal });
  const formDisabled = hasPendingWithdrawal || busy || !withdrawal.canWithdraw;
  const canSubmit =
    !formDisabled &&
    taxConsent &&
    isValidResidentNumber(residentNumber) &&
    !!bankName.trim() &&
    !!accountNumber.trim() &&
    amountNum >= WITHDRAWAL_MIN_CP &&
    amountNum <= creatorPoints;

  const missingFields = [
    !(amountNum >= WITHDRAWAL_MIN_CP && amountNum <= creatorPoints) && "출금 CP",
    !bankName.trim() && "은행명",
    !accountNumber.trim() && "계좌번호",
    !isValidResidentNumber(residentNumber) && "주민등록번호",
    !taxConsent && "수집·이용 동의",
  ].filter((label): label is string => Boolean(label));

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
          `플랫폼 수수료 (${platformPct}%): -${fmt(breakdown.platformFee)}CP`,
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
    try {
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
    } catch {
      const msg =
        "네트워크 오류로 신청 결과를 확인하지 못했어요. 입력한 내용은 그대로 두었습니다. 아래 신청 내역에서 접수 여부를 확인한 뒤 다시 시도해 주세요.";
      setError(msg);
      onError(msg);
      await onRefresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  const fieldLabel = "mb-1.5 block text-sm font-medium text-zinc-300";
  return (
    <section
      id="creator-withdraw"
      aria-labelledby={`${uid}-title`}
      className={cn(studioSurface.card, "scroll-mt-32 p-4 sm:p-5")}
    >
      <h2 id={`${uid}-title`} className={studioType.sectionTitle}>
        CP → 현금 출금 신청
      </h2>
      <p className={cn(studioType.caption, "mt-1")}>
        최소 {WITHDRAWAL_MIN_CP.toLocaleString()}CP · 1CP = ₩1 · 본인 명의 계좌만 가능
      </p>

      <div className="mt-3">
        <WithdrawalGateBanner gate={gate}>
          {!withdrawal.canWithdraw && (
            <Link
              href="/verify"
              className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-2"
            >
              성인인증 하러 가기
            </Link>
          )}
        </WithdrawalGateBanner>
      </div>

      {withdrawal.canWithdraw && (
        <p className={cn(studioType.helper, "mt-3")}>
          출금 계좌는 <strong className="text-zinc-100">본인인증 실명({verifiedRealName})</strong>과
          동일한 예금주만 등록할 수 있습니다. 신분증·통장 사본은 받지 않습니다.
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={ids.amount} className={fieldLabel}>
            출금 CP
          </label>
          <input
            id={ids.amount}
            type="number"
            inputMode="numeric"
            min={WITHDRAWAL_MIN_CP}
            step={1}
            value={requestedCp}
            onChange={(e) => setRequestedCp(e.target.value)}
            placeholder={`최소 ${WITHDRAWAL_MIN_CP.toLocaleString()} · 보유 ${fmt(creatorPoints)}CP`}
            disabled={formDisabled}
            className={studioInputClass}
          />
        </div>
        <div className="sm:col-span-2">
          <span className={fieldLabel}>예금주 (본인인증 실명)</span>
          <div
            className="rounded-xl border border-white/10 bg-[#0e1120]/80 px-4 py-3 text-sm text-zinc-100"
          >
            {verifiedRealName || "—"}
          </div>
        </div>
        <div>
          <label htmlFor={ids.bank} className={fieldLabel}>
            은행명
          </label>
          <input
            id={ids.bank}
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            placeholder="예: 카카오뱅크"
            disabled={formDisabled}
            className={studioInputClass}
          />
        </div>
        <div>
          <label htmlFor={ids.account} className={fieldLabel}>
            계좌번호
          </label>
          <input
            id={ids.account}
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            placeholder="- 없이 입력"
            inputMode="numeric"
            autoComplete="off"
            disabled={formDisabled}
            className={studioInputClass}
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={ids.resident} className={fieldLabel}>
            주민등록번호 (13자리)
          </label>
          <input
            id={ids.resident}
            value={residentNumber}
            onChange={(e) => onResidentChange(e.target.value)}
            placeholder="000000-0000000"
            inputMode="numeric"
            autoComplete="off"
            maxLength={14}
            disabled={formDisabled}
            aria-describedby={ids.hint}
            className={cn(studioInputClass, "font-mono tracking-wider")}
          />
          <p id={ids.hint} className={cn(studioType.caption, "mt-1")}>
            주민등록번호는 암호화되어 보관되며, 계좌 예금주는 신청 시 자동 확인됩니다.
          </p>
        </div>
      </div>

      <label className="mt-3 flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm text-zinc-300">
        <input
          type="checkbox"
          checked={taxConsent}
          onChange={(e) => setTaxConsent(e.target.checked)}
          disabled={formDisabled}
          className="mt-0.5 h-6 w-6 shrink-0 accent-violet-500"
        />
        <span>
          원천징수 신고 목적의 주민등록번호 수집 및 이용에 동의합니다{" "}
          <span className="text-rose-300">(필수)</span>
        </span>
      </label>

      {breakdown && amountNum > 0 && (
        <div className="mt-3 rounded-xl border border-white/10 bg-[#0e1120]/80 px-4 py-3" aria-live="polite">
          <p className="text-xs font-semibold tracking-wider text-zinc-400">예상 수령액 (실시간)</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-50">
            ₩{breakdown.payoutAmount.toLocaleString()}
          </p>
          <ul className="mt-2 space-y-1 text-sm text-zinc-300">
            <li className="flex justify-between gap-3">
              <span>신청 CP</span>
              <span className="tabular-nums text-zinc-50">{fmt(breakdown.requestedCp)}CP</span>
            </li>
            <li className="flex justify-between gap-3">
              <span>원천징수 세금 ({taxPct}%)</span>
              <span className="tabular-nums text-rose-200">-{fmt(breakdown.taxAmount)}CP</span>
            </li>
            <li className="flex justify-between gap-3">
              <span>플랫폼 수수료 ({platformPct}%)</span>
              <span className="tabular-nums text-rose-200">-{fmt(breakdown.platformFee)}CP</span>
            </li>
            <li className="flex justify-between gap-3 border-t border-white/10 pt-1 font-semibold">
              <span>실수령 ({100 - totalPct}%)</span>
              <span className="tabular-nums text-zinc-50">₩{breakdown.payoutAmount.toLocaleString()}</span>
            </li>
          </ul>
        </div>
      )}

      <div
        data-testid="withdraw-action-bar"
        className="sticky bottom-[calc(var(--mobile-nav-offset,0px)+var(--keyboard-inset,0px))] z-10 -mx-4 mt-3 space-y-2 border-t border-white/10 bg-[#0b0d14]/95 px-4 py-3 backdrop-blur-md sm:-mx-5 sm:px-5"
      >
        {!formDisabled && missingFields.length > 0 ? (
          <p className={studioType.caption}>신청하려면 확인이 필요해요: {missingFields.join(" · ")}</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <StudioButton
            type="button"
            variant="secondary"
            disabled={formDisabled || creatorPoints < WITHDRAWAL_MIN_CP}
            onClick={() =>
              setRequestedCp(String(Math.max(WITHDRAWAL_MIN_CP, Math.floor(creatorPoints))))
            }
          >
            전액
          </StudioButton>
          <StudioButton type="button" disabled={!canSubmit} onClick={submit}>
            {busy ? "신청 중…" : "출금 신청"}
          </StudioButton>
        </div>
        <ScopedNotice notice={error ? { kind: "error", text: error } : null} />
      </div>

      <p className={cn(studioType.caption, "mt-3")}>
        세금 {taxPct}% 포함 총 {totalPct}%가 공제된 금액이 입금됩니다. (실수령 {100 - totalPct}%)
      </p>

      {recentWithdrawals.length > 0 && (
        <div className="mt-5 border-t border-white/10 pt-4">
          <h3 className="mb-2 text-sm font-semibold text-zinc-200">출금 신청 내역</h3>
          <ul className="space-y-2">
            {recentWithdrawals.map((w) => (
              <li
                key={w.id}
                className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-white/[0.08] bg-[#0e1120]/70 px-3 py-2.5"
              >
                <div className="min-w-0 text-sm text-zinc-200">
                  <p className="break-all">{formatAccountInfoLabel(w.account_info)}</p>
                  <p className="text-xs text-zinc-400">{w.created_at}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums text-zinc-50">
                    ₩{w.payout_amount.toLocaleString()}
                  </p>
                  <p className="text-xs text-zinc-400">
                    {fmt(w.requested_cp)}CP · 세금 {fmt(w.tax_amount)} · 플랫폼 수수료{" "}
                    {fmt(w.platform_fee)}
                  </p>
                  <WithdrawalStatusLabel status={w.status} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

const STATUS_TONE: Record<string, string> = {
  APPROVED: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200",
  REJECTED: "border-rose-400/30 bg-rose-500/10 text-rose-200",
  FAILED: "border-rose-400/30 bg-rose-500/10 text-rose-200",
};

function WithdrawalStatusLabel({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? "border-amber-400/30 bg-amber-500/10 text-amber-200";
  const label = status === "FAILED" ? "지급실패·CP복구" : withdrawalStatusLabel(status);
  return (
    <span className={cn("mt-1 inline-block rounded border px-1.5 py-0.5 text-xs font-semibold", tone)}>
      {label}
    </span>
  );
}
