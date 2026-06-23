"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
      <button onClick={() => setOpen(true)} className="mt-3 rounded-full bg-violet-600 px-5 py-2 text-sm font-semibold text-white">
        글쓰기
      </button>
    );
  }
  return (
    <div className="mt-3 space-y-2 rounded-xl border border-violet-500/30 bg-[#131626] p-4">
      <input
        placeholder="제목" value={title} onChange={(e) => setTitle(e.target.value)}
        className="w-full rounded-lg bg-[#0e1120] px-3 py-2 text-sm text-white outline-none"
      />
      <textarea
        placeholder="내용" rows={4} value={content} onChange={(e) => setContent(e.target.value)}
        className="w-full rounded-lg bg-[#0e1120] px-3 py-2 text-sm text-white outline-none"
      />
      {error && <p className="text-sm text-rose-400">{error}</p>}
      <div className="flex gap-2">
        <button onClick={submit} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white">등록</button>
        <button onClick={() => setOpen(false)} className="rounded-lg bg-white/5 px-4 py-2 text-sm text-gray-300">취소</button>
      </div>
    </div>
  );
}
