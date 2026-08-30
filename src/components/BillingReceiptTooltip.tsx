"use client";

import { useEffect, useRef, useState } from "react";
import {
  billingWaiverLabel,
  buildBillingReceipt,
  formatBillingReceiptText,
  formatPoints,
  isMeteredReceiptProvider,
  resolveApiRawCostKrw,
  resolveMainRpApiCostPartsKrw,
  resolveOpenRouterCacheReceipt,
  resolveExchangeRateReceiptLabel,
  resolveRealizedMarginRatePercent,
  resolveStoredWidgetExtractCallCount,
  type BillingReceipt,
} from "@/lib/billingDisplay";
import type { AdminBillingReceiptProjection } from "@/lib/adminBillingReceiptProjection";
import { filterUsageBreakdownForReceipt } from "@/lib/billingReceiptAccess";
import type { Usage } from "@/lib/chatUsage";
import {
  isGemini25ProModel,
  isGemini31ProModel,
  isGeminiProOpenRouterModel,
  isOpenRouterSimplePointModel,
} from "@/lib/chatModels";
import { IconInfo } from "./ChatToolbarIcons";

function formatUsd(usd: number | null | undefined): string {
  if (usd == null || !Number.isFinite(usd)) return "—";
  return `$${usd.toFixed(4)}`;
}

function coverageLabel(coverage: AdminBillingReceiptProjection["providerActualSettlement"]["actualCostCoverage"]): string {
  return coverage === "complete" ? "전체 확정" : "일부 미확정";
}

