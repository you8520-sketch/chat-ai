"use client";

import { useCallback, useEffect, useState } from "react";
import {
  LOREBOOK_CONTENT_MAX,
  LOREBOOK_ENTRY_MAX,
  LOREBOOK_KEYWORDS_PER_ENTRY,
  parseKeywordField,
} from "@/lib/keywordLorebooks";
import type { SubscriptionMemoryCapability } from "@/lib/subscriptionMemoryCapability";
import type {
  UserLorebookEntryEffectiveState,
  UserLorebookStoredEntry,
} from "@/lib/userLorebook";
import LorebookKeywordInput from "@/components/LorebookKeywordInput";
import { cn, studioSurface, studioType } from "@/lib/studioDesign";

type LorebookView = {
  entries: UserLorebookStoredEntry[];
  entryEffectiveStates?: UserLorebookEntryEffectiveState[];
  capability: SubscriptionMemoryCapability;
  effectiveActiveEntryCount: number;
  effectiveActiveContentChars: number;
};

type EntryDraft = {
  keywords: string;
  content: string;
  enabled: boolean;
};

const emptyEntry = (): EntryDraft => ({ keywords: "", content: "", enabled: true });

function toDraft(entry: UserLorebookStoredEntry): EntryDraft {
  return {
    keywords: entry.keywords.join("│"),
    content: entry.content,
    enabled: entry.enabled !== false,
  };
}

