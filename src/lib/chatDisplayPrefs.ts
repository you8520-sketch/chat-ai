import type { CSSProperties } from "react";

export const STREAM_INTERVAL_MIN = 0;
export const STREAM_INTERVAL_MAX = 65;

export const CHAT_STREAM_SPEED_PRESETS = [
  { intervalMs: 0, label: "즉시" },
  { intervalMs: 35, label: "빠름" },
  { intervalMs: 50, label: "보통" },
  { intervalMs: 65, label: "느림" },
] as const;

/**
 * Previous 즉시/빠름/보통/느림 millisecond values.
 * Map by label intent before nearest-ms — old 60 (보통) is closer to 65 (느림).
 */
export const LEGACY_CHAT_STREAM_INTERVAL_MS: Record<number, number> = {
  0: 0,
  20: 35,
  60: 50,
  100: 65,
};

export type ChatFontSizePreset = "small" | "medium" | "large" | "xlarge";
export type ChatParagraphSpacingPreset = "tight" | "normal" | "relaxed" | "loose";

export const CHAT_FONT_SIZE_PRESETS: {
  id: ChatFontSizePreset;
  label: string;
  scale: number;
}[] = [
  { id: "small", label: "작게", scale: 0.875 },
  { id: "medium", label: "보통", scale: 1 },
  { id: "large", label: "크게", scale: 1.125 },
  { id: "xlarge", label: "아주 크게", scale: 1.25 },
];

export const CHAT_PARAGRAPH_SPACING_PRESETS: {
  id: ChatParagraphSpacingPreset;
  label: string;
  scale: number;
}[] = [
  { id: "tight", label: "좁게", scale: 0.7 },
  { id: "normal", label: "보통", scale: 1 },
  { id: "relaxed", label: "넓게", scale: 1.35 },
  { id: "loose", label: "아주 넓게", scale: 1.7 },
];

export type ChatDisplayPrefs = {
  streamIntervalMs: number;
  streamCharsPerTick: number;
  fontFamily: string;
  /** @deprecated fontSizePreset 사용 */
  fontSizePx?: number;
  fontSizePreset: ChatFontSizePreset;
  /** NovelText 문단 간격 배율 */
  paragraphSpacingPreset: ChatParagraphSpacingPreset;
  narrationColor: string;
  dialogueColor: string;
  userNarrationColor: string;
  userDialogueColor: string;
  /** 캐릭터 답변 왼쪽 초상 표시 */
  showCharacterPortrait: boolean;
  /** AI 답변 후 유저 추천 메시지 3갈래 */
  showSuggestedReplies: boolean;
  portraitBackgroundOpacity: number;
};

/** 검은 채팅 배경에서 홈페이지 보라 테마와 충분한 대비를 내는 캐릭터 대사색. */
export const DEFAULT_CHARACTER_DIALOGUE_COLOR = "#c4b5fd";
export const LEGACY_CHARACTER_DIALOGUE_COLOR = "#fb923c";

export const DEFAULT_CHAT_DISPLAY_PREFS: ChatDisplayPrefs = {
  streamIntervalMs: 35,
  streamCharsPerTick: 1,
  fontFamily: "system",
  fontSizePreset: "medium",
  paragraphSpacingPreset: "normal",
  narrationColor: "#fafafa",
  dialogueColor: DEFAULT_CHARACTER_DIALOGUE_COLOR,
  userNarrationColor: "#d4d4d8",
  userDialogueColor: "#e4e4e7",
  showCharacterPortrait: true,
  showSuggestedReplies: true,
  portraitBackgroundOpacity: 0.22,
};

/** #RRGGBB — relative luminance 0..1 */
function hexLuminance(hex: string): number | null {
  const h = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const channels = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

/** 너무 어두운 저장값 — 기본 밝은 지문색으로 보정 */
export function normalizeReadableTextColor(color: unknown, fallback: string): string {
  if (typeof color !== "string") return fallback;
  const trimmed = color.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(trimmed)) return fallback;
  const lum = hexLuminance(trimmed);
  if (lum == null || lum < 0.62) return fallback;
  return trimmed;
}

