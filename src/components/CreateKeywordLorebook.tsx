"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import StudioButton from "@/components/studio/StudioButton";
import StudioCard from "@/components/studio/StudioCard";
import { StudioBackLink } from "@/components/studio/StudioEmptyState";
import { StudioInput, StudioTextarea } from "@/components/studio/StudioInput";
import StudioSaveBar from "@/components/studio/StudioSaveBar";
import {
  LOREBOOK_CONTENT_MAX,
  LOREBOOK_ENTRY_MAX,
  LOREBOOK_KEYWORDS_PER_ENTRY,
  LOREBOOK_NAME_LIMIT,
  LOREBOOK_SUMMARY_LIMIT,
  parseKeywordField,
  type KeywordLorebookEntryInput,
} from "@/lib/keywordLorebooks";
import { cn, studioSurface, studioType } from "@/lib/studioDesign";

const FORM_ID = "studio-lorebook-form";
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
      <div
        className={cn(
          "flex min-h-12 w-full flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-[#161922] px-3 py-2",
          "focus-within:border-violet-500/60 focus-within:ring-2 focus-within:ring-violet-500/20",
        )}
      >
        {keywords.map((keyword) => (
          <span key={keyword} className={studioSurface.chip}>
            <span className="max-w-[12rem] truncate">{keyword}</span>
            <button
              type="button"
              onClick={() => removeKeyword(keyword)}
              className={studioSurface.chipRemove}
              aria-label={`${keyword} 키워드 삭제`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          className="min-h-11 min-w-[10rem] flex-1 bg-transparent px-1 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 disabled:cursor-not-allowed"
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
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className={studioType.helper}>
          등록한 키워드가 대화에 나오면 이 항목이 활성화됩니다.
        </span>
        <span className={studioType.counter}>
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
      router.push("/studio?tab=lorebooks");
      router.refresh();
    } catch {
      setError("저장 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  if (bootLoading) {
    return (
      <p className={`mx-auto max-w-2xl px-4 py-12 ${studioType.helper}`}>불러오는 중...</p>
    );
  }

  const filledCount = entries.filter((e) => e.keywords.trim() || e.content.trim()).length;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 pb-32 sm:py-8">
      <StudioBackLink href="/studio?tab=lorebooks">← 제작 · 로어북</StudioBackLink>

      <h1 className={`${studioType.heading} mt-4`}>
        {isEdit ? "로어북 수정" : "로어북 제작"}
      </h1>
      <p className={`${studioType.helper} mt-2`}>
        유저 입력에 등록한 키워드가 포함되면 해당 내용이 프롬프트에{" "}
        <b className="font-semibold text-zinc-200">번역 없이</b> 그대로 주입됩니다. 키워드는
        항목마다 최대 {LOREBOOK_KEYWORDS_PER_ENTRY}개까지 등록할 수 있어요.
      </p>
      <p className={`${studioType.caption} mt-1`}>
        예: <span className="text-zinc-300">카드, 동료, 제이</span>처럼 키워드를 하나씩 입력하고
        Enter를 누르세요.
      </p>

      <form id={FORM_ID} onSubmit={submit} className="mt-8 space-y-6">
        <StudioInput
          label="로어북 이름 *"
          placeholder="예: 주요 인물 설정"
          value={name}
          maxLength={LOREBOOK_NAME_LIMIT}
          onChange={(e) => setName(e.target.value.slice(0, LOREBOOK_NAME_LIMIT))}
        />

        <StudioInput
          label="짧은 요약"
          placeholder="목록에서 구분하기 위한 짧은 설명 (선택)"
          value={summary}
          maxLength={LOREBOOK_SUMMARY_LIMIT}
          onChange={(e) => setSummary(e.target.value.slice(0, LOREBOOK_SUMMARY_LIMIT))}
        />

        <div>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className={studioType.label}>항목</p>
              <p className={studioType.helper}>
                항목 내용 {LOREBOOK_CONTENT_MAX}자 · 최대 {LOREBOOK_ENTRY_MAX}개
              </p>
            </div>
            <p className={studioType.counter}>
              {filledCount} / {LOREBOOK_ENTRY_MAX}
            </p>
          </div>

          <div className="space-y-4">
            {entries.map((entry, index) => (
              <StudioCard
                key={index}
                title={`#${index + 1}`}
                trailing={
                  <StudioButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeEntry(index)}
                    className="text-zinc-400 hover:text-rose-300"
                  >
                    삭제
                  </StudioButton>
                }
              >
                <div>
                  <p className={studioType.label}>활성화 키워드</p>
                  <KeywordInput
                    value={entry.keywords}
                    onChange={(next) => updateEntry(index, { keywords: next })}
                  />
                </div>
                <StudioTextarea
                  label="내용"
                  rows={4}
                  placeholder="키워드가 유저 입력에 포함되면 주입할 설정·설명"
                  value={entry.content}
                  counter={{ now: entry.content.length, max: LOREBOOK_CONTENT_MAX }}
                  onChange={(e) =>
                    updateEntry(index, {
                      content: e.target.value.slice(0, LOREBOOK_CONTENT_MAX),
                    })
                  }
                />
              </StudioCard>
            ))}
          </div>

          {entries.length < LOREBOOK_ENTRY_MAX && (
            <StudioButton
              type="button"
              variant="secondary"
              onClick={addEntry}
              className="mt-3 w-full border-dashed"
            >
              + 항목 추가
            </StudioButton>
          )}
        </div>

        <StudioButton href="/create" variant="secondary">
          캐릭터 제작으로
        </StudioButton>
      </form>

      <StudioSaveBar
        formId={FORM_ID}
        saveType="submit"
        saveLabel={loading ? "저장 중..." : isEdit ? "로어북 저장" : "로어북 만들기"}
        saveDisabled={loading}
        error={error || null}
      />
    </div>
  );
}
