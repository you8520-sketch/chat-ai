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

/**
 * Phase C — 메뉴 시네마틱 전환의 단일 owner.
 *
 * - canonical navigation owner는 기존 `next/link` 그대로 (href·redirect·query 불변).
 * - 이 모듈은 시각적 향상만 담당: 승인된 메뉴 영역(`data-menu-transition`)의 클릭 감지
 *   → 오버레이 연출 → 경로 변경 후 해제. 콘텐츠 링크·최근 활동·history traversal은 대상 아님.
 * - navigation을 지연시키지 않고, router를 직접 호출하지 않으며,
 *   오버레이는 항상 `pointer-events: none`이라 기능을 가로막지 않는다.
 */

type Burst = {
  id: number;
  spec: MenuTransitionSpec;
  dest: string;
  phase: "cover" | "reveal";
};

const { holdMaxMs, revealMs, failsafeMs } = MENU_TRANSITION_TIMING;

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

  function beginReveal(id: number) {
    const cur = burstRef.current;
    if (!cur || cur.id !== id || cur.phase === "reveal") return;
    const revealed: Burst = { ...cur, phase: "reveal" };
    burstRef.current = revealed;
    setBurst(revealed);
    timers.current.push(
      window.setTimeout(() => {
        if (burstRef.current && burstRef.current.id === id) {
          burstRef.current = null;
          setBurst(null);
        }
      }, revealMs),
    );
  }

  function scheduleBurst(spec: MenuTransitionSpec, dest: string) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    clearTimers();
    burstSeq += 1;
    const next: Burst = { id: burstSeq, spec, dest, phase: "cover" };
    burstRef.current = next;
    startedAt.current = performance.now();
    setBurst(next);
    // 도착이 늦거나 실패해도 정해진 시각에 걷힌다.
    timers.current.push(window.setTimeout(() => beginReveal(next.id), holdMaxMs));
    // 이동 실패·지연 대비 failsafe — 화면을 영구히 덮지 않는다.
    timers.current.push(
      window.setTimeout(() => {
        if (burstRef.current && burstRef.current.id === next.id) {
          burstRef.current = null;
          setBurst(null);
        }
      }, failsafeMs),
    );
  }

  // BEAT 1 — 승인된 메뉴 영역 클릭의 즉각 반응 + BEAT 2 진입. navigation은 그대로 진행.
  useEffect(() => {
    function onClickCapture(e: MouseEvent) {
      if (!isPlainLeftClick(e)) return;
      const target = e.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (!anchor.closest(`[${MENU_TRANSITION_ATTR}]`)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      const dest = new URL(anchor.href, window.location.href);
      if (dest.origin !== window.location.origin) return;
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
      scheduleBurst(spec, dest.pathname);
    }
    document.addEventListener("click", onClickCapture, true);
    return () => document.removeEventListener("click", onClickCapture, true);
  }, []);

  // BEAT 3 — 메뉴 클릭으로 시작된 burst만 목적지 도착 시 reveal. 클릭 없는 경로 변경
  // (뒤로/앞으로 가기, 프로그래밍 이동, 콘텐츠 링크)은 veil을 만들지 않는다.
  useEffect(() => {
    if (firstPath.current === null) {
      firstPath.current = pathname;
      return;
    }
    if (firstPath.current === pathname) return;
    firstPath.current = pathname;
    const cur = burstRef.current;
    if (!cur || cur.phase === "reveal") return;
    const delay = menuRevealDelayMs(performance.now() - startedAt.current);
    timers.current.push(window.setTimeout(() => beginReveal(cur.id), delay));
  }, [pathname]);

  useEffect(() => () => clearTimers(), []);

  if (!burst) return null;
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
