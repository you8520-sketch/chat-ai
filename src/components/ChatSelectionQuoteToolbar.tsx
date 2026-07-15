"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  canShareQuoteCardPng,
  prepareQuoteCardSaveFallbackWindow,
  saveQuoteCardPngWithFallback,
  type QuoteCardOrientation,
  quoteCardDimensions,
  QUOTE_CARD_BODY_FONT_DEFAULT,
  QUOTE_CARD_BODY_FONT_MAX,
  QUOTE_CARD_BODY_FONT_MIN,
  renderQuoteCardPngBlob,
  scaleQuoteCardForViewport,
  shareQuoteCardPng,
} from "@/lib/quoteCardImage";
import { clampQuoteToolbarPosition, createCoalescedSelectionScheduler } from "@/lib/quoteSelectionToolbar";

type PendingCapture = {
  text: string;
  cursorX: number;
  cursorY: number;
};

type PreviewState = {
  blob: Blob;
  blobUrl: string;
  orientation: QuoteCardOrientation;
  loading: boolean;
  cardWidth: number;
  cardHeight: number;
  displayWidth: number;
  displayHeight: number;
};

const CURSOR_OFFSET = 14;

function elementFromSelectionNode(node: Node): Element | null {
  return node.nodeType === Node.TEXT_NODE ? node.parentElement : node instanceof Element ? node : null;
}

function isSelectionInContainer(container: HTMLElement, range: Range): boolean {
  const startElement = elementFromSelectionNode(range.startContainer);
  const endElement = elementFromSelectionNode(range.endContainer);
  const commonElement = elementFromSelectionNode(range.commonAncestorContainer);
  if (!startElement || !endElement || !commonElement) return false;
  if (!container.contains(startElement) || !container.contains(endElement)) return false;
  if (commonElement.closest("textarea, input, button, [data-quote-ignore], [data-quote-ui]")) {
    return false;
  }
  const startAssistant = startElement.closest("[data-quote-assistant]");
  const endAssistant = endElement.closest("[data-quote-assistant]");
  if (!startAssistant || !endAssistant || startAssistant !== endAssistant) return false;
  return container.contains(startAssistant) && container.contains(endAssistant);
}

function rangeAnchorPoint(range: Range): { x: number; y: number } {
  const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 || r.height > 0);
  const rect = rects[rects.length - 1] ?? range.getBoundingClientRect();
  return {
    x: rect.left + Math.min(rect.width, 240),
    y: rect.bottom || rect.top,
  };
}

