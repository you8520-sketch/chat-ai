"use client";

import type { ReactNode } from "react";
import {
  adminReceiptExactnessLabel,
  formatAdminActualUsd,
} from "@/lib/adminBillingReceiptV2";
import {
  formatAdminBillingReceiptV3Text,
  wholeTurnCoverageLabel,
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
      {receipt.historicalNote && (
        <p className="text-[10px] text-amber-400/90">{receipt.historicalNote}</p>
      )}

      <SectionTitle>턴 귀속 Provider 총원가</SectionTitle>
      <ReceiptRow
        label="현재 확인된 Provider 비용"
        value={formatAdminActualUsd(receipt.wholeTurn.knownProviderSpendUsd)}
        hint="(정산확정 subset만 합산)"
      />
      <ReceiptRow
        label="확정 USD"
        value={
          receipt.wholeTurn.exactProviderSpendUsd != null
            ? formatAdminActualUsd(receipt.wholeTurn.exactProviderSpendUsd)
            : "—"
        }
      />
      <ReceiptRow
        label="확정 KRW"
        value={
          receipt.wholeTurn.exactProviderSpendKrw != null
            ? `~${formatPoints(receipt.wholeTurn.exactProviderSpendKrw)}원`
            : "—"
        }
        hint="(parent turn FX 1회 적용)"
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
        value={formatAdminActualUsd(receipt.async.knownActualCostUsd)}
      />
      <ReceiptRow
        label="exact USD"
        value={
          receipt.async.exactActualCostUsd != null
            ? formatAdminActualUsd(receipt.async.exactActualCostUsd)
            : "—"
        }
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
          {formatAdminActualUsd(family.knownActualCostUsd)}, {family.expectationState} /{" "}
          {family.coverage}
          {family.skipReason ? ` (${family.skipReason})` : ""}
        </p>
      ))}

      <SectionTitle>Main RP (동기)</SectionTitle>
      {sync.mainRp.actual ? (
        <>
          <ReceiptRow
            label="actual USD"
            value={formatAdminActualUsd(sync.mainRp.actual.actualProviderCostUsd)}
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
      {sync.syncPlatformSpend.status === "available" ? (
        <>
          <ReceiptRow label="group" value={sync.syncPlatformSpend.groupLabel ?? "—"} />
          <ReceiptRow
            label="actual USD"
            value={formatAdminActualUsd(sync.syncPlatformSpend.actualProviderCostUsd)}
          />
          {sync.syncPlatformSpend.postTurnSharedInitial && (
            <ReceiptRow label="shared initial" value="included once in sync" />
          )}
        </>
      ) : (
        <ReceiptRow label="status" value={sync.syncPlatformSpend.status} />
      )}

      {sync.mainRp.marginPercent != null && (
        <ReceiptRow
          label="Main RP margin"
          value={`${sync.mainRp.marginPercent}%`}
          hint={`(${sync.mainRp.marginScopeLabel})`}
        />
      )}

      <SectionTitle>범위 제외</SectionTitle>
      <p className="text-[10px] text-zinc-500">{receipt.excludedCostScopes.join(", ")}</p>
    </div>
  );
}
