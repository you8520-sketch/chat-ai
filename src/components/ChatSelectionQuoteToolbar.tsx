"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  canShareQuoteCardPng,
  clampQuoteCardAvatarFocus,
  copyQuoteCardPng,
  listQuoteCardDialogueEntries,
  prepareQuoteCardSaveFallbackWindow,
  saveQuoteCardPngWithFallback,
  type QuoteCardAvatarFocus,
  type QuoteCardDialogueStyle,
  type QuoteCardFontId,
  type QuoteCardThemeId,
  QUOTE_CARD_WIDTH,
  quoteCardFontById,
  QUOTE_CARD_AVATAR_FOCUS_DEFAULT,
  QUOTE_CARD_BODY_FONT_DEFAULT,
  QUOTE_CARD_BODY_FONT_MAX,
  QUOTE_CARD_BODY_FONT_MIN,
  QUOTE_CARD_FONTS,
  QUOTE_CARD_THEMES,
  renderQuoteCardPngBlob,
  scaleQuoteCardForViewport,
  shareQuoteCardPng,
  styleFromQuoteCardTheme,
} from "@/lib/quoteCardImage";
import { extractQuoteSelectionText, isSelectionInContainer } from "@/lib/quoteSelectionContainer";
import { clampQuoteToolbarPosition, createCoalescedSelectionScheduler } from "@/lib/quoteSelectionToolbar";

type PendingCapture = {
  text: string;
  cursorX: number;
  cursorY: number;
};

type PreviewState = {
  blob: Blob;
  blobUrl: string;
  loading: boolean;
  cardWidth: number;
  cardHeight: number;
  displayWidth: number;
  displayHeight: number;
};

const CURSOR_OFFSET = 14;

function rangeAnchorPoint(range: Range): { x: number; y: number } {
  const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 || r.height > 0);
  const rect = rects[rects.length - 1] ?? range.getBoundingClientRect();
  return {
    x: rect.left + Math.min(rect.width, 240),
    y: rect.bottom || rect.top,
  };
}

function loadImageFromFile(file: File): Promise<{ img: HTMLImageElement; url: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image load failed"));
    };
    img.src = url;
  });
}

const AVATAR_PREVIEW_SIZE = 80;

