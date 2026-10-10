/**
 * Phase D-2 — 최근 활동의 캐릭터 채팅방 → 기존 채팅방 reveal (순수 로직).
 * 시각·lifecycle owner는 기존 `MenuTransitionHost`이고, 이 모듈은 식별·도착 판정·레이아웃·타이밍만 계산한다.
 * navigation(href·세션 결정·권한·redirect)은 건드리지 않는다.
 */

import type { RevealRect } from "@/lib/characterReveal";
import { MENU_TRANSITION_TIMING } from "@/lib/menuTransitionSpec";

export type ChatRoomRef = { characterId: number; chatId: number };

/** 최근 활동 행(Link)에 붙는 마커. 값은 캐릭터 id. 성인 가림·/verify 행에는 붙지 않는다. */
export const CHAT_RESUME_ATTR = "data-chat-resume";
export const CHAT_RESUME_CHAT_ATTR = "data-chat-resume-chat";
/** 오버레이가 쓰는 공개 이름. 마지막 메시지·제목이 섞인 `title` 속성은 쓰지 않는다. */
export const CHAT_RESUME_NAME_ATTR = "data-chat-resume-name";
/** 행의 원형 썸네일. 전환의 시각적 출발점. */
export const CHAT_RESUME_THUMB_ATTR = "data-chat-resume-thumb";

/** 실제 채팅방(ChatClient) 루트 마커. 새 세션이 실제로 도착했는지 확인하는 유일한 근거. */
export const CHAT_ROOM_CHARACTER_ATTR = "data-chat-room-character";
export const CHAT_ROOM_ID_ATTR = "data-chat-room-id";

export function chatRoomAttrs(room: ChatRoomRef): Record<string, string> {
  return {
    [CHAT_ROOM_CHARACTER_ATTR]: String(room.characterId),
    [CHAT_ROOM_ID_ATTR]: String(room.chatId),
  };
}

/** 성인 가림 행(href가 /verify)에는 마커를 붙이지 않아 기본 navigation을 유지한다. */
export function chatResumeAttrs(input: {
  characterId: number;
  chatId: number;
  name: string;
  hidden: boolean;
}): Record<string, string> {
  if (input.hidden) return {};
  return {
    [CHAT_RESUME_ATTR]: String(input.characterId),
    [CHAT_RESUME_CHAT_ATTR]: String(input.chatId),
    [CHAT_RESUME_NAME_ATTR]: input.name,
  };
}

