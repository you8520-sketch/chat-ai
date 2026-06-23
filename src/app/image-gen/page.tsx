"use client";

import { useState } from "react";

export default function ImageGenPage() {
  const [prompt, setPrompt] = useState("");
  const [img, setImg] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function generate() {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError("");
    setImg("");
    const res = await fetch("/api/image-gen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error);
      return;
    }
    setImg(data.image);
  }

  return (
    <div className="mx-auto mt-8 max-w-2xl">
      <h1 className="text-xl font-black text-white">AI 이미지 생성</h1>
      <p className="mt-1 text-sm text-gray-400">캐릭터 일러스트 등 이미지를 생성합니다. (Gemini 이미지 생성 API)</p>
      <div className="mt-4 flex gap-2">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && generate()}
          placeholder="예: 보라색 머리의 엘프 소녀, 애니메이션 스타일"
          className="flex-1 rounded-xl bg-[#131626] px-4 py-3 text-sm text-white outline-none focus:ring-1 focus:ring-violet-500"
        />
        <button onClick={generate} disabled={loading} className="rounded-xl bg-violet-600 px-6 font-semibold text-white disabled:opacity-50">
          {loading ? "생성 중…" : "생성"}
        </button>
      </div>
      {error && <p className="mt-4 text-sm text-rose-400">{error}</p>}
      {img && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img} alt={prompt} className="mt-6 w-full rounded-2xl border border-white/5" />
      )}
    </div>
  );
}
