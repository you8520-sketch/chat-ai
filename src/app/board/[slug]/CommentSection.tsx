"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Comment = { id: number; author_name: string; content: string; created_at: string };

export default function CommentSection({
  postId,
  comments,
  loggedIn,
}: {
  postId: number;
  comments: Comment[];
  loggedIn: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    const content = text.trim();
    if (!content || busy) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId, content }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json()).error || "댓글 등록에 실패했습니다.");
      return;
    }
    setText("");
    router.refresh();
  }

  return (
    <div className="mt-4 border-t border-white/5 pt-3">
      <p className="text-xs font-semibold text-gray-500">답글 {comments.length}</p>
      <div className="mt-2 space-y-2">
        {comments.map((c) => (
          <div key={c.id} className="rounded-lg bg-[#0e1120] px-3 py-2">
            <p className="text-[11px] text-gray-500">
              <span className="font-semibold text-violet-300">{c.author_name}</span> ·{" "}
              {new Date(c.created_at + "Z").toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}
            </p>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-gray-300">{c.content}</p>
          </div>
        ))}
      </div>
      {loggedIn ? (
        <div className="mt-2 flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="답글을 입력하세요…"
            className="flex-1 rounded-lg bg-[#0e1120] px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-violet-500 placeholder:text-gray-600"
          />
          <button
            onClick={submit}
            disabled={busy || !text.trim()}
            className="rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white disabled:opacity-40"
          >
            등록
          </button>
        </div>
      ) : (
        <p className="mt-2 text-xs text-gray-600">로그인 후 답글을 달 수 있습니다.</p>
      )}
      {error && <p className="mt-1 text-xs text-rose-400">{error}</p>}
    </div>
  );
}
