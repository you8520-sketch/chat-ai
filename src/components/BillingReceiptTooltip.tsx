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
  resolveStoredWidgetExtractCallCount,
  type BillingReceipt,
} from "@/lib/billingDisplay";
import { filterUsageBreakdownForReceipt } from "@/lib/billingReceiptAccess";
import type { Usage } from "@/lib/chatUsage";
import { AdminBillingReceiptV2Panel } from "@/components/AdminBillingReceiptV2Panel";
import { AdminBillingReceiptV3Panel } from "@/components/AdminBillingReceiptV3Panel";
import {
  buildAdminBillingReceiptV2,
  formatAdminBillingReceiptV2Text,
} from "@/lib/adminBillingReceiptV2";
import {
  formatAdminBillingReceiptV3Text,
} from "@/lib/adminBillingReceiptV3Shared";
import type { AdminBillingReceiptV3 } from "@/lib/adminBillingReceiptV3Shared";
import {
  isGemini25ProModel,
  isGemini31ProModel,
  isGeminiProOpenRouterModel,
  isOpenRouterSimplePointModel,
} from "@/lib/chatModels";
import { IconInfo } from "./ChatToolbarIcons";
import {
  countWidgetExtractAttempts,
  formatWidgetExtractAttemptLine,
} from "@/lib/statusWidgetExtractDiagnosticsDisplay";

