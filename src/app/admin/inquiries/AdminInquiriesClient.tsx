"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type InquiryRow = {
  id: number;
  title: string;
  content: string;
  author_name: string;
  created_at: string;
  user_nickname: string | null;
  user_email: string | null;
  reply_count: number;
};

type CommentRow = {
  id: number;
  author_name: string;
  content: string;
  created_at: string;
  is_staff_reply: number;
};

export default function AdminInquiriesClient() {
  const [inquiries, setInquiries] = useState<InquiryRow[]>([]);
  const [commentsByPost, setCommentsByPost] = useState<Record<number, CommentRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [replies, setReplies] = useState<Record<number, string>>({});
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const res = await fetch("/api/admin/inquiries");
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error || "목록을 불러오지 못했습니다.");
      return;
    }
    setInquiries(data.inquiries ?? []);
    setCommentsByPost(data.commentsByPost ?? {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function submitReply(postId: number) {
    const content = (replies[postId] ?? "").trim();
    if (!content || busyId != null) return;
    setBusyId(postId);
    setError("");
    const res = await fetch("/api/admin/inquiries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId, content }),
    });
    const data = await res.json();
    setBusyId(null);
    if (!res.ok) {
      setError(data.error || "답변 등록에 실패했습니다.");
      return;
    }
    setReplies((prev) => ({ ...prev, [postId]: "" }));
    await load();
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Link href="/settings" className="text-sm text-violet-400 hover:underline">
        ← 설정
      </Link>
      <h1 className="mt-4 text-2xl font-black text-white">문의 게시판 — 관리</h1>
      <p className="mt-1 text-sm text-gray-400">사용자 문의를 확인하고 운영팀 답변을 등록합니다.</p>

      {error && (
        <p className="mt-4 rounded-lg border border-rose-500/30 bg-rose-950/30 px-4 py-2 text-sm text-rose-200">
          {error}
        </p>
      )}

      {loading ? (
        <p className="mt-8 text-sm text-gray-500">불러오는 중…</p>
      ) : inquiries.length === 0 ? (
        <p className="mt-8 text-sm text-gray-500">접수된 문의가 없습니다.</p>
      ) : (
        <div className="mt-6 space-y-3">
          {inquiries.map((row) => {
            const comments = commentsByPost[row.id] ?? [];
            const authorLabel = row.user_nickname || row.author_name;
            return (
              <details
                key={row.id}
                className="rounded-xl border border-white/5 bg-[#131626] p-4"
                open={row.reply_count === 0}
              >
                <summary className="cursor-pointer list-none">
                  <span className="font-semibold text-white">{row.title}</span>
                  {row.reply_count > 0 ? (
                    <span className="ml-2 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                      답변 {row.reply_count}
                    </span>
                  ) : (
                    <span className="ml-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                      미답변
                    </span>
                  )}
                  <span className="mt-1 block text-xs text-gray-500">
                    {authorLabel}
                    {row.user_email ? ` · ${row.user_email}` : ""} ·{" "}
                    {new Date(row.created_at + "Z").toLocaleString("ko-KR")}
                  </span>
                </summary>

                <div className="mt-3 rounded-lg bg-[#0e1120] px-3 py-2">
                  <p className="text-[11px] font-semibold text-gray-500">문의 내용</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-gray-300">{row.content}</p>
                </div>

                {comments.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs font-semibold text-gray-500">답변 내역</p>
                    {comments.map((c) => (
                      <div key={c.id} className="rounded-lg border border-violet-500/20 bg-violet-950/20 px-3 py-2">
                        <p className="text-[11px] text-violet-300">
                          {c.author_name} ·{" "}
                          {new Date(c.created_at + "Z").toLocaleString("ko-KR", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })}
                        </p>
                        <p className="mt-0.5 whitespace-pre-wrap text-sm text-gray-300">{c.content}</p>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-3">
                  <textarea
                    value={replies[row.id] ?? ""}
                    onChange={(e) => setReplies((prev) => ({ ...prev, [row.id]: e.target.value }))}
                    placeholder="운영팀 답변을 입력하세요…"
                    rows={4}
                    maxLength={5000}
                    className="w-full rounded-lg bg-[#0e1120] px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-violet-500"
                  />
                  <button
                    type="button"
                    onClick={() => submitReply(row.id)}
                    disabled={busyId === row.id || !(replies[row.id] ?? "").trim()}
                    className="mt-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
                  >
                    {busyId === row.id ? "등록 중…" : "답변 등록"}
                  </button>
                </div>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}
