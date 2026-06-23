"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LOREBOOK_CONTENT_MAX,
  LOREBOOK_ENTRY_MAX,
  LOREBOOK_KEYWORDS_PER_ENTRY,
  LOREBOOK_NAME_LIMIT,
  LOREBOOK_SUMMARY_LIMIT,
  type KeywordLorebookEntryInput,
} from "@/lib/keywordLorebooks";

const cls =
  "w-full rounded-xl border border-white/10 bg-[#1a1a2e] px-4 py-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-emerald-500/40";
const label = "mb-1.5 block text-xs font-semibold text-zinc-400";

const emptyEntry = (): KeywordLorebookEntryInput => ({ keywords: "", content: "" });

type Props = {
  lorebookId?: number;
};

export default function CreateKeywordLorebook({ lorebookId }: Props) {
  const router = useRouter();
  const isEdit = lorebookId != null;
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [entries, setEntries] = useState<KeywordLorebookEntryInput[]>([emptyEntry()]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [bootLoading, setBootLoading] = useState(isEdit);

  useEffect(() => {
    if (!isEdit || lorebookId == null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/lorebooks/${lorebookId}`);
        const data = await res.json();
        if (!res.ok) {
          if (!cancelled) setError(data.error || "불러오기에 실패했습니다.");
          return;
        }
        if (cancelled) return;
        setName(data.lorebook?.name ?? "");
        setSummary(data.lorebook?.summary ?? "");
        const loaded = Array.isArray(data.entries) ? data.entries : [];
        setEntries(loaded.length > 0 ? loaded : [emptyEntry()]);
      } catch {
        if (!cancelled) setError("불러오기 중 오류가 발생했습니다.");
      } finally {
        if (!cancelled) setBootLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEdit, lorebookId]);

  function updateEntry(index: number, patch: Partial<KeywordLorebookEntryInput>) {
    setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }

  function addEntry() {
    if (entries.length >= LOREBOOK_ENTRY_MAX) return;
    setEntries((prev) => [...prev, emptyEntry()]);
  }

  function removeEntry(index: number) {
    setEntries((prev) => (prev.length <= 1 ? [emptyEntry()] : prev.filter((_, i) => i !== index)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch(isEdit ? `/api/lorebooks/${lorebookId}` : "/api/lorebooks", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, summary, entries }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "저장에 실패했습니다.");
        return;
      }
      router.push("/studio");
      router.refresh();
    } catch {
      setError("저장 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  if (bootLoading) {
    return <p className="mx-auto max-w-2xl px-4 py-12 text-sm text-zinc-500">불러오는 중…</p>;
  }

  const filledCount = entries.filter((e) => e.keywords.trim() || e.content.trim()).length;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link href="/studio" className="text-sm text-zinc-500 hover:text-zinc-300">
          ← 제작 메뉴
        </Link>
      </div>

      <h1 className="text-2xl font-black text-white">{isEdit ? "📖 로어북 수정" : "📖 로어북 제작"}</h1>
      <p className="mt-2 text-sm leading-relaxed text-gray-400">
        유저 입력에 특정 키워드가 포함되면 해당 내용이 프롬프트에{" "}
        <b className="text-emerald-300/90">번역 없이</b> 그대로 주입됩니다. 키워드는 한 칸에 최대{" "}
        {LOREBOOK_KEYWORDS_PER_ENTRY}개, <code className="text-emerald-200/80">│</code> 로 구분합니다.
      </p>
      <p className="mt-1 text-xs text-zinc-600">
        예: <span className="text-zinc-400">!유나│!헌터│!얼음마녀</span> — 유저가 이 중 하나를 입력하면 내용이
        불러와집니다.
      </p>

      <form onSubmit={submit} className="mt-8 space-y-6">
        <div>
          <label className={label}>로어북 이름 *</label>
          <input
            className={cls}
            placeholder="예: 주요 인물 설정"
            value={name}
            maxLength={LOREBOOK_NAME_LIMIT}
            onChange={(e) => setName(e.target.value.slice(0, LOREBOOK_NAME_LIMIT))}
          />
        </div>

        <div>
          <label className={label}>한 줄 요약</label>
          <input
            className={cls}
            placeholder="목록에서 구분하기 위한 짧은 설명 (선택)"
            value={summary}
            maxLength={LOREBOOK_SUMMARY_LIMIT}
            onChange={(e) => setSummary(e.target.value.slice(0, LOREBOOK_SUMMARY_LIMIT))}
          />
        </div>

        <div>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <label className={label}>항목</label>
              <p className="text-[11px] text-zinc-600">
                항목당 내용 {LOREBOOK_CONTENT_MAX}자 · 최대 {LOREBOOK_ENTRY_MAX}개
              </p>
            </div>
            <p className="text-xs tabular-nums text-zinc-500">
              {filledCount} / {LOREBOOK_ENTRY_MAX}
            </p>
          </div>

          <div className="space-y-4">
            {entries.map((entry, index) => (
              <div key={index} className="rounded-2xl border border-white/10 bg-[#131626] p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-emerald-300/90">#{index + 1}</span>
                  <button
                    type="button"
                    onClick={() => removeEntry(index)}
                    className="text-xs text-zinc-500 hover:text-rose-400"
                  >
                    삭제
                  </button>
                </div>
                <label className={label}>키워드 (최대 {LOREBOOK_KEYWORDS_PER_ENTRY}개 · │ 구분)</label>
                <input
                  className={cls}
                  placeholder="!유나│!헌터│!얼음마녀"
                  value={entry.keywords}
                  onChange={(e) => updateEntry(index, { keywords: e.target.value })}
                />
                <label className={`${label} mt-3`}>내용</label>
                <textarea
                  rows={4}
                  className={cls}
                  placeholder="키워드가 유저 입력에 포함되면 주입할 설정·설명"
                  value={entry.content}
                  maxLength={LOREBOOK_CONTENT_MAX}
                  onChange={(e) => updateEntry(index, { content: e.target.value.slice(0, LOREBOOK_CONTENT_MAX) })}
                />
                <p className="mt-1 text-right text-[10px] tabular-nums text-zinc-600">
                  {entry.content.length} / {LOREBOOK_CONTENT_MAX}
                </p>
              </div>
            ))}
          </div>

          {entries.length < LOREBOOK_ENTRY_MAX && (
            <button
              type="button"
              onClick={addEntry}
              className="mt-3 w-full rounded-xl border border-dashed border-white/15 py-2.5 text-sm font-semibold text-zinc-400 hover:border-emerald-500/40 hover:text-emerald-300"
            >
              + 항목 추가
            </button>
          )}
        </div>

        {error && <p className="text-sm text-rose-400">{error}</p>}

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={loading}
            className="rounded-xl bg-emerald-600 px-6 py-3 font-bold text-white disabled:opacity-50"
          >
            {loading ? "저장 중…" : isEdit ? "로어북 저장" : "로어북 만들기"}
          </button>
          <Link
            href="/create"
            className="rounded-xl border border-white/10 px-6 py-3 text-sm font-semibold text-zinc-300 hover:bg-white/5"
          >
            캐릭터 제작으로
          </Link>
        </div>
      </form>
    </div>
  );
}
