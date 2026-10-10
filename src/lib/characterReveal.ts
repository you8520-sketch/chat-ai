/**
 * Phase D-1 — 캐릭터 카드 → 프로필 kinetic assembly (순수 로직).
 * 시각 owner는 기존 `MenuTransitionHost`이고, 이 모듈은 레이아웃·타이밍·동작 표를 계산만 한다.
 * navigation(href·redirect·권한)은 건드리지 않는다.
 */

import { MENU_TRANSITION_TIMING } from "@/lib/menuTransitionSpec";
import { serializePublicProfileFacts, type PublicProfileFact } from "@/lib/publicProfileFacts";

export type RevealRect = { left: number; top: number; width: number; height: number };

/** 카드 article에 붙는 마커. 값은 캐릭터 id. */
export const CHARACTER_CARD_ATTR = "data-character-card";
/** 프로필 hero 이미지 프레임 마커. 값은 캐릭터 id. */
export const CHARACTER_HERO_IMAGE_ATTR = "data-character-hero-image";

/**
 * reveal 오버레이의 요소(overlay)와 프로필 hero의 같은 요소(hero)를 잇는 키.
 * hero 요소에는 `data-hero-item`, 오버레이 요소에는 `data-rv-item`을 둔다.
 * 키: `name` · `eyebrow` · `record` · `fact:<key>` · `tagline` · `tag:<index>`.
 */
export const HERO_ITEM_ATTR = "data-hero-item";
export const REVEAL_ITEM_ATTR = "data-rv-item";
/** 이름처럼 크기가 달라지는 요소는 너비 비율로 함께 스케일한다. */
export const REVEAL_FIT_ATTR = "data-rv-fit";
export const revealTagKey = (index: number) => `tag:${index}`;
export const revealFactKey = (key: string) => `fact:${key}`;

/** 오버레이에 그리는 키워드 칩 최대 수 (hero는 전체 표시). */
export const REVEAL_MAX_TAGS = 3;

/** hero/일러스트 프레임 비율 (카드 표준 2:3 — 693×1024). */
export const REVEAL_FRAME_ASPECT = 2 / 3;

export const CHARACTER_REVEAL_TIMING = {
  /** reveal 시작의 최소 시각(클릭 기준) — 확장 + 이름 + 메타가 모두 보이는 시간. */
  minCoverMs: 1000,
  /** 도착이 늦어도 이 시각에는 reveal 시작. */
  holdMaxMs: 1300,
  revealMs: 420,
  /** 메뉴 전환과 동일한 절대 상한. */
  failsafeMs: MENU_TRANSITION_TIMING.failsafeMs,
} as const;

/**
 * reveal 대상 카드 마커. 프로필로 바로 가는(href가 정확히 /character/:id) 카드이면서
 * 성인 가림·로그인 redirect가 아니고 공개 이미지가 있을 때만 값을 돌려준다.
 * 실제 전환은 `MenuTransitionHost`가 href와 이미지를 다시 검증한다.
 */
export function characterRevealAttrs(input: {
  id: number;
  name: string;
  genre: string;
  /** 카드에 이미 공개된 한 줄 소개. `{{user}}`·`{{char}}`가 남은 문장은 오버레이에 쓰지 않는다. */
  tagline?: string | null;
  /** 카드에 이미 공개된 키워드. */
  tags?: readonly string[];
  /** 공개 승인된 기본 인적사항. 없으면 마커도 붙지 않는다. */
  facts?: readonly PublicProfileFact[];
  href: string;
  hidden: boolean;
  hasThumb: boolean;
}): Record<string, string> {
  if (input.hidden || !input.hasThumb || input.href !== `/character/${input.id}`) return {};
  const attrs: Record<string, string> = {
    [CHARACTER_CARD_ATTR]: String(input.id),
    "data-character-name": input.name,
    "data-character-genre": input.genre,
  };
  const tagline = input.tagline?.trim() ?? "";
  if (tagline && !/\{\{[^}]*\}\}/.test(tagline)) attrs["data-character-tagline"] = tagline;
  const tags = (input.tags ?? []).map((t) => t.trim()).filter(Boolean).slice(0, REVEAL_MAX_TAGS);
  if (tags.length > 0) attrs["data-character-tags"] = JSON.stringify(tags);
  if (input.facts && input.facts.length > 0) attrs["data-character-facts"] = serializePublicProfileFacts(input.facts);
  return attrs;
}

/** 카드의 `data-character-tags`를 안전하게 읽는다. 형식이 틀리면 빈 배열. */
export function parseRevealTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, REVEAL_MAX_TAGS);
  } catch {
    return [];
  }
}

