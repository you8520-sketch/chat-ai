"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppPageShell } from "@/components/AppPageShell";
import PersonaSelector from "@/components/PersonaSelector";
import type { PublicPersonaListItem } from "@/lib/userPersonasClient";

const PERSONA_STORAGE_KEY = "habi:lastPersonaId";

export default function TrpgJoinClient({
  code,
  title,
  remainingSlots,
  personas: initialPersonas,
}: {
  code: string;
  title: string;
  remainingSlots: number;
  personas: PublicPersonaListItem[];
}) {
  const router = useRouter();
  const [personas, setPersonas] = useState(initialPersonas);
  const [selectedPersonaId, setSelectedPersonaId] = useState<number | null>(initialPersonas[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setPersonas(initialPersonas);
  }, [initialPersonas]);

  useEffect(() => {
    if (personas.length === 0) return;
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
      return personas[0]?.id ?? null;
    });
  }, [personas]);

  function handlePersonaChange(personaId: number) {
    setSelectedPersonaId(personaId);
    try {
      localStorage.setItem(PERSONA_STORAGE_KEY, String(personaId));
    } catch {
      /* ignore */
    }
  }

  async function join() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/trpg/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          ...(selectedPersonaId != null ? { personaId: selectedPersonaId } : {}),
        }),
      });
      const data = (await res.json()) as { campaignId?: number; error?: string };
      if (!res.ok || !data.campaignId) throw new Error(data.error || "참가하지 못했습니다.");
      router.push(`/trpg/${data.campaignId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "참가하지 못했습니다.");
      setBusy(false);
    }
  }

  return (
    <AppPageShell title="TRPG 입장" description={`${title} · 남은 자리 ${remainingSlots}`} narrow>
      <p className="text-sm leading-relaxed text-zinc-400">
        페르소나를 고르면 빈 자리가 그 페르소나로 채워집니다.
      </p>
      {personas.length > 0 ? (
        <div className="mt-4">
          <p className="mb-2 text-sm text-zinc-300">내 페르소나</p>
          <PersonaSelector
            chatId={null}
            personas={personas}
            selectedPersonaId={selectedPersonaId}
            onSelectedChange={handlePersonaChange}
            addPersonaHref="/persona#personas"
          />
        </div>
      ) : null}
      {error ? (
        <p className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>
      ) : null}
      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void join()}
          className="inline-flex min-h-10 items-center rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
        >
          이 페르소나로 참가
        </button>
        <Link
          href="/trpg"
          className="inline-flex min-h-10 items-center rounded-xl border border-white/10 px-4 text-sm font-semibold text-zinc-300 hover:bg-white/5"
        >
          로비로
        </Link>
      </div>
    </AppPageShell>
  );
}
