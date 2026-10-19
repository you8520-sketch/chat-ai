"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import LogoutButton from "./LogoutButton";
import UserPreferenceControls from "./UserPreferenceControls";

type Props = {
  nickname: string;
  isAdult: boolean;
  canDisableSafetyFilter: boolean;
  nsfwOn: boolean;
  pref: "female" | "male" | null;
};

/** Profile menu — 설정 · 앨범 · 세이프티 필터 · 로그아웃 (모바일·데스크톱 공통). */
export default function HeaderProfileMenu({
  nickname,
  isAdult,
  canDisableSafetyFilter,
  nsfwOn,
  pref,
}: Props) {
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
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="프로필 메뉴"
        title={nickname}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 max-w-[7rem] items-center gap-1 rounded-xl border border-white/10 bg-white/[0.04] px-1.5 text-xs font-semibold text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.07] hover:text-white sm:px-2"
      >
        <span
          aria-hidden
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-violet-500/20 text-xs font-bold text-violet-100 sm:hidden"
        >
          {Array.from(nickname.trim())[0] ?? "?"}
        </span>
        <span className="hidden truncate sm:inline">{nickname}</span>
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`h-3.5 w-3.5 shrink-0 text-zinc-500 transition ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      <div
        id={panelId}
        role="menu"
        hidden={!open}
        className="absolute right-0 top-full z-50 mt-1.5 min-w-[12.5rem] overflow-hidden rounded-xl border border-white/10 bg-[#131626] py-1 shadow-xl shadow-black/40"
      >
          <Link
            href="/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-3.5 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-white/[0.06] hover:text-white"
          >
            설정
          </Link>
          <Link
            href="/albums"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-3.5 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-white/[0.06] hover:text-white"
          >
            앨범
          </Link>
          <UserPreferenceControls
            variant="profileMenu"
            isAdult={isAdult}
            canDisableSafetyFilter={canDisableSafetyFilter}
            nsfwOn={nsfwOn}
            pref={pref}
          />
          <div className="border-t border-white/[0.06] px-3.5 py-2">
            <LogoutButton className="w-full text-left text-sm font-medium text-zinc-400 transition hover:text-white" />
          </div>
      </div>
    </div>
  );
}