function AdminFullReceiptBody({
  usage,
  messageId,
  v3Receipt,
  v3Loading,
  v3Error,
  copied,
  onCopy,
}: {
  usage: Usage;
  messageId?: number;
  v3Receipt: AdminBillingReceiptV3 | null;
  v3Loading: boolean;
  v3Error: string | null;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="space-y-1 text-[11px] leading-relaxed text-zinc-300">
      {usage.htmlFlashOnly && (
        <p className="text-[10px] leading-relaxed text-zinc-500">
          HTML 전용 턴 — 백그라운드 단독 호출 (영수증 모델: HTML전용모델). 메인 RP 모델 미호출.
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
            </p>
          )}
        </>
      )}
      {usage.statusWidgetExtractDiagnostics && (
        <div className="mt-1 border-t border-zinc-800 pt-1">
          {(() => {
            const diag = usage.statusWidgetExtractDiagnostics;
            const counts = countWidgetExtractAttempts(diag);
            return (
              <>
                <p className="text-zinc-500">
                  위젯 진단:{" "}
                  {diag.usedFallback
                    ? "V3 폴백 사용"
                    : diag.exhausted
                      ? "추출 실패"
                      : "정상"}
                  {counts.total > 0
                    ? ` · API attempts ${counts.total} (initial ${counts.initial}, repair ${counts.repair})`
                    : ""}
                </p>
                {diag.attempts.map((attempt, index) => (
                  <p key={`${attempt.stage}-${attempt.modelId}-${index}`}>
                    <span className="text-zinc-500">{formatWidgetExtractAttemptLine(attempt)}</span>
                  </p>
                ))}
              </>
            );
          })()}
        </div>
      )}
      {messageId && v3Loading && (
        <p className="text-[10px] text-zinc-500">Async ledger 불러오는 중…</p>
      )}
      {messageId && v3Error && (
        <p className="text-[10px] text-amber-400/90">Async ledger unavailable — {v3Error}</p>
      )}
      {v3Receipt ? (
        <AdminBillingReceiptV3Panel receipt={v3Receipt} onCopy={onCopy} copied={copied} />
      ) : (
        <AdminBillingReceiptV2Panel usage={usage} />
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
}: {
  receipt: BillingReceipt;
  usage: Usage;
  apiRawCostKrw: number | null;
  mainRpCostParts: ReturnType<typeof resolveMainRpApiCostPartsKrw>;
  cacheReceipt: ReturnType<typeof resolveOpenRouterCacheReceipt>;
  exchangeRateLabel: string;
  showFullReceipt: boolean;
}) {
  const reasoningExcludedFromBilling =
    isMeteredReceiptProvider(usage.provider) &&
    !isOpenRouterSimplePointModel(usage.model ?? "") &&
    (isGemini25ProModel(usage.model ?? "") ||
      (isGeminiProOpenRouterModel(usage.model ?? "") &&
        !isGemini31ProModel(usage.model ?? "")));
  // Admin v2 owns canonical provider economics — legacy margin removed from admin panel.
  const marginRateLabel = null;
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

  if (showFullReceipt) {
    return null;
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
      {usage.cacheDiscountUsd != null && usage.cacheDiscountUsd > 0 && !showFullReceipt && (
        <p>
          <span className="text-zinc-500">OpenRouter 절약:</span>{" "}
          <span className="text-emerald-400/90">
            ${usage.cacheDiscountUsd.toFixed(4)}
          </span>
        </p>
      )}
      {usage.statusWidgetExtract && !showFullReceipt && (
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
            <span className="text-zinc-600"> (플랫폼 부담)</span>
            {usage.statusWidgetExtract.upstreamCostUsd != null &&
            usage.statusWidgetExtract.upstreamCostUsd > 0 ? (
              <span className="text-zinc-600"> · OpenRouter USD</span>
            ) : (
              <span className="text-zinc-600"> · 요율 추정</span>
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
      {apiRawCostKrw != null && apiRawCostKrw > 0 && !showFullReceipt && (
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
      {usage.statusWidgetExtract && apiRawCostKrw != null && apiRawCostKrw > 0 && !showFullReceipt && (
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
      {cacheReceipt?.rateSummary && !showFullReceipt && (
        <p className="text-[10px] text-zinc-500">모델 요율: {cacheReceipt.rateSummary}</p>
      )}
      {!showFullReceipt && (
        <p className="text-[10px] text-zinc-500">적용 환율: {exchangeRateLabel}</p>
      )}
      {!showFullReceipt && (receipt.waived ? (
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
          <p className="font-semibold text-zinc-100">
            <span className="text-zinc-500">포인트 차감:</span> {formatPoints(receipt.totalCost)} P
            {marginRateLabel != null && (
              <span className="text-zinc-500"> (마진율: {marginRateLabel})</span>
            )}
          </p>
        </>
      ))}
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
  messageId,
}: {
  usage: Usage;
  triggerVariant?: "coin" | "info";
  /** 관리자·데모유저 — thinking·API raw·strip 등 전체 영수증 */
  showFullReceipt?: boolean;
  messageId?: number;
}) {
  const receipt = buildBillingReceipt(usage);
  const apiRawCostKrw = resolveApiRawCostKrw(usage);
  const mainRpCostParts = showFullReceipt ? resolveMainRpApiCostPartsKrw(usage) : null;
  const cacheReceipt = resolveOpenRouterCacheReceipt(usage);
  const exchangeRateLabel = resolveExchangeRateReceiptLabel(usage);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [v3Receipt, setV3Receipt] = useState<AdminBillingReceiptV3 | null>(null);
  const [v3Loading, setV3Loading] = useState(false);
  const [v3Error, setV3Error] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const fetchGenerationRef = useRef(0);

  useEffect(() => {
    if (!open || !showFullReceipt || !messageId) return;
    const generation = ++fetchGenerationRef.current;
    setV3Loading(true);
    setV3Error(null);
    void fetch(`/api/chat/admin-billing-receipt?messageId=${messageId}`, {
      cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `HTTP ${res.status}`);
        }
        return res.json() as Promise<AdminBillingReceiptV3>;
      })
      .then((payload) => {
        if (generation !== fetchGenerationRef.current) return;
        setV3Receipt(payload);
      })
      .catch((error: Error) => {
        if (generation !== fetchGenerationRef.current) return;
        setV3Receipt(null);
        setV3Error(error.message);
      })
      .finally(() => {
        if (generation === fetchGenerationRef.current) {
          setV3Loading(false);
        }
      });
  }, [open, showFullReceipt, messageId]);

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
    const text = v3Receipt
      ? formatAdminBillingReceiptV3Text(v3Receipt)
      : formatAdminBillingReceiptV2Text(buildAdminBillingReceiptV2(usage));
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
          {showFullReceipt ? (
            <AdminFullReceiptBody
              usage={usage}
              messageId={messageId}
              v3Receipt={v3Receipt}
              v3Loading={v3Loading}
              v3Error={v3Error}
              copied={copied}
              onCopy={() => void copyReceipt()}
            />
          ) : (
            <ReceiptBody
              receipt={receipt}
              usage={usage}
              apiRawCostKrw={apiRawCostKrw}
              mainRpCostParts={mainRpCostParts}
              cacheReceipt={cacheReceipt}
              exchangeRateLabel={exchangeRateLabel}
              showFullReceipt={showFullReceipt}
            />
          )}
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
