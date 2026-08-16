"use client";

import { useEffect, useRef, useState } from "react";
import {
  ADULT_HANDOFF_HINT,
  ADULT_HANDOFF_NOTICE,
  modelSupportsAdultHandoffNotice,
} from "@/lib/adultHandoffDisplay";
import { IconInfo } from "./ChatToolbarIcons";

export default function AdultHandoffModelNotice({
  selectedAI,
}: {
  selectedAI: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!modelSupportsAdultHandoffNotice(selectedAI)) return null;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-label={ADULT_HANDOFF_HINT}
        aria-expanded={open}
        title={ADULT_HANDOFF_HINT}
        onClick={() => setOpen((v) => !v)}
        className={`flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition hover:bg-white/5 hover:text-zinc-300 ${
          open ? "bg-white/5 text-zinc-300" : ""
        }`}
      >
        <IconInfo className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          role="tooltip"
          className="absolute bottom-full left-0 z-30 mb-1.5 w-64 rounded-lg border border-white/10 bg-[#1a1a1a]/95 p-2.5 text-[11px] leading-relaxed text-zinc-300 shadow-xl shadow-black/40 backdrop-blur-sm"
        >
          <p className="mb-1 font-semibold text-zinc-200">{ADULT_HANDOFF_HINT}</p>
          <p>{ADULT_HANDOFF_NOTICE}</p>
        </div>
      )}
    </div>
  );
}
