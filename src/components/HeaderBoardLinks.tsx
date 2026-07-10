"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

const BOARD_LINKS = [
  { href: "/board/notice", label: "공지사항", noticeBadge: true },
  { href: "/board/inquiry", label: "문의게시판" },
  { href: "/board/faq", label: "FAQ" },
] as const;

type Props = {
  unreadNotice: boolean;
};

/** Desktop: inline links. Mobile: single “더보기” button → sheet (no horizontal scroll strip). */
export default function HeaderBoardLinks({ unreadNotice }: Props) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointer = (e: MouseEvent | TouchEvent) => {
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("touchstart", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("touchstart", onPointer);
    };
  }, [open]);

  return (
    <>
      {/* md+: keep inline board links next to brand */}
      <nav className="hidden items-center gap-4 md:flex" aria-label="게시판">
        {BOARD_LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="shrink-0 font-medium text-zinc-300 transition hover:text-white"
          >
            {l.label}
            {l.noticeBadge && unreadNotice && (
              <sup className="ml-0.5 text-[9px] font-bold text-red-400">N</sup>
            )}
          </Link>
        ))}
      </nav>

      {/* <md: one control — no sideways scroll of board labels */}
      <div ref={rootRef} className="relative md:hidden">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-zinc-300 transition hover:bg-white/[0.06] hover:text-white"
        >
          안내
          {unreadNotice && (
            <span className="h-1.5 w-1.5 rounded-full bg-red-400" aria-label="새 공지" />
          )}
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            className={`h-3.5 w-3.5 text-zinc-500 transition ${open ? "rotate-180" : ""}`}
            aria-hidden
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </button>

        {open && (
          <div
            id={panelId}
            role="menu"
            className="absolute left-0 top-full z-50 mt-1.5 min-w-[11rem] overflow-hidden rounded-xl border border-white/10 bg-[#14161f] py-1 shadow-xl shadow-black/40"
          >
            {BOARD_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-white/[0.06] hover:text-white"
              >
                <span>{l.label}</span>
                {l.noticeBadge && unreadNotice && (
                  <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-bold text-red-300">
                    NEW
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
