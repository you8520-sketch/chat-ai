"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ADMIN_MANAGED_BOARDS, type AdminManagedBoard } from "@/lib/boardConfig";

type PostRow = {
  id: number;
  board: string;
  title: string;
  content: string;
  author_name: string;
  created_at: string;
};

const BOARD_LABELS: Record<AdminManagedBoard, string> = {
  notice: "공지사항",
  faq: "FAQ",
};

export default function AdminBoardsClient() {
  const [board, setBoard] = useState<AdminManagedBoard>("notice");
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const res = await fetch(`/api/admin/posts?board=${board}`);
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error || "목록을 불러오지 못했습니다.");
      return;
    }
    setPosts(data.posts ?? []);
  }, [board]);

  useEffect(() => {
    load();
  }, [load]);

  async function createPost(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setMsg("");
    const res = await fetch("/api/admin/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ board, title, content }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "등록에 실패했습니다.");
      return;
    }
    setTitle("");
    setContent("");
    setMsg("등록되었습니다.");
    await load();
  }

  async function removePost(id: number, postTitle: string) {
    if (!confirm(`「${postTitle}」을(를) 삭제할까요?`)) return;
    setBusy(true);
    setError("");
    setMsg("");
    const res = await fetch(`/api/admin/posts?id=${id}`, { method: "DELETE" });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "삭제에 실패했습니다.");
      return;
    }
    setMsg("삭제되었습니다.");
    await load();
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Link href="/settings" className="text-sm text-violet-400 hover:underline">
        ← 설정
      </Link>
      <h1 className="mt-4 text-2xl font-black text-white">공지사항 · FAQ 관리</h1>
      <p className="mt-1 text-sm text-gray-400">공지와 FAQ를 작성·삭제합니다. 사용자 게시판에 바로 반영됩니다.</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {ADMIN_MANAGED_BOARDS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setBoard(id)}
            className={`rounded-full px-3 py-1 text-sm font-semibold ${
              board === id ? "bg-violet-600 text-white" : "border border-white/10 text-gray-300 hover:bg-white/5"
            }`}
          >
            {BOARD_LABELS[id]}
          </button>
        ))}
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-rose-500/30 bg-rose-950/30 px-4 py-2 text-sm text-rose-200">
          {error}
        </p>
      )}
      {msg && (
        <p className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-950/30 px-4 py-2 text-sm text-emerald-200">
          {msg}
        </p>
      )}

      <form onSubmit={createPost} className="mt-6 rounded-2xl border border-white/5 bg-[#131626] p-5">
        <h2 className="font-bold text-white">{BOARD_LABELS[board]} 새 글</h2>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="제목"
          maxLength={200}
          className="mt-3 w-full rounded-lg bg-[#0e1120] px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-violet-500"
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="내용"
          rows={6}
          maxLength={10000}
          className="mt-2 w-full rounded-lg bg-[#0e1120] px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-violet-500"
        />
        <button
          type="submit"
          disabled={busy || !title.trim() || !content.trim()}
          className="mt-3 rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
        >
          등록
        </button>
      </form>

      <section className="mt-8">
        <h2 className="font-bold text-white">{BOARD_LABELS[board]} 목록</h2>
        {loading ? (
          <p className="mt-4 text-sm text-gray-500">불러오는 중…</p>
        ) : posts.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">등록된 글이 없습니다.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {posts.map((p) => (
              <details key={p.id} className="rounded-xl border border-white/5 bg-[#131626] p-4">
                <summary className="cursor-pointer list-none">
                  <span className="font-semibold text-white">{p.title}</span>
                  <span className="ml-3 text-xs text-gray-500">
                    {new Date(p.created_at + "Z").toLocaleString("ko-KR")}
                  </span>
                </summary>
                <p className="mt-3 whitespace-pre-wrap text-sm text-gray-300">{p.content}</p>
                <button
                  type="button"
                  onClick={() => removePost(p.id, p.title)}
                  disabled={busy}
                  className="mt-3 rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-950/40 disabled:opacity-40"
                >
                  삭제
                </button>
              </details>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