export default function ChatSelectionQuoteToolbar({
  containerRef,
  characterName,
  creatorName,
  disabled,
  onToast,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  characterName: string;
  creatorName?: string;
  disabled?: boolean;
  onToast: (msg: string) => void;
}) {
  const [pending, setPending] = useState<PendingCapture | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [orientation, setOrientation] = useState<QuoteCardOrientation>("portrait");
  const [bodyFontSize, setBodyFontSize] = useState(QUOTE_CARD_BODY_FONT_DEFAULT);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [busy, setBusy] = useState(false);

  const previewUrlRef = useRef<string | null>(null);
  const toolbarRef = useRef<HTMLButtonElement>(null);
  const selectionSchedulerRef = useRef<ReturnType<typeof createCoalescedSelectionScheduler> | null>(null);
  const lastSelectionSignatureRef = useRef<string>("");
  /** Sticky toolbar coords so iOS selectionchange / getClientRects jitter does not chase the button. */
  const stickyToolbarPosRef = useRef<{ x: number; y: number } | null>(null);
  const toolbarPointerActiveRef = useRef(false);
  const toolbarPointerSafetyTimerRef = useRef<number | null>(null);
  const fontRenderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetToolbarPointerActive = useCallback(() => {
    toolbarPointerActiveRef.current = false;
    if (toolbarPointerSafetyTimerRef.current) {
      clearTimeout(toolbarPointerSafetyTimerRef.current);
      toolbarPointerSafetyTimerRef.current = null;
    }
  }, []);

  const markToolbarPointerActive = useCallback(() => {
    resetToolbarPointerActive();
    toolbarPointerActiveRef.current = true;
    toolbarPointerSafetyTimerRef.current = window.setTimeout(() => {
      toolbarPointerActiveRef.current = false;
      toolbarPointerSafetyTimerRef.current = null;
    }, 1200);
  }, [resetToolbarPointerActive]);

  const canNativeShare =
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof File !== "undefined";

  const revokePreviewUrl = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }, []);

  const clearAll = useCallback(() => {
    setPending(null);
    setModalOpen(false);
    setOrientation("portrait");
    setBodyFontSize(QUOTE_CARD_BODY_FONT_DEFAULT);
    revokePreviewUrl();
    setPreview(null);
    setBusy(false);
    lastSelectionSignatureRef.current = "";
    stickyToolbarPosRef.current = null;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) sel.removeAllRanges();
  }, [revokePreviewUrl]);

  const renderPreview = useCallback(
    async (
      text: string,
      nextOrientation: QuoteCardOrientation,
      nextBodyFontSize: number
    ) => {
      const viewportW = typeof window !== "undefined" ? window.innerWidth : 800;
      const viewportH = typeof window !== "undefined" ? window.innerHeight : 600;
      const cardDims = quoteCardDimensions(nextOrientation);
      const baseDims = scaleQuoteCardForViewport(
        cardDims.width,
        cardDims.height,
        viewportW,
        viewportH
      );
      setPreview({
        blob: new Blob(),
        blobUrl: "",
        orientation: nextOrientation,
        loading: true,
        cardWidth: cardDims.width,
        cardHeight: cardDims.height,
        displayWidth: baseDims.width,
        displayHeight: baseDims.height,
      });
      try {
        const { blob, width, height } = await renderQuoteCardPngBlob(
          {
            bodyText: text,
            characterName,
            creatorName,
            orientation: nextOrientation,
          },
          { bodyFontSize: nextBodyFontSize }
        );
        revokePreviewUrl();
        const blobUrl = URL.createObjectURL(blob);
        previewUrlRef.current = blobUrl;
        const display = scaleQuoteCardForViewport(width, height, viewportW, viewportH);
        setPreview({
          blob,
          blobUrl,
          orientation: nextOrientation,
          loading: false,
          cardWidth: width,
          cardHeight: height,
          displayWidth: display.width,
          displayHeight: display.height,
        });
      } catch {
        onToast("미리보기 만들기에 실패했습니다.");
        setModalOpen(false);
        revokePreviewUrl();
        setPreview(null);
      }
    },
    [characterName, creatorName, onToast, revokePreviewUrl]
  );

  const schedulePreviewRender = useCallback(
    (
      text: string,
      nextOrientation: QuoteCardOrientation,
      nextBodyFontSize: number,
      delayMs = 0
    ) => {
      if (fontRenderTimerRef.current) {
        clearTimeout(fontRenderTimerRef.current);
      }
      fontRenderTimerRef.current = setTimeout(() => {
        fontRenderTimerRef.current = null;
        void renderPreview(text, nextOrientation, nextBodyFontSize);
      }, delayMs);
    },
    [renderPreview]
  );

  const openPreviewModal = useCallback(() => {
    if (!pending) return;
    setModalOpen(true);
    void renderPreview(pending.text, orientation, bodyFontSize);
  }, [pending, orientation, bodyFontSize, renderPreview]);

  const changeOrientation = useCallback(
    (next: QuoteCardOrientation) => {
      if (!pending || next === orientation) return;
      setOrientation(next);
      void renderPreview(pending.text, next, bodyFontSize);
    },
    [pending, orientation, bodyFontSize, renderPreview]
  );

  const changeBodyFontSize = useCallback(
    (next: number) => {
      const clamped = Math.min(
        QUOTE_CARD_BODY_FONT_MAX,
        Math.max(QUOTE_CARD_BODY_FONT_MIN, Math.round(next))
      );
      setBodyFontSize(clamped);
      if (!pending || !modalOpen) return;
      schedulePreviewRender(pending.text, orientation, clamped, 120);
    },
    [pending, modalOpen, orientation, schedulePreviewRender]
  );

  useEffect(() => {
    return () => {
      if (fontRenderTimerRef.current) {
        clearTimeout(fontRenderTimerRef.current);
      }
      selectionSchedulerRef.current?.cancel();
      resetToolbarPointerActive();
    };
  }, [resetToolbarPointerActive]);

  useEffect(() => {
    window.addEventListener("blur", resetToolbarPointerActive);
    return () => window.removeEventListener("blur", resetToolbarPointerActive);
  }, [resetToolbarPointerActive]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || disabled) {
      clearAll();
      return;
    }

    const syncFromSelection = (cursorX?: number, cursorY?: number) => {
      if (modalOpen) return;

      const sel = window.getSelection();
      if (toolbarPointerActiveRef.current) return;
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        if (!lastSelectionSignatureRef.current) return;
        lastSelectionSignatureRef.current = "";
        stickyToolbarPosRef.current = null;
        setPending(null);
        return;
      }

      const range = sel.getRangeAt(0);
      if (!isSelectionInContainer(container, range)) {
        if (!lastSelectionSignatureRef.current) return;
        lastSelectionSignatureRef.current = "";
        stickyToolbarPosRef.current = null;
        setPending(null);
        return;
      }

      const text = sel.toString().replace(/\u00a0/g, " ").replace(/\s+\n/g, "\n").trim();
      if (!text) {
        if (!lastSelectionSignatureRef.current) return;
        lastSelectionSignatureRef.current = "";
        stickyToolbarPosRef.current = null;
        setPending(null);
        return;
      }

      const viewport = window.visualViewport;
      const viewportBox = {
        width: viewport?.width ?? window.innerWidth,
        height: viewport?.height ?? window.innerHeight,
        offsetLeft: viewport?.offsetLeft ?? 0,
        offsetTop: viewport?.offsetTop ?? 0,
      };
      const hasExplicitCursor =
        typeof cursorX === "number" &&
        typeof cursorY === "number" &&
        Number.isFinite(cursorX) &&
        Number.isFinite(cursorY);

      let nextX: number;
      let nextY: number;
      if (hasExplicitCursor) {
        // Pointer / touch / mouse end: place near the gesture.
        const clamped = clampQuoteToolbarPosition(
          { x: cursorX, y: cursorY },
          viewportBox,
          { offset: CURSOR_OFFSET }
        );
        nextX = clamped.x;
        nextY = clamped.y;
        stickyToolbarPosRef.current = { x: nextX, y: nextY };
      } else if (stickyToolbarPosRef.current) {
        // selectionchange on iOS fires often with jittery getClientRects — keep sticky spot.
        nextX = stickyToolbarPosRef.current.x;
        nextY = stickyToolbarPosRef.current.y;
      } else {
        const anchor = rangeAnchorPoint(range);
        const clamped = clampQuoteToolbarPosition(anchor, viewportBox, { offset: CURSOR_OFFSET });
        nextX = clamped.x;
        nextY = clamped.y;
        stickyToolbarPosRef.current = { x: nextX, y: nextY };
      }

      const signature = `${text}|${range.startOffset}|${range.endOffset}|${Math.round(nextX)}|${Math.round(nextY)}`;
      if (signature === lastSelectionSignatureRef.current) return;
      lastSelectionSignatureRef.current = signature;
      setPending({
        text,
        cursorX: nextX,
        cursorY: nextY,
      });
    };

    if (!selectionSchedulerRef.current) {
      selectionSchedulerRef.current = createCoalescedSelectionScheduler({
        requestAnimationFrame: window.requestAnimationFrame.bind(window),
        cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
        setTimeout: window.setTimeout.bind(window),
        clearTimeout: window.clearTimeout.bind(window),
      });
    }

    const scheduleSelectionSync = (cursorX?: number, cursorY?: number, delayMs = 35) => {
      selectionSchedulerRef.current?.schedule(() => syncFromSelection(cursorX, cursorY), delayMs);
    };

    const shouldIgnoreTarget = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      if (!container.contains(target)) return true;
      return Boolean(target.closest("textarea, input, button, [data-quote-ignore], [data-quote-ui]"));
    };

    const onMouseUp = (e: MouseEvent) => {
      if (shouldIgnoreTarget(e.target)) return;
      scheduleSelectionSync(e.clientX, e.clientY, 0);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      if (shouldIgnoreTarget(e.target)) return;
      scheduleSelectionSync(e.clientX, e.clientY);
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (shouldIgnoreTarget(e.target)) return;
      const touch = e.changedTouches.item(0);
      scheduleSelectionSync(touch?.clientX, touch?.clientY, 55);
    };

    const onSelectionChange = () => {
      if (modalOpen) return;
      scheduleSelectionSync(undefined, undefined, 20);
    };

    container.addEventListener("mouseup", onMouseUp);
    container.addEventListener("pointerup", onPointerUp);
    container.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("selectionchange", onSelectionChange);

    return () => {
      container.removeEventListener("mouseup", onMouseUp);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("selectionchange", onSelectionChange);
      selectionSchedulerRef.current?.cancel();
      resetToolbarPointerActive();
    };
  }, [containerRef, disabled, modalOpen, clearAll]);

  useEffect(() => {
    if (!pending && !modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (modalOpen) {
          setModalOpen(false);
          revokePreviewUrl();
          setPreview(null);
        } else {
          clearAll();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, modalOpen, clearAll, revokePreviewUrl]);

  useEffect(() => {
    if (!pending || modalOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (toolbarRef.current?.contains(target)) return;
      if ((e.target as Element).closest("[data-quote-toolbar], [data-quote-ui]")) return;
      stickyToolbarPosRef.current = null;
      lastSelectionSignatureRef.current = "";
      setPending(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [pending, modalOpen]);

  async function exportCard(mode: "save" | "share") {
    if (busy || preview?.loading || !preview?.blob) return;
    const fallbackWindow = mode === "save" || !canShareQuoteCardPng(preview.blob)
      ? prepareQuoteCardSaveFallbackWindow()
      : null;
    setBusy(true);
    try {
      if (mode === "share") {
        let shared = false;
        try {
          shared = await shareQuoteCardPng(preview.blob);
        } catch (err) {
          fallbackWindow?.close();
          const name = err instanceof DOMException || err instanceof Error ? err.name : "";
          if (name !== "AbortError") {
            onToast("공유에 실패했습니다. 저장 버튼으로 다시 시도해 주세요.");
          }
          return;
        }
        if (shared) {
          onToast("이미지를 공유했습니다.");
          clearAll();
          return;
        }
        const result = saveQuoteCardPngWithFallback(preview.blob, "quote.png", fallbackWindow);
        if (result === "blocked") fallbackWindow?.close();
        onToast(result === "opened" ? "이미지를 새 탭으로 열었습니다. 길게 눌러 저장해 주세요." : result === "blocked" ? "새 탭 열기가 차단되었습니다. 브라우저 공유 또는 이미지를 길게 눌러 저장해 주세요." : "이미지를 저장했습니다. (공유 미지원)");
      } else {
        const result = saveQuoteCardPngWithFallback(preview.blob, "quote.png", fallbackWindow);
        if (result === "blocked") fallbackWindow?.close();
        onToast(result === "opened" ? "이미지를 새 탭으로 열었습니다. 길게 눌러 저장해 주세요." : result === "blocked" ? "새 탭 열기가 차단되었습니다. 브라우저 공유 또는 이미지를 길게 눌러 저장해 주세요." : "이미지를 저장했습니다.");
      }
      clearAll();
    } catch {
      fallbackWindow?.close();
      onToast("이미지 만들기에 실패했습니다.");
    } finally {
      resetToolbarPointerActive();
      setBusy(false);
    }
  }

  const orientationBtn =
    "rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50";
  const orientationActive =
    "border-violet-400/60 bg-violet-600 text-white shadow-[0_0_10px_rgba(139,92,246,0.35)]";
  const orientationIdle =
    "border-white/10 bg-[#1a1a1a] text-zinc-300 hover:border-violet-500/35 hover:bg-violet-500/10";

  return (
    <>
      {pending && !modalOpen ? (
        <button
          ref={toolbarRef}
          type="button"
          data-quote-ui
          onClick={() => {
            try {
              openPreviewModal();
            } finally {
              window.setTimeout(resetToolbarPointerActive, 0);
            }
          }}
          className="fixed z-[85] rounded-lg border border-violet-400/50 bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.45)] transition hover:bg-violet-500"
          data-quote-toolbar
          onPointerDown={markToolbarPointerActive}
          onTouchStart={markToolbarPointerActive}
          onPointerUp={resetToolbarPointerActive}
          onTouchEnd={resetToolbarPointerActive}
          onPointerCancel={resetToolbarPointerActive}
          onTouchCancel={resetToolbarPointerActive}
          onBlur={resetToolbarPointerActive}
          style={{
            left: pending.cursorX,
            top: pending.cursorY,
          }}
        >
          이미지 저장
        </button>
      ) : null}

      {modalOpen && pending ? (
        <div
          data-quote-ui
          data-quote-toolbar
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) {
              setModalOpen(false);
              revokePreviewUrl();
              setPreview(null);
            }
          }}
        >
          <div
            className="flex w-fit max-w-[92vw] flex-col rounded-2xl border border-violet-500/35 bg-[#141418] shadow-[0_0_40px_rgba(139,92,246,0.2)]"
            role="dialog"
            aria-modal="true"
            aria-label="발췌 이미지 미리보기"
          >
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2.5">
              <p className="text-sm font-semibold text-zinc-100">저장 이미지 미리보기</p>
              <button
                type="button"
                onClick={() => {
                  setModalOpen(false);
                  revokePreviewUrl();
                  setPreview(null);
                }}
                className="rounded-lg px-2 py-1 text-xs text-zinc-400 transition hover:bg-white/10 hover:text-zinc-200"
              >
                닫기
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3 px-4 pt-2.5">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={preview?.loading}
                  onClick={() => changeOrientation("portrait")}
                  className={`${orientationBtn} ${
                    orientation === "portrait" ? orientationActive : orientationIdle
                  }`}
                >
                  세로 2:3
                </button>
                <button
                  type="button"
                  disabled={preview?.loading}
                  onClick={() => changeOrientation("square")}
                  className={`${orientationBtn} ${
                    orientation === "square" ? orientationActive : orientationIdle
                  }`}
                >
                  정사각 1:1
                </button>
                <button
                  type="button"
                  disabled={preview?.loading}
                  onClick={() => changeOrientation("landscape")}
                  className={`${orientationBtn} ${
                    orientation === "landscape" ? orientationActive : orientationIdle
                  }`}
                >
                  가로 3:2
                </button>
              </div>
              <label className="flex min-w-[9rem] flex-1 items-center gap-2 text-xs text-zinc-400">
                <span className="shrink-0 font-medium text-zinc-300">글자 크기</span>
                <input
                  type="range"
                  min={QUOTE_CARD_BODY_FONT_MIN}
                  max={QUOTE_CARD_BODY_FONT_MAX}
                  step={1}
                  value={bodyFontSize}
                  disabled={preview?.loading}
                  onChange={(e) => changeBodyFontSize(Number(e.target.value))}
                  className="h-1.5 w-full accent-violet-500"
                  aria-label="글자 크기"
                />
                <span className="shrink-0 tabular-nums text-zinc-300">{bodyFontSize}</span>
              </label>
            </div>

            <div className="flex justify-center px-3 py-2">
              {preview?.loading ? (
                <div
                  className="flex items-center justify-center rounded-lg border border-white/10 bg-black/20"
                  style={{
                    width: preview.displayWidth,
                    height: preview.displayHeight,
                    minWidth: 200,
                    minHeight: 120,
                  }}
                >
                  <p className="animate-pulse text-sm text-zinc-400">미리보기 생성 중…</p>
                </div>
              ) : preview?.blobUrl ? (
                <img
                  src={preview.blobUrl}
                  alt="발췌 카드 미리보기"
                  width={preview.displayWidth}
                  height={preview.displayHeight}
                  className="block rounded-lg border border-white/10 object-contain shadow-lg"
                  style={{
                    width: preview.displayWidth,
                    height: preview.displayHeight,
                    maxWidth: "none",
                  }}
                />
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/10 px-4 py-2.5">
              {canNativeShare ? (
                <button
                  type="button"
                  disabled={busy || preview?.loading}
                  onClick={() => exportCard("share")}
                  className="rounded-lg border border-violet-500/40 bg-violet-500/15 px-3 py-1.5 text-xs font-semibold text-violet-100 transition hover:bg-violet-500/25 disabled:opacity-50"
                >
                  공유
                </button>
              ) : null}
              <button
                type="button"
                disabled={busy || preview?.loading}
                onClick={() => exportCard("save")}
                className="rounded-lg border border-violet-400/50 bg-violet-600 px-4 py-1.5 text-xs font-semibold text-white shadow-[0_0_12px_rgba(139,92,246,0.35)] transition hover:bg-violet-500 disabled:opacity-50"
              >
                이미지 저장
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