export function characterRevealDelayMs(elapsedSinceClickMs: number): number {
  return Math.max(0, CHARACTER_REVEAL_TIMING.minCoverMs - elapsedSinceClickMs);
}

/** `/character/123` 정확히 일치하는 경로만 캐릭터 프로필로 본다 (query·login/verify redirect 제외). */
export function parseCharacterProfilePath(pathname: string): number | null {
  const m = /^\/character\/(\d+)$/.exec(pathname);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * 한 시간축(클릭 기준 ms)의 beat 표. 각 요소는 서로 다른 시작 위치·방향을 갖고 시간상 겹쳐 진행하며,
 * 모두 `CHARACTER_REVEAL_TIMING.minCoverMs` 근처에서 조립이 끝나 reveal(FINAL ASSEMBLY)로 이어진다.
 *  A ARTWORK  : 잉크 마스크가 카드 위치에서 열리고(rv-open) 프레임이 카드에서 분리돼 확장(rv-fly).
 *  B NAME     : 글자(grapheme) 단위가 위/아래 마스크 줄에서 엇갈려 들어와 양끝→가운데로 결합.
 *  C IDENTITY : 기준선이 그려지고 공개 인적사항이 각기 다른 위치에서 날아와 한 줄에 정렬.
 *  D PERSONAL : 한 줄 소개는 가로 마스크 와이프, 태그는 각기 다른 위치에서 정렬.
 *  E ASSEMBLY : reveal phase — 모든 요소가 프로필의 대응 요소로 개별 이동.
 */
export const REVEAL_BEATS = {
  inkOpenMs: 620,
  frameFlyMs: 680,
  imageDriftMs: 900,
  nameStartMs: 140,
  nameGlyphMs: 520,
  /** 첫 글자와 마지막 글자 시작 사이 최대 간격. */
  nameSpreadMs: 260,
  nameMaxStepMs: 46,
  eyebrowStartMs: 240,
  eyebrowMs: 420,
  recordStartMs: 360,
  recordMs: 420,
  factStartMs: 440,
  factStepMs: 60,
  factMs: 400,
  taglineStartMs: 520,
  taglineMs: 420,
  tagStartMs: 560,
  tagStepMs: 55,
  tagMs: 380,
} as const;

/** 각 요소가 시작하는 흩어진 위치. 뷰포트 단위라 360/390/1440 모두에서 서로 다른 방향이 유지된다. */
export type RevealScatter = { x: string; y: string; r: number };
export const REVEAL_TAG_SCATTER: readonly RevealScatter[] = [
  { x: "-26vw", y: "-16vh", r: -9 },
  { x: "8vw", y: "20vh", r: 6 },
  { x: "24vw", y: "-12vh", r: -5 },
];
export const REVEAL_FACT_SCATTER: readonly RevealScatter[] = [
  { x: "-20vw", y: "12vh", r: 5 },
  { x: "4vw", y: "-18vh", r: -6 },
  { x: "18vw", y: "16vh", r: 4 },
];

/** 한 글자의 시작 모양. y는 글자 높이 %, x는 em — 줄 마스크가 가려 위/아래에서 나타나게 한다. */
export type RevealGlyphMotion = { x: number; y: number; r: number };
const GLYPH_MOTIONS: readonly RevealGlyphMotion[] = [
  { x: -0.35, y: 118, r: -7 },
  { x: 0.3, y: -118, r: 6 },
  { x: 0.5, y: 118, r: 5 },
  { x: -0.45, y: -118, r: -5 },
  { x: 0.15, y: 118, r: -4 },
  { x: -0.2, y: -118, r: 7 },
];
export function revealGlyphMotion(index: number): RevealGlyphMotion {
  return GLYPH_MOTIONS[((index % GLYPH_MOTIONS.length) + GLYPH_MOTIONS.length) % GLYPH_MOTIONS.length];
}

/** 한 줄을 grapheme 단위로 나눈다. 완성형·조합형 한글, 결합 문자, ZWJ 이모지를 쪼개지 않는다. */
export function splitRevealGraphemes(line: string): string[] {
  const text = line.normalize("NFC");
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter("ko", { granularity: "grapheme" });
    return Array.from(segmenter.segment(text), (seg) => seg.segment);
  }
  return Array.from(text);
}

