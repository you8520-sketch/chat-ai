/**
 * Phase D-3 — 최근 활동 TRPG 캠페인 → 기존 캠페인 방 reveal (순수 로직).
 * 시각·lifecycle owner는 기존 `MenuTransitionHost`이고, 이 모듈은 식별·도착 판정·레이아웃·타이밍만 계산한다.
 * navigation(href·참가 자격·권한·redirect)과 라운드/과금 writer는 건드리지 않는다.
 */

import type { RevealRect } from "@/lib/characterReveal";
import { MENU_TRANSITION_TIMING } from "@/lib/menuTransitionSpec";

export type TrpgRoomRef = { campaignId: number };

/** 최근 활동 TRPG 행(Link)에 붙는 마커. 값은 캠페인 id. */
export const TRPG_RESUME_ATTR = "data-trpg-resume";
/** 오버레이가 쓰는 공개 캠페인 제목. `title` 속성(툴팁)은 쓰지 않는다. */
export const TRPG_RESUME_NAME_ATTR = "data-trpg-resume-name";
/** 행의 D20 원. 전환의 시각적 출발점. 소스 캐릭터 썸네일을 쓰지 않는다. */
export const TRPG_RESUME_GLYPH_ATTR = "data-trpg-resume-glyph";

/** 실제 TRPG 룸(TrpgRoomClient) 루트 마커. URL만으로 도착을 끝내지 않는다. */
export const TRPG_ROOM_ID_ATTR = "data-trpg-room-id";

export function trpgRoomAttrs(campaignId: number): Record<string, string> {
  return { [TRPG_ROOM_ID_ATTR]: String(campaignId) };
}

/** 최근 활동의 `/trpg/:id` 행에만 마커를 붙인다. 로비(`/trpg`)·잘못된 id는 빈 객체. */
export function trpgResumeAttrs(input: { campaignId: number; title: string; href: string }): Record<string, string> {
  if (input.campaignId <= 0 || !Number.isSafeInteger(input.campaignId)) return {};
  if (input.href !== `/trpg/${input.campaignId}`) return {};
  const title = input.title.replace(/\s+/g, " ").trim();
  if (!title) return {};
  return {
    [TRPG_RESUME_ATTR]: String(input.campaignId),
    [TRPG_RESUME_NAME_ATTR]: title,
  };
}