/** 이전 기본 주황색만 새 테마색으로 이전하고 사용자가 고른 색상은 유지합니다. */
export function normalizeCharacterDialogueColor(color: unknown): string {
  if (typeof color !== "string") return DEFAULT_CHARACTER_DIALOGUE_COLOR;
  const trimmed = color.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(trimmed)) return DEFAULT_CHARACTER_DIALOGUE_COLOR;
  return trimmed.toLowerCase() === LEGACY_CHARACTER_DIALOGUE_COLOR
    ? DEFAULT_CHARACTER_DIALOGUE_COLOR
    : trimmed;
}

/** Includes quote-card (텍스트 이미지 저장) faces so chat settings stay aligned. */
export const CHAT_FONT_OPTIONS = [
  {
    id: "system",
    label: "시스템 기본",
    css: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    loadName: "system-ui",
    google: null as string | null,
  },
  {
    id: "sans",
    label: "고딕",
    css: "'Pretendard', 'Noto Sans KR', sans-serif",
    loadName: "Pretendard",
    google: null as string | null,
  },
  {
    id: "noto-serif",
    label: "노토 명조",
    css: '"Noto Serif KR", "Apple SD Gothic Neo", serif',
    loadName: "Noto Serif KR",
    google: "Noto+Serif+KR:wght@400;500;600",
  },
  {
    id: "nanum-myeongjo",
    label: "나눔명조",
    css: '"Nanum Myeongjo", "Apple SD Gothic Neo", serif',
    loadName: "Nanum Myeongjo",
    google: "Nanum+Myeongjo:wght@400;700",
  },
  {
    id: "gowun-batang",
    label: "고운바탕",
    css: '"Gowun Batang", "Apple SD Gothic Neo", serif',
    loadName: "Gowun Batang",
    google: "Gowun+Batang:wght@400;700",
  },
  {
    id: "song-myung",
    label: "송명",
    css: '"Song Myung", "Apple SD Gothic Neo", serif',
    loadName: "Song Myung",
    google: "Song+Myung",
  },
  {
    id: "serif",
    label: "명조",
    css: "'Noto Serif KR', 'Nanum Myeongjo', serif",
    loadName: "Noto Serif KR",
    google: "Noto+Serif+KR:wght@400;500;600",
  },
  {
    id: "mono",
    label: "고정폭",
    css: "'Pretendard', ui-monospace, monospace",
    loadName: "ui-monospace",
    google: null as string | null,
  },
] as const;

const STORAGE_KEY = "playai-chat-display-prefs";

export function formatStreamIntervalLabel(ms: number): string {
  const normalized = normalizeStreamIntervalMs(ms);
  return (
    CHAT_STREAM_SPEED_PRESETS.find((preset) => preset.intervalMs === normalized)?.label ??
    "빠름"
  );
}

export function normalizeStreamIntervalMs(value: unknown): number {
  const fallback = DEFAULT_CHAT_DISPLAY_PREFS.streamIntervalMs;
  const n = typeof value === "number" && !Number.isNaN(value) ? value : fallback;
  const legacy = LEGACY_CHAT_STREAM_INTERVAL_MS[n];
  if (legacy != null) return legacy;
  const exact = CHAT_STREAM_SPEED_PRESETS.find((preset) => preset.intervalMs === n);
  if (exact) return exact.intervalMs;
  const clamped = Math.min(STREAM_INTERVAL_MAX, Math.max(STREAM_INTERVAL_MIN, n));
  return CHAT_STREAM_SPEED_PRESETS.reduce<number>(
    (closest, preset) =>
      Math.abs(preset.intervalMs - clamped) < Math.abs(closest - clamped)
        ? preset.intervalMs
        : closest,
    fallback
  );
}

export function streamCharsPerTickForInterval(intervalMs: number): number {
  return intervalMs <= STREAM_INTERVAL_MIN ? 64 : 1;
}

export function withStreamSpeed(
  prefs: ChatDisplayPrefs,
  streamIntervalMs: number
): ChatDisplayPrefs {
  const ms = normalizeStreamIntervalMs(streamIntervalMs);
  return {
    ...prefs,
    streamIntervalMs: ms,
    streamCharsPerTick: streamCharsPerTickForInterval(ms),
  };
}

