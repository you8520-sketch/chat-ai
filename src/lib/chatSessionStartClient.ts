const inFlight = new Map<string, Promise<{ chatId: number; created: boolean }>>();

export function chatRoomHref(characterId: number, chatId: number): string {
  return `/chat/${characterId}?chat=${chatId}`;
}

function requestKey(input: {
  characterId: number;
  fresh?: boolean;
  personaId?: number | null;
}): string {
  return `${input.characterId}:${input.fresh === true ? "fresh" : "reuse"}:${input.personaId ?? ""}`;
}

/** Coalesce duplicate in-flight POSTs from double-click / overlapping navigation. */
export function requestExplicitChatSession(input: {
  characterId: number;
  fresh?: boolean;
  personaId?: number | null;
}): Promise<{ chatId: number; created: boolean }> {
  const key = requestKey(input);
  const pending = inFlight.get(key);
  if (pending) return pending;

  const started = (async () => {
    const res = await fetch("/api/chat/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        characterId: input.characterId,
        fresh: input.fresh === true,
        personaId: input.personaId ?? undefined,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      chatId?: number;
      created?: boolean;
    };
    if (!res.ok || !data.chatId) {
      throw new Error(typeof data.error === "string" ? data.error : "채팅을 시작하지 못했습니다.");
    }
    return { chatId: Number(data.chatId), created: data.created === true };
  })();

  inFlight.set(key, started);
  void started.finally(() => {
    if (inFlight.get(key) === started) inFlight.delete(key);
  });
  return started;
}
