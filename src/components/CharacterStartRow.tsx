"use client";

import { useEffect, useState } from "react";

import PersonaSelector from "@/components/PersonaSelector";
import StartChatButton from "@/components/StartChatButton";
import type { PersonaListItem } from "@/lib/userPersonas";
import type { UserChatSession } from "@/lib/recentChats";

const PERSONA_STORAGE_KEY = "habi:lastPersonaId";

type Props = {
  characterId: number;
  characterName: string;
  loggedIn: boolean;
  branches: UserChatSession[];
  personas: PersonaListItem[];
  initialPersonaId: number | null;
};

export default function CharacterStartRow({
  characterId,
  characterName,
  loggedIn,
  branches,
  personas,
  initialPersonaId,
}: Props) {
  const [selectedPersonaId, setSelectedPersonaId] = useState<number | null>(initialPersonaId);

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
    setSelectedPersonaId(initialPersonaId ?? personas[0]?.id ?? null);
  }, [loggedIn, personas, initialPersonaId]);

  function handlePersonaChange(personaId: number) {
    setSelectedPersonaId(personaId);
    try {
      localStorage.setItem(PERSONA_STORAGE_KEY, String(personaId));
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <StartChatButton
        characterId={characterId}
        characterName={characterName}
        loggedIn={loggedIn}
        branches={branches}
        selectedPersonaId={selectedPersonaId}
      />
      {loggedIn && personas.length > 0 && (
        <PersonaSelector
          chatId={null}
          personas={personas}
          selectedPersonaId={selectedPersonaId}
          onSelectedChange={handlePersonaChange}
          triggerClassName="max-w-[14rem] rounded-full border-0 bg-white/5 px-8 py-3 text-base font-bold text-gray-200 hover:bg-white/10"
          addPersonaHref="/persona#personas"
        />
      )}
    </div>
  );
}