function avatarPreviewDrawRect(
  natural: { w: number; h: number },
  focus: QuoteCardAvatarFocus,
  previewSize: number
): { width: number; height: number; left: number; top: number } {
  const cover = Math.max(previewSize / natural.w, previewSize / natural.h);
  const scale = cover * (focus.zoom ?? 1);
  const width = natural.w * scale;
  const height = natural.h * scale;
  return {
    width,
    height,
    left: previewSize / 2 - focus.x * width,
    top: previewSize / 2 - focus.y * height,
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
  const [bodyFontSize, setBodyFontSize] = useState(QUOTE_CARD_BODY_FONT_DEFAULT);
  const [fontId, setFontId] = useState<QuoteCardFontId>("noto-serif");
  const [themeId, setThemeId] = useState<QuoteCardThemeId>("white");
  const [dialogueStyle, setDialogueStyle] = useState<QuoteCardDialogueStyle>("bubble");
  const [speakerDrafts, setSpeakerDrafts] = useState<string[]>([]);
  const [dialoguePreviews, setDialoguePreviews] = useState<string[]>([]);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [busy, setBusy] = useState(false);

  const previewUrlRef = useRef<string | null>(null);
  const avatarUrlRef = useRef<string | null>(null);
  const backgroundUrlRef = useRef<string | null>(null);
  const avatarImageRef = useRef<HTMLImageElement | null>(null);
  const backgroundImageRef = useRef<HTMLImageElement | null>(null);
  const [hasAvatar, setHasAvatar] = useState(false);
  const [hasBackground, setHasBackground] = useState(false);
  const [avatarFocus, setAvatarFocus] = useState<QuoteCardAvatarFocus>({
    ...QUOTE_CARD_AVATAR_FOCUS_DEFAULT,
  });
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarNatural, setAvatarNatural] = useState<{ w: number; h: number } | null>(
    null
  );

  const toolbarRef = useRef<HTMLButtonElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const backgroundInputRef = useRef<HTMLInputElement>(null);
  const avatarFocusRef = useRef<QuoteCardAvatarFocus>({ ...QUOTE_CARD_AVATAR_FOCUS_DEFAULT });
  const avatarPanRef = useRef<{
    pointerId: number;
    lastX: number;
    lastY: number;
  } | null>(null);
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

  const resetAvatarFocus = useCallback(() => {
    const next = { ...QUOTE_CARD_AVATAR_FOCUS_DEFAULT };
    avatarFocusRef.current = next;
    setAvatarFocus(next);
  }, []);

  const revokeSessionImages = useCallback(() => {
    if (avatarUrlRef.current) {
      URL.revokeObjectURL(avatarUrlRef.current);
      avatarUrlRef.current = null;
    }
    if (backgroundUrlRef.current) {
      URL.revokeObjectURL(backgroundUrlRef.current);
      backgroundUrlRef.current = null;
    }
    avatarImageRef.current = null;
    backgroundImageRef.current = null;
    setAvatarUrl(null);
    setAvatarNatural(null);
    setHasAvatar(false);
    setHasBackground(false);
    resetAvatarFocus();
    if (avatarInputRef.current) avatarInputRef.current.value = "";
    if (backgroundInputRef.current) backgroundInputRef.current.value = "";
  }, [resetAvatarFocus]);

  const syncSpeakerDrafts = useCallback(
    (text: string, overrides?: Record<number, string>) => {
      const entries = listQuoteCardDialogueEntries(text, {
        defaultSpeaker: characterName,
        overrides,
      });
      setSpeakerDrafts(entries.map((e) => e.speaker));
      setDialoguePreviews(entries.map((e) => e.preview));
      return entries.map((e) => e.speaker);
    },
    [characterName]
  );

  const clearAll = useCallback(() => {
    setPending(null);
    setModalOpen(false);
    setBodyFontSize(QUOTE_CARD_BODY_FONT_DEFAULT);
    setFontId("noto-serif");
    setThemeId("white");
    setDialogueStyle("bubble");
    setSpeakerDrafts([]);
    setDialoguePreviews([]);
    revokePreviewUrl();
    revokeSessionImages();
    setPreview(null);
    setBusy(false);
    lastSelectionSignatureRef.current = "";
    stickyToolbarPosRef.current = null;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) sel.removeAllRanges();
  }, [revokePreviewUrl, revokeSessionImages]);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    revokePreviewUrl();
    revokeSessionImages();
    setPreview(null);
    setDialogueStyle("bubble");
    setSpeakerDrafts([]);
    setDialoguePreviews([]);
    setBodyFontSize(QUOTE_CARD_BODY_FONT_DEFAULT);
    setFontId("noto-serif");
    setThemeId("white");
  }, [revokePreviewUrl, revokeSessionImages]);

  const renderPreview = useCallback(
    async (
      text: string,
      nextBodyFontSize: number,
      nextDialogueStyle: QuoteCardDialogueStyle,
      nextFontId: QuoteCardFontId,
      nextThemeId: QuoteCardThemeId,
      nextSpeakers: string[]
    ) => {
      const viewportW = typeof window !== "undefined" ? window.innerWidth : 800;
      const viewportH = typeof window !== "undefined" ? window.innerHeight : 600;
      const baseDims = scaleQuoteCardForViewport(
        QUOTE_CARD_WIDTH,
        900,
        viewportW,
        viewportH
      );
      setPreview({
        blob: new Blob(),
        blobUrl: "",
        loading: true,
        cardWidth: QUOTE_CARD_WIDTH,
        cardHeight: 900,
        displayWidth: baseDims.width,
        displayHeight: baseDims.height,
      });
      try {
        const themeStyle = styleFromQuoteCardTheme(nextThemeId);
        const font = quoteCardFontById(nextFontId);
        const speakerOverrides = Object.fromEntries(
          nextSpeakers.map((name, index) => [index, name])
        );
        const { blob, width, height } = await renderQuoteCardPngBlob(
          {
            bodyText: text,
            characterName,
            creatorName,
          },
          {
            ...themeStyle,
            bodyFontSize: nextBodyFontSize,
            bodyFontFamily: font.css,
            dialogueStyle: nextDialogueStyle,
            avatarImage: avatarImageRef.current,
            avatarFocus: avatarFocusRef.current,
            backgroundImage: backgroundImageRef.current,
            characterInitial: characterName.trim()[0] || "?",
            defaultSpeakerName: characterName,
            speakerOverrides,
          }
        );
        revokePreviewUrl();
        const blobUrl = URL.createObjectURL(blob);
        previewUrlRef.current = blobUrl;
        const display = scaleQuoteCardForViewport(width, height, viewportW, viewportH);
        setPreview({
          blob,
          blobUrl,
          loading: false,
          cardWidth: width,
          cardHeight: height,
          displayWidth: display.width,
          displayHeight: display.height,
        });
      } catch {
        onToast("미리보기 만들기에 실패했습니다.");
        closeModal();
      }
    },
    [characterName, creatorName, onToast, revokePreviewUrl, closeModal]
  );

  const schedulePreviewRender = useCallback(
    (
      text: string,
      nextBodyFontSize: number,
      nextDialogueStyle: QuoteCardDialogueStyle,
      nextFontId: QuoteCardFontId,
      nextThemeId: QuoteCardThemeId,
      nextSpeakers: string[],
      delayMs = 0
    ) => {
      if (fontRenderTimerRef.current) {
        clearTimeout(fontRenderTimerRef.current);
      }
      fontRenderTimerRef.current = setTimeout(() => {
        fontRenderTimerRef.current = null;
        void renderPreview(
          text,
          nextBodyFontSize,
          nextDialogueStyle,
          nextFontId,
          nextThemeId,
          nextSpeakers
        );
      }, delayMs);
    },
    [renderPreview]
  );

  const openPreviewModal = useCallback(() => {
    if (!pending) return;
    const speakers = syncSpeakerDrafts(pending.text);
    setModalOpen(true);
    void renderPreview(
      pending.text,
      bodyFontSize,
      dialogueStyle,
      fontId,
      themeId,
      speakers
    );
  }, [
    pending,
    bodyFontSize,
    dialogueStyle,
    fontId,
    themeId,
    renderPreview,
    syncSpeakerDrafts,
  ]);

  const changeBodyFontSize = useCallback(
    (next: number) => {
      const clamped = Math.min(
        QUOTE_CARD_BODY_FONT_MAX,
        Math.max(QUOTE_CARD_BODY_FONT_MIN, Math.round(next))
      );
      setBodyFontSize(clamped);
      if (!pending || !modalOpen) return;
      schedulePreviewRender(
        pending.text,
        clamped,
        dialogueStyle,
        fontId,
        themeId,
        speakerDrafts,
        120
      );
    },
    [
      pending,
      modalOpen,
      dialogueStyle,
      fontId,
      themeId,
      speakerDrafts,
      schedulePreviewRender,
    ]
  );

  const changeFontId = useCallback(
    (next: QuoteCardFontId) => {
      if (!pending || next === fontId) return;
      setFontId(next);
      void renderPreview(
        pending.text,
        bodyFontSize,
        dialogueStyle,
        next,
        themeId,
        speakerDrafts
      );
    },
    [
      pending,
      fontId,
      bodyFontSize,
      dialogueStyle,
      themeId,
      speakerDrafts,
      renderPreview,
    ]
  );

  const changeThemeId = useCallback(
    (next: QuoteCardThemeId) => {
      if (!pending || next === themeId) return;
      setThemeId(next);
      void renderPreview(
        pending.text,
        bodyFontSize,
        dialogueStyle,
        fontId,
        next,
        speakerDrafts
      );
    },
    [
      pending,
      themeId,
      bodyFontSize,
      dialogueStyle,
      fontId,
      speakerDrafts,
      renderPreview,
    ]
  );

  const changeDialogueStyle = useCallback(
    (next: QuoteCardDialogueStyle) => {
      setDialogueStyle(next);
      if (!pending || !modalOpen) return;
      void renderPreview(
        pending.text,
        bodyFontSize,
        next,
        fontId,
        themeId,
        speakerDrafts
      );
    },
    [
      pending,
      modalOpen,
      bodyFontSize,
      fontId,
      themeId,
      speakerDrafts,
      renderPreview,
    ]
  );

  const changeSpeakerDraft = useCallback(
    (index: number, value: string) => {
      setSpeakerDrafts((prev) => {
        const next = prev.map((s, i) => (i === index ? value : s));
        if (pending && modalOpen) {
          schedulePreviewRender(
            pending.text,
            bodyFontSize,
            dialogueStyle,
            fontId,
            themeId,
            next,
            160
          );
        }
        return next;
      });
    },
    [
      pending,
      modalOpen,
      bodyFontSize,
      dialogueStyle,
      fontId,
      themeId,
      schedulePreviewRender,
    ]
  );

  const applyAvatarFocus = useCallback(
    (partial: Partial<QuoteCardAvatarFocus>, delayMs = 80) => {
      const next = clampQuoteCardAvatarFocus({
        ...avatarFocusRef.current,
        ...partial,
      });
      avatarFocusRef.current = next;
      setAvatarFocus(next);
      if (!pending || !modalOpen) return;
      schedulePreviewRender(
        pending.text,
        bodyFontSize,
        dialogueStyle,
        fontId,
        themeId,
        speakerDrafts,
        delayMs
      );
    },
    [
      pending,
      modalOpen,
      bodyFontSize,
      dialogueStyle,
      fontId,
      themeId,
      speakerDrafts,
      schedulePreviewRender,
    ]
  );

  const onAvatarPanPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!hasAvatar || preview?.loading) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      avatarPanRef.current = {
        pointerId: e.pointerId,
        lastX: e.clientX,
        lastY: e.clientY,
      };
    },
    [hasAvatar, preview?.loading]
  );

  const onAvatarPanPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const pan = avatarPanRef.current;
      if (!pan || pan.pointerId !== e.pointerId) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const size = Math.max(1, Math.min(rect.width, rect.height));
      const dx = e.clientX - pan.lastX;
      const dy = e.clientY - pan.lastY;
      pan.lastX = e.clientX;
      pan.lastY = e.clientY;
      const zoom = avatarFocusRef.current.zoom ?? 1;
      // Drag image with finger: focus moves opposite to the drag.
      applyAvatarFocus(
        {
          x: avatarFocusRef.current.x - dx / (size * zoom),
          y: avatarFocusRef.current.y - dy / (size * zoom),
        },
        40
      );
    },
    [applyAvatarFocus]
  );

  const onAvatarPanPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (avatarPanRef.current?.pointerId === e.pointerId) {
      avatarPanRef.current = null;
    }
  }, []);

  const onAvatarFile = useCallback(
    async (file: File | null) => {
      if (!file || !pending) return;
      try {
        if (avatarUrlRef.current) URL.revokeObjectURL(avatarUrlRef.current);
        const { img, url } = await loadImageFromFile(file);
        avatarUrlRef.current = url;
        avatarImageRef.current = img;
        setAvatarUrl(url);
        setAvatarNatural({
          w: Math.max(1, img.naturalWidth || img.width || 1),
          h: Math.max(1, img.naturalHeight || img.height || 1),
        });
        setHasAvatar(true);
        resetAvatarFocus();
        void renderPreview(
          pending.text,
          bodyFontSize,
          dialogueStyle,
          fontId,
          themeId,
          speakerDrafts
        );
      } catch {
        onToast("캐릭터 사진을 불러오지 못했습니다.");
      }
    },
    [
      pending,
      bodyFontSize,
      dialogueStyle,
      fontId,
      themeId,
      speakerDrafts,
      renderPreview,
      onToast,
      resetAvatarFocus,
    ]
  );

  const onBackgroundFile = useCallback(
    async (file: File | null) => {
      if (!file || !pending) return;
      try {
        if (backgroundUrlRef.current) URL.revokeObjectURL(backgroundUrlRef.current);
        const { img, url } = await loadImageFromFile(file);
        backgroundUrlRef.current = url;
        backgroundImageRef.current = img;
        setHasBackground(true);
        void renderPreview(
          pending.text,
          bodyFontSize,
          dialogueStyle,
          fontId,
          themeId,
          speakerDrafts
        );
      } catch {
        onToast("배경 이미지를 불러오지 못했습니다.");
      }
    },
    [
      pending,
      bodyFontSize,
      dialogueStyle,
      fontId,
      themeId,
      speakerDrafts,
      renderPreview,
      onToast,
    ]
  );

  const clearBackground = useCallback(() => {
    if (backgroundUrlRef.current) {
      URL.revokeObjectURL(backgroundUrlRef.current);
      backgroundUrlRef.current = null;
    }
    backgroundImageRef.current = null;
    setHasBackground(false);
    if (backgroundInputRef.current) backgroundInputRef.current.value = "";
    if (!pending) return;
    void renderPreview(
      pending.text,
      bodyFontSize,
      dialogueStyle,
      fontId,
      themeId,
      speakerDrafts
    );
  }, [
    pending,
    bodyFontSize,
    dialogueStyle,
    fontId,
    themeId,
    speakerDrafts,
    renderPreview,
  ]);

  useEffect(() => {
    return () => {
      if (fontRenderTimerRef.current) {
        clearTimeout(fontRenderTimerRef.current);
      }
      selectionSchedulerRef.current?.cancel();
      resetToolbarPointerActive();
      if (avatarUrlRef.current) URL.revokeObjectURL(avatarUrlRef.current);
      if (backgroundUrlRef.current) URL.revokeObjectURL(backgroundUrlRef.current);
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

      const text = extractQuoteSelectionText(container, range);
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
        const clamped = clampQuoteToolbarPosition(
          { x: cursorX, y: cursorY },
          viewportBox,
          { offset: CURSOR_OFFSET }
        );
        nextX = clamped.x;
        nextY = clamped.y;
        stickyToolbarPosRef.current = { x: nextX, y: nextY };
      } else if (stickyToolbarPosRef.current) {
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
  }, [containerRef, disabled, modalOpen, clearAll, resetToolbarPointerActive]);

  useEffect(() => {
    if (!pending && !modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (modalOpen) {
          closeModal();
        } else {
          clearAll();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, modalOpen, clearAll, closeModal]);

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

  async function exportCard(mode: "save" | "share" | "copy") {
    if (busy || preview?.loading || !preview?.blob) return;
    if (mode === "copy") {
      setBusy(true);
      try {
        const ok = await copyQuoteCardPng(preview.blob);
        onToast(ok ? "이미지를 복사했습니다." : "이 브라우저에서는 이미지 복사를 지원하지 않습니다. 저장을 이용해 주세요.");
        if (ok) clearAll();
      } finally {
        resetToolbarPointerActive();
        setBusy(false);
      }
      return;
    }

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

  const chipBtn =
    "min-h-9 shrink-0 rounded-lg border px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60";
  const chipActive =
    "border-violet-500 bg-violet-600 text-white shadow-sm";
  const chipIdle =
    "border-zinc-300 bg-white text-zinc-900 hover:border-violet-400 hover:bg-violet-50";

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
          className="fixed z-[140] rounded-lg border-2 border-violet-300 bg-violet-600 px-4 py-2 text-sm font-bold text-white shadow-[0_4px_20px_rgba(0,0,0,0.45)] ring-2 ring-white/90 transition hover:bg-violet-500"
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
          className="fixed inset-0 z-[140] flex items-end justify-center bg-black/70 p-3 sm:items-center sm:p-4"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) {
              closeModal();
            }
          }}
        >
          <div
            className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-zinc-300 bg-white text-zinc-900 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="발췌 이미지 미리보기"
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 py-3">
              <p className="text-base font-bold text-zinc-950">이미지 미리보기</p>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-lg border border-zinc-300 bg-zinc-100 px-3 py-1.5 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-200"
              >
                닫기
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <div className="flex flex-col gap-3 px-4 py-3">

                <div>
                  <p className="mb-1.5 text-xs font-bold text-zinc-900">대사 스타일</p>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        { id: "off", label: "끄기" },
                        { id: "bubble", label: "말풍선" },
                        { id: "accent", label: "강조선" },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={preview?.loading}
                        onClick={() => changeDialogueStyle(opt.id)}
                        className={`${chipBtn} ${
                          dialogueStyle === opt.id ? chipActive : chipIdle
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="flex min-w-[10rem] items-center gap-2 text-sm text-zinc-700">
                    <span className="shrink-0 font-semibold text-zinc-900">크기</span>
                    <input
                      type="range"
                      min={QUOTE_CARD_BODY_FONT_MIN}
                      max={QUOTE_CARD_BODY_FONT_MAX}
                      step={1}
                      value={bodyFontSize}
                      disabled={preview?.loading}
                      onChange={(e) => changeBodyFontSize(Number(e.target.value))}
                      className="h-2 w-full accent-violet-600"
                      aria-label="글자 크기"
                    />
                    <span className="shrink-0 tabular-nums font-semibold text-zinc-900">
                      {bodyFontSize}
                    </span>
                  </label>
                  <p className="text-[11px] leading-snug text-zinc-500">
                    가로는 900px 고정, 세로는 글자 수·크기에 맞게 400~2000px로 자동 조절됩니다.
                  </p>
                </div>

                {dialogueStyle !== "off" && speakerDrafts.length > 1 ? (
                  <div>
                    <p className="mb-1.5 text-xs font-bold text-zinc-900">화자 이름</p>
                    <p className="mb-2 text-[11px] leading-snug text-zinc-500">
                      기본은 모두 캐릭터 이름입니다. 다른 인물 대사만 이름을 바꿔 주세요.
                    </p>
                    <div className="flex flex-col gap-2">
                      {speakerDrafts.map((speaker, index) => (
                        <label
                          key={`speaker-${index}`}
                          className="flex flex-col gap-1 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2"
                        >
                          <span className="truncate text-[11px] text-zinc-500">
                            {dialoguePreviews[index] || `대사 ${index + 1}`}
                          </span>
                          <input
                            type="text"
                            value={speaker}
                            disabled={preview?.loading}
                            onChange={(e) => changeSpeakerDraft(index, e.target.value)}
                            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-violet-400"
                            aria-label={`화자 ${index + 1} 이름`}
                            maxLength={32}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div>
                  <p className="mb-1.5 text-xs font-bold text-zinc-900">글씨체</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {QUOTE_CARD_FONTS.map((font) => (
                      <button
                        key={font.id}
                        type="button"
                        disabled={preview?.loading}
                        onClick={() => changeFontId(font.id)}
                        className={`${chipBtn} ${
                          fontId === font.id ? chipActive : chipIdle
                        }`}
                        style={{ fontFamily: font.css }}
                      >
                        {font.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-1.5 text-xs font-bold text-zinc-900">배경색</p>
                  <div className="grid grid-cols-3 gap-2">
                    {QUOTE_CARD_THEMES.map((theme) => (
                      <button
                        key={theme.id}
                        type="button"
                        disabled={preview?.loading}
                        onClick={() => changeThemeId(theme.id)}
                        className={`${chipBtn} ${
                          themeId === theme.id ? chipActive : chipIdle
                        }`}
                      >
                        {theme.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => void onAvatarFile(e.target.files?.[0] ?? null)}
                  />
                  <input
                    ref={backgroundInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => void onBackgroundFile(e.target.files?.[0] ?? null)}
                  />
                  <button
                    type="button"
                    disabled={preview?.loading}
                    onClick={() => avatarInputRef.current?.click()}
                    className={`${chipBtn} ${chipIdle}`}
                  >
                    {hasAvatar ? "캐릭터 사진 변경" : "캐릭터 사진"}
                  </button>
                  <button
                    type="button"
                    disabled={preview?.loading}
                    onClick={() => backgroundInputRef.current?.click()}
                    className={`${chipBtn} ${chipIdle}`}
                  >
                    {hasBackground ? "배경 변경" : "배경 이미지"}
                  </button>
                  {hasBackground ? (
                    <button
                      type="button"
                      disabled={preview?.loading}
                      onClick={clearBackground}
                      className={`${chipBtn} border-zinc-300 bg-zinc-100 text-zinc-800`}
                    >
                      배경 지우기
                    </button>
                  ) : null}
                </div>

                {hasAvatar && avatarUrl && avatarNatural && dialogueStyle === "bubble" ? (
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5">
                    <p className="mb-1.5 text-xs font-bold text-zinc-900">캐릭터 사진 위치</p>
                    <p className="mb-2 text-[11px] leading-snug text-zinc-500">
                      원을 드래그해 얼굴을 가운데에 맞추고, 확대로 크기를 조절하세요.
                    </p>
                    <div className="flex items-center gap-3">
                      <div
                        role="presentation"
                        className="relative shrink-0 touch-none overflow-hidden rounded-full border border-zinc-300 bg-zinc-200"
                        style={{
                          width: AVATAR_PREVIEW_SIZE,
                          height: AVATAR_PREVIEW_SIZE,
                          touchAction: "none",
                          cursor: preview?.loading ? "default" : "grab",
                        }}
                        onPointerDown={onAvatarPanPointerDown}
                        onPointerMove={onAvatarPanPointerMove}
                        onPointerUp={onAvatarPanPointerUp}
                        onPointerCancel={onAvatarPanPointerUp}
                        aria-label="캐릭터 사진 위치 조절"
                      >
                        <img
                          src={avatarUrl}
                          alt=""
                          draggable={false}
                          className="pointer-events-none absolute max-w-none select-none"
                          style={avatarPreviewDrawRect(
                            avatarNatural,
                            avatarFocus,
                            AVATAR_PREVIEW_SIZE
                          )}
                        />
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col gap-2">
                        <label className="flex items-center gap-2 text-sm text-zinc-700">
                          <span className="shrink-0 font-semibold text-zinc-900">확대</span>
                          <input
                            type="range"
                            min={1}
                            max={2.5}
                            step={0.05}
                            value={avatarFocus.zoom ?? 1}
                            disabled={preview?.loading}
                            onChange={(e) =>
                              applyAvatarFocus({ zoom: Number(e.target.value) }, 60)
                            }
                            className="h-2 w-full accent-violet-600"
                            aria-label="캐릭터 사진 확대"
                          />
                        </label>
                        <button
                          type="button"
                          disabled={preview?.loading}
                          onClick={() =>
                            applyAvatarFocus({ ...QUOTE_CARD_AVATAR_FOCUS_DEFAULT }, 0)
                          }
                          className={`${chipBtn} ${chipIdle} self-start`}
                        >
                          위치 초기화
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="flex justify-center bg-zinc-100 px-3 py-3">
                {preview?.loading ? (
                  <div className="flex h-[42vh] max-h-[320px] w-full max-w-full items-center justify-center rounded-xl border border-zinc-300 bg-white">
                    <p className="text-sm font-medium text-zinc-600">미리보기 생성 중…</p>
                  </div>
                ) : preview?.blobUrl ? (
                  <img
                    src={preview.blobUrl}
                    alt="발췌 카드 미리보기"
                    className="block max-h-[42vh] w-auto max-w-full rounded-xl border border-zinc-300 object-contain shadow-md"
                  />
                ) : null}
              </div>
            </div>

            <div className="flex shrink-0 flex-col gap-2 border-t border-zinc-200 bg-white px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              <button
                type="button"
                disabled={busy || preview?.loading}
                onClick={() => exportCard("copy")}
                className="min-h-11 w-full rounded-lg border-2 border-zinc-400 bg-white px-4 py-2.5 text-sm font-bold text-zinc-950 transition hover:bg-zinc-50 disabled:opacity-60 sm:w-auto"
              >
                이미지 복사
              </button>
              {canNativeShare ? (
                <button
                  type="button"
                  disabled={busy || preview?.loading}
                  onClick={() => exportCard("share")}
                  className="min-h-11 w-full rounded-lg border-2 border-zinc-400 bg-white px-4 py-2.5 text-sm font-bold text-zinc-950 transition hover:bg-zinc-50 disabled:opacity-60 sm:w-auto"
                >
                  공유
                </button>
              ) : null}
              <button
                type="button"
                disabled={busy || preview?.loading}
                onClick={() => exportCard("save")}
                className="min-h-11 w-full rounded-lg border-2 border-violet-400 bg-violet-600 px-5 py-2.5 text-sm font-bold text-white shadow-md transition hover:bg-violet-500 disabled:opacity-60 sm:w-auto"
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
