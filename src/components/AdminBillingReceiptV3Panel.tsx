"use client";

import type { ReactNode } from "react";
import {
  adminReceiptExactnessLabel,
  formatAdminActualUsd,
  formatAdminKrwFromUsd,
} from "@/lib/adminBillingReceiptV2";
import {
  formatAdminBillingReceiptV3Text,
  wholeTurnCoverageLabel,
  type AdminBillingReceiptV3,
} from "@/lib/adminBillingReceiptV3Shared";
import {
  buildAdminReceiptTurnSummary,
  formatAdminReceiptTurnSummaryLines,
} from "@/lib/adminBillingReceiptTurnSummary";
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

function coverageBadgeClass(coverage: AdminBillingReceiptV3["wholeTurn"]["coverage"]): string {
  switch (coverage) {
    case "complete":
      return "text-emerald-300/95";
    case "pending":
      return "text-amber-300/95";
    case "partial":
      return "text-orange-300/95";
    case "unverifiable":
      return "text-zinc-400";
    default:
      return "text-zinc-400";
  }
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
  const turnSummary = buildAdminReceiptTurnSummary(receipt);
  const forensic = receipt.forensic;
  const fxRate = receipt.wholeTurn.fx?.effectiveKrwPerUsd ?? null;

  return (
    <div className="space-y-0.5 text-[11px] leading-relaxed text-zinc-300">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[10px] font-semibold text-amber-300/90">
          Admin Receipt v3 · 턴 귀속 Provider 원가
        </p>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${coverageBadgeClass(receipt.wholeTurn.coverage)} bg-white/5`}
        >
          {wholeTurnCoverageLabel(receipt.wholeTurn.coverage)}
        </span>
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

      <SectionTitle>턴 요약</SectionTitle>
      {formatAdminReceiptTurnSummaryLines(turnSummary, {
        locale: "ko",
        includeHeading: false,
      }).map((line) => (
        <p key={line} className="whitespace-pre-wrap font-mono text-[10px] leading-snug">
          {line}
        </p>
      ))}

      {receipt.historicalNote && (
        <p className="text-[10px] text-amber-400/90">{receipt.historicalNote}</p>
      )}

      {!sync ? (
        <>
          <SectionTitle>Usage snapshot</SectionTitle>
          <ReceiptRow label="status" value="Unavailable — no stored Usage snapshot" />
          {forensic?.chargeStatus && (
            <ReceiptRow label="charge status" value={forensic.chargeStatus} />
          )}
          {forensic?.chargeEvidenceSettledPoints != null && (
            <ReceiptRow
              label="settled points (settlement evidence)"
              value={`${formatPoints(forensic.chargeEvidenceSettledPoints)} P`}
            />
          )}
        </>
      ) : null}

      {sync?.userCharge.billingContract && (
        <>
          <SectionTitle>User charge contract (admin)</SectionTitle>
          <ReceiptRow label="contract" value={sync.userCharge.billingContract} />
          <ReceiptRow label="reason" value={sync.userCharge.billingContractReason ?? "—"} />
          {sync.userCharge.publishedFinalPoints != null && (
            <ReceiptRow
              label="published final"
              value={`${formatPoints(sync.userCharge.publishedFinalPoints)} P`}
            />
          )}
          {sync.userCharge.pricingVersion != null && (
            <ReceiptRow label="pricingVersion" value={sync.userCharge.pricingVersion} />
          )}
        </>
      )}

      <SectionTitle>턴 귀속 Provider 총원가</SectionTitle>
      <ReceiptRow
        label="현재 확인된 Provider 비용"
        value={usdWithKrw(receipt.wholeTurn.knownProviderSpendUsd, fxRate)}
        hint="(정산확정 subset만 합산)"
      />
      <ReceiptRow
        label="확정 USD"
        value={usdWithKrw(receipt.wholeTurn.exactProviderSpendUsd, fxRate)}
      />
      <ReceiptRow
        label="확정 KRW"
        value={
          receipt.wholeTurn.exactProviderSpendKrw != null
            ? `~${formatPoints(receipt.wholeTurn.exactProviderSpendKrw)}원`
            : "—"
        }
        hint={
          fxRate != null
            ? `(billing FX ${fxRate.toLocaleString(undefined, { maximumFractionDigits: 2 })} KRW/USD · ${receipt.wholeTurn.fx?.dateKey ?? ""})`
            : "(parent turn FX 1회 적용)"
        }
      />
      {receipt.wholeTurn.contributionMarginPercent != null && (
        <ReceiptRow
          label="턴 귀속 마진"
          value={`${receipt.wholeTurn.contributionMarginPercent}%`}
          hint={`(${receipt.wholeTurn.contributionMarginKrw} KRW)`}
        />
      )}

      <SectionTitle>Async 플랫폼 부담 (턴 귀속)</SectionTitle>
      <ReceiptRow label="coverage" value={wholeTurnCoverageLabel(receipt.async.coverage)} />
      <ReceiptRow
        label="known USD"
        value={usdWithKrw(receipt.async.knownActualCostUsd, fxRate)}
      />
      <ReceiptRow
        label="exact USD"
        value={usdWithKrw(receipt.async.exactActualCostUsd, fxRate)}
      />
      {receipt.async.unexpectedRowCount > 0 && (
        <ReceiptRow
          label="unexpected rows"
          value={receipt.async.unexpectedRowCount}
          hint={`(${receipt.async.unexpectedFamilies.join(", ")})`}
        />
      )}
      {receipt.async.byFamily.map((family) => (
        <p key={family.family} className="pl-2 text-[10px] text-zinc-400">
          {family.label}: calls {family.physicalCallCount}, known{" "}
          {usdWithKrw(family.knownActualCostUsd, fxRate)}, {family.expectationState} /{" "}
          {family.coverage}
          {family.skipReason ? ` (${family.skipReason})` : ""}
        </p>
      ))}

      <SectionTitle>Main RP (동기)</SectionTitle>
      {sync?.mainRp.actual ? (
        <>
          <ReceiptRow
            label="actual USD"
            value={usdWithKrw(sync.mainRp.actual.actualProviderCostUsd, fxRate)}
          />
          <ReceiptRow
            label="확정"
            value={adminReceiptExactnessLabel(sync.mainRp.actual.exactness)}
          />
        </>
      ) : (
        <p className="text-zinc-500">Main RP actual unavailable</p>
      )}

      <SectionTitle>Sync 플랫폼 부담 (동기)</SectionTitle>
      {sync?.syncPlatformSpend.status === "available" ? (
        <>
          <ReceiptRow label="group" value={sync.syncPlatformSpend.groupLabel ?? "—"} />
          <ReceiptRow
            label="actual USD"
            value={usdWithKrw(sync.syncPlatformSpend.actualProviderCostUsd, fxRate)}
          />
          {sync.syncPlatformSpend.postTurnSharedInitial && (
            <ReceiptRow label="shared initial" value="included once in sync" />
          )}
        </>
      ) : (
        <ReceiptRow label="status" value={sync?.syncPlatformSpend.status ?? "unavailable"} />
      )}

      <SectionTitle>범위 제외</SectionTitle>
      <p className="text-[10px] text-zinc-500">{receipt.excludedCostScopes.join(", ")}</p>
    </div>
  );
}

// Re-export for copy handler consumers
export { formatAdminBillingReceiptV3Text };
