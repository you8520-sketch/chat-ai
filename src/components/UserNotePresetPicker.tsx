"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { UserNotePresetItem } from "@/lib/userNotePresetTypes";

type Props = {
  presets: UserNotePresetItem[];
  selectedPresetId: number | null;
  onSelect: (preset: UserNotePresetItem) => void;
  disabled?: boolean;
};

export default function UserNotePresetPicker({
  presets,
  selectedPresetId,
  onSelect,
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = presets.find((p) => p.id === selectedPresetId) ?? null;

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    if (!open) return;
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  if (presets.length === 0) {
    return (
      <Link
        href="/persona#user-note-presets"
        className="rounded border border-violet-500/30 px-2 py-0.5 text-[10px] text-violet-200/90 hover:bg-violet-500/10"
      >
        관리
      </Link>
    );
  }

  return (
    <div ref={rootRef} className="inline-flex flex-col items-end">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded border border-white/10 px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-white/5 hover:text-zinc-200 disabled:opacity-40"
      >
        {selected ? selected.title : "저장 목록"}
        <span className="text-zinc-600">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="mt-1 w-44 rounded-lg border border-white/10 bg-[#1a1a1a] p-1 shadow-xl">
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              disabled={disabled}
              onClick={() => {
                onSelect(preset);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[10px] transition ${
                preset.id === selectedPresetId
                  ? "bg-violet-500/20 text-violet-200"
                  : "text-zinc-300 hover:bg-white/5"
              }`}
            >
              <span className="min-w-0 flex-1 truncate font-semibold">{preset.title}</span>
              {preset.id === selectedPresetId && (
                <span className="shrink-0 text-violet-400">✓</span>
              )}
            </button>
          ))}
          <Link
            href="/persona#user-note-presets"
            className="mt-1 flex w-full items-center justify-center rounded-md border border-dashed border-violet-500/30 px-2 py-1.5 text-[10px] text-violet-300/90 hover:bg-violet-500/10"
          >
            관리
          </Link>
        </div>
      )}
    </div>
  );
}
