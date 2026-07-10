"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import StudioButton from "@/components/studio/StudioButton";
import { cn, studioInputClass, studioSurface, studioTextareaClass } from "@/lib/studioDesign";

export default function PostForm({ board }: { board: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    const res = await fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ board, title, content }),
    });
    if (!res.ok) {
      setError((await res.json()).error);
      return;
    }
    setTitle("");
    setContent("");
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <StudioButton onClick={() => setOpen(true)} className="mt-3 rounded-full">
        글쓰기
      </StudioButton>
    );
  }
  return (
    <div className={cn(studioSurface.card, "mt-3 space-y-2 p-4")}>
      <input
        placeholder="제목"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className={studioInputClass}
      />
      <textarea
        placeholder="내용"
        rows={4}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className={studioTextareaClass}
      />
      {error && <p className="text-sm text-rose-400">{error}</p>}
      <div className="flex gap-2">
        <StudioButton onClick={submit}>등록</StudioButton>
        <StudioButton variant="secondary" onClick={() => setOpen(false)}>
          취소
        </StudioButton>
      </div>
    </div>
  );
}
