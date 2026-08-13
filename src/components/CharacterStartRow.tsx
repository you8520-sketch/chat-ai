"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import PersonaSelector from "@/components/PersonaSelector";
import StartChatButton from "@/components/StartChatButton";
import type { PublicPersonaListItem } from "@/lib/userPersonasClient";
import type { UserChatSession } from "@/lib/recentChats";

const PERSONA_STORAGE_KEY = "habi:lastPersonaId";

type Props = {
  characterId: number;
  characterName: string;
  loggedIn: boolean;
  branches: UserChatSession[];
  personas: PublicPersonaListItem[];
  initialPersonaId: number | null;
  /** Chat-intro iframe: always start a fresh chat and navigate the top window. */
  embedMode?: boolean;
  startLabel?: string;
  trpgHref?: string | null;
};

export default function CharacterStartRow({
  characterId,
  characterName,
  loggedIn,
  branches,
  personas: initialPersonas,
  initialPersonaId,
  embedMode = false,
  startLabel,
  trpgHref = null,
}: Props) {
  const [personas, setPersonas] = useState(initialPersonas);
  const [selectedPersonaId, setSelectedPersonaId] = useState<number | null>(initialPersonaId);

  useEffect(() => {
    setPersonas(initialPersonas);
  }, [initialPersonas]);

  useEffect(() => {
    if (!loggedIn) return;
    let cancelled = false;
    async function refreshPersonas() {
      try {
        const res = await fetch("/api/personas", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { personas?: PublicPersonaListItem[] };
        if (cancelled || !Array.isArray(data.personas)) return;
        setPersonas(data.personas);
      } catch {
        /* ignore */
      }
    }
    void refreshPersonas();
    function onVisible() {
      if (document.visibilityState === "visible") void refreshPersonas();
    }
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted) void refreshPersonas();
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [loggedIn]);

  useEffect(() => {
    if (!loggedIn || personas.length === 0) return;
    try {
      const stored = localStorage.getItem(PERSONA_STORAGE_KEY);
      const storedId = stored ? Number(stored) : NaN;
      if (Number.isFinite(storedId) && personas.some((p) => p.id === storedId)) {
        setSelectedPersonaId(storedId);
        return;
      }
    } catch {
      /* ignore */
    }
    setSelectedPersonaId((prev) => {
      if (prev != null && personas.some((p) => p.id === prev)) return prev;
      return initialPersonaId ?? personas[0]?.id ?? null;
    });
  }, [loggedIn, personas, initialPersonaId]);

  function handlePersonaChange(personaId: number) {
    setSelectedPersonaId(personaId);
    try {
      localStorage.setItem(PERSONA_STORAGE_KEY, String(personaId));
    } catch {
      /* ignore */
    }
  }

  const actionBtn =
    "inline-flex items-center justify-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-semibold text-zinc-200 transition hover:bg-white/10";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <StartChatButton
        characterId={characterId}
        characterName={characterName}
        loggedIn={loggedIn}
        branches={branches}
        selectedPersonaId={selectedPersonaId}
        className={actionBtn}
        startLabel={startLabel}
        alwaysNewChat={embedMode}
        openInTop={embedMode}
      />
      {trpgHref ? (
        <Link href={trpgHref} className={actionBtn}>
          TRPG로 시작
        </Link>
      ) : null}
      {loggedIn && personas.length > 0 && (
        <PersonaSelector
          chatId={null}
          personas={personas}
          selectedPersonaId={selectedPersonaId}
          onSelectedChange={handlePersonaChange}
          triggerClassName={`${actionBtn} max-w-[14rem]`}
          addPersonaHref="/persona#personas"
          linkTarget={embedMode ? "_top" : undefined}
        />
      )}
    </div>
  );
}
