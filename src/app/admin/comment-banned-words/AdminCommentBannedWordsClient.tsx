"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  COMMENT_BANNED_WORD_CATEGORIES,
  COMMENT_BANNED_WORD_CATEGORY_LABELS,
  type CommentBannedWordCategory,
} from "@/lib/commentModerationPolicy";

type BannedWordRow = {
  id: number;
  word: string;
  category: CommentBannedWordCategory;
  match_type: "substring" | "regex";
  ai_check: number;
  enabled: number;
};

export default function AdminCommentBannedWordsClient() {
  const [filter, setFilter] = useState<CommentBannedWordCategory | "all">("all");
  const [words, setWords] = useState<BannedWordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [newWord, setNewWord] = useState("");
  const [newCategory, setNewCategory] = useState<CommentBannedWordCategory>("profanity");
  const [newMatchType, setNewMatchType] = useState<"substring" | "regex">("substring");
  const [newAiCheck, setNewAiCheck] = useState(true);
  const [csvText, setCsvText] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const q = filter === "all" ? "" : `?category=${filter}`;
    const res = await fetch(`/api/admin/comment-banned-words${q}`);
    setLoading(false);
    if (!res.ok) {
      setError((await res.json()).error || "불러오기 실패");
      return;
    }
    const data = await res.json();
    setWords(data.words ?? []);
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  async function addWord() {
    if (!newWord.trim()) return;
    const res = await fetch("/api/admin/comment-banned-words", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        word: newWord,
        category: newCategory,
        match_type: newMatchType,
        ai_check: newAiCheck,
      }),
    });
    if (!res.ok) {
      setError((await res.json()).error || "추가 실패");
      return;
    }
    setNewWord("");
    load();
  }

  async function uploadCsv() {
    if (!csvText.trim()) return;
    const res = await fetch("/api/admin/comment-banned-words", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv: csvText, category: newCategory, ai_check: newAiCheck }),
    });
    if (!res.ok) {
      setError((await res.json()).error || "CSV 업로드 실패");
      return;
    }
    setCsvText("");
    load();
  }

  async function toggleEnabled(row: BannedWordRow) {
    await fetch(`/api/admin/comment-banned-words/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: row.enabled === 0 }),
    });
    load();
  }

  async function removeWord(id: number) {
    if (!confirm("삭제할까요?")) return;
    await fetch(`/api/admin/comment-banned-words/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="mx-auto mt-6 max-w-4xl px-4 pb-12">
      <Link href="/settings" className="text-xs text-violet-400 hover:underline">
        ← 설정
      </Link>
      <h1 className="mt-2 text-xl font-black text-white">금지어 관리</h1>
      <p className="mt-1 text-xs text-gray-500">
        댓글 필터 — 정규화 후 매칭. AI 즉시검사 ON이면 금지어 매칭 시 LLM 2차 판정.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${filter === "all" ? "bg-violet-600 text-white" : "bg-white/5 text-gray-400"}`}
        >
          전체
        </button>
        {COMMENT_BANNED_WORD_CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setFilter(cat)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${filter === cat ? "bg-violet-600 text-white" : "bg-white/5 text-gray-400"}`}
          >
            {COMMENT_BANNED_WORD_CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      <section className="mt-6 rounded-2xl border border-white/10 bg-[#131626] p-5">
        <h2 className="text-sm font-bold text-zinc-200">금지어 추가</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={newWord}
            onChange={(e) => setNewWord(e.target.value)}
            placeholder="금지어 또는 정규식"
            className="min-w-[160px] flex-1 rounded-lg bg-[#0e1120] px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-violet-500"
          />
          <select
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value as CommentBannedWordCategory)}
            className="rounded-lg bg-[#0e1120] px-3 py-2 text-sm text-white"
          >
            {COMMENT_BANNED_WORD_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {COMMENT_BANNED_WORD_CATEGORY_LABELS[cat]}
              </option>
            ))}
          </select>
          <select
            value={newMatchType}
            onChange={(e) => setNewMatchType(e.target.value as "substring" | "regex")}
            className="rounded-lg bg-[#0e1120] px-3 py-2 text-sm text-white"
          >
            <option value="substring">부분 일치</option>
            <option value="regex">정규식</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs text-zinc-400">
            <input type="checkbox" checked={newAiCheck} onChange={(e) => setNewAiCheck(e.target.checked)} />
            AI 즉시검사
          </label>
          <button
            type="button"
            onClick={addWord}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white"
          >
            추가
          </button>
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-white/10 bg-[#131626] p-5">
        <h2 className="text-sm font-bold text-zinc-200">CSV 업로드</h2>
        <p className="mt-1 text-[11px] text-zinc-500">한 줄에 하나. 선택적으로 `단어,카테고리` 형식.</p>
        <textarea
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          rows={4}
          className="mt-2 w-full rounded-lg bg-[#0e1120] px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-violet-500"
          placeholder={"시발\n딸깍,ai_attack"}
        />
        <button
          type="button"
          onClick={uploadCsv}
          className="mt-2 rounded-lg border border-white/10 px-4 py-2 text-sm font-semibold text-zinc-200 hover:bg-white/5"
        >
          CSV 반영
        </button>
      </section>

      {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}

      <section className="mt-6">
        <h2 className="text-sm font-bold text-zinc-300">
          목록 {loading ? "…" : `(${words.length})`}
        </h2>
        <div className="mt-2 space-y-1">
          {words.map((row) => (
            <div
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#0e1120] px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <span className="font-mono text-zinc-200">{row.word}</span>
                <span className="ml-2 text-[10px] text-zinc-500">
                  {COMMENT_BANNED_WORD_CATEGORY_LABELS[row.category]} · {row.match_type}
                  {row.ai_check ? " · AI" : " · 즉시차단"}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => toggleEnabled(row)}
                  className="text-[10px] font-semibold text-zinc-400 hover:text-white"
                >
                  {row.enabled ? "비활성" : "활성"}
                </button>
                <button
                  type="button"
                  onClick={() => removeWord(row.id)}
                  className="text-[10px] font-semibold text-rose-400 hover:text-rose-300"
                >
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