const positiveInt = (raw: string | null | undefined): number | null => {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/** `/chat/:characterId` 정확히 일치하는 경로의 캐릭터 id. */
export function parseChatRoomPath(pathname: string): number | null {
  const m = /^\/chat\/(\d+)$/.exec(pathname);
  return m ? positiveInt(m[1]) : null;
}

/** `/chat/:characterId?chat=:chatId` 형태의 실제 최근 활동 링크만 방 식별자로 변환한다. */
export function parseChatResumeHref(pathname: string, search: string): ChatRoomRef | null {
  const characterId = parseChatRoomPath(pathname);
  if (characterId === null) return null;
  const params = new URLSearchParams(search);
  const keys = [...params.keys()];
  if (keys.length !== 1 || keys[0] !== "chat" || params.getAll("chat").length !== 1) return null;
  const chatId = positiveInt(params.get("chat"));
  return chatId === null ? null : { characterId, chatId };
}

export function isSameChatRoom(a: ChatRoomRef | null, b: ChatRoomRef | null): boolean {
  return Boolean(a && b && a.characterId === b.characterId && a.chatId === b.chatId);
}

/** 행 마커와 href가 같은 방을 가리킬 때만 방 식별자를 돌려준다. */
export function resolveChatResumeTarget(input: {
  markerCharacterId: string | null;
  markerChatId: string | null;
  destPathname: string;
  destSearch: string;
}): ChatRoomRef | null {
  const fromHref = parseChatResumeHref(input.destPathname, input.destSearch);
  if (!fromHref) return null;
  const markerCharacter = positiveInt(input.markerCharacterId);
  const markerChat = positiveInt(input.markerChatId);
  if (markerCharacter !== fromHref.characterId || markerChat !== fromHref.chatId) return null;
  return fromHref;
}

export type ChatArrival = "arrived" | "pending" | "abandoned";
export type ChatBurstAction = "reveal" | "hold" | "drop";

/**
 * 목적지 방이 실제로 도착했는지 판정한다.
 * - 도착: 목적지 방 마커가 DOM에 있다. 서버가 같은 캐릭터의 기존 방으로 redirect한 경우는
 *   현재 canonical URL(`?chat=`)과 실제 방 마커가 같은 방일 때만 도착으로 본다.
 *   URL과 마커가 어긋나면(이전 방 마커가 잠시 남은 경우 등) 도착이 아니다.
 * - 대기: 아직 방 마커가 없거나 출발 방 그대로다. 클릭한 페이지에 그대로 있는 늦은 RSC도 대기다.
 *   빠른 연속 클릭으로 밀려난 이전 목적지(superseded)가 먼저 도착해도 기다린다.
 * - 포기: 채팅방이 아닌 경로로 갔거나(권한·로그인·인증 redirect, 뒤로 가기) URL과 일치하는 다른 캐릭터의 방이다.
 */
export function resolveChatArrival(input: {
  dest: ChatRoomRef;
  origin: ChatRoomRef | null;
  room: ChatRoomRef | null;
  pathname: string;
  /** 현재 위치(pathname + search). */
  url: string;
  /** 이 전환이 시작되며 밀어낸 이전 전환의 목적지(pathname + search). */
  superseded?: readonly string[];
  /** 클릭 당시 위치. 아직 이 자리에 있으면 목적지로 떠나지 않은 pending이다. */
  from?: string;
  /** 한 번 채팅 경로에 들어간 뒤 다시 출발 페이지로 돌아온 경우(뒤로 가기). */
  leftOrigin?: boolean;
}): ChatArrival {
  const { dest, origin, room, pathname, url, superseded = [], from, leftOrigin = false } = input;
  if (isSameChatRoom(room, dest)) return "arrived";
  if (superseded.includes(url)) return "pending";
  const pathCharacter = parseChatRoomPath(pathname);
  if (pathCharacter === null) return from != null && url === from && !leftOrigin ? "pending" : "abandoned";
  if (!room || isSameChatRoom(room, origin)) return "pending";
  const queryAt = url.indexOf("?");
  const urlRoom = parseChatResumeHref(pathname, queryAt === -1 ? "" : url.slice(queryAt));
  if (!isSameChatRoom(room, urlRoom)) return "pending";
  return room.characterId === dest.characterId ? "arrived" : "abandoned";
}

/**
 * 채팅 전환 레이어가 지금 할 일.
 * - reveal: 실제 방이 준비됐다. minCover가 끝났으면 즉시 분할한다.
 * - hold: 아직 방 마커가 없다. 이전 화면을 드러내지 않고 cover를 유지한다.
 * - drop: 채팅이 아닌 곳으로 갔거나, 목적지가 실패 페이지다.
 */
export function decideChatBurstAction(arrival: ChatArrival, pageFailed: boolean): ChatBurstAction {
  switch (arrival) {
    case "arrived":
      return "reveal";
    case "abandoned":
      return "drop";
    case "pending":
      return pageFailed ? "drop" : "hold";
    default: {
      const _exhaustive: never = arrival;
      return _exhaustive;
    }
  }
}

/** 채팅 경로에 방이 없고 Next가 404/에러 페이지를 그린 경우만 실패로 본다. 출발 목록 문구는 보지 않는다. */
export function chatResumePageLooksFailed(root: ParentNode, pathname?: string): boolean {
  if (pathname !== undefined && parseChatRoomPath(pathname) === null) return false;
  if (root.querySelector(`[${CHAT_ROOM_ID_ATTR}]`)) return false;
  const heading = (root.querySelector("h1, h2")?.textContent ?? "").replace(/\s+/g, " ").trim();
  if (/^404\b/.test(heading) || /this page could not be found/i.test(heading)) return true;
  return Boolean(root.querySelector("[data-nextjs-error-body], [data-next-error]"));
}

/**
 * 전환 타임라인(클릭 기준 ms). 도착이 아무리 빨라도 identity 장면이 보이기 전에는 열지 않는다.
 * 채팅 전환은 holdMax로 분할을 시작하지 않는다. 방이 준비되면 minCover 이후 즉시 연다.
 * navigation은 지연하지 않고 오버레이 해제 시점만 정한다.
 */
export const CHAT_RESUME_TIMING = {
  minCoverMs: 560,
  holdMaxMs: 1100,
  revealMs: 400,
  failsafeMs: MENU_TRANSITION_TIMING.failsafeMs,
} as const;

export function chatResumeRevealDelayMs(elapsedSinceClickMs: number): number {
  return Math.max(0, CHAT_RESUME_TIMING.minCoverMs - elapsedSinceClickMs);
}

/**
 * 시간축(클릭 기준 ms). 모두 `minCoverMs` 안에서 끝나 identity가 잠깐 정지한 뒤 화면이 열린다.
 *  A SELECT  : 행 반응 + 썸네일에서 링이 퍼진다.
 *  B ENTRY   : 썸네일에서 잉크 마스크·선이 펼쳐지고, 썸네일이 초상 프레임으로 열리며 이름이 줄 마스크에서 조립된다.
 *  C SPLIT   : reveal phase — 비스듬한 면 두 장이 서로 다른 방향·시간으로 열려 실제 채팅방이 드러난다.
 */
export const CHAT_RESUME_BEATS = {
  inkOpenMs: 420,
  lineMs: 320,
  ringMs: 460,
  frameStartMs: 70,
  frameMs: 460,
  seamStartMs: 140,
  seamMs: 300,
  eyebrowStartMs: 230,
  eyebrowMs: 220,
  nameStartMs: 210,
  nameGlyphMs: 240,
  nameSpreadMs: 140,
  splitUpMs: 340,
  splitDownMs: 330,
  splitDownDelayMs: 55,
} as const;

/** 글자 k번째의 시작 지연. 총 퍼짐 시간(nameSpreadMs) 안에 모두 시작한다. */
export function chatResumeGlyphDelayMs(index: number, total: number): number {
  const step = total > 1 ? Math.min(26, CHAT_RESUME_BEATS.nameSpreadMs / (total - 1)) : 0;
  return Math.round(CHAT_RESUME_BEATS.nameStartMs + index * step);
}

/** 비스듬한 분할선의 위(top)·아래(bottom) x 위치 (뷰포트 폭 비율). */
export const CHAT_RESUME_SEAM = { top: 0.58, bottom: 0.46 } as const;

export function chatResumeSeamX(yFraction: number): number {
  const y = Math.min(1, Math.max(0, yFraction));
  return CHAT_RESUME_SEAM.top + (CHAT_RESUME_SEAM.bottom - CHAT_RESUME_SEAM.top) * y;
}

export type ChatResumeLayout = {
  compact: boolean;
  frame: RevealRect;
  nameFontPx: number;
  nameBox: RevealRect;
  eyebrow: { left: number; top: number };
};

const FRAME_ASPECT = 3 / 4;
const NAME_LINE_HEIGHT = 1.12;
const NAME_ADVANCE = 1.0;
const EYEBROW_OFFSET = 30;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round = (n: number) => Math.round(n);

/**
 * 비스듬한 분할선 왼쪽 면에 초상 프레임, 오른쪽 면에 이름을 둔다.
 * 프레임은 왼쪽 면, 이름·eyebrow는 오른쪽 면 안에 항상 들어간다.
 */
export function computeChatResumeLayout(
  vw: number,
  vh: number,
  lineCount: number,
  maxChars: number,
): ChatResumeLayout {
  const compact = vw < 720;
  const gap = compact ? 14 : 44;
  const edge = compact ? 16 : 56;

  let frameH = clamp(vh * (compact ? 0.3 : 0.42), 150, 360);
  const bottomFrac = (vh + frameH) / 2 / vh;
  const frameRight = chatResumeSeamX(bottomFrac) * vw - gap;
  let frameW = frameH * FRAME_ASPECT;
  if (frameRight - frameW < edge) {
    frameW = Math.max(60, frameRight - edge);
    frameH = frameW / FRAME_ASPECT;
  }
  const frame: RevealRect = {
    left: round(frameRight - frameW),
    top: round((vh - frameH) / 2),
    width: round(frameW),
    height: round(frameH),
  };

  const lines = Math.max(1, lineCount);
  let nameTop = vh / 2 - (lines * 40) / 2;
  let nameLeft = 0;
  let nameWidth = 0;
  let fontPx = 24;
  for (let pass = 0; pass < 4; pass++) {
    nameLeft = chatResumeSeamX(Math.max(0, nameTop - EYEBROW_OFFSET) / vh) * vw + gap;
    nameWidth = Math.max(80, vw - edge - nameLeft);
    const byWidth = nameWidth / (Math.max(1, maxChars) * NAME_ADVANCE);
    const byHeight = (vh * 0.44) / (lines * NAME_LINE_HEIGHT);
    fontPx = clamp(Math.min(compact ? 40 : 76, byWidth, byHeight), 11, 76);
    nameTop = (vh - lines * fontPx * NAME_LINE_HEIGHT) / 2;
  }
  return {
    compact,
    frame,
    nameFontPx: Math.floor(fontPx),
    nameBox: {
      left: Math.ceil(nameLeft),
      top: round(nameTop),
      width: Math.floor(nameWidth),
      height: round(lines * fontPx * NAME_LINE_HEIGHT),
    },
    eyebrow: { left: Math.ceil(nameLeft), top: round(nameTop - EYEBROW_OFFSET) },
  };
}

/**
 * 프레임이 썸네일 원에서 열리는 FLIP.
 * 프레임 로컬 좌표의 (w/2, w/2)를 원 중심에 맞추고, 반지름 w/2 원이 썸네일 지름에 일치하도록 축소한다.
 */
export function chatResumeIris(
  origin: RevealRect,
  frame: RevealRect,
): { tx: number; ty: number; scale: number; r0: number; r1: number; cy: number } {
  const cx = origin.left + origin.width / 2;
  const cy = origin.top + origin.height / 2;
  const pivotX = frame.left + frame.width / 2;
  const pivotY = frame.top + frame.width / 2;
  const scale = frame.width > 0 ? origin.width / frame.width : 1;
  return {
    tx: round((cx - pivotX) * 100) / 100,
    ty: round((cy - pivotY) * 100) / 100,
    scale: Math.round(scale * 10000) / 10000,
    r0: round((frame.width / 2) * 100) / 100,
    r1: round(Math.hypot(frame.width, frame.height) * 100) / 100,
    cy: round((frame.width / 2) * 100) / 100,
  };
}

/** 원점(썸네일 중심)에서 뷰포트 가장 먼 모서리까지의 거리 — 잉크 원형 마스크의 최종 반지름. */
export function chatResumeInkRadius(cx: number, cy: number, vw: number, vh: number): number {
  const dx = Math.max(cx, vw - cx);
  const dy = Math.max(cy, vh - cy);
  return Math.ceil(Math.hypot(dx, dy)) + 2;
}
