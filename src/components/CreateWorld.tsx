"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { WORLD_CONTENT_LIMIT, WORLD_NAME_LIMIT, WORLD_SUMMARY_LIMIT } from "@/lib/worlds";

const cls =
  "w-full rounded-xl border border-white/10 bg-[#1a1a2e] px-4 py-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-500/40";
const label = "mb-1.5 block text-xs font-semibold text-zinc-400";

export default function CreateWorld() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("세계관 이름을 입력해 주세요.");
      return;
    }
    if (!content.trim()) {
      setError("세계관 본문을 입력해 주세요.");
      return;
    }
    if (content.length > WORLD_CONTENT_LIMIT) {
      setError(`세계관 본문은 ${WORLD_CONTENT_LIMIT.toLocaleString()}자 이하여야 합니다.`);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/worlds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, summary, content }),
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

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link href="/studio" className="text-sm text-zinc-500 hover:text-zinc-300">
          ← 제작 메뉴
        </Link>
      </div>

      <h1 className="text-2xl font-black text-white">🌍 세계관 제작</h1>
      <p className="mt-2 text-sm text-gray-400">
        배경·시대·장소·세력·규칙 등을 저장해 두면, 캐릭터 제작 시 불러올 수 있습니다.
      </p>

      <form onSubmit={submit} className="mt-8 space-y-5">
        <div>
          <label className={label}>세계관 이름 *</label>
          <input
            className={cls}
            placeholder="예: 북부 대공국 · 현대 서울 판타지"
            value={name}
            maxLength={WORLD_NAME_LIMIT}
            onChange={(e) => setName(e.target.value.slice(0, WORLD_NAME_LIMIT))}
          />
          <p className="mt-1 text-right text-[10px] tabular-nums text-zinc-600">
            {name.length} / {WORLD_NAME_LIMIT}
          </p>
        </div>

        <div>
          <label className={label}>한 줄 요약</label>
          <input
            className={cls}
            placeholder="목록에서 구분하기 위한 짧은 설명 (선택)"
            value={summary}
            maxLength={WORLD_SUMMARY_LIMIT}
            onChange={(e) => setSummary(e.target.value.slice(0, WORLD_SUMMARY_LIMIT))}
          />
        </div>

        <div>
          <label className={label}>세계관 본문 *</label>
          <textarea
            rows={14}
            className={cls}
            placeholder={
              "시대와 배경, 주요 지역, 세력 관계, 마법/기술 규칙, 사회 구조, 금기, 분위기 등을 자유롭게 작성하세요.\n\n캐릭터 제작 시 이 내용이 「세계관 / 배경」란에 자동으로 채워집니다."
            }
            value={content}
            onChange={(e) => setContent(e.target.value.slice(0, WORLD_CONTENT_LIMIT))}
          />
          <p className="mt-1 text-right text-[10px] tabular-nums text-zinc-600">
            {content.length.toLocaleString()} / {WORLD_CONTENT_LIMIT.toLocaleString()}
          </p>
        </div>

        {error && <p className="text-sm text-rose-400">{error}</p>}

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={loading}
            className="rounded-xl bg-cyan-600 px-6 py-3 font-bold text-white disabled:opacity-50"
          >
            {loading ? "저장 중…" : "세계관 저장"}
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
