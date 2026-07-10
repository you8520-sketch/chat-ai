"use client";

import { useState } from "react";
import { AppPageShell } from "@/components/AppPageShell";
import StudioButton from "@/components/studio/StudioButton";
import { studioInputClass, studioSurface } from "@/lib/studioDesign";

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
    <AppPageShell
      narrow
      title="AI 이미지 생성"
      description="캐릭터 일러스트 등 이미지를 생성합니다. (Gemini 이미지 생성 API)"
    >
      <div className="flex gap-2">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && generate()}
          placeholder="예: 보라색 머리의 엘프 소녀, 애니메이션 스타일"
          className={`${studioInputClass} flex-1`}
        />
        <StudioButton onClick={generate} disabled={loading}>
          {loading ? "생성 중…" : "생성"}
        </StudioButton>
      </div>
      {error ? <p className="mt-4 text-sm text-rose-400">{error}</p> : null}
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img} alt={prompt} className={`mt-6 w-full ${studioSurface.card}`} />
      ) : null}
    </AppPageShell>
  );
}
