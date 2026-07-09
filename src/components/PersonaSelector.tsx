"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { PersonaListItem } from "@/lib/userPersonas";

type Props = {
  chatId: number | null;
  personas: PersonaListItem[];
  selectedPersonaId: number | null;
  onSelectedChange: (personaId: number) => void;
  onOpenEditor?: () => void;
  variant?: "dropdown" | "list";
  addPersonaHref?: string;
  /** 트리거 버튼 추가 클래스 (캐릭터 페이지 액션 행 등) */
  triggerClassName?: string;
};

const DEFAULT_ADD_PERSONA_HREF = "/persona#personas";
const PERSONA_STORAGE_KEY = "habi:lastPersonaId";

function rememberPersonaSelection(personaId: number) {
  try {
    localStorage.setItem(PERSONA_STORAGE_KEY, String(personaId));
  } catch {
    /* ignore */
  }
}

function PersonaAddButton({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-violet-500/30 px-2.5 py-2 text-[11px] font-semibold text-violet-300/90 transition hover:border-violet-500/50 hover:bg-violet-500/10"
    >
      + 페르소나 추가하기
    </Link>
  );
}

export default function PersonaSelector({
  chatId,
  personas,
  selectedPersonaId,
  onSelectedChange,
  onOpenEditor,
  variant = "dropdown",
  addPersonaHref = DEFAULT_ADD_PERSONA_HREF,
  triggerClassName = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const selected =
    selectedPersonaId != null
      ? personas.find((p) => p.id === selectedPersonaId) ?? null
      : null;

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function showNotice(msg: string) {
    setNotice(msg);
    window.setTimeout(() => setNotice(""), 2800);
  }

  async function pickPersona(persona: PersonaListItem) {
    if (persona.id === selectedPersonaId) {
      setOpen(false);
      return;
    }

    setBusy(true);
    try {
      if (chatId) {
        const res = await fetch("/api/chat/persona", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId, selectedPersonaId: persona.id }),
        });
        const data = await res.json();
        if (data.fallbackApplied) {
          showNotice(data.error || "페르소나를 찾을 수 없습니다.");
          if (data.selectedPersonaId) {
            rememberPersonaSelection(data.selectedPersonaId);
            onSelectedChange(data.selectedPersonaId);
          }
        } else if (res.ok) {
          const nextPersonaId = data.selectedPersonaId ?? persona.id;
          rememberPersonaSelection(nextPersonaId);
          onSelectedChange(nextPersonaId);
        } else {
          showNotice(data.error || "페르소나 변경에 실패했습니다.");
        }
      } else {
        rememberPersonaSelection(persona.id);
        onSelectedChange(persona.id);
      }
      setOpen(false);
    } catch {
      showNotice("페르소나 변경 중 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  }

  if (personas.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-xs font-medium text-zinc-300">등록된 페르소나가 없습니다.</p>
        <PersonaAddButton href={addPersonaHref} />
      </div>
    );
  }

  if (variant === "list") {
    return (
      <div ref={rootRef} className="space-y-2">
        <p className="text-xs font-bold text-violet-300">연기할 페르소나를 선택하세요.</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-[#1a1a1a] px-2.5 py-2 text-left text-xs transition hover:bg-white/5 disabled:opacity-50"
        >
          <span className="min-w-0 flex-1 truncate font-semibold text-zinc-200">
            {selected?.name ?? "페르소나를 선택하세요"}
          </span>
          {selected?.memo?.trim() && !open && (
            <span className="hidden min-w-0 truncate text-[10px] text-zinc-500 sm:block">{selected.memo}</span>
          )}
          <span className={`shrink-0 text-[10px] text-zinc-500 transition ${open ? "rotate-180" : ""}`}>
            ▾
          </span>
        </button>
        {open && (
          <div className="space-y-1 rounded-lg border border-white/5 bg-[#1a1a1a] p-1">
            {personas.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={busy}
                onClick={() => pickPersona(p)}
                className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition ${
                  p.id === selectedPersonaId
                    ? "bg-violet-500/20 text-violet-200"
                    : "text-zinc-200 hover:bg-white/5"
                }`}
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="block truncate font-semibold">{p.name}</span>
                  {p.memo?.trim() && (
                    <span className="block truncate text-[10px] text-zinc-500">{p.memo}</span>
                  )}
                </span>
                {p.id === selectedPersonaId && (
                  <span className="shrink-0 text-[10px] text-violet-400">✓</span>
                )}
              </button>
            ))}
            <PersonaAddButton href={addPersonaHref} />
          </div>
        )}
        {notice && (
          <p className="rounded-lg border border-amber-500/30 bg-[#2a2418] px-2.5 py-2 text-[10px] text-amber-200">
            {notice}
          </p>
        )}
      </div>
    );
  }

  const isCustomTrigger = Boolean(triggerClassName.trim());

  return (
    <div ref={rootRef} className="relative flex min-w-0 shrink-0 items-center gap-1">
      <div className={`relative min-w-0 ${isCustomTrigger ? "max-w-[14rem]" : "max-w-[160px]"}`}>
        <button
          type="button"
          disabled={busy}
          onClick={() => setOpen((v) => !v)}
          className={
            isCustomTrigger
              ? `flex w-full items-center gap-2 text-left transition disabled:opacity-50 ${triggerClassName}`
              : `flex w-full items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-left text-[11px] font-semibold text-zinc-200 transition hover:bg-white/10 disabled:opacity-50 ${triggerClassName}`
          }
          title="페르소나 선택"
        >
          <span className="truncate">{selected?.name ?? "페르소나"}</span>
          <span className={`shrink-0 ${isCustomTrigger ? "text-sm text-gray-400" : "text-zinc-500"}`}>▾</span>
        </button>

        {open && (
          <div className="absolute left-0 top-full z-30 mt-1 max-h-56 w-56 overflow-y-auto rounded-lg border border-white/10 bg-[#1a1a1a] py-1 shadow-xl">
            {personas.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={busy}
                onClick={() => pickPersona(p)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition ${
                  p.id === selectedPersonaId
                    ? "bg-violet-500/15 text-violet-200"
                    : "text-zinc-200 hover:bg-white/5"
                }`}
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="block truncate">{p.name}</span>
                  {p.memo?.trim() && (
                    <span className="block truncate text-[10px] text-zinc-500">{p.memo}</span>
                  )}
                </span>
                {p.id === selectedPersonaId && (
                  <span className="shrink-0 text-[10px] text-violet-400">✓</span>
                )}
              </button>
            ))}
            <div className="border-t border-white/5 p-1">
              <PersonaAddButton href={addPersonaHref} />
            </div>
          </div>
        )}

        {notice && (
          <p className="absolute left-0 top-full z-40 mt-1 w-56 rounded-lg border border-amber-500/30 bg-[#2a2418] px-2.5 py-2 text-[10px] leading-relaxed text-amber-200 shadow-lg">
            {notice}
          </p>
        )}
      </div>

      {onOpenEditor && (
        <button
          type="button"
          onClick={onOpenEditor}
          className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[11px] font-semibold text-zinc-300 transition hover:bg-white/10 hover:text-white"
          title="페르소나 보기·수정"
        >
          ✎
        </button>
      )}
    </div>
  );
}
