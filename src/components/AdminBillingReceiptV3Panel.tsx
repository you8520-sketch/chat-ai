"use client";

import type { ReactNode } from "react";
import {
  formatAdminActualUsd,
  formatAdminKrwFromUsd,
} from "@/lib/adminBillingReceiptV2";
import {
  buildAdminReceiptCompactViewModel,
  formatAdminBillingReceiptV3MainRpModelLines,
  formatAdminBillingReceiptV3Text,
  resolveAdminBillingReceiptV3MainRpModelIdentity,
  type AdminBillingReceiptV3,
} from "@/lib/adminBillingReceiptV3Shared";
import { formatPoints } from "@/lib/billingDisplay";

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <p className="mb-0.5 mt-2 border-t border-zinc-800 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 first:mt-0 first:border-t-0 first:pt-0">
      {children}
    </p>
  );
}

function ReceiptRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <p>
      <span className="text-zinc-500">{label}:</span> {value}
      {hint ? <span className="text-zinc-600"> {hint}</span> : null}
    </p>
  );
}

/** USD 값 옆에 오늘의 billing FX로 환산한 KRW 금액을 함께 표시한다. */
function usdWithKrw(
  usd: number | null | undefined,
  effectiveKrwPerUsd: number | null | undefined
): ReactNode {
  if (usd == null || !(usd > 0)) return "—";
  const krw = formatAdminKrwFromUsd(usd, effectiveKrwPerUsd);
  if (krw == null) return formatAdminActualUsd(usd);
  return (
    <>
      {formatAdminActualUsd(usd)}{" "}
      <span className="text-zinc-400">({krw})</span>
    </>
  );
}

export function AdminBillingReceiptV3Panel({
  receipt,
  onCopy,
  copied,
}: {
  receipt: AdminBillingReceiptV3;
  onCopy?: () => void;
  copied?: boolean;
}) {
  const sync = receipt.syncReceipt;
  const fxRate = receipt.wholeTurn.fx?.effectiveKrwPerUsd ?? null;
  const vm = buildAdminReceiptCompactViewModel(receipt);
  const mainRpModelLines = formatAdminBillingReceiptV3MainRpModelLines(
    resolveAdminBillingReceiptV3MainRpModelIdentity(receipt)
  );

  return (
    <div className="space-y-0.5 text-[11px] leading-relaxed text-zinc-300">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[10px] font-semibold text-amber-300/90">
          Admin Receipt v3
        </p>
        {onCopy && (
          <button
            type="button"
            className="ml-auto text-[10px] text-zinc-500 underline hover:text-zinc-300"
            onClick={onCopy}
          >
            {copied ? "복사됨" : "클립보드"}
          </button>
        )}
      </div>

      <SectionTitle>Main RP</SectionTitle>
      {mainRpModelLines.map((line) => (
        <p key={line} className="whitespace-pre-wrap font-mono text-[10px] leading-snug">
          {line}
        </p>
      ))}
      {vm.mainRp.provenanceLabel && vm.mainRp.costUsd != null ? (
        <ReceiptRow
          label={vm.mainRp.provenanceLabel}
          value={usdWithKrw(vm.mainRp.costUsd, fxRate)}
        />
      ) : null}

      {sync ? (
        <>
          <SectionTitle>차감</SectionTitle>
          <ReceiptRow
            label="실제 차감"
            value={
              vm.deductedPoints != null
                ? `${formatPoints(vm.deductedPoints)} P`
                : "확인 불가"
            }
          />
          <ReceiptRow
            label="입력/출력"
            value={`${(sync.userCharge.inputTokens ?? 0).toLocaleString()} / ${(sync.userCharge.outputTokens ?? 0).toLocaleString()} tok`}
          />
          {receipt.mainRpOutputVisibleChars != null && (
            <ReceiptRow
              label="출력"
              value={`${receipt.mainRpOutputVisibleChars.toLocaleString()}자`}
            />
          )}
        </>
      ) : null}

      {vm.auxiliaryCalls.length > 0 ? (
        <>
          <SectionTitle>이번 턴 보조 호출</SectionTitle>
          {vm.auxiliaryCalls.map((call) => (
            <ReceiptRow
              key={call.label}
              label={call.label}
              value={
                <>
                  {call.model ? (
                    <span className="text-zinc-200">{call.model} · </span>
                  ) : null}
                  <span className="text-zinc-200">
                    {call.calls}회 {call.result === "success" ? "성공" : call.result}
                  </span>
                  {call.costUsd != null ? (
                    <>
                      {" · "}
                      {usdWithKrw(call.costUsd, fxRate)}
                      {call.costProvenanceLabel ? (
                        <span className="text-zinc-500"> ({call.costProvenanceLabel})</span>
                      ) : null}
                    </>
                  ) : null}
                </>
              }
            />
          ))}
        </>
      ) : null}

      {vm.hasCompleteTotal && vm.completeTotalUsd != null ? (
        <>
          <SectionTitle>이번 턴 확인 원가</SectionTitle>
          <ReceiptRow label="합계" value={usdWithKrw(vm.completeTotalUsd, fxRate)} />
        </>
      ) : null}

      {receipt.historicalNote && (
        <p className="text-[10px] text-amber-400/90">{receipt.historicalNote}</p>
      )}
    </div>
  );
}

// Re-export for copy handler consumers
export { formatAdminBillingReceiptV3Text };
