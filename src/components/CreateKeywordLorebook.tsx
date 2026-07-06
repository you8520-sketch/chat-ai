"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  LOREBOOK_CONTENT_MAX,
  LOREBOOK_ENTRY_MAX,
  LOREBOOK_KEYWORDS_PER_ENTRY,
  LOREBOOK_NAME_LIMIT,
  LOREBOOK_SUMMARY_LIMIT,
  parseKeywordField,
  type KeywordLorebookEntryInput,
} from "@/lib/keywordLorebooks";

const cls =
  "w-full rounded-xl border border-white/10 bg-[#1a1a2e] px-4 py-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-emerald-500/40";
const label = "mb-1.5 block text-xs font-semibold text-zinc-400";
const keywordSeparator = "│";

const emptyEntry = (): KeywordLorebookEntryInput => ({ keywords: "", content: "" });

type Props = {
  lorebookId?: number;
};

function keywordsToField(keywords: string[]) {
  return keywords.join(keywordSeparator);
}

function KeywordInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const keywords = useMemo(() => parseKeywordField(value), [value]);
  const [draft, setDraft] = useState("");

  function commitKeyword(raw: string) {
    const nextKeyword = raw.trim();
    if (!nextKeyword || keywords.length >= LOREBOOK_KEYWORDS_PER_ENTRY) return;
    if (keywords.some((keyword) => keyword === nextKeyword)) {
      setDraft("");
      return;
    }
    onChange(keywordsToField([...keywords, nextKeyword]));
    setDraft("");
  }

  function removeKeyword(keywordToRemove: string) {
    onChange(keywordsToField(keywords.filter((keyword) => keyword !== keywordToRemove)));
  }

  return (
    <div>
      <div className="flex min-h-[48px] w-full flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-[#1a1a2e] px-3 py-2 focus-within:border-emerald-500/40">
        {keywords.map((keyword) => (
          <span
            key={keyword}
            className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-emerald-400/15 px-2.5 py-1 text-xs font-semibold text-emerald-100 ring-1 ring-emerald-300/20"
          >
            <span className="max-w-[12rem] truncate">{keyword}</span>
            <button
              type="button"
              onClick={() => removeKeyword(keyword)}
              className="rounded-full px-1 text-emerald-100/70 hover:bg-white/10 hover:text-white"
              aria-label={`${keyword} 키워드 삭제`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          className="min-w-[10rem] flex-1 bg-transparent px-1 py-1.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 disabled:cursor-not-allowed"
          placeholder={
            keywords.length >= LOREBOOK_KEYWORDS_PER_ENTRY
              ? "키워드는 최대 10개까지 등록할 수 있어요."
              : "키워드 입력 후 Enter"
          }
          value={draft}
          disabled={keywords.length >= LOREBOOK_KEYWORDS_PER_ENTRY}
          onChange={(e) => setDraft(e.target.value.replace(/[|│]/g, "").slice(0, 40))}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            commitKeyword(draft);
          }}
          onBlur={() => commitKeyword(draft)}
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-zinc-600">
        <span>등록한 키워드가 대화에 나오면 이 항목이 활성화됩니다.</span>
        <span className="shrink-0 tabular-nums">
          {keywords.length} / {LOREBOOK_KEYWORDS_PER_ENTRY}
        </span>
      </div>
    </div>
  );
}

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
        if (!cancelled) setError("불러오는 중 오류가 발생했습니다.");
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
    return <p className="mx-auto max-w-2xl px-4 py-12 text-sm text-zinc-500">불러오는 중...</p>;
  }

  const filledCount = entries.filter((e) => e.keywords.trim() || e.content.trim()).length;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link href="/studio" className="text-sm text-zinc-500 hover:text-zinc-300">
          제작 메뉴
        </Link>
      </div>

      <h1 className="text-2xl font-black text-white">{isEdit ? "로어북 수정" : "로어북 제작"}</h1>
      <p className="mt-2 text-sm leading-relaxed text-gray-400">
        유저 입력에 등록한 키워드가 포함되면 해당 내용이 프롬프트에{" "}
        <b className="text-emerald-300/90">번역 없이</b> 그대로 주입됩니다. 키워드는 항목마다 최대{" "}
        {LOREBOOK_KEYWORDS_PER_ENTRY}개까지 등록할 수 있어요.
      </p>
      <p className="mt-1 text-xs text-zinc-600">
        예: <span className="text-zinc-400">카드, 동료, 제이</span>처럼 키워드를 하나씩 입력하고 Enter를 누르세요.
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
          <label className={label}>짧은 요약</label>
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
                항목 내용 {LOREBOOK_CONTENT_MAX}자 · 최대 {LOREBOOK_ENTRY_MAX}개
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
                <label className={label}>활성화 키워드</label>
                <KeywordInput
                  value={entry.keywords}
                  onChange={(next) => updateEntry(index, { keywords: next })}
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
            {loading ? "저장 중..." : isEdit ? "로어북 저장" : "로어북 만들기"}
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