function settlementStatusLabel(
  status: AdminBillingReceiptProjection["providerCalls"][number]["settlementStatus"]
): string {
  switch (status) {
    case "SETTLED_EXACT":
      return "정산 확정";
    case "SETTLED_PARTIAL":
      return "부분 정산";
    case "ESTIMATED_ONLY":
      return "추정만";
    case "UNAVAILABLE":
      return "없음";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

function AdminBillingReceiptPanel({
  projection,
}: {
  projection: AdminBillingReceiptProjection;
}) {
  const [callsOpen, setCallsOpen] = useState(false);
  const actual = projection.providerActualSettlement;
  const listRef = projection.providerListReference;
  const published = projection.publishedBillingReference;
  const economics = projection.internalEconomics;

  return (
    <div className="mt-2 space-y-2 border-t border-amber-500/20 pt-2 text-[10px] leading-relaxed text-zinc-300">
      <p className="font-semibold text-amber-300/90">관리자 정산 감사 영수증</p>

      <div className="space-y-0.5">
        <p className="font-semibold text-zinc-400">A. 사용자 청구</p>
        <p>
          <span className="text-zinc-500">모델:</span> {projection.userCharge.modelLabel}
        </p>
        <p>
          <span className="text-zinc-500">입력/출력:</span>{" "}
          {projection.userCharge.inputTokens.toLocaleString()} /{" "}
          {projection.userCharge.outputTokens.toLocaleString()}
        </p>
        <p>
          <span className="text-zinc-500">저장 RP:</span>{" "}
          {projection.userCharge.outputChars.toLocaleString()}자
        </p>
        <p>
          <span className="text-zinc-500">차감:</span>{" "}
          {projection.userCharge.waived
            ? "0 P (면제)"
            : `${formatPoints(projection.userCharge.deductedPoints)} P`}
        </p>
        {projection.userCharge.pricingVersion != null && (
          <p>
            <span className="text-zinc-500">Published pricing v:</span>{" "}
            {projection.userCharge.pricingVersion}
          </p>
        )}
      </div>

      <div className="space-y-0.5 border-t border-zinc-800 pt-1">
        <p className="font-semibold text-zinc-400">B. Provider 실제 정산</p>
        <p>
          <span className="text-zinc-500">Provider:</span> {actual.provider}
        </p>
        <p>
          <span className="text-zinc-500">정산 actual USD:</span>{" "}
          <span className="text-emerald-300/90">{formatUsd(actual.actualProviderCostUsd)}</span>
          <span className="text-zinc-600"> ({actual.actualCostSource})</span>
        </p>
        <p>
          <span className="text-zinc-500">Coverage:</span> {coverageLabel(actual.actualCostCoverage)}
        </p>
        <p>
          <span className="text-zinc-500">KST FX ({actual.fxDateKey}):</span>{" "}
          {actual.effectiveKrwPerUsd.toFixed(2)} KRW/USD
        </p>
        <p>
          <span className="text-zinc-500">Base actual KRW:</span>{" "}
          {actual.baseActualKrw != null ? `~${formatPoints(actual.baseActualKrw)}원` : "—"}
        </p>
        <p>
          <span className="text-zinc-500">해외결제 {Math.round(actual.overseasCardFeeRate * 100)}% 포함:</span>{" "}
          {actual.effectiveProviderCashCostKrw != null
            ? `~${formatPoints(actual.effectiveProviderCashCostKrw)}원`
            : "—"}
        </p>
      </div>

      <div className="space-y-0.5 border-t border-zinc-800 pt-1">
        <p className="font-semibold text-zinc-400">C. Provider list/reference (비교용)</p>
        <p className="text-[9px] text-zinc-600">실제 정산 비용이 아닙니다.</p>
        <p>
          <span className="text-zinc-500">List/reference USD:</span>{" "}
          <span className="text-cyan-300/90">{formatUsd(listRef.providerListCostUsd)}</span>
        </p>
        <p>
          <span className="text-zinc-500">Reference KRW:</span>{" "}
          {listRef.baseReferenceKrw != null ? `~${formatPoints(listRef.baseReferenceKrw)}원` : "—"}
        </p>
        <p>
          <span className="text-zinc-500">Source:</span> {listRef.referenceSource}
        </p>
      </div>

      <div className="space-y-0.5 border-t border-zinc-800 pt-1">
        <p className="font-semibold text-zinc-400">D. Published billing reference</p>
        <p>
          <span className="text-zinc-500">Reference USD:</span>{" "}
          {formatUsd(published.billingReferenceCostUsd)}
        </p>
        <p>
          <span className="text-zinc-500">Reference KRW:</span>{" "}
          {published.billingReferenceCostKrw != null
            ? `~${formatPoints(published.billingReferenceCostKrw)}원`
            : "—"}
        </p>
      </div>

      <div className="space-y-0.5 border-t border-zinc-800 pt-1">
        <p className="font-semibold text-zinc-400">E. 내부 economics</p>
        {economics ? (
          <>
            <p>
              <span className="text-zinc-500">Provider 절감:</span>{" "}
              {economics.providerSavingsKrw != null
                ? `~${formatPoints(economics.providerSavingsKrw)}원`
                : "—"}
            </p>
            <p>
              <span className="text-zinc-500">Provider 초과:</span>{" "}
              {economics.providerOverrunKrw != null
                ? `~${formatPoints(economics.providerOverrunKrw)}원`
                : "—"}
            </p>
            <p>
              <span className="text-zinc-500">Gross profit:</span>{" "}
              {economics.grossProfitKrw != null
                ? `~${formatPoints(economics.grossProfitKrw)}원`
                : "—"}
            </p>
            <p>
              <span className="text-zinc-500">Realized margin:</span>{" "}
              {economics.realizedMargin != null
                ? `${(economics.realizedMargin * 100).toFixed(1)}%`
                : "—"}
            </p>
          </>
        ) : (
          <p className="text-amber-400/90">정산 일부 미확정 — exact economics 미표시</p>
        )}
      </div>

      {projection.providerCalls.length > 0 && (
        <div className="border-t border-zinc-800 pt-1">
          <button
            type="button"
            onClick={() => setCallsOpen((v) => !v)}
            className="flex w-full items-center justify-between text-left font-semibold text-zinc-400 hover:text-zinc-200"
          >
            <span>F. Provider call audit ({projection.providerCalls.length})</span>
            <span className="text-zinc-600">{callsOpen ? "▾" : "▸"}</span>
          </button>
          {callsOpen && (
            <div className="mt-1 max-h-40 space-y-1 overflow-y-auto">
              {projection.providerCalls.map((call) => (
                <div key={call.callIndex} className="rounded border border-zinc-800/80 p-1">
                  <p>
                    <span className="text-zinc-500">#{call.callIndex}</span> {call.purpose} ·{" "}
                    {call.modelId}
                  </p>
                  <p>
                    {call.inputTokens.toLocaleString()} / {call.outputTokens.toLocaleString()} tok
                    {call.reasoningTokens > 0
                      ? ` · thinking ${call.reasoningTokens.toLocaleString()}`
                      : ""}
                  </p>
                  {(call.cacheReadTokens > 0 || call.cacheWriteTokens > 0) && (
                    <p className="text-zinc-600">
                      cache r/w: {call.cacheReadTokens}/{call.cacheWriteTokens}
                    </p>
                  )}
                  <p>
                    <span className="text-zinc-500">Settled:</span> {formatUsd(call.settledActualUsd)}{" "}
                    <span className="text-zinc-600">({call.actualCostSource})</span>
                  </p>
                  <p>
                    <span className="text-zinc-500">List/ref:</span>{" "}
                    {formatUsd(call.providerReferenceListUsd)}
                    {call.upstreamReportedUsd != null && (
                      <span className="text-zinc-600">
                        {" "}
                        · upstream {formatUsd(call.upstreamReportedUsd)}
                      </span>
                    )}
                  </p>
                  <p className="text-zinc-600">
                    {settlementStatusLabel(call.settlementStatus)}
                    {call.includedInTurnTotal ? " · turn 합산" : " · audit only"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ReceiptBody({
  receipt,
  usage,
  apiRawCostKrw,
  mainRpCostParts,
  cacheReceipt,
  exchangeRateLabel,
  showFullReceipt,
  adminBillingReceipt,
}: {
  receipt: BillingReceipt;
  usage: Usage;
  apiRawCostKrw: number | null;
  mainRpCostParts: ReturnType<typeof resolveMainRpApiCostPartsKrw>;
  cacheReceipt: ReturnType<typeof resolveOpenRouterCacheReceipt>;
  exchangeRateLabel: string;
  showFullReceipt: boolean;
  adminBillingReceipt?: AdminBillingReceiptProjection;
}) {
  const useAdminSettlementReceipt = showFullReceipt && adminBillingReceipt != null;
  const reasoningExcludedFromBilling =
    isMeteredReceiptProvider(usage.provider) &&
    !isOpenRouterSimplePointModel(usage.model ?? "") &&
    (isGemini25ProModel(usage.model ?? "") ||
      (isGeminiProOpenRouterModel(usage.model ?? "") &&
        !isGemini31ProModel(usage.model ?? "")));
  // 실현 마진율 = 1 - (API 원가 KRW / 실제 차감 P). 유료 1P=1원.
  // 원가: 공급자 실시간 차감 USD 우선, 없으면 이용 사이트 게시 요율×토큰×환율.
  const marginRateLabel = (() => {
    if (!showFullReceipt || receipt.waived) return null;
    if (adminBillingReceipt?.internalEconomics?.realizedMargin != null) {
      return `${(adminBillingReceipt.internalEconomics.realizedMargin * 100).toFixed(1)}%`;
    }
    const pct = resolveRealizedMarginRatePercent(usage, receipt.totalCost);
    return pct != null ? `${pct}%` : null;
  })();
  const widgetExtractCallCount = resolveStoredWidgetExtractCallCount(
    usage.statusWidgetExtract?.callCount
  );

  if (!showFullReceipt) {
    return (
      <div className="space-y-1 text-[11px] leading-relaxed text-zinc-300">
        <p>
          <span className="text-zinc-500">모델:</span> {receipt.modelLabel}
        </p>
        <p>
          <span className="text-zinc-500">과금 기준 입력/출력:</span>{" "}
          {receipt.inputTokens.toLocaleString()} / {receipt.outputTokens.toLocaleString()}
          {receipt.estimated ? " (추정)" : ""}
        </p>
        {usage.apiReasoningOutputTokens != null && usage.apiReasoningOutputTokens > 0 && (
          <>
            <p>
              <span className="text-zinc-500">thinking:</span>{" "}
              {usage.apiReasoningOutputTokens.toLocaleString()} tokens
            </p>
            <p>
              <span className="text-zinc-500">output + thinking:</span>{" "}
              {(usage.apiOutputTokens ?? 0).toLocaleString()} tokens
            </p>
          </>
        )}
        {receipt.waived ? (
          <p className="font-semibold text-emerald-300/95">
            <span className="text-zinc-500">포인트 차감:</span> 0 P (면제)
          </p>
        ) : (
          <p className="font-semibold text-zinc-100">
            <span className="text-zinc-500">포인트 차감:</span> {formatPoints(receipt.totalCost)} P
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1 text-[11px] leading-relaxed text-zinc-300">
      <p>
        <span className="text-zinc-500">모델:</span> {receipt.modelLabel}
      </p>
      {usage.htmlFlashOnly && (
        <p className="text-[10px] leading-relaxed text-zinc-500">
          HTML 전용 턴 — 백그라운드 단독 호출 (영수증 모델: HTML전용모델). API 원가에 55% 마진 적용. 입력 컨텍스트 최대
          24,000토큰(장기기억·히스토리·페르소나·설정·로어북 등), 출력 최대 8,000토큰. 실제 출력량으로 과금 (메인 RP
          모델 미호출).
        </p>
      )}
      <p>
        <span className="text-zinc-500">과금 기준 입력/출력:</span>{" "}
        {receipt.inputTokens.toLocaleString()} / {receipt.outputTokens.toLocaleString()}
        {receipt.estimated ? " (추정)" : ""}
        {isMeteredReceiptProvider(usage.provider) &&
        usage.apiOutputTokens != null &&
        usage.apiOutputTokens !== receipt.outputTokens ? (
          <span className="text-zinc-600"> (content·조립 입력 — API raw와 다름)</span>
        ) : null}
      </p>
      {usage.apiReasoningOutputTokens != null && usage.apiReasoningOutputTokens > 0 && (
        <>
          <p>
            <span className="text-zinc-500">thinking (API):</span>{" "}
            {usage.apiReasoningOutputTokens.toLocaleString()} tokens
          </p>
          <p>
            <span className="text-zinc-500">content (표시 RP):</span>{" "}
            {(usage.apiContentOutputTokens ?? receipt.outputTokens).toLocaleString()} tokens
            <span className="text-zinc-600">
              {reasoningExcludedFromBilling
                ? " (reasoning은 과금·미저장)"
                : isOpenRouterSimplePointModel(usage.model ?? "")
                  ? " (표시 RP · 미저장)"
                  : isGemini31ProModel(usage.model ?? "")
                    ? " (3.1 Pro thinking — 과금·미저장, low 최저)"
                    : " (과금·미저장)"}
            </span>
          </p>
          <p>
            <span className="text-zinc-500">output + thinking:</span>{" "}
            {(usage.apiOutputTokens ?? 0).toLocaleString()} tokens
            <span className="text-zinc-600"> (과금 기준)</span>
          </p>
        </>
      )}
      {usage.gemini37FlashPricing && (
        <div className="mt-1 border-t border-zinc-800 pt-1">
          <p className="text-zinc-500">Gemini 3.7 pricing:</p>
          <p>
            <span className="text-zinc-500">base:</span> {usage.gemini37FlashPricing.basePoints}P
          </p>
          <p>
            <span className="text-zinc-500">api input:</span>{" "}
            {usage.gemini37FlashPricing.inputTokens.toLocaleString()}
          </p>
          <p>
            <span className="text-zinc-500">input surcharge:</span>{" "}
            {usage.gemini37FlashPricing.inputSurchargePoints}P
          </p>
          <p>
            <span className="text-zinc-500">billed output:</span>{" "}
            {usage.gemini37FlashPricing.billedOutputTokens.toLocaleString()}
          </p>
          <p>
            <span className="text-zinc-500">output surcharge:</span>{" "}
            {usage.gemini37FlashPricing.outputSurchargePoints}P
          </p>
          <p>
            <span className="text-zinc-500">main charge:</span>{" "}
            {usage.gemini37FlashPricing.totalPoints}P
          </p>
        </div>
      )}
      {usage.savedOutputChars != null && usage.savedOutputChars > 0 && (
        <p>
          <span className="text-zinc-500">저장 RP:</span>{" "}
          {usage.savedOutputChars.toLocaleString()}자
          <span className="text-zinc-600"> (화면 표시 · HTML·마크업 코드 제외)</span>
        </p>
      )}
      {isMeteredReceiptProvider(usage.provider) &&
        usage.apiInputTokens != null &&
        usage.apiOutputTokens != null &&
        (usage.apiInputTokens !== receipt.inputTokens ||
          usage.apiOutputTokens !== receipt.outputTokens) && (
          <p>
            <span className="text-zinc-500">API completion 합산{usage.apiCallCount != null && usage.apiCallCount > 1 ? ` (${usage.apiCallCount}회)` : ""}:</span>{" "}
            {usage.apiInputTokens != null ? `${usage.apiInputTokens.toLocaleString()} / ` : ""}
            {usage.apiOutputTokens.toLocaleString()} tokens
            <span className="text-zinc-600"> (thinking+content+strip된 본문)</span>
          </p>
        )}
      {cacheReceipt?.cacheReadLine && (
        <p>
          <span className="text-zinc-500">캐시 히트:</span> {cacheReceipt.cacheReadLine}
        </p>
      )}
      {cacheReceipt?.cacheWriteLine && (
        <p>
          <span className="text-zinc-500">캐시 저장:</span> {cacheReceipt.cacheWriteLine}
        </p>
      )}
      {cacheReceipt &&
        (cacheReceipt.standardInputTokens ?? 0) > 0 &&
        (usage.cacheReadTokens ?? 0) > 0 && (
          <p>
            <span className="text-zinc-500">신규 입력:</span>{" "}
            {cacheReceipt.standardInputTokens!.toLocaleString()}
          </p>
        )}
      {usage.cacheDiscountUsd != null && usage.cacheDiscountUsd > 0 && (
        <p>
          <span className="text-zinc-500">OpenRouter 절약:</span>{" "}
          <span className="text-emerald-400/90">
            ${usage.cacheDiscountUsd.toFixed(4)}
          </span>
        </p>
      )}
      {usage.statusWidgetExtract && (
        <>
          <p>
            <span className="text-zinc-500">
              {usage.statusWidgetExtract.modelLabel}
              {widgetExtractCallCount != null
                ? ` · ${widgetExtractCallCount}회`
                : ""}
              :
            </span>{" "}
            {usage.statusWidgetExtract.input.toLocaleString()} /{" "}
            {usage.statusWidgetExtract.output.toLocaleString()} tokens
            {usage.statusWidgetExtract.estimated ? " (추정)" : ""}
          </p>
          <p>
            <span className="text-zinc-500">위젯 API 원가:</span>{" "}
            <span className="text-cyan-300/90">
              ~{formatPoints(usage.statusWidgetExtract.apiRawCostKrw)}원
            </span>
            {usage.widgetCostPoints != null && usage.widgetCostPoints > 0 ? (
              <span className="text-zinc-600">
                {" "}
                → {formatPoints(usage.widgetCostPoints)} P (올림)
              </span>
            ) : null}
            {usage.statusWidgetExtract.upstreamCostUsd != null &&
            usage.statusWidgetExtract.upstreamCostUsd > 0 ? (
              <span className="text-zinc-600"> (OpenRouter USD)</span>
            ) : (
              <span className="text-zinc-600"> (요율 추정)</span>
            )}
          </p>
        </>
      )}
      {usage.statusWidgetExtractDiagnostics && (
        <div className="mt-1 border-t border-zinc-800 pt-1">
          <p className="text-zinc-500">
            위젯 진단:{" "}
            {usage.statusWidgetExtractDiagnostics.usedFallback
              ? "V3 폴백 사용"
              : usage.statusWidgetExtractDiagnostics.exhausted
                ? "추출 실패"
                : "정상"}
          </p>
          {usage.statusWidgetExtractDiagnostics.attempts.map((attempt, index) => (
            <p key={`${attempt.stage}-${attempt.modelId}-${index}`}>
              <span className="text-zinc-500">
                {attempt.stage} · {attempt.modelId}:
              </span>{" "}
              HTTP {attempt.httpStatus ?? "없음"} · finish{" "}
              {attempt.finishReason ?? "없음"}
              {attempt.errorCode ? ` · ${attempt.errorCode}` : ""}
            </p>
          ))}
        </div>
      )}
      {!useAdminSettlementReceipt && apiRawCostKrw != null && apiRawCostKrw > 0 && (
        <>
          <p>
            <span className="text-zinc-500">
              {usage.statusWidgetExtract ? "메인 RP API 원가:" : "실제 API 원가:"}
            </span>{" "}
            <span className="text-cyan-300/90">
              ~{formatPoints(usage.mainApiRawCostKrw ?? apiRawCostKrw)}원
            </span>
            {!usage.statusWidgetExtract &&
              usage.apiRawCostSource === "provider_reported" && (
                <span className="text-zinc-600"> (공급자 USD 합산)</span>
              )}
            {!usage.statusWidgetExtract &&
              usage.apiRawCostSource === "live_catalog" && (
                <span className="text-zinc-600"> (실시간 카탈로그 추정)</span>
              )}
            {!usage.statusWidgetExtract &&
              (usage.apiRawCostSource === "fallback_catalog" ||
                (usage.apiRawCostSource == null &&
                  usage.apiRawCostKrw == null &&
                  usage.upstreamCostUsd == null)) && (
                <span className="text-zinc-600"> (저장 요율 추정)</span>
              )}
          </p>
          {mainRpCostParts && (
            <>
              <p>
                <span className="text-zinc-500">입력 토큰 원가:</span>{" "}
                <span className="text-cyan-300/90">
                  ~{formatPoints(mainRpCostParts.inputKrw)}원
                </span>
                <span className="text-zinc-600">
                  {" "}
                  ({mainRpCostParts.inputTokens.toLocaleString()} tok)
                </span>
              </p>
              <p>
                <span className="text-zinc-500">출력 토큰 원가:</span>{" "}
                <span className="text-cyan-300/90">
                  ~{formatPoints(mainRpCostParts.outputKrw)}원
                </span>
                <span className="text-zinc-600">
                  {" "}
                  ({mainRpCostParts.outputContentTokens.toLocaleString()} tok · content)
                </span>
              </p>
              <p>
                <span className="text-zinc-500">thinking 토큰 원가:</span>{" "}
                <span className="text-cyan-300/90">
                  ~{formatPoints(mainRpCostParts.thinkingKrw)}원
                </span>
                <span className="text-zinc-600">
                  {" "}
                  ({mainRpCostParts.thinkingTokens.toLocaleString()} tok)
                </span>
              </p>
            </>
          )}
        </>
      )}
      {useAdminSettlementReceipt && adminBillingReceipt && (
        <AdminBillingReceiptPanel projection={adminBillingReceipt} />
      )}
      {usage.statusWidgetExtract && apiRawCostKrw != null && apiRawCostKrw > 0 && (
        <p>
          <span className="text-zinc-500">API 원가 합계 (메인+위젯):</span>{" "}
          <span className="text-cyan-300/90">~{formatPoints(apiRawCostKrw)}원</span>
        </p>
      )}
      {usage.coldStartShieldApplied && (
        <>
          {usage.uncappedChargePoints != null && usage.uncappedChargePoints > 0 && (
            <p>
              <span className="text-zinc-500">방어선 적용 전 청구:</span>{" "}
              <span className="text-rose-300/90">{formatPoints(usage.uncappedChargePoints)} P</span>
            </p>
          )}
          {usage.coldStartCostFloorPoints != null && usage.coldStartCostFloorPoints > 0 && (
            <p>
              <span className="text-zinc-500">원가·글자상한 중간값:</span>{" "}
              <span className="text-cyan-300/90">{formatPoints(usage.coldStartCostFloorPoints)} P</span>
              <span className="text-zinc-600"> (원가+0.135P/자)/2</span>
            </p>
          )}
        </>
      )}
      {cacheReceipt?.rateSummary && (
        <p className="text-[10px] text-zinc-500">모델 요율: {cacheReceipt.rateSummary}</p>
      )}
      <p className="text-[10px] text-zinc-500">적용 환율: {exchangeRateLabel}</p>
      {receipt.waived ? (
        <>
          <p className="font-semibold text-emerald-300/95">
            <span className="text-zinc-500">포인트 차감:</span> 0 P (면제)
          </p>
          <p className="text-[10px] leading-relaxed text-zinc-400">
            {billingWaiverLabel(receipt.waiverReason)}
          </p>
        </>
      ) : (
        <>
          {usage.widgetCostPoints != null &&
            usage.widgetCostPoints > 0 &&
            usage.baseCost != null &&
            usage.baseCost !== receipt.totalCost && (
              <p>
                <span className="text-zinc-500">메인 RP:</span>{" "}
                {formatPoints(usage.baseCost)} P
                <span className="text-zinc-600">
                  {" "}
                  + 위젯 {formatPoints(usage.widgetCostPoints)} P
                </span>
              </p>
            )}
          <p className="font-semibold text-zinc-100">
            <span className="text-zinc-500">포인트 차감:</span> {formatPoints(receipt.totalCost)} P
            {marginRateLabel != null && (
              <span className="text-zinc-500"> (마진율: {marginRateLabel})</span>
            )}
          </p>
        </>
      )}
    </div>
  );
}

function ReceiptTrigger({
  open,
  onClick,
  variant,
}: {
  open: boolean;
  onClick: () => void;
  variant: "coin" | "info";
}) {
  if (variant === "info") {
    return (
      <button
        type="button"
        aria-label="포인트 차감 내역"
        aria-expanded={open}
        onClick={onClick}
        className={`flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-white/5 hover:text-zinc-300 ${
          open ? "bg-white/5 text-zinc-300" : ""
        }`}
      >
        <IconInfo />
      </button>
    );
  }

  return (
    <button
      type="button"
      aria-label="포인트 차감 내역"
      aria-expanded={open}
      className={`rounded-md px-1.5 py-0.5 text-sm transition hover:bg-white/5 ${
        open ? "bg-white/10 opacity-90" : "opacity-40 hover:opacity-80"
      }`}
      onClick={onClick}
    >
      🪙
    </button>
  );
}

export default function BillingReceiptTooltip({
  usage,
  triggerVariant = "coin",
  showFullReceipt = false,
}: {
  usage: Usage;
  triggerVariant?: "coin" | "info";
  /** 관리자·데모유저 — thinking·API raw·strip 등 전체 영수증 */
  showFullReceipt?: boolean;
}) {
  const receipt = buildBillingReceipt(usage);
  const apiRawCostKrw = resolveApiRawCostKrw(usage);
  const mainRpCostParts = showFullReceipt ? resolveMainRpApiCostPartsKrw(usage) : null;
  const cacheReceipt = resolveOpenRouterCacheReceipt(usage);
  const exchangeRateLabel = resolveExchangeRateReceiptLabel(usage);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  if (!receipt) return null;

  async function copyReceipt() {
    if (!showFullReceipt) return;
    const text = formatBillingReceiptText(receipt!, {
      route: usage.route,
      breakdown: usage.breakdown,
      apiRawCostKrw,
      coldStartShieldApplied: usage.coldStartShieldApplied,
      uncappedChargePoints: usage.uncappedChargePoints,
      coldStartCostFloorPoints: usage.coldStartCostFloorPoints,
      cacheReadLine: cacheReceipt?.cacheReadLine,
      cacheWriteLine: cacheReceipt?.cacheWriteLine,
      cacheRateSummary: cacheReceipt?.rateSummary,
      standardInputTokens: cacheReceipt?.standardInputTokens,
      exchangeRateLabel,
      apiReasoningOutputTokens: usage.apiReasoningOutputTokens,
      apiContentOutputTokens: usage.apiContentOutputTokens,
      statusWidgetExtract: usage.statusWidgetExtract,
      statusWidgetExtractDiagnostics: usage.statusWidgetExtractDiagnostics,
      mainApiRawCostKrw: usage.mainApiRawCostKrw,
      apiRawCostSource: usage.apiRawCostSource,
      mainRpCostParts,
      gemini37FlashPricing: usage.gemini37FlashPricing,
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <ReceiptTrigger open={open} onClick={() => setOpen((v) => !v)} variant={triggerVariant} />
      {open && (
        <div
          role="dialog"
          aria-label="포인트 차감 내역"
          className={`absolute bottom-full right-0 z-30 mb-1.5 rounded-lg border border-white/10 bg-[#1a1a1a]/95 p-2.5 shadow-xl shadow-black/40 backdrop-blur-sm ${
            showFullReceipt && usage.adminBillingReceipt ? "w-80 max-w-[min(20rem,calc(100vw-2rem))]" : "w-60"
          }`}
        >
          <ReceiptBody
            receipt={receipt}
            usage={usage}
            apiRawCostKrw={apiRawCostKrw}
            mainRpCostParts={mainRpCostParts}
            cacheReceipt={cacheReceipt}
            exchangeRateLabel={exchangeRateLabel}
            showFullReceipt={showFullReceipt}
            adminBillingReceipt={usage.adminBillingReceipt}
          />
          {filterUsageBreakdownForReceipt(usage.breakdown, showFullReceipt).some(
            (b) => b.tokens > 0
          ) && (
            <div className="mt-2 space-y-0.5 border-t border-white/10 pt-2 text-[10px] text-zinc-500">
              <p className="mb-1 font-semibold text-zinc-400">
                컨텍스트 분해 (추정 배분)
              </p>
              <p className="mb-1 text-[9px] leading-snug text-zinc-600">
                섹션별 토큰은 provider가 영역별로 보고한 값이 아니라 조립된 텍스트 크기에 따른
                추정 배분입니다. API 입력 총합만 provider 보고값입니다.
              </p>
              {filterUsageBreakdownForReceipt(usage.breakdown, showFullReceipt)
                .filter((b) => b.tokens > 0)
                .map((b) => (
                  <p key={b.label}>
                    {b.label} ({b.pct}%)
                  </p>
                ))}
              {showFullReceipt && usage.rawHistoryHealth && (
                <div className="mt-1 space-y-0.5 border-t border-white/5 pt-1">
                  <p>RAW exchanges: {usage.rawHistoryHealth.rawCompleteExchanges}</p>
                  <p>RAW chars: {usage.rawHistoryHealth.rawChars.toLocaleString()}</p>
                  <p>
                    SUMMARY_INTERVAL: {usage.rawHistoryHealth.summaryInterval} · through turn{" "}
                    {usage.rawHistoryHealth.summarizedThroughTurn}
                  </p>
                  {usage.rawHistoryHealth.policyViolation && (
                    <p className="text-amber-400">RAW_HISTORY_POLICY_VIOLATION</p>
                  )}
                </div>
              )}
            </div>
          )}
          {showFullReceipt && usage.assembledPromptChars && (
            <div className="mt-2 space-y-0.5 border-t border-white/10 pt-2 text-[10px] text-zinc-500">
              <p className="mb-1 font-semibold text-zinc-400">ASSEMBLED TEXT (chars)</p>
              <p>system: {usage.assembledPromptChars.system.toLocaleString()}</p>
              <p>systemRules: {usage.assembledPromptChars.systemRules.toLocaleString()}</p>
              <p>characterSettings: {usage.assembledPromptChars.characterSettings.toLocaleString()}</p>
              <p>dynamic: {usage.assembledPromptChars.dynamic.toLocaleString()}</p>
              <p>RAW/history: {usage.assembledPromptChars.history.toLocaleString()}</p>
              <p>current user: {usage.assembledPromptChars.currentUser.toLocaleString()}</p>
              <p>total: {usage.assembledPromptChars.total.toLocaleString()}</p>
            </div>
          )}
          {showFullReceipt && (
            <div className="mt-2 flex items-center justify-end gap-2 border-t border-white/10 pt-2">
              {copied && <span className="text-[10px] text-emerald-400">복사됨</span>}
              <button
                type="button"
                onClick={() => void copyReceipt()}
                className="rounded-md bg-white/10 px-2 py-1 text-[10px] font-semibold text-zinc-200 transition hover:bg-white/15"
              >
                복사
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