/** n개 글자가 결합되는 순서(rank): 양끝에서 시작해 가운데로 모인다. 반환값[k] = k번째 글자의 순번. */
export function revealGlyphRanks(n: number): number[] {
  const order: number[] = [];
  let lo = 0;
  let hi = n - 1;
  while (lo <= hi) {
    order.push(lo++);
    if (lo <= hi) order.push(hi--);
  }
  const ranks = new Array<number>(n);
  order.forEach((glyph, rank) => {
    ranks[glyph] = rank;
  });
  return ranks;
}

export function revealGlyphDelayMs(rank: number, count: number): number {
  const step = count > 1 ? Math.min(REVEAL_BEATS.nameMaxStepMs, REVEAL_BEATS.nameSpreadMs / (count - 1)) : 0;
  return Math.round(REVEAL_BEATS.nameStartMs + rank * step);
}

/** 오버레이 요소 → hero 요소로의 이동량(좌상단 기준). fit이면 너비 비율로 스케일한다. */
export function revealSettleDelta(
  from: RevealRect,
  to: RevealRect,
  fit: boolean,
): { tx: number; ty: number; scale: number } {
  const raw = fit && from.width > 0 ? to.width / from.width : 1;
  const scale = Math.min(3, Math.max(0.2, raw));
  return { tx: to.left - from.left, ty: to.top - from.top, scale };
}

const MAX_NAME_CHARS = 44;

/**
 * 긴 한글 이름도 안전하게 보이도록 최대 3줄로 균형 분할한다.
 * 공백이 있으면 단어 경계를, 없으면 글자 단위로 나눈다.
 */
export function splitRevealName(raw: string): { lines: string[]; maxChars: number } {
  let name = raw.replace(/\s+/g, " ").trim();
  if (!name) return { lines: ["—"], maxChars: 1 };
  const chars = Array.from(name);
  if (chars.length > MAX_NAME_CHARS) name = `${chars.slice(0, MAX_NAME_CHARS - 1).join("")}…`;
  const total = Array.from(name).length;
  const lineCount = total <= 7 ? 1 : total <= 14 ? 2 : 3;
  if (lineCount === 1) return { lines: [name], maxChars: total };

  const limit = Math.ceil(total / lineCount);
  const lines: string[] = [];
  let current = "";
  const push = () => {
    if (current) lines.push(current);
    current = "";
  };
  for (const word of name.split(" ")) {
    const wordChars = Array.from(word);
    if (wordChars.length > limit) {
      push();
      for (let i = 0; i < wordChars.length; i += limit) {
        lines.push(wordChars.slice(i, i + limit).join(""));
      }
      continue;
    }
    const joined = current ? `${current} ${word}` : word;
    if (Array.from(joined).length > limit) {
      push();
      current = word;
    } else {
      current = joined;
    }
  }
  push();
  while (lines.length > 3) {
    const last = lines.pop()!;
    lines[lines.length - 1] = `${lines[lines.length - 1]} ${last}`;
  }
  return { lines, maxChars: Math.max(...lines.map((l) => Array.from(l).length)) };
}

export type RevealLayout = {
  compact: boolean;
  frame: RevealRect;
  nameFontPx: number;
  nameBox: RevealRect;
  /** eyebrow / 인적사항 / 한 줄 소개·키워드 묶음의 위치. 데스크톱은 우측 정렬, 모바일은 좌측 정렬. */
  info: { left: number; width: number; eyebrowTop: number; factsTop: number; subTop: number };
};

/** 한글 전각 글자 평균 advance(letter-spacing -0.04em 반영). */
const GLYPH_ADVANCE = 0.98;
/** 프레임 폭 대비 이름이 일러스트 뒤로 들어가는 비율 — 마지막 글자가 읽히는 수준만 겹친다. */
const NAME_TUCK = 0.015;
const EYEBROW_BLOCK = 34;
/** 기준선 + 캡션/값 한 줄. */
const FACTS_BLOCK = 60;
/** 한 줄 소개 2줄 + 간격 + 키워드 칩 한 줄. */
const SUB_BLOCK = 112;
const SUB_GAP = 16;
const INFO_MAX_WIDTH = 416;
const NAME_LINE_HEIGHT = 1.06;

/**
 * 뷰포트 기준 포스터 구도.
 * 데스크톱: 일러스트 우측, 거대한 이름이 일러스트 뒤(좌측)에서 마지막 글자 가장자리만 살짝 겹치고,
 *   장르 eyebrow(위) · 인적사항(이름 아래, 있을 때만) · 한 줄 소개/키워드가 이름 기둥에 정렬된다.
 * 모바일: 일러스트 아래로 eyebrow → 이름 → 인적사항 → 소개/키워드가 한 열로 쌓인다(이름은 가려지지 않음).
 */
