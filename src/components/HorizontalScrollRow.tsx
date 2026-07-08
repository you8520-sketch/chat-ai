"use client";

import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

/**
 * 스크롤바 없는 가로 스크롤 — 터치는 브라우저 기본 스와이프, 마우스는 클릭+드래그로 넘김.
 * 드래그가 일정 거리 이상 움직이면 하위 링크 클릭(카드 이동)을 막아 오작동을 방지.
 */
export default function HorizontalScrollRow({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const drag = useRef({
    active: false,
    captured: false,
    pointerId: -1,
    startX: 0,
    startScroll: 0,
    moved: false,
  });
  const DRAG_THRESHOLD_PX = 10;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") return;
    const el = scrollerRef.current;
    if (!el) return;
    drag.current = {
      active: true,
      captured: false,
      pointerId: e.pointerId,
      startX: e.clientX,
      startScroll: el.scrollLeft,
      moved: false,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = scrollerRef.current;
    const state = drag.current;
    if (!el || !state.active || state.pointerId !== e.pointerId) return;
    const dx = e.clientX - state.startX;
    if (Math.abs(dx) <= DRAG_THRESHOLD_PX && !state.moved) return;
    if (!state.captured) {
      try {
        el.setPointerCapture(e.pointerId);
        state.captured = true;
      } catch {
        /* pointer may already be unavailable */
      }
    }
    state.moved = true;
    el.scrollLeft = state.startScroll - dx;
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = scrollerRef.current;
    if (el && drag.current.active && drag.current.captured) {
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* pointer already released */
      }
    }
    drag.current.active = false;
  };

  const onClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (drag.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      drag.current.moved = false;
    }
  };

  return (
    <div
      ref={scrollerRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={endDrag}
      onClickCapture={onClickCapture}
      onDragStart={(e) => e.preventDefault()}
      className={`scrollbar-hide flex cursor-grab gap-3 overflow-x-auto select-none active:cursor-grabbing ${className}`}
    >
      {children}
    </div>
  );
}