export function fontFamilyCss(id: string): string {
  return CHAT_FONT_OPTIONS.find((f) => f.id === id)?.css ?? CHAT_FONT_OPTIONS[0].css;
}

export function normalizeChatFontFamily(value: unknown): string {
  if (typeof value === "string" && CHAT_FONT_OPTIONS.some((f) => f.id === value)) {
    return value;
  }
  return DEFAULT_CHAT_DISPLAY_PREFS.fontFamily;
}

export function normalizeFontSizePreset(value: unknown): ChatFontSizePreset {
  if (value === "small" || value === "medium" || value === "large" || value === "xlarge") {
    return value;
  }
  return "medium";
}

export function normalizeParagraphSpacingPreset(value: unknown): ChatParagraphSpacingPreset {
  if (value === "tight" || value === "normal" || value === "relaxed" || value === "loose") {
    return value;
  }
  return "normal";
}

export function paragraphSpacingPresetScale(preset: ChatParagraphSpacingPreset): number {
  return CHAT_PARAGRAPH_SPACING_PRESETS.find((p) => p.id === preset)?.scale ?? 1;
}

export function paragraphSpacingPresetLabel(preset: ChatParagraphSpacingPreset): string {
  return CHAT_PARAGRAPH_SPACING_PRESETS.find((p) => p.id === preset)?.label ?? "보통";
}

export function paragraphSpacingPresetIndex(preset: ChatParagraphSpacingPreset): number {
  const idx = CHAT_PARAGRAPH_SPACING_PRESETS.findIndex((p) => p.id === preset);
  return idx >= 0 ? idx : 1;
}

export function paragraphSpacingPresetFromIndex(index: number): ChatParagraphSpacingPreset {
  return (
    CHAT_PARAGRAPH_SPACING_PRESETS[
      Math.min(CHAT_PARAGRAPH_SPACING_PRESETS.length - 1, Math.max(0, index))
    ]?.id ?? "normal"
  );
}

let chatDisplayFontsPromise: Promise<void> | null = null;

/** Load Google faces used by chat font options (same set as quote-card image save). */
export function ensureChatDisplayWebFontsLoaded(): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  if (chatDisplayFontsPromise) return chatDisplayFontsPromise;
  chatDisplayFontsPromise = (async () => {
    const google = CHAT_FONT_OPTIONS.map((f) => f.google).filter(Boolean) as string[];
    const unique = [...new Set(google)];
    if (unique.length > 0) {
      const id = "chat-display-google-fonts";
      if (!document.getElementById(id)) {
        const link = document.createElement("link");
        link.id = id;
        link.rel = "stylesheet";
        link.href = `https://fonts.googleapis.com/css2?${unique
          .map((f) => `family=${f}`)
          .join("&")}&display=swap`;
        document.head.appendChild(link);
      }
    }
    if (document.fonts?.ready) await document.fonts.ready;
  })();
  return chatDisplayFontsPromise;
}

export function fontSizePresetFromLegacyPx(px: number): ChatFontSizePreset {
  if (px <= 13) return "small";
  if (px <= 16) return "medium";
  if (px <= 19) return "large";
  return "xlarge";
}

export function fontSizePresetScale(preset: ChatFontSizePreset): number {
  return CHAT_FONT_SIZE_PRESETS.find((p) => p.id === preset)?.scale ?? 1;
}

export function fontSizePresetLabel(preset: ChatFontSizePreset): string {
  return CHAT_FONT_SIZE_PRESETS.find((p) => p.id === preset)?.label ?? "보통";
}

export function fontSizePresetIndex(preset: ChatFontSizePreset): number {
  const idx = CHAT_FONT_SIZE_PRESETS.findIndex((p) => p.id === preset);
  return idx >= 0 ? idx : 1;
}

export function fontSizePresetFromIndex(index: number): ChatFontSizePreset {
  return CHAT_FONT_SIZE_PRESETS[Math.min(CHAT_FONT_SIZE_PRESETS.length - 1, Math.max(0, index))]?.id ?? "medium";
}