const positiveInt = (raw: string | null | undefined): number | null => {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/** `/trpg/:campaignId` 정확히 일치하는 경로만. 로비·하위 경로·query는 거부. */
export function parseTrpgRoomPath(pathname: string): number | null {
  const m = /^\/trpg\/(\d+)$/.exec(pathname);
  return m ? positiveInt(m[1]) : null;
}

export function parseTrpgResumeHref(pathname: string, search: string): TrpgRoomRef | null {
  const campaignId = parseTrpgRoomPath(pathname);
  if (campaignId === null) return null;
  if (search && search !== "?") return null;
  return { campaignId };
}

export function isSameTrpgRoom(a: TrpgRoomRef | null, b: TrpgRoomRef | null): boolean {
  return Boolean(a && b && a.campaignId === b.campaignId);
}

/** 행 마커와 href가 같은 캠페인을 가리킬 때만 식별자를 돌려준다. */
export function resolveTrpgResumeTarget(input: {
  markerCampaignId: string | null;
  destPathname: string;
  destSearch: string;
}): TrpgRoomRef | null {
  const fromHref = parseTrpgResumeHref(input.destPathname, input.destSearch);
  if (!fromHref) return null;
  const marker = positiveInt(input.markerCampaignId);
  if (marker !== fromHref.campaignId) return null;
  return fromHref;
}

export type TrpgArrival = "arrived" | "pending" | "abandoned";
export type TrpgBurstAction = "reveal" | "hold" | "drop";

/**
 * 목적지 캠페인이 실제로 도착했는지 판정한다.
 * - 도착: 목적지 룸 마커가 DOM에 있다. URL만으로는 도착이 아니다.
 * - 대기: 마커가 없거나 출발 캠페인 그대로다. 클릭한 페이지에 그대로 있는 늦은 RSC도 대기다.
 *   빠른 연속 클릭으로 밀려난 이전 목적지(superseded)가 먼저 도착해도 기다린다.
 * - 포기: TRPG 캠페인 방이 아닌 경로(로비·로그인·확인·뒤로 가기)이거나 다른 캠페인 마커다.
 */
export function resolveTrpgArrival(input: {
  dest: TrpgRoomRef;
  origin: TrpgRoomRef | null;
  room: TrpgRoomRef | null;
  pathname: string;
  url: string;
  superseded?: readonly string[];
  from?: string;
  leftOrigin?: boolean;
}): TrpgArrival {
  const { dest, origin, room, pathname, url, superseded = [], from, leftOrigin = false } = input;
  if (isSameTrpgRoom(room, dest)) return "arrived";
  if (superseded.includes(url)) return "pending";
  const pathId = parseTrpgRoomPath(pathname);
  if (pathId === null) return from != null && url === from && !leftOrigin ? "pending" : "abandoned";
  if (!room || isSameTrpgRoom(room, origin)) return "pending";
  return room.campaignId === dest.campaignId ? "arrived" : "abandoned";
}

export function decideTrpgBurstAction(arrival: TrpgArrival, pageFailed: boolean): TrpgBurstAction {
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

/** TRPG 캠페인 경로에 룸 마커가 없고 Next가 404/에러를 그린 경우만 실패. 출발 목록 문구는 보지 않는다. */
export function trpgResumePageLooksFailed(root: ParentNode, pathname?: string): boolean {
  if (pathname !== undefined && parseTrpgRoomPath(pathname) === null) return false;
  if (root.querySelector(`[${TRPG_ROOM_ID_ATTR}]`)) return false;
  const heading = (root.querySelector("h1, h2")?.textContent ?? "").replace(/\s+/g, " ").trim();
  if (/^404\b/.test(heading) || /this page could not be found/i.test(heading)) return true;
  return Boolean(root.querySelector("[data-nextjs-error-body], [data-next-error]"));
}

/**
 * 전환 타임라인(클릭 기준 ms). 도착이 아무리 빨라도 identity 장면이 보이기 전에는 열지 않는다.
 * holdMax로 분할하지 않는다. 룸이 준비되면 minCover 이후 즉시 연다.
 */
export const TRPG_RESUME_TIMING = {
  minCoverMs: 560,
  holdMaxMs: 1100,
  revealMs: 400,
  failsafeMs: MENU_TRANSITION_TIMING.failsafeMs,
} as const;

export function trpgResumeRevealDelayMs(elapsedSinceClickMs: number): number {
  return Math.max(0, TRPG_RESUME_TIMING.minCoverMs - elapsedSinceClickMs);
}

/**
 * 시간축(클릭 기준 ms). 모두 `minCoverMs` 안에서 끝나 identity가 잠깐 정지한 뒤 화면이 열린다.
 *  A SELECT  : D20 반응 + 원에서 링이 퍼진다.
 *  B CREST   : 문양이 열리고 캠페인 제목이 줄 마스크에서 조립된다. 주사위 결과는 그리지 않는다.
 *  C SPLIT   : reveal — 비대칭 두 면이 서로 다른 방향으로 열려 실제 캠페인 화면이 드러난다.
 */
export const TRPG_RESUME_BEATS = {
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

export function trpgResumeGlyphDelayMs(index: number, total: number): number {
  const step = total > 1 ? Math.min(26, TRPG_RESUME_BEATS.nameSpreadMs / (total - 1)) : 0;
  return Math.round(TRPG_RESUME_BEATS.nameStartMs + index * step);
}

/** 채팅 D-2와 반대 기울기의 분할선 (위가 더 왼쪽). */
export const TRPG_RESUME_SEAM = { top: 0.42, bottom: 0.56 } as const;

export function trpgResumeSeamX(yFraction: number): number {
  const y = Math.min(1, Math.max(0, yFraction));
  return TRPG_RESUME_SEAM.top + (TRPG_RESUME_SEAM.bottom - TRPG_RESUME_SEAM.top) * y;
}

export type TrpgResumeLayout = {
  compact: boolean;
  frame: RevealRect;
  nameFontPx: number;
  nameBox: RevealRect;
  eyebrow: { left: number; top: number };
};

const FRAME_ASPECT = 1;
const NAME_LINE_HEIGHT = 1.12;
const NAME_ADVANCE = 1.0;
const EYEBROW_OFFSET = 30;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round = (n: number) => Math.round(n);

/** 분할선 왼쪽 면에 D20 문양, 오른쪽 면에 캠페인 제목. */
export function computeTrpgResumeLayout(
  vw: number,
  vh: number,
  lineCount: number,
  maxChars: number,
): TrpgResumeLayout {
  const compact = vw < 720;
  const gap = compact ? 14 : 44;
  const edge = compact ? 16 : 56;

  let frameH = clamp(vh * (compact ? 0.26 : 0.34), 132, 280);
  const midFrac = 0.5;
  const frameRight = trpgResumeSeamX(midFrac) * vw - gap;
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
    nameLeft = trpgResumeSeamX(Math.max(0, nameTop - EYEBROW_OFFSET) / vh) * vw + gap;
    nameWidth = Math.max(80, vw - edge - nameLeft);
    const byWidth = nameWidth / (Math.max(1, maxChars) * NAME_ADVANCE);
    const byHeight = (vh * 0.44) / (lines * NAME_LINE_HEIGHT);
    fontPx = clamp(Math.min(compact ? 40 : 72, byWidth, byHeight), 11, 72);
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

/** 문양이 D20 원에서 열리는 FLIP. */
export function trpgResumeIris(
  origin: RevealRect,
  frame: RevealRect,
): { tx: number; ty: number; scale: number; r0: number; r1: number; cy: number } {
  const cx = origin.left + origin.width / 2;
  const cy = origin.top + origin.height / 2;
  const pivotX = frame.left + frame.width / 2;
  const pivotY = frame.top + frame.height / 2;
  const scale = frame.width > 0 ? origin.width / frame.width : 1;
  return {
    tx: round((cx - pivotX) * 100) / 100,
    ty: round((cy - pivotY) * 100) / 100,
    scale: Math.round(scale * 10000) / 10000,
    r0: round((Math.min(frame.width, frame.height) / 2) * 100) / 100,
    r1: round(Math.hypot(frame.width, frame.height) * 100) / 100,
    cy: round((frame.height / 2) * 100) / 100,
  };
}

export function trpgResumeInkRadius(cx: number, cy: number, vw: number, vh: number): number {
  const dx = Math.max(cx, vw - cx);
  const dy = Math.max(cy, vh - cy);
  return Math.ceil(Math.hypot(dx, dy)) + 2;
}