export default function UserLorebookEditor({
  chatId,
  focusMaxChars,
}: {
  chatId: number | null;
  focusMaxChars: number;
}) {
  const [entries, setEntries] = useState<EntryDraft[]>([]);
  const [capability, setCapability] = useState<SubscriptionMemoryCapability | null>(null);
  const [effectiveActiveEntryCount, setEffectiveActiveEntryCount] = useState(0);
  const [effectiveActiveContentChars, setEffectiveActiveContentChars] = useState(0);
  const [entryEffectiveStates, setEntryEffectiveStates] = useState<UserLorebookEntryEffectiveState[]>(
    []
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!chatId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/chat/user-lorebook?chatId=${chatId}`);
      const data = (await res.json()) as { lorebook?: LorebookView; error?: string };
      if (!res.ok) throw new Error(data.error ?? "불러오기 실패");
      const lorebook = data.lorebook!;
      setEntries(lorebook.entries.map(toDraft));
      setCapability(lorebook.capability);
      setEffectiveActiveEntryCount(lorebook.effectiveActiveEntryCount);
      setEffectiveActiveContentChars(lorebook.effectiveActiveContentChars);
      setEntryEffectiveStates(lorebook.entryEffectiveStates ?? []);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [chatId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(nextEntries: EntryDraft[]) {
    if (!chatId) {
      setMessage("첫 메시지 전송 후 이 방에 저장할 수 있습니다.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const payload = nextEntries.map((entry) => ({
        keywords: entry.keywords,
        content: entry.content,
        enabled: entry.enabled,
      }));
      const res = await fetch("/api/chat/user-lorebook", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, entries: payload }),
      });
      const data = (await res.json()) as { lorebook?: LorebookView; error?: string };
      if (!res.ok) throw new Error(data.error ?? "저장 실패");
      const lorebook = data.lorebook!;
      setEntries(lorebook.entries.map(toDraft));
      setCapability(lorebook.capability);
      setEffectiveActiveEntryCount(lorebook.effectiveActiveEntryCount);
      setEffectiveActiveContentChars(lorebook.effectiveActiveContentChars);
      setEntryEffectiveStates(lorebook.entryEffectiveStates ?? []);
      setMessage("내 로어북이 저장되었습니다.");
      window.setTimeout(() => setMessage(""), 2500);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const cap = capability ?? {
    focusMaxChars,
    userLorebookActiveEntryMax: 10,
    userLorebookActiveContentMaxChars: 5_000,
    userLorebookTurnInjectMaxChars: 2_500,
  };

  return (
    <section className="space-y-3 rounded-lg border border-violet-400/35 bg-violet-500/[0.07] p-3">
      <div>
        <p className="text-[11px] font-bold text-violet-200">내 로어북</p>
        <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-400">
          키워드가 매칭되면 턴당 최대 {cap.userLorebookTurnInjectMaxChars.toLocaleString()}자까지 주입됩니다.
          활성 항목 {effectiveActiveEntryCount}/{cap.userLorebookActiveEntryMax} · 활성 내용{" "}
          {effectiveActiveContentChars.toLocaleString()}/
          {cap.userLorebookActiveContentMaxChars.toLocaleString()}자
        </p>
      </div>

      {loading ? <p className="text-[10px] text-zinc-500">불러오는 중…</p> : null}
      {message ? <p className="text-[10px] text-violet-300/90">{message}</p> : null}

      <div className="space-y-3">
        {entries.map((entry, index) => {
          const effectiveState = entryEffectiveStates[index];
          const inactiveLabel =
            effectiveState?.inactiveReason === "entry_count_cap" ||
            effectiveState?.inactiveReason === "content_cap"
              ? "현재 요금제 한도로 비활성"
              : effectiveState?.inactiveReason === "disabled"
                ? "사용자 비활성"
                : null;
          return (
          <div key={index} className={cn(studioSurface.card, "space-y-2 p-3")}>
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-[11px] text-zinc-300">
                <input
                  type="checkbox"
                  checked={entry.enabled}
                  onChange={(e) => {
                    const next = entries.map((row, i) =>
                      i === index ? { ...row, enabled: e.target.checked } : row
                    );
                    setEntries(next);
                  }}
                />
                활성
              </label>
              {entry.enabled && inactiveLabel ? (
                <span className="text-[10px] text-rose-300/90">{inactiveLabel}</span>
              ) : null}
              <button
                type="button"
                className="text-[10px] text-red-300 hover:text-red-200"
                onClick={() => setEntries(entries.filter((_, i) => i !== index))}
              >
                삭제
              </button>
            </div>
            <LorebookKeywordInput
              value={entry.keywords}
              onChange={(keywords) => {
                const next = entries.map((row, i) => (i === index ? { ...row, keywords } : row));
                setEntries(next);
              }}
            />
            <textarea
              className="w-full rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 font-mono text-xs leading-relaxed text-zinc-200 outline-none focus:border-violet-500/40"
              rows={5}
              maxLength={LOREBOOK_CONTENT_MAX}
              value={entry.content}
              placeholder={`항목 내용 (최대 ${LOREBOOK_CONTENT_MAX}자)`}
              onChange={(e) => {
                const next = entries.map((row, i) =>
                  i === index ? { ...row, content: e.target.value.slice(0, LOREBOOK_CONTENT_MAX) } : row
                );
                setEntries(next);
              }}
            />
            <p className={studioType.counter}>
              {entry.content.length}/{LOREBOOK_CONTENT_MAX} · 키워드{" "}
              {parseKeywordField(entry.keywords).length}/{LOREBOOK_KEYWORDS_PER_ENTRY}
            </p>
          </div>
        );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={entries.length >= LOREBOOK_ENTRY_MAX || saving}
          className="rounded border border-violet-400/50 bg-violet-500/15 px-2.5 py-1 text-[11px] font-semibold text-violet-100 hover:bg-violet-500/25 disabled:opacity-40"
          onClick={() => setEntries([...entries, emptyEntry()])}
        >
          항목 추가
        </button>
        <button
          type="button"
          disabled={saving}
          className="rounded border border-violet-400/50 bg-violet-500/15 px-2.5 py-1 text-[11px] font-semibold text-violet-100 hover:bg-violet-500/25 disabled:opacity-40"
          onClick={() => void save(entries)}
        >
          {saving ? "저장 중…" : "내 로어북 저장"}
        </button>
      </div>
    </section>
  );
}