/** --font-size-chat-base(반응형) × 프리셋 배율 + 비례 line-height + 문단 간격 */
export function chatReadabilityStyle(
  prefs: Pick<ChatDisplayPrefs, "fontSizePreset" | "fontFamily" | "paragraphSpacingPreset">
): CSSProperties {
  const scale = fontSizePresetScale(prefs.fontSizePreset);
  const lineBoost = (scale - 1) * 0.35;
  const paragraphGapScale = paragraphSpacingPresetScale(prefs.paragraphSpacingPreset);
  return {
    fontFamily: fontFamilyCss(prefs.fontFamily),
    ["--font-size-chat-scale" as string]: String(scale),
    ["--font-size-chat" as string]: `calc(var(--font-size-chat-base) * ${scale})`,
    ["--line-height-chat" as string]: `calc(var(--line-height-chat-base) + ${lineBoost})`,
    ["--chat-paragraph-gap-scale" as string]: String(paragraphGapScale),
  };
}

export function chatReadabilityRootStyle(
  prefs: Pick<
    ChatDisplayPrefs,
    "fontSizePreset" | "fontFamily" | "paragraphSpacingPreset" | "narrationColor"
  >
): CSSProperties {
  return {
    ...chatReadabilityStyle(prefs),
    ["--chat-narration-color" as string]: prefs.narrationColor,
  };
}

export function normalizeShowCharacterPortrait(value: unknown): boolean {
  return value !== false;
}

export function normalizeShowSuggestedReplies(value: unknown): boolean {
  return value !== false;
}

export function normalizePortraitBackgroundOpacity(value: unknown): number {
  const n =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : DEFAULT_CHAT_DISPLAY_PREFS.portraitBackgroundOpacity;
  return Math.min(1, Math.max(0, n));
}

export function loadChatDisplayPrefs(): ChatDisplayPrefs {
  if (typeof window === "undefined") return DEFAULT_CHAT_DISPLAY_PREFS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CHAT_DISPLAY_PREFS;
    const parsed = JSON.parse(raw) as Partial<ChatDisplayPrefs>;
    const streamIntervalMs = normalizeStreamIntervalMs(parsed.streamIntervalMs);
    const fontSizePreset = parsed.fontSizePreset
      ? normalizeFontSizePreset(parsed.fontSizePreset)
      : fontSizePresetFromLegacyPx(
          typeof parsed.fontSizePx === "number" ? parsed.fontSizePx : 15
        );
    const next: ChatDisplayPrefs = {
      ...DEFAULT_CHAT_DISPLAY_PREFS,
      ...parsed,
      streamIntervalMs,
      streamCharsPerTick: streamCharsPerTickForInterval(streamIntervalMs),
      fontFamily: normalizeChatFontFamily(parsed.fontFamily),
      fontSizePreset,
      paragraphSpacingPreset: normalizeParagraphSpacingPreset(parsed.paragraphSpacingPreset),
      narrationColor: normalizeReadableTextColor(
        parsed.narrationColor,
        DEFAULT_CHAT_DISPLAY_PREFS.narrationColor
      ),
      dialogueColor: normalizeCharacterDialogueColor(parsed.dialogueColor),
      userNarrationColor: normalizeReadableTextColor(
        parsed.userNarrationColor,
        DEFAULT_CHAT_DISPLAY_PREFS.userNarrationColor
      ),
      showCharacterPortrait: normalizeShowCharacterPortrait(parsed.showCharacterPortrait),
      showSuggestedReplies: normalizeShowSuggestedReplies(parsed.showSuggestedReplies),
      portraitBackgroundOpacity: normalizePortraitBackgroundOpacity(
        parsed.portraitBackgroundOpacity
      ),
    };
    if (parsed.streamIntervalMs !== streamIntervalMs) {
      saveChatDisplayPrefs(next);
    }
    return next;
  } catch {
    return DEFAULT_CHAT_DISPLAY_PREFS;
  }
}

export function saveChatDisplayPrefs(prefs: ChatDisplayPrefs) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

/**
 * Device display prefs: localStorage wins when present so toggles (에셋 ON/OFF 등)
 * survive leaving/re-entering a chat room. When empty, seed from server prefs.
 */
