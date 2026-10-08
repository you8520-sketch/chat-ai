"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { usePathname } from "next/navigation";

import {
  isPlainLeftClick,
  menuTransitionSpecForPath,
  type MenuTransitionSpec,
} from "@/lib/menuTransitionSpec";

/**
 * Phase C — 메뉴 시네마틱 전환의 단일 owner.
 *
 * - canonical navigation owner는 기존 `next/link` 그대로 (href·redirect·query 불변).
 * - 이 모듈은 시각적 향상만 담당: 클릭 감지 → 오버레이 연출 → 경로 변경 후 해제.
 * - navigation을 지연시키지 않고, router를 직접 호출하지 않으며,
 *   오버레이는 항상 `pointer-events: none`이라 기능을 가로막지 않는다.
 */

type Burst = {
  id: number;
  spec: MenuTransitionSpec;
  dest: string;
  phase: "cover" | "reveal";
};

const COVER_MS = 620;
const REVEAL_MS = 480;
const FAILSAFE_MS = 1800;

let burstSeq = 0;

/** 루트 레이아웃에 상주하는 단일 전환 레이어. */
export default function MenuTransitionHost() {
  const pathname = usePathname();
  const [burst, setBurst] = useState<Burst | null>(null);
  const burstRef = useRef<Burst | null>(null);
  const timers = useRef<number[]>([]);
  const firstPath = useRef<string | null>(null);

  function clearTimers() {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
  }

  function scheduleBurst(spec: MenuTransitionSpec, dest: string) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    clearTimers();
    burstSeq += 1;
    const next: Burst = { id: burstSeq, spec, dest, phase: "cover" };
    burstRef.current = next;
    setBurst(next);
    // BEAT 2 → BEAT 3: 목적지 도착 전이라도 정해진 시간에 걷힌다.
    timers.current.push(
      window.setTimeout(() => {
        const cur = burstRef.current;
        if (cur && cur.id === next.id) {
          const revealed: Burst = { ...cur, phase: "reveal" };
          burstRef.current = revealed;
          setBurst(revealed);
        }
      }, COVER_MS),
    );
    // 이동 실패·지연 대비 failsafe — 화면을 영구히 덮지 않는다.
    timers.current.push(
      window.setTimeout(() => {
        if (burstRef.current && burstRef.current.id === next.id) {
          burstRef.current = null;
          setBurst(null);
        }
      }, FAILSAFE_MS),
    );
  }

  // BEAT 1 — 메뉴 클릭의 즉각 반응 + BEAT 2 진입. navigation은 그대로 진행.
  useEffect(() => {
    function onClickCapture(e: MouseEvent) {
      if (!isPlainLeftClick(e)) return;
      const anchor = (e.target as HTMLElement).closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target === "_blank") return;
      const href = anchor.getAttribute("href") ?? "";
      if (!href.startsWith("/")) return;
      const spec = menuTransitionSpecForPath(href);
      if (!spec) return;
      // 클릭한 링크에 즉시 반응 표시 (시각 전용, 이동 불변).
      anchor.classList.remove("menu-flash");
      void anchor.offsetWidth;
      anchor.classList.add("menu-flash");
      window.setTimeout(() => anchor.classList.remove("menu-flash"), 350);
      scheduleBurst(spec, href.split("?")[0]!);
    }
    document.addEventListener("click", onClickCapture, true);
    return () => document.removeEventListener("click", onClickCapture, true);
  }, []);

  // BEAT 3 — 목적지 도착 시 reveal 후 해제. 뒤로/앞으로 가기도 동일 처리.
  useEffect(() => {
    if (firstPath.current === null) {
      firstPath.current = pathname;
      return;
    }
    const prev = firstPath.current;
    firstPath.current = pathname;
    if (prev === pathname) {
      // 같은 메뉴 재클릭 — failsafe가 걷어낸다.
      return;
    }
    const cur = burstRef.current;
    if (cur) {
      const arrived: Burst = { ...cur, phase: "reveal" };
      burstRef.current = arrived;
      setBurst(arrived);
      clearTimers();
      timers.current.push(
        window.setTimeout(() => {
          if (burstRef.current && burstRef.current.id === arrived.id) {
            burstRef.current = null;
            setBurst(null);
          }
        }, REVEAL_MS),
      );
    } else {
      // 클릭 없이 경로가 바뀐 경우(뒤로/앞으로 가기, 프로그래밍 이동) — 짧게만.
      const spec = menuTransitionSpecForPath(pathname);
      if (spec && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        scheduleBurst(spec, pathname);
      }
    }
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
      style={{ "--menu-accent": spec.accent } as CSSProperties}
    >
      <div className="menu-slash menu-slash-a" />
      <div className="menu-slash menu-slash-b" />
      <div className="menu-type">
        <span className="menu-en">{spec.en}</span>
        <span className="menu-ko">{spec.ko}</span>
      </div>
      <div className="menu-baseline" />
    </div>
  );
}