export function computeRevealLayout(
  vw: number,
  vh: number,
  nameLines: number,
  nameMaxChars: number,
  opts: { facts?: boolean } = {},
): RevealLayout {
  const compact = vw < 768;
  const lines = Math.max(1, nameLines);
  const chars = Math.max(1, nameMaxChars);
  const factsBlock = opts.facts ? FACTS_BLOCK + SUB_GAP : 0;

  if (!compact) {
    let fh = Math.min(vh * 0.84, 780);
    let fw = fh * REVEAL_FRAME_ASPECT;
    if (fw > vw * 0.4) {
      fw = vw * 0.4;
      fh = fw / REVEAL_FRAME_ASPECT;
    }
    const left = vw - fw - vw * 0.11;
    const top = (vh - fh) / 2;
    const frame = { left, top, width: fw, height: fh };
    const nameRight = left + fw * NAME_TUCK;
    const nameLeft = vw * 0.06;
    const availW = nameRight - nameLeft;
    const nameFontPx = Math.max(28, Math.min(availW / (chars * GLYPH_ADVANCE), (fh * 0.46) / lines, 280));
    const blockH = nameFontPx * NAME_LINE_HEIGHT * lines;
    const stackH = EYEBROW_BLOCK + blockH + factsBlock + SUB_GAP + SUB_BLOCK;
    const eyebrowTop = top + Math.max(0, (fh - stackH) / 2);
    const nameBox = { left: nameLeft, top: eyebrowTop + EYEBROW_BLOCK, width: availW, height: blockH };
    const factsTop = nameBox.top + blockH + SUB_GAP;
    const infoRight = left - 16;
    const infoWidth = Math.max(160, Math.min(INFO_MAX_WIDTH, infoRight - nameLeft));
    const info = {
      left: infoRight - infoWidth,
      width: infoWidth,
      eyebrowTop,
      factsTop,
      subTop: factsTop + factsBlock,
    };
    return { compact, frame, nameFontPx, nameBox, info };
  }

  const nameLeft = vw * 0.06;
  const availW = vw - nameLeft * 2;
  const nameFontPx = Math.max(26, Math.min(availW / (chars * GLYPH_ADVANCE), 150));
  const blockH = nameFontPx * NAME_LINE_HEIGHT * lines;
  const top = Math.max(vh * 0.08, 56);
  const reserve = EYEBROW_BLOCK + blockH + factsBlock + SUB_GAP + SUB_BLOCK + 20;
  const wantedFh = Math.min(vw * 0.74, vh * 0.5 * REVEAL_FRAME_ASPECT * 1.45) / REVEAL_FRAME_ASPECT;
  const fh = Math.min(wantedFh, Math.max(vh - top - reserve, 140));
  const fw = fh * REVEAL_FRAME_ASPECT;
  const left = vw - fw - vw * 0.06;
  const frame = { left, top, width: fw, height: fh };
  const eyebrowTop = top + fh + 12;
  const nameBox = { left: nameLeft, top: eyebrowTop + EYEBROW_BLOCK - 12, width: availW, height: blockH };
  const factsTop = nameBox.top + blockH + SUB_GAP;
  const info = { left: nameLeft, width: availW, eyebrowTop, factsTop, subTop: factsTop + factsBlock };
  return { compact, frame, nameFontPx, nameBox, info };
}

/** from(카드 이미지) → to(프레임) 로 되돌리는 FLIP transform. 프레임 좌상단 기준(transform-origin: 0 0). */
export function flipTransform(from: RevealRect, to: RevealRect): { tx: number; ty: number; scale: number } {
  const scale = to.width > 0 ? from.width / to.width : 1;
  return { tx: from.left - to.left, ty: from.top - to.top, scale };
}

/**
 * 프레임 로컬 좌표계(스케일 전)에서 보이는 영역을 `clip-path: inset()` 값으로 환산.
 * 카드 비율이 2:3이 아니거나(예: 4:5) 스크롤 컨테이너에 잘린 카드를 정확히 재현한다.
 */
export function flipClipInset(
  visible: RevealRect,
  from: RevealRect,
  frame: RevealRect,
  scale: number,
): { top: number; right: number; bottom: number; left: number } {
  const s = scale > 0 ? scale : 1;
  const clamp = (n: number) => Math.max(0, Math.round(n * 100) / 100);
  const localW = (visible.left + visible.width - from.left) / s;
  const localH = (visible.top + visible.height - from.top) / s;
  return {
    left: clamp((visible.left - from.left) / s),
    top: clamp((visible.top - from.top) / s),
    right: clamp(frame.width - localW),
    bottom: clamp(frame.height - localH),
  };
}
