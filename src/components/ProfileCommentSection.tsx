"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ProfileCommentTarget } from "@/lib/profileComments";

type Comment = {
  id: number;
  author_id: number;
  author_name: string;
  content: string;
  created_at: string;
  is_private?: boolean;
  is_blinded?: boolean;
  user_has_reported?: boolean;
};

export default function ProfileCommentSection({
  targetType,
  targetId,
  comments,
  loggedIn,
  canWrite,
  canReport = false,
  isOwner = false,
  ownerUserId,
  writeBlockedMessage,
}: {
  targetType: ProfileCommentTarget;
  targetId: number;
  comments: Comment[];
  loggedIn: boolean;
  canWrite: boolean;
  canReport?: boolean;
  isOwner?: boolean;
  ownerUserId?: number;
  writeBlockedMessage?: string;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blockingId, setBlockingId] = useState<number | null>(null);
  const [reportingId, setReportingId] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function submit() {
    const content = text.trim();
    if (!content || busy || !canWrite) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/profile-comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetType, targetId, content, isPrivate: isOwner && isPrivate }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json()).error || "댓글 등록에 실패했습니다.");
      return;
    }
    setText("");
    setIsPrivate(false);
    router.refresh();
  }

  async function blockAuthor(commentId: number) {
    if (blockingId != null) return;
    if (!confirm("이 댓글 작성자를 차단할까요? (댓글만 단 계정만 차단됩니다)")) return;
    setBlockingId(commentId);
    setError("");
    const res = await fetch(`/api/profile-comments/${commentId}/block`, { method: "POST" });
    setBlockingId(null);
    if (!res.ok) {
      setError((await res.json()).error || "차단에 실패했습니다.");
      return;
    }
    router.refresh();
  }

  async function reportComment(commentId: number) {
    if (reportingId != null) return;
    if (!confirm("이 댓글을 신고할까요?")) return;
    setReportingId(commentId);
    setError("");
    const res = await fetch(`/api/profile-comments/${commentId}/report`, { method: "POST" });
    setReportingId(null);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "신고에 실패했습니다.");
      return;
    }
    router.refresh();
  }

  const publicCount = comments.filter((c) => !c.is_private && !c.is_blinded).length;

  return (
    <div className="mt-6 rounded-2xl border border-white/5 bg-[#131626] p-5">
      <p className="text-xs font-bold text-gray-500">
        댓글 {isOwner ? comments.length : publicCount}
        {isOwner && comments.some((c) => c.is_private) && (
          <span className="ml-1 font-normal text-zinc-600">
            (비공개 {comments.filter((c) => c.is_private).length})
          </span>
        )}
      </p>
      <div className="mt-2 space-y-2">
        {comments.map((c) => (
          <div
            key={c.id}
            className={`rounded-lg px-3 py-2 ${
              c.is_private ? "border border-dashed border-violet-500/30 bg-violet-500/5" : "bg-[#0e1120]"
            } ${c.is_blinded ? "opacity-60" : ""}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-gray-500">
                <span className="font-semibold text-violet-300">{c.author_name}</span>
                {c.is_private && (
                  <span className="ml-1.5 rounded bg-violet-500/20 px-1.5 py-0.5 text-[9px] font-bold text-violet-300">
                    비공개
                  </span>
                )}
                {c.is_blinded && isOwner && (
                  <span className="ml-1.5 rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold text-amber-300">
                    검수 중
                  </span>
                )}
                <span className="mx-1">·</span>
                {new Date(c.created_at + "Z").toLocaleString("ko-KR", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </p>
              <div className="flex items-center gap-2">
                {canReport && c.author_id !== ownerUserId && !c.user_has_reported && (
                  <button
                    type="button"
                    disabled={reportingId === c.id}
                    onClick={() => reportComment(c.id)}
                    className="text-[10px] font-semibold text-zinc-500 hover:text-rose-300 disabled:opacity-40"
                  >
                    {reportingId === c.id ? "처리 중…" : "신고"}
                  </button>
                )}
                {c.user_has_reported && (
                  <span className="text-[10px] text-zinc-600">신고됨</span>
                )}
                {isOwner && ownerUserId != null && c.author_id !== ownerUserId && (
                  <button
                    type="button"
                    disabled={blockingId === c.id}
                    onClick={() => blockAuthor(c.id)}
                    className="text-[10px] font-semibold text-rose-400/80 hover:text-rose-300 disabled:opacity-40"
                  >
                    {blockingId === c.id ? "처리 중…" : "작성자 차단"}
                  </button>
                )}
              </div>
            </div>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-gray-300">{c.content}</p>
          </div>
        ))}
        {comments.length === 0 && (
          <p className="text-xs text-gray-600">아직 댓글이 없습니다.</p>
        )}
      </div>
      {!loggedIn ? (
        <p className="mt-3 text-xs text-gray-600">로그인 후 댓글을 달 수 있습니다.</p>
      ) : canWrite ? (
        <div className="mt-3 space-y-2">
          {isOwner && (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-400">
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
                className="rounded border-white/20 bg-[#0e1120] text-violet-600 focus:ring-violet-500"
              />
              비공개 댓글 (나만 보기)
            </label>
          )}
          <div className="flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={isOwner && isPrivate ? "비공개 메모…" : "댓글을 입력하세요…"}
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
        </div>
      ) : (
        <p className="mt-3 text-xs text-gray-500">
          {writeBlockedMessage ?? "댓글을 작성할 수 없습니다."}
        </p>
      )}
      {error && <p className="mt-1 text-xs text-rose-400">{error}</p>}
      {isOwner && (
        <p className="mt-3 text-[10px] leading-relaxed text-zinc-600">
          악성 댓글 작성자 중 대화·좋아요 등 이용 기록이 없는(댓글만 단) 계정은 「작성자 차단」으로 사이트
          댓글 이용을 제한할 수 있습니다.
        </p>
      )}
    </div>
  );
}
