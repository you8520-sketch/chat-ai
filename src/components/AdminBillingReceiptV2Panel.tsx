"use client";

import type { ReactNode } from "react";
import {
  adminReceiptExactnessLabel,
  buildAdminBillingReceiptV2,
  type AdminBillingReceiptV2,
} from "@/lib/adminBillingReceiptV2";
import { formatPoints } from "@/lib/billingDisplay";
import type { Usage } from "@/lib/chatUsage";

function formatKrw(value: number | undefined | null): string {
  if (value == null || !(value > 0)) return "—";
  return `~${formatPoints(value)}원`;
}

function formatUsd(value: number | undefined | null): string {
  if (value == null || !(value > 0)) return "—";
  return `$${value.toFixed(4)}`;
}

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

export function AdminBillingReceiptV2Panel({ usage }: { usage: Usage }) {
  const receipt = buildAdminBillingReceiptV2(usage);

  return (
    <div className="mt-2 space-y-0.5 border-t border-zinc-700 pt-2 text-[11px] leading-relaxed text-zinc-300">
      <p className="text-[10px] font-semibold text-amber-300/90">
        Admin Receipt v2 · 동기 수집 범위 (async 제외)
      </p>
      {receipt.historicalNote && (
        <p className="text-[10px] text-amber-400/90">{receipt.historicalNote}</p>
      )}

      <SectionTitle>사용자 청구</SectionTitle>
      <ReceiptRow label="모델" value={receipt.userCharge.modelLabel} />
      <ReceiptRow
        label="과금 입력/출력"
        value={`${receipt.userCharge.inputTokens.toLocaleString()} / ${receipt.userCharge.outputTokens.toLocaleString()}`}
      />
      {receipt.userCharge.reasoningTokens != null && receipt.userCharge.reasoningTokens > 0 && (
        <ReceiptRow
          label="reasoning"
          value={`${receipt.userCharge.reasoningTokens.toLocaleString()} tokens`}
        />
      )}
      {receipt.userCharge.savedOutputChars != null && receipt.userCharge.savedOutputChars > 0 && (
        <ReceiptRow
          label="저장 RP"
          value={`${receipt.userCharge.savedOutputChars.toLocaleString()}자`}
        />
      )}
      <ReceiptRow
        label="포인트 차감"
        value={
          receipt.userCharge.billingWaived
            ? "0 P (면제)"
            : `${formatPoints(receipt.userCharge.deductedPoints)} P`
        }
      />

      {receipt.mainRp.actual && (
        <>
          <SectionTitle>Main RP — Provider Actual</SectionTitle>
          <ReceiptRow label="provider" value={receipt.mainRp.actual.provider} />
          <ReceiptRow label="model" value={receipt.mainRp.actual.model} />
          <ReceiptRow label="actual USD" value={formatUsd(receipt.mainRp.actual.actualProviderCostUsd)} />
          <ReceiptRow label="actual KRW" value={formatKrw(receipt.mainRp.actual.actualProviderCostKrw)} />
          <ReceiptRow label="source" value={receipt.mainRp.actual.actualCostSource} />
          <ReceiptRow label="coverage" value={receipt.mainRp.actual.actualTurnCostCoverage} />
          <ReceiptRow
            label="확정 상태"
            value={adminReceiptExactnessLabel(receipt.mainRp.actual.exactness)}
          />
        </>
      )}

      {receipt.mainRp.providerReference && (
        <>
          <SectionTitle>Main RP — Provider Reference</SectionTitle>
          <ReceiptRow
            label="list cost"
            value={formatKrw(receipt.mainRp.providerReference.providerListCostKrw)}
            hint="(실제 결제액 아님)"
          />
          <ReceiptRow
            label="list status"
            value={receipt.mainRp.providerReference.providerListCostStatus}
          />
          {receipt.mainRp.providerReference.providerSavingsKrw != null && (
            <ReceiptRow
              label="provider savings"
              value={formatKrw(receipt.mainRp.providerReference.providerSavingsKrw)}
            />
          )}
          {receipt.mainRp.providerReference.providerOverrunKrw != null && (
            <ReceiptRow
              label="provider overrun"
              value={formatKrw(receipt.mainRp.providerReference.providerOverrunKrw)}
            />
          )}
        </>
      )}

      {receipt.mainRp.publishedPricing && (
        <>
          <SectionTitle>Published User Pricing</SectionTitle>
          <ReceiptRow
            label="billing reference"
            value={formatKrw(receipt.mainRp.publishedPricing.billingReferenceCostKrw)}
          />
          <ReceiptRow
            label="input rate"
            value={`$${receipt.mainRp.publishedPricing.billingReferenceInputUsdPerMillion}/M`}
          />
          <ReceiptRow
            label="output rate"
            value={`$${receipt.mainRp.publishedPricing.billingReferenceOutputUsdPerMillion}/M`}
          />
          <ReceiptRow label="pricing v" value={receipt.mainRp.publishedPricing.pricingVersion} />
          <ReceiptRow label="target margin" value={`${Math.round(receipt.mainRp.publishedPricing.targetMargin * 100)}%`} />
          <ReceiptRow
            label="margin floor"
            value={`${Math.round(receipt.mainRp.publishedPricing.minimumMarginFloor * 100)}%`}
          />
          <ReceiptRow
            label="published standard"
            value={formatKrw(receipt.mainRp.publishedPricing.standardUserChargeKrw)}
          />
        </>
      )}

      {receipt.mainRp.marginPercent != null && (
        <ReceiptRow
          label={receipt.mainRp.marginScopeLabel}
          value={`${receipt.mainRp.marginPercent}%`}
        />
      )}

      <SectionTitle>플랫폼 부담 후처리 (Captured Provider Spend)</SectionTitle>
      {receipt.syncPlatformSpend.status === "not_persisted" ? (
        <ReceiptRow label="sync platform spend" value="NOT PERSISTED / unavailable" />
      ) : receipt.syncPlatformSpend.status === "available" ? (
        <>
          <ReceiptRow label="group" value={receipt.syncPlatformSpend.groupLabel} />
          <ReceiptRow label="model" value={receipt.syncPlatformSpend.modelLabel ?? receipt.syncPlatformSpend.model} />
          <ReceiptRow
            label="tokens"
            value={`${(receipt.syncPlatformSpend.inputTokens ?? 0).toLocaleString()} / ${(receipt.syncPlatformSpend.outputTokens ?? 0).toLocaleString()}`}
          />
          <ReceiptRow
            label="callCount"
            value={String(receipt.syncPlatformSpend.callCount ?? 1)}
            hint="(aggregate — physical call audit 아님)"
          />
          <ReceiptRow label="actual USD" value={formatUsd(receipt.syncPlatformSpend.actualProviderCostUsd)} />
          <ReceiptRow label="actual KRW" value={formatKrw(receipt.syncPlatformSpend.actualProviderCostKrw)} />
          {receipt.syncPlatformSpend.actualCostSource && (
            <ReceiptRow label="source" value={receipt.syncPlatformSpend.actualCostSource} />
          )}
          {receipt.syncPlatformSpend.actualCostCoverage && (
            <ReceiptRow label="coverage" value={receipt.syncPlatformSpend.actualCostCoverage} />
          )}
          {receipt.syncPlatformSpend.exactness && (
            <ReceiptRow
              label="확정 상태"
              value={adminReceiptExactnessLabel(receipt.syncPlatformSpend.exactness)}
            />
          )}
          <ReceiptRow label="user charged" value="0 P" hint="(platform funded)" />
          {receipt.syncPlatformSpend.legacyApiRawCostKrw != null &&
            receipt.syncPlatformSpend.legacyApiRawCostKrw > 0 && (
              <ReceiptRow
                label="legacy apiRawCostKrw"
                value={formatKrw(receipt.syncPlatformSpend.legacyApiRawCostKrw)}
                hint="(≠ exact settled actual)"
              />
            )}
        </>
      ) : (
        <ReceiptRow label="sync platform spend" value="unavailable" />
      )}

      {receipt.capturedSyncProviderSpendKrw != null && (
        <ReceiptRow
          label="CAPTURED_SYNC_PROVIDER_SPEND"
          value={formatKrw(receipt.capturedSyncProviderSpendKrw)}
          hint={
            receipt.capturedSyncProviderSpendExact
              ? "(main + sync exact)"
              : "(partial — not labeled exact)"
          }
        />
      )}

      {receipt.fx && (
        <>
          <SectionTitle>FX Snapshot</SectionTitle>
          <ReceiptRow label="KST date" value={receipt.fx.dateKey} />
          <ReceiptRow label="base USD/KRW" value={receipt.fx.baseUsdKrw} />
          <ReceiptRow label="overseas fee" value={`${Math.round(receipt.fx.overseasFeeRate * 100)}%`} />
          <ReceiptRow label="effective KRW/USD" value={receipt.fx.effectiveKrwPerUsd} />
          <ReceiptRow label="source" value={receipt.fx.source} />
        </>
      )}

      <SectionTitle>비동기 후처리</SectionTitle>
      <p className="text-[10px] text-zinc-500">
        현재 receipt 범위 밖 — {receipt.asyncDeferredFamilies.join(", ")}
      </p>
    </div>
  );
}

export { buildAdminBillingReceiptV2 };
export type { AdminBillingReceiptV2 };
