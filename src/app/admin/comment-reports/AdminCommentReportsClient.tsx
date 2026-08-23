"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Status = "pending" | "resolved" | "all";
type Row = {
  id: number;
  author_id: number;
  author_name: string;
  content: string;
  created_at: string;
  moderation_status: string;
  report_count: number;
  total_report_count: number;
  target_type: "creator" | "character";
  target_id: number;
  target_label: string;
  comment_banned: number;
  strike_count: number;
  last_action: string | null;
  last_action_at: string | null;
};

export default function AdminCommentReportsClient() {
  const [status, setStatus] = useState<Status>("pending");
  const [rows, setRows] = useState<Row[]>([]);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/comment-reports?status=${status}`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) return setError(data.error || "목록을 불러오지 못했습니다.");
    setRows(data.comments ?? []);
  }, [status]);

  useEffect(() => { void load(); }, [load]);

  async function review(row: Row, action: "delete" | "restore") {
    const label = action === "delete" ? "삭제" : "다시 공개";
    if (!confirm(`이 댓글을 ${label} 처리할까요?`)) return;
    setBusyId(row.id);
    setError("");
    const res = await fetch(`/api/admin/comment-reports/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, note: notes[row.id] ?? "" }),
    });
    const data = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok) return setError(data.error || "처리에 실패했습니다.");
    await load();
  }

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-8 text-white">
      <Link href="/settings" className="text-sm text-zinc-400 hover:text-white">← 설정</Link>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black">신고 댓글 관리</h1>
          <p className="mt-1 text-sm text-zinc-400">신고 10건 누적 시 자동 가림 · 삭제 3회 누적 시 댓글 작성 제한</p>
        </div>
        <Link href="/settings" className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-zinc-300 hover:border-violet-400/40 hover:text-white">
          푸시 알림 설정
        </Link>
      </div>

      <div className="mt-6 flex gap-2">
        {([['pending','검토 대기'],['resolved','처리 완료'],['all','전체']] as const).map(([value, label]) => (
          <button key={value} onClick={() => setStatus(value)} className={`rounded-lg px-3 py-2 text-xs font-bold ${status === value ? "bg-violet-600" : "bg-white/5 text-zinc-400"}`}>{label}</button>
        ))}
      </div>
      {error && <p className="mt-4 rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}
      <div className="mt-4 space-y-3">
        {rows.map((row) => {
          const targetHref = row.target_type === "character" ? `/character/${row.target_id}` : `/creator/${row.target_id}`;
          const pending = row.moderation_status === "blinded";
          return (
            <article key={row.id} className="rounded-xl border border-white/10 bg-[#131626] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
                <p><span className="font-bold text-violet-300">@{row.author_name}</span> · <Link className="hover:text-white hover:underline" href={targetHref}>{row.target_label}</Link></p>
                <p>미처리 신고 {row.report_count}건 · 전체 {row.total_report_count}건</p>
              </div>
              <p className="mt-3 whitespace-pre-wrap rounded-lg bg-black/20 p-3 text-sm text-zinc-200">{row.content}</p>
              <p className="mt-2 text-[11px] text-zinc-500">위반 누적 {row.strike_count}/3 {row.comment_banned ? "· 댓글 제한 중" : ""} · {new Date(row.created_at + "Z").toLocaleString("ko-KR")}</p>
              {pending ? (
                <div className="mt-3 space-y-2">
                  <input value={notes[row.id] ?? ""} onChange={(e) => setNotes((prev) => ({ ...prev, [row.id]: e.target.value }))} placeholder="처리 사유 또는 관리자 메모 (선택)" maxLength={500} className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-violet-500" />
                  <div className="flex gap-2">
                    <button disabled={busyId === row.id} onClick={() => review(row, "delete")} className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-bold disabled:opacity-40">댓글 삭제</button>
                    <button disabled={busyId === row.id} onClick={() => review(row, "restore")} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold disabled:opacity-40">가림 해제 · 공개</button>
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-xs font-semibold text-zinc-400">{row.moderation_status === "deleted" ? "삭제됨" : "공개 복구됨"}</p>
              )}
            </article>
          );
        })}
        {rows.length === 0 && <p className="py-12 text-center text-sm text-zinc-500">해당 댓글이 없습니다.</p>}
      </div>
    </main>
  );
}