export function resolveClientDisplayPrefs(
  serverPrefs?: ChatDisplayPrefs | null
): ChatDisplayPrefs {
  if (typeof window === "undefined") {
    return serverPrefs ?? DEFAULT_CHAT_DISPLAY_PREFS;
  }
  try {
    if (localStorage.getItem(STORAGE_KEY)) {
      return loadChatDisplayPrefs();
    }
  } catch {
    /* ignore */
  }
  const source = serverPrefs ?? DEFAULT_CHAT_DISPLAY_PREFS;
  const next = {
    ...source,
    dialogueColor: normalizeCharacterDialogueColor(source.dialogueColor),
  };
  saveChatDisplayPrefs(next);
  return next;
}

/** Chat-room desktop chrome (left/right rails, sticky name/album). Narrower than Tailwind sm/md. */
export const CHAT_DESKTOP_MIN_WIDTH_PX = 576;
export const CHAT_DESKTOP_MEDIA_QUERY = `(min-width: ${CHAT_DESKTOP_MIN_WIDTH_PX}px)`;
/** Tailwind arbitrary variant for chat desktop layout */
export const CHAT_DESKTOP = "min-[576px]" as const;

/** 채팅 좌측 에셋 열 — 2:3 비율 이미지 너비(auto) */
export const CHAT_PORTRAIT_COLUMN_WIDTH_CLASS = "w-auto shrink-0";

/** 글로벌 Header(sticky top-0) 높이 — 채팅 설정 레일 등 (사이드바는 ResizeObserver로 실측) */
export const CHAT_GLOBAL_HEADER_OFFSET_CLASS = "top-[92px]";

/** 채팅방 Header — 탭 행 숨김, 공지·유저 바만 (md+). 모바일은 글로벌 헤더 숨김 */
export const CHAT_ROOM_HEADER_OFFSET_CLASS =
  "top-0 min-[576px]:top-[calc(var(--site-header-height,44px)+3.25rem)]";

export function isChatRoomPathname(pathname: string): boolean {
  return /^\/chat\/\d+/.test(pathname);
}

/** Desktop compact left rail: regular chat rooms and TRPG campaign rooms. */
export function isCompactRoomPathname(pathname: string): boolean {
  return isChatRoomPathname(pathname) || /^\/trpg\/\d+/.test(pathname);
}

/** 채팅방 — 모바일: 뒤로+프로필 / 메뉴 · chat desktop+: 제목 바 숨김 */
export const CHAT_ROOM_TITLE_BAR_CLASS =
  "chat-room-mobile-title-bar fixed inset-x-0 top-0 z-50 shrink-0 border-b border-white/5 bg-[#121212]/95 px-2 py-2 backdrop-blur min-[576px]:px-0 min-[576px]:hidden";

/** 제목 바 아래부터 초상 시작 (모바일 헤더 없음 ≈ 2.75rem, md+ ≈ 5.25rem) */
export const CHAT_PORTRAIT_TITLE_STACK_REM = "2.75rem";
export const CHAT_PORTRAIT_TITLE_STACK_MD_REM = "5.25rem";

/** PC portrait rail / frame height — definite calc (not %), drives intrinsic width via aspect-ratio. */
export const CHAT_PORTRAIT_RAIL_HEIGHT =
  "calc(100dvh - var(--site-header-height, 44px) - 3.25rem)";

/** 에셋 패널 높이 — 제목 아래부터 뷰포트 하단(입력창 sticky bottom과 동일 선) */
export const CHAT_PORTRAIT_PANEL_HEIGHT = `calc(100dvh - ${CHAT_PORTRAIT_TITLE_STACK_MD_REM})`;

/** 채팅 입력창 하단 안내문 위쪽에 맞춰 좌측 에셋이 화면 바닥까지 꽉 차지 않도록 남기는 여백 */
export const CHAT_PORTRAIT_INPUT_HELPER_GAP_REM = "1.75rem";

/** Desktop portrait+chat — flex row; portrait column w-max owns intrinsic width. */
export const CHAT_PORTRAIT_DESKTOP_TRACK_CLASS =
  "min-[576px]:flex min-[576px]:flex-row min-[576px]:items-start min-[576px]:gap-x-6";

