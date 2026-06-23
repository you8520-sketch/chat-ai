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
  type BillingReceipt,
} from "@/lib/billingDisplay";
import type { Usage } from "@/lib/chatUsage";
import { isGeminiProOpenRouterModel } from "@/lib/chatModels";
import { IconInfo } from "./ChatToolbarIcons";

function ReceiptBody({
  receipt,
  usage,
  apiRawCostKrw,
  cacheReceipt,
  exchangeRateLabel,
}: {
  receipt: BillingReceipt;
  usage: Usage;
  apiRawCostKrw: number | null;
  cacheReceipt: ReturnType<typeof resolveOpenRouterCacheReceipt>;
  exchangeRateLabel: string;
}) {
  const reasoningExcludedFromBilling =
    usage.provider === "openrouter" && isGeminiProOpenRouterModel(usage.model ?? "");

  return (
    <div className="space-y-1 text-[11px] leading-relaxed text-zinc-300">
      <p>
        <span className="text-zinc-500">모델:</span> {receipt.modelLabel}
      </p>
      {usage.htmlFlashOnly && (
        <p className="text-[10px] leading-relaxed text-zinc-500">
          Flash HTML 전용 턴 — 출력 1,000토큰당 10P 과금 (최대 6,000토큰). 입력 토큰에는 최근 대화·장기기억·페르소나·캐릭터
          설정·로어북 등 Flash 프롬프트 전체가 포함됩니다 (메인 RP 모델 미호출).
        </p>
      )}
      <p>
        <span className="text-zinc-500">
          {usage.provider === "openrouter" && usage.apiOutputTokens != null
            ? "사용모델 API 입력/출력:"
            : "입력/출력 (과금):"}
        </span>{" "}
        {receipt.inputTokens.toLocaleString()} / {receipt.outputTokens.toLocaleString()}
        {receipt.estimated ? " (추정)" : ""}
      </p>
      {!reasoningExcludedFromBilling &&
        usage.apiReasoningOutputTokens != null &&
        usage.apiReasoningOutputTokens > 0 && (
        <>
          <p>
            <span className="text-zinc-500">reasoning:</span>{" "}
            {usage.apiReasoningOutputTokens.toLocaleString()} tokens
          </p>
          <p>
            <span className="text-zinc-500">content (표시 RP):</span>{" "}
            {(usage.apiContentOutputTokens ?? 0).toLocaleString()} tokens
            <span className="text-zinc-600"> (reasoning은 과금·미저장)</span>
          </p>
        </>
      )}
      {usage.savedOutputChars != null && usage.savedOutputChars > 0 && (
        <p>
          <span className="text-zinc-500">저장 RP:</span>{" "}
          {usage.savedOutputChars.toLocaleString()}자
          <span className="text-zinc-600"> (표시 텍스트 · tier cap)</span>
        </p>
      )}
      {usage.outputLeakage?.hiddenArtifacts.detected && (
        <p className="text-[10px] leading-relaxed text-amber-200/90">
          <span className="text-zinc-500">숨은 출력(strip):</span>{" "}
          JSON {usage.outputLeakage.hiddenArtifacts.statusJsonChars.toLocaleString()}자
          {usage.outputLeakage.hiddenArtifacts.statusTableChars > 0
            ? ` · 표 ${usage.outputLeakage.hiddenArtifacts.statusTableChars.toLocaleString()}자`
            : ""}
          {usage.outputLeakage.hiddenArtifacts.statusHtmlChars > 0
            ? ` · HTML ${usage.outputLeakage.hiddenArtifacts.statusHtmlChars.toLocaleString()}자`
            : ""}
          <span className="text-zinc-600">
            {" "}
            (추정 ~{usage.outputLeakage.estimates.hiddenTokenEstimate.toLocaleString()} tokens · API
            과금에 포함)
          </span>
        </p>
      )}
      {usage.outputLeakage && !usage.outputLeakage.hiddenArtifacts.detected && (
        <p className="text-[10px] text-zinc-600">
          숨은 status/JSON/HTML strip 없음 (모델 raw → 저장 차이는 sanitize·토큰/글자 단위 차이)
        </p>
      )}
      {usage.provider === "openrouter" &&
        usage.apiInputTokens != null &&
        usage.apiOutputTokens != null &&
        (usage.apiInputTokens !== receipt.inputTokens ||
          usage.apiOutputTokens !== receipt.outputTokens) && (
          <p>
            <span className="text-zinc-500">API 합산{usage.apiCallCount != null && usage.apiCallCount > 1 ? ` (${usage.apiCallCount}회)` : ""}:</span>{" "}
            {usage.apiInputTokens.toLocaleString()} / {usage.apiOutputTokens.toLocaleString()}
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
      {apiRawCostKrw != null && apiRawCostKrw > 0 && (
        <p>
          <span className="text-zinc-500">실제 API 원가:</span>{" "}
          <span className="text-cyan-300/90">~{formatPoints(apiRawCostKrw)}원</span>
          {usage.upstreamCostUsd != null && usage.upstreamCostUsd > 0 && (
            <span className="text-zinc-600"> (OpenRouter USD 합산)</span>
          )}
          {usage.apiRawCostKrw == null && usage.upstreamCostUsd == null && (
            <span className="text-zinc-600"> (요율 추정)</span>
          )}
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
        <p className="font-semibold text-zinc-100">
          <span className="text-zinc-500">포인트 차감:</span> {formatPoints(receipt.totalCost)} P
        </p>
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
}: {
  usage: Usage;
  triggerVariant?: "coin" | "info";
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
          />
          {usage.breakdown?.some((b) => b.tokens > 0) && (
            <div className="mt-2 space-y-0.5 border-t border-white/10 pt-2 text-[10px] text-zinc-500">
              <p className="mb-1 font-semibold text-zinc-400">컨텍스트 분해 (추정)</p>
              {usage.breakdown
                .filter((b) => b.tokens > 0)
                .map((b) => (
                  <p key={b.label}>
                    {b.label}: {b.tokens.toLocaleString()} ({b.pct}%)
                  </p>
                ))}
            </div>
          )}
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
        </div>
      )}
    </div>
  );
}
