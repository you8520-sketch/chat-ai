import type { CSSProperties } from "react";

export const STREAM_INTERVAL_MIN = 0;
export const STREAM_INTERVAL_MAX = 100;
export const STREAM_INTERVAL_STEP = 20;

export type ChatFontSizePreset = "small" | "medium" | "large" | "xlarge";

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

export type ChatDisplayPrefs = {
  streamIntervalMs: number;
  streamCharsPerTick: number;
  fontFamily: string;
  /** @deprecated fontSizePreset 사용 */
  fontSizePx?: number;
  fontSizePreset: ChatFontSizePreset;
  narrationColor: string;
  dialogueColor: string;
  userNarrationColor: string;
  userDialogueColor: string;
  /** 캐릭터 답변 왼쪽 초상 표시 */
  showCharacterPortrait: boolean;
};

export const DEFAULT_CHAT_DISPLAY_PREFS: ChatDisplayPrefs = {
  streamIntervalMs: 0,
  streamCharsPerTick: 1,
  fontFamily: "system",
  fontSizePreset: "medium",
  narrationColor: "#f4f4f5",
  dialogueColor: "#fb923c",
  userNarrationColor: "#a1a1aa",
  userDialogueColor: "#e4e4e7",
  showCharacterPortrait: true,
};

export const CHAT_FONT_OPTIONS = [
  { id: "system", label: "시스템 기본", css: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
  { id: "sans", label: "고딕", css: "'Pretendard', 'Noto Sans KR', sans-serif" },
  { id: "serif", label: "명조", css: "'Noto Serif KR', 'Nanum Myeongjo', serif" },
  { id: "mono", label: "고정폭", css: "'Pretendard', ui-monospace, monospace" },
] as const;

const STORAGE_KEY = "playai-chat-display-prefs";

export function formatStreamIntervalLabel(ms: number): string {
  return ms <= STREAM_INTERVAL_MIN ? "즉시" : `${ms}ms`;
}

export function normalizeStreamIntervalMs(value: unknown): number {
  const n = typeof value === "number" && !Number.isNaN(value) ? value : DEFAULT_CHAT_DISPLAY_PREFS.streamIntervalMs;
  const clamped = Math.min(STREAM_INTERVAL_MAX, Math.max(STREAM_INTERVAL_MIN, n));
  const stepped =
    Math.round((clamped - STREAM_INTERVAL_MIN) / STREAM_INTERVAL_STEP) * STREAM_INTERVAL_STEP +
    STREAM_INTERVAL_MIN;
  return Math.min(STREAM_INTERVAL_MAX, stepped);
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

export function normalizeFontSizePreset(value: unknown): ChatFontSizePreset {
  if (value === "small" || value === "medium" || value === "large" || value === "xlarge") {
    return value;
  }
  return "medium";
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

/** --font-size-chat-base(반응형) × 프리셋 배율 + 비례 line-height */
export function chatReadabilityStyle(
  prefs: Pick<ChatDisplayPrefs, "fontSizePreset" | "fontFamily">
): CSSProperties {
  const scale = fontSizePresetScale(prefs.fontSizePreset);
  const lineBoost = (scale - 1) * 0.35;
  return {
    fontFamily: fontFamilyCss(prefs.fontFamily),
    ["--font-size-chat-scale" as string]: String(scale),
    ["--font-size-chat" as string]: `calc(var(--font-size-chat-base) * ${scale})`,
    ["--line-height-chat" as string]: `calc(var(--line-height-chat-base) + ${lineBoost})`,
  };
}

export function normalizeShowCharacterPortrait(value: unknown): boolean {
  return value !== false;
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
    return {
      ...DEFAULT_CHAT_DISPLAY_PREFS,
      ...parsed,
      streamIntervalMs,
      streamCharsPerTick: streamCharsPerTickForInterval(streamIntervalMs),
      fontSizePreset,
      showCharacterPortrait: normalizeShowCharacterPortrait(parsed.showCharacterPortrait),
    };
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

/** 채팅 좌측 에셋 열 — 2:3 비율 이미지 너비(auto) */
export const CHAT_PORTRAIT_COLUMN_WIDTH_CLASS = "w-auto shrink-0";

/** 글로벌 Header(sticky top-0) 높이 — Sidebar·설정 레일 (탭 행 포함) */
export const CHAT_GLOBAL_HEADER_OFFSET_CLASS = "top-[92px]";

/** 채팅방 Header — 탭 행 숨김, 공지·유저 바만 */
export const CHAT_ROOM_HEADER_OFFSET_CLASS = "top-11";

export function isChatRoomPathname(pathname: string): boolean {
  return /^\/chat\/\d+/.test(pathname);
}

/** 채팅방 — 캐릭터(시뮬)명·제작자 (항상 좌상단) */
export const CHAT_ROOM_TITLE_BAR_CLASS =
  "sticky top-11 z-30 shrink-0 border-b border-white/5 bg-[#121212] px-2 py-2 pl-3 sm:pl-2 sm:pr-1";

/** 제목 바( top-11 + room title ) 아래부터 초상 시작 */
export const CHAT_PORTRAIT_TITLE_STACK_REM = "5.25rem";

/** 에셋 패널 높이 — 제목 아래부터 뷰포트 하단(입력창 sticky bottom과 동일 선) */
export const CHAT_PORTRAIT_PANEL_HEIGHT = `calc(100dvh - ${CHAT_PORTRAIT_TITLE_STACK_REM})`;

/** 초상 ON — 좌: 에셋 / 우: 채팅+입력 */
export const CHAT_PORTRAIT_GRID_CLASS =
  "grid min-w-0 flex-1 items-start gap-x-1.5 sm:gap-x-2 grid-cols-[auto_minmax(0,1fr)]";

/** 초상 열 sticky — 하단=입력창 하단(뷰포트 bottom) */
export const CHAT_PORTRAIT_STICKY_CLASS =
  "col-start-1 row-start-1 sticky top-[calc(2.75rem+2.5rem)] z-20 flex w-full flex-col justify-end self-start";

/** @deprecated CHAT_PORTRAIT_PANEL_HEIGHT + 인라인 height 사용 */
export const CHAT_PORTRAIT_VIEWPORT_MIN_H_CLASS = "";

/** 채팅 본문 열 — 이미지와 같은 시작 높이 */
export const CHAT_MESSAGES_COLUMN_CLASS = "col-start-2 row-start-1 flex min-w-0 flex-col";

/** 초상 OFF — 메시지+입력 열 (본문을 입력창 위로 밀어 붙임) */
export const CHAT_MESSAGES_COLUMN_NO_PORTRAIT_CLASS =
  "flex min-h-[calc(100dvh-5.25rem)] min-w-0 flex-1 flex-col sm:min-h-[calc(100dvh-5rem)]";

/** 초상 OFF — 본문 래퍼 (하단 정렬, 입력창과 여백 최소) */
export const CHAT_MESSAGES_BODY_NO_PORTRAIT_CLASS =
  "flex min-h-0 flex-1 flex-col justify-end bg-[#121212] px-2 pl-3 sm:pl-2 sm:pr-1 pt-1 pb-0";

/** 초상 OFF — 메시지 목록 간격 */
export const CHAT_MESSAGES_LIST_NO_PORTRAIT_CLASS = "min-w-0 space-y-1";

/** 초상 OFF — 입력창 (본문과 간격 최소) */
export const CHAT_INPUT_DOCK_NO_PORTRAIT_CLASS =
  "sticky bottom-0 z-10 shrink-0 border-t border-white/5 bg-[#121212] px-2 pl-3 sm:pl-2 sm:pr-1 pt-1 pb-1.5";

/** @deprecated 초상 그리드 레이아웃에서 미사용 */
export const CHAT_CONTENT_ROW_TOP_PAD_CLASS = "";

/** 채팅 본문 영역 — 가로는 main/창 너비에 맞춤 */
export function chatMessageAreaLayoutClass(_showCharacterPortrait?: boolean): string {
  return "w-full min-w-0";
}