/** Left column — name header + portrait panel. */
export const CHAT_PORTRAIT_COLUMN_CLASS =
  "chat-room-portrait-column hidden min-[576px]:flex min-[576px]:w-max min-[576px]:shrink-0 min-[576px]:flex-col min-[576px]:self-start";

/** Right column — chat header band + messages. */
export const CHAT_PORTRAIT_CHAT_COLUMN_CLASS =
  "chat-room-portrait-chat-column flex min-h-0 min-w-0 w-full flex-1 flex-col min-[576px]:max-w-[780px]";

/**
 * PC portrait panel max width — set on `.chat-room-portrait-grid` as `--chat-portrait-max-w`.
 * Frame uses `max-w-[var(--chat-portrait-max-w)]`; when exceeded, aspect-ratio box scales down.
 */
export const CHAT_PORTRAIT_PANEL_MAX_WIDTH_CLASS = "max-w-[var(--chat-portrait-max-w)]";

/** PC portrait panel shell — rail height is definite; image sits bottom-aligned in column. */
export const CHAT_PORTRAIT_PANEL_SHELL_CLASS =
  "flex h-full w-max min-h-0 items-end justify-center overflow-hidden";

/** PC portrait frame — definite height calc + aspect-ratio; width is intrinsic for grid track. */
export const CHAT_PORTRAIT_PANEL_FRAME_CLASS =
  "relative shrink-0 overflow-hidden rounded-[18px] border border-white/[0.08] bg-[#08080c] shadow-lg shadow-black/10 transition hover:border-violet-400/35";

/** PC portrait img — fills frame; frame aspect matches asset so contain shows full image. */
export const CHAT_PORTRAIT_PANEL_IMG_CLASS = "block h-full w-full object-contain object-top";

export const CHAT_PORTRAIT_PANEL_IMG_ENHANCED_CLASS =
  `${CHAT_PORTRAIT_PANEL_IMG_CLASS} brightness-95 contrast-95`;

/** PC portrait empty-state column footprint (matches legacy ~400px track). */
export const CHAT_PORTRAIT_PANEL_PLACEHOLDER_CLASS =
  "flex h-full max-h-full w-auto max-w-[var(--chat-portrait-max-w)] shrink-0 items-center justify-center rounded-[18px] aspect-[3/4] min-w-[340px]";

/** 초상 ON — 좌: 에셋 / 우: 채팅+입력 */
export const CHAT_PORTRAIT_GRID_CLASS =
  `chat-room-portrait-grid mx-auto flex w-full max-w-[75.25rem] min-w-0 flex-1 flex-col ${CHAT_PORTRAIT_DESKTOP_TRACK_CLASS}`;

/**
 * Desktop sticky name/creator/album (portrait ON) — top of portrait column.
 */
export const CHAT_PORTRAIT_INFO_STICKY_CLASS =
  "chat-room-desktop-name-strip hidden min-[576px]:sticky min-[576px]:top-[var(--site-header-height,44px)] min-[576px]:z-30 min-[576px]:flex min-[576px]:h-[3.25rem] min-[576px]:w-full min-[576px]:shrink-0 min-[576px]:items-center min-[576px]:justify-between min-[576px]:gap-3 min-[576px]:border-b min-[576px]:border-white/5 min-[576px]:bg-[#121212]/95 min-[576px]:backdrop-blur";

/** Desktop header continuation over chat column. */
export const CHAT_PORTRAIT_INFO_HEADER_CHAT_CLASS =
  "chat-room-portrait-header-chat hidden min-[576px]:block min-[576px]:h-[3.25rem] min-[576px]:shrink-0 min-[576px]:border-b min-[576px]:border-white/5 min-[576px]:bg-[#121212]/95 min-[576px]:backdrop-blur";

/** @deprecated sticky strip is the subgrid row; children are direct grid items */
export const CHAT_PORTRAIT_INFO_STICKY_INNER_CLASS = "";

/**
 * Desktop sticky name/creator/album strip (portrait OFF) — same fixed top bar as
 * mobile intent: always visible above the chat column.
 */
