"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { usePathname } from "next/navigation";

import {
  isPlainLeftClick,
  MENU_TRANSITION_ATTR,
  MENU_TRANSITION_TIMING,
  menuRevealDelayMs,
  resolveMenuClickTransition,
  type MenuTransitionSpec,
} from "@/lib/menuTransitionSpec";
import {
  CHARACTER_CARD_ATTR,
  CHARACTER_HERO_IMAGE_ATTR,
  CHARACTER_REVEAL_TIMING,
  characterRevealDelayMs,
  computeRevealLayout,
  flipClipInset,
  flipTransform,
  parseCharacterProfilePath,
  splitRevealName,
  type RevealRect,
} from "@/lib/characterReveal";
import CharacterRevealScene, { type CharacterScene } from "@/components/CharacterRevealScene";

/**
 * 공통 전환 lifecycle의 단일 owner (Phase C 메뉴 + Phase D-1 캐릭터 reveal).
 *
 * - canonical navigation owner는 기존 `next/link` 그대로 (href·redirect·query 불변).
 * - 시각 렌더만 kind로 구분한다.
 *   - `menu`: 승인된 메뉴 영역(`data-menu-transition`) 클릭 → Phase C 그래픽 전환.
 *   - `character`: 캐릭터 카드(`data-character-card`)의 프로필 링크 클릭 → artwork reveal.
 *   콘텐츠 링크(태그·제작자)·최근 활동·history traversal은 대상 아님.
 * - navigation을 지연시키지 않고, router를 직접 호출하지 않으며,
 *   오버레이는 항상 `pointer-events: none`이라 기능을 가로막지 않는다.
 */

type BurstBase = {
  id: number;
  dest: string;
  phase: "cover" | "reveal";
};
type MenuBurst = BurstBase & { kind: "menu"; spec: MenuTransitionSpec };
type CharacterBurst = BurstBase & { kind: "character"; scene: CharacterScene };
type Burst = MenuBurst | CharacterBurst;

