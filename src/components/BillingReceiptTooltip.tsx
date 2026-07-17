"use client";

import { useEffect, useRef, useState } from "react";
import {
  billingWaiverLabel,
  buildBillingReceipt,
  formatBillingReceiptText,
  formatPoints,
  resolveApiRawCostKrw,
  resolveOpenRouterCacheReceipt,
  resolveExchangeRateReceiptLabel,
  resolveStoredWidgetExtractCallCount,
  type BillingReceipt,
} from "@/lib/billingDisplay";
import { filterUsageBreakdownForReceipt } from "@/lib/billingReceiptAccess";
import type { Usage } from "@/lib/chatUsage";
import { isGemini31ProModel, isGeminiProOpenRouterModel } from "@/lib/chatModels";
import { IconInfo } from "./ChatToolbarIcons";

function ReceiptBody({
  receipt,
  usage,
  apiRawCostKrw,
  cacheReceipt,
  exchangeRateLabel,
  showFullReceipt,
}: {
  receipt: BillingReceipt;
  usage: Usage;
  apiRawCostKrw: number | null;
  cacheReceipt: ReturnType<typeof resolveOpenRouterCacheReceipt>;
  exchangeRateLabel: string;
  showFullReceipt: boolean;
}) {
  const reasoningExcludedFromBilling =
    usage.provider === "openrouter" &&
    isGeminiProOpenRouterModel(usage.model ?? "") &&
    !isGemini31ProModel(usage.model ?? "");
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
          HTML 전용 턴 — DeepSeek V3 단독 호출 (영수증 모델: HTML전용모델). API 원가에 55% 마진 적용. 입력 컨텍스트 최대
          24,000토큰(장기기억·히스토리·페르소나·설정·로어북 등), 출력 최대 8,000토큰. 실제 출력량으로 과금 (메인 RP
          모델 미호출).
        </p>
      )}
      <p>
        <span className="text-zinc-500">과금 기준 입력/출력:</span>{" "}
        {receipt.inputTokens.toLocaleString()} / {receipt.outputTokens.toLocaleString()}
        {receipt.estimated ? " (추정)" : ""}
        {usage.provider === "openrouter" &&
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
                : isGemini31ProModel(usage.model ?? "")
                  ? " (3.1 Pro thinking — 과금·미저장, low 최저)"
                  : " (과금·미저장)"}
            </span>
          </p>
        </>
      )}
      {usage.savedOutputChars != null && usage.savedOutputChars > 0 && (
        <p>
          <span className="text-zinc-500">저장 RP:</span>{" "}
          {usage.savedOutputChars.toLocaleString()}자
          <span className="text-zinc-600"> (화면 표시 · HTML·마크업 코드 제외)</span>
        </p>
      )}
      {usage.provider === "openrouter" &&
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
      {apiRawCostKrw != null && apiRawCostKrw > 0 && (
        <p>
          <span className="text-zinc-500">
            {usage.statusWidgetExtract ? "메인 RP API 원가:" : "실제 API 원가:"}
          </span>{" "}
          <span className="text-cyan-300/90">
            ~{formatPoints(usage.mainApiRawCostKrw ?? apiRawCostKrw)}원
          </span>
          {!usage.statusWidgetExtract &&
            usage.upstreamCostUsd != null &&
            usage.upstreamCostUsd > 0 && (
              <span className="text-zinc-600"> (OpenRouter USD 합산)</span>
            )}
          {!usage.statusWidgetExtract &&
            usage.apiRawCostKrw == null &&
            usage.upstreamCostUsd == null && (
              <span className="text-zinc-600"> (요율 추정)</span>
            )}
        </p>
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
      mainApiRawCostKrw: usage.mainApiRawCostKrw,
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
          className="absolute bottom-full right-0 z-30 mb-1.5 w-60 rounded-lg border border-white/10 bg-[#1a1a1a]/95 p-2.5 shadow-xl shadow-black/40 backdrop-blur-sm"
        >
          <ReceiptBody
            receipt={receipt}
            usage={usage}
            apiRawCostKrw={apiRawCostKrw}
            cacheReceipt={cacheReceipt}
            exchangeRateLabel={exchangeRateLabel}
            showFullReceipt={showFullReceipt}
          />
          {filterUsageBreakdownForReceipt(usage.breakdown, showFullReceipt).some(
            (b) => b.tokens > 0
          ) && (
            <div className="mt-2 space-y-0.5 border-t border-white/10 pt-2 text-[10px] text-zinc-500">
              <p className="mb-1 font-semibold text-zinc-400">컨텍스트 분해 (추정)</p>
              {filterUsageBreakdownForReceipt(usage.breakdown, showFullReceipt)
                .filter((b) => b.tokens > 0)
                .map((b) => (
                  <p key={b.label}>
                    {b.label}: {b.tokens.toLocaleString()} ({b.pct}%)
                  </p>
                ))}
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