export const CHAT_INFO_STICKY_NO_PORTRAIT_CLASS =
  "chat-room-desktop-name-strip chat-room-desktop-name-strip--row hidden min-[576px]:sticky min-[576px]:top-[var(--site-header-height,44px)] min-[576px]:z-30 min-[576px]:mx-auto min-[576px]:flex min-[576px]:h-[3.25rem] min-[576px]:w-full min-[576px]:max-w-[780px] min-[576px]:items-center min-[576px]:justify-between min-[576px]:gap-3 min-[576px]:border-b min-[576px]:border-white/5 min-[576px]:bg-[#121212]/95 min-[576px]:pl-0 min-[576px]:pr-1 min-[576px]:backdrop-blur";

/** 초상 열 sticky — 모바일 채팅은 글로벌 헤더 없음(제목만), chat desktop+: 에셋 열 */
export const CHAT_PORTRAIT_STICKY_CLASS =
  "chat-room-portrait-rail hidden min-[576px]:flex min-[576px]:h-[var(--chat-portrait-rail-h)] min-[576px]:w-max min-[576px]:flex-col min-[576px]:items-start min-[576px]:justify-end min-[576px]:self-start";

/** @deprecated CHAT_PORTRAIT_PANEL_HEIGHT + 인라인 height 사용 */
export const CHAT_PORTRAIT_VIEWPORT_MIN_H_CLASS = "";

/**
 * 채팅 본문 열 — 이미지와 같은 시작 높이.
 * Mobile must NOT use overflow-hidden/auto: that creates a sticky containing block
 * so the composer scrolls away with the message list. Clip X only if needed.
 */
export const CHAT_MESSAGES_COLUMN_CLASS =
  "chat-room-messages-column relative flex min-w-0 flex-1 flex-col overflow-x-clip";

/** Mobile portrait background is pinned to the stable viewport, never the growing message list. */
export const CHAT_MOBILE_PORTRAIT_BACKGROUND_CLASS =
  "chat-room-mobile-portrait-bg pointer-events-none fixed inset-x-0 top-0 z-0 h-[100svh] w-[100svw] select-none overflow-hidden bg-[#121212] min-[576px]:hidden";

/** Keep crop geometry invariant while streaming; only the image opacity may change. */
export const CHAT_MOBILE_PORTRAIT_IMAGE_CLASS =
  "block h-full w-full select-none object-cover object-top opacity-[var(--mobile-portrait-opacity)]";

/** 초상 OFF — 메시지+입력 열 (본문을 입력창 위로 밀어 붙임) */
export const CHAT_MESSAGES_COLUMN_NO_PORTRAIT_CLASS =
  "mx-auto flex min-h-0 w-full max-w-[780px] min-w-0 flex-1 flex-col";

/** 초상 OFF — 본문 래퍼 (하단 정렬, 입력창과 여백 최소) */
export const CHAT_MESSAGES_BODY_NO_PORTRAIT_CLASS =
  "flex min-h-0 flex-1 flex-col justify-end bg-[#121212] px-2 pt-1 pb-0 min-[576px]:px-0";

/** 초상 OFF — 메시지 목록 간격 */
export const CHAT_MESSAGES_LIST_NO_PORTRAIT_CLASS =
  "min-w-0 space-y-1 pb-12 min-[576px]:pb-0";

/** 초상 OFF — 입력창 (본문과 간격 최소). 채팅방에서는 하단 네비 숨김 → bottom-0. */
export const CHAT_INPUT_DOCK_NO_PORTRAIT_CLASS =
  "sticky bottom-0 z-20 shrink-0 border-t border-white/5 bg-[#121212]/95 px-2 pt-0 pb-[max(0.375rem,env(safe-area-inset-bottom))] backdrop-blur min-[576px]:-mt-1 min-[576px]:px-0 min-[576px]:pb-1.5";

/** @deprecated 초상 그리드 레이아웃에서 미사용 */
export const CHAT_CONTENT_ROW_TOP_PAD_CLASS = "";

/** 채팅 본문 영역 — 가로는 main/창 너비에 맞춤 */
export function chatMessageAreaLayoutClass(_showCharacterPortrait?: boolean): string {
  return "mx-auto w-full max-w-[820px] min-w-0";
}