function timingFor(kind: Burst["kind"]) {
  switch (kind) {
    case "menu":
      return MENU_TRANSITION_TIMING;
    case "character":
      return CHARACTER_REVEAL_TIMING;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function revealDelayFor(kind: Burst["kind"], elapsedMs: number): number {
  switch (kind) {
    case "menu":
      return menuRevealDelayMs(elapsedMs);
    case "character":
      return characterRevealDelayMs(elapsedMs);
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function intersect(a: RevealRect, b: DOMRect): RevealRect {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.right);
  const bottom = Math.min(a.top + a.height, b.bottom);
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/** 카드가 가로 스크롤/overflow 컨테이너와 뷰포트에 잘린 만큼만 보이는 영역. */
function visibleRect(el: Element, rect: RevealRect): RevealRect {
  let visible = intersect(rect, new DOMRect(0, 0, window.innerWidth, window.innerHeight));
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (cs.overflowX !== "visible" || cs.overflowY !== "visible") {
      visible = intersect(visible, p.getBoundingClientRect());
    }
  }
  return visible;
}

/** 클릭한 카드에서 실제로 보이던 공개 이미지와 위치를 읽어 reveal scene을 만든다. 불가하면 null. */
function buildCharacterScene(card: Element, id: number): CharacterScene | null {
  const img = card.querySelector("img");
  if (!(img instanceof HTMLImageElement) || !img.complete || img.naturalWidth === 0) return null;
  const src = img.currentSrc || img.src;
  if (!src || src.includes("/media/private/")) return null;
  const r = img.getBoundingClientRect();
  const from: RevealRect = { left: r.left, top: r.top, width: r.width, height: r.height };
  if (from.width < 48 || from.height < 48) return null;
  const visible = visibleRect(img, from);
  if (visible.width < 24 || visible.height < 24) return null;

  const { lines, maxChars } = splitRevealName(card.getAttribute("data-character-name") ?? "");
  const layout = computeRevealLayout(window.innerWidth, window.innerHeight, lines.length, maxChars);
  const start = flipTransform(from, layout.frame);
  return {
    id,
    src,
    lines,
    genre: (card.getAttribute("data-character-genre") ?? "").trim(),
    creator: (card.getAttribute("data-character-creator") ?? "").trim(),
    layout,
    start: { ...start, clip: flipClipInset(visible, from, layout.frame, start.scale) },
    hero: null,
  };
}

/** 도착한 프로필 hero 이미지 프레임 위치로 일러스트가 안착하도록 목표를 읽는다. */
function readHeroTarget(scene: CharacterScene): CharacterScene["hero"] {
  const el = document.querySelector(`[${CHARACTER_HERO_IMAGE_ATTR}="${scene.id}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 48 || r.height < 48) return null;
  const heroImg = el.querySelector("img");
  return {
    ...flipTransform({ left: r.left, top: r.top, width: r.width, height: r.height }, scene.layout.frame),
    src: heroImg instanceof HTMLImageElement ? heroImg.currentSrc || heroImg.src : "",
  };
}

let burstSeq = 0;

/** 루트 레이아웃에 상주하는 단일 전환 레이어. */
export default function MenuTransitionHost() {
  const pathname = usePathname();
  const [burst, setBurst] = useState<Burst | null>(null);
  const burstRef = useRef<Burst | null>(null);
  const timers = useRef<number[]>([]);
  const firstPath = useRef<string | null>(null);
  const startedAt = useRef(0);

  function clearTimers() {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
  }

  function dropBurst(id: number) {
    clearTimers();
    if (burstRef.current && burstRef.current.id === id) {
      burstRef.current = null;
      setBurst(null);
    }
  }

  function beginReveal(id: number) {
    const cur = burstRef.current;
    if (!cur || cur.id !== id || cur.phase === "reveal") return;
    const revealed: Burst =
      cur.kind === "character"
        ? {
            ...cur,
            phase: "reveal",
            scene: { ...cur.scene, hero: window.location.pathname === cur.dest ? readHeroTarget(cur.scene) : null },
          }
        : { ...cur, phase: "reveal" };
    burstRef.current = revealed;
    setBurst(revealed);
    timers.current.push(
      window.setTimeout(() => {
        if (burstRef.current && burstRef.current.id === id) {
          burstRef.current = null;
          setBurst(null);
        }
      }, timingFor(cur.kind).revealMs),
    );
  }

  function startBurst(next: Burst) {
    clearTimers();
    burstRef.current = next;
    startedAt.current = performance.now();
    setBurst(next);
    const timing = timingFor(next.kind);
    // 도착이 늦거나 실패해도 정해진 시각에 걷힌다.
    timers.current.push(window.setTimeout(() => beginReveal(next.id), timing.holdMaxMs));
    // 이동 실패·지연 대비 failsafe — 화면을 영구히 덮지 않는다.
    timers.current.push(
      window.setTimeout(() => {
        if (burstRef.current && burstRef.current.id === next.id) {
          burstRef.current = null;
          setBurst(null);
        }
      }, timing.failsafeMs),
    );
  }

  function scheduleMenuBurst(spec: MenuTransitionSpec, dest: string) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    burstSeq += 1;
    startBurst({ kind: "menu", id: burstSeq, spec, dest, phase: "cover" });
  }

  function scheduleCharacterBurst(scene: CharacterScene, dest: string) {
    burstSeq += 1;
    startBurst({ kind: "character", id: burstSeq, scene, dest, phase: "cover" });
  }

  // BEAT 1 — 승인된 영역(메뉴 / 캐릭터 카드)의 클릭에 즉각 반응. navigation은 그대로 진행.
  useEffect(() => {
    function onClickCapture(e: MouseEvent) {
      if (!isPlainLeftClick(e)) return;
      const target = e.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      const dest = new URL(anchor.href, window.location.href);
      if (dest.origin !== window.location.origin) return;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      // 캐릭터 카드의 프로필 링크(href가 정확히 /character/:id)만. 태그·제작자·login/verify redirect는 제외.
      const card = anchor.closest(`[${CHARACTER_CARD_ATTR}]`);
      if (card) {
        const id = Number(card.getAttribute(CHARACTER_CARD_ATTR));
        if (
          reduced ||
          !Number.isSafeInteger(id) ||
          parseCharacterProfilePath(dest.pathname) !== id ||
          dest.search ||
          dest.pathname === window.location.pathname
        ) {
          return;
        }
        const scene = buildCharacterScene(card, id);
        if (scene) scheduleCharacterBurst(scene, dest.pathname);
        return;
      }

      if (!anchor.closest(`[${MENU_TRANSITION_ATTR}]`)) return;
      const spec = resolveMenuClickTransition({
        inMenuRegion: true,
        destPathname: dest.pathname,
        currentPathname: window.location.pathname,
      });
      if (!spec) return;
      anchor.classList.remove("menu-flash");
      void anchor.offsetWidth;
      anchor.classList.add("menu-flash");
      window.setTimeout(() => anchor.classList.remove("menu-flash"), 350);
      scheduleMenuBurst(spec, dest.pathname);
    }
    document.addEventListener("click", onClickCapture, true);
    return () => document.removeEventListener("click", onClickCapture, true);
  }, []);

  // BEAT 3 — 클릭으로 시작된 burst만 목적지 도착 시 reveal. 클릭 없는 경로 변경
  // (뒤로/앞으로 가기, 프로그래밍 이동, 콘텐츠 링크)은 veil을 만들지 않는다.
  // 캐릭터 burst는 자기 목적지 도착만 인정한다. 일반 콘텐츠·history로 프로필을
  // 벗어나면 오래된 scene을 즉시 내린다. 다른 /character/:id 중간 도착은
  // 빠른 연속 클릭이므로 유지한다.
  useEffect(() => {
    if (firstPath.current === null) {
      firstPath.current = pathname;
      return;
    }
    if (firstPath.current === pathname) return;
    firstPath.current = pathname;
    const cur = burstRef.current;
    if (!cur) return;
    if (cur.kind === "character" && pathname !== cur.dest) {
      if (parseCharacterProfilePath(pathname) === null) dropBurst(cur.id);
      return;
    }
    if (cur.phase === "reveal") return;
    const delay = revealDelayFor(cur.kind, performance.now() - startedAt.current);
    timers.current.push(window.setTimeout(() => beginReveal(cur.id), delay));
  }, [pathname]);

  useEffect(() => () => clearTimers(), []);

  if (!burst) return null;
  switch (burst.kind) {
    case "menu": {
      const { spec } = burst;
      return (
        <div
          key={burst.id}
          aria-hidden
          data-motif={spec.motif}
          data-phase={burst.phase}
          className="menu-veil"
          style={{ "--menu-accent": spec.accent, "--menu-chars": spec.en.length } as CSSProperties}
        >
          <div className="menu-ink" />
          <div className="menu-field" />
          <div className="menu-type">
            <div className="menu-slab">
              <span className="menu-en">{spec.en}</span>
              <span className="menu-ko">{spec.ko}</span>
            </div>
          </div>
        </div>
      );
    }
    case "character":
      return <CharacterRevealScene key={burst.id} scene={burst.scene} phase={burst.phase} />;
    default: {
      const _exhaustive: never = burst;
      return _exhaustive;
    }
  }
}
