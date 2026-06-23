"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type ReportRow = {
  id: number;
  user_id: number;
  chat_id: number;
  message_id: number;
  status: string;
  refund_amount: number;
  validation_note: string;
  created_at: string;
  user_nickname: string;
  user_email: string;
  message_content: string;
  message_status: string | null;
};

const FILTERS = [
  { id: "pending", label: "대기" },
  { id: "approved", label: "승인" },
  { id: "rejected", label: "반려" },
  { id: "all", label: "전체" },
] as const;

export default function AdminReportRefundsClient() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("pending");
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const res = await fetch(`/api/admin/report-refunds?status=${filter}`);
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error || "목록을 불러오지 못했습니다.");
      return;
    }
    setRows(data.reports ?? []);
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  async function review(id: number, action: "approve" | "reject") {
    setBusyId(id);
    setError("");
    const res = await fetch(`/api/admin/report-refunds/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, adminNote: notes[id] ?? "" }),
    });
    const data = await res.json();
    setBusyId(null);
    if (!res.ok) {
      setError(data.error || "처리에 실패했습니다.");
      return;
    }
    await load();
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Link href="/" className="text-sm text-violet-400 hover:underline">
        ← 홈
      </Link>
      <h1 className="mt-4 text-2xl font-black text-white">오류 신고 — 관리</h1>
      <p className="mt-1 text-sm text-gray-400">신고 내용 확인 후 환불 승인 또는 반려</p>

      <div className="mt-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
              filter === f.id
                ? "bg-violet-600 text-white"
                : "bg-white/5 text-gray-400 hover:bg-white/10"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <p className="mt-4 rounded-xl bg-rose-600/10 p-3 text-sm text-rose-300">{error}</p>}

      {loading ? (
        <p className="mt-8 text-sm text-gray-500">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className="mt-8 text-sm text-gray-500">해당 상태의 신고가 없습니다.</p>
      ) : (
        <ul className="mt-6 space-y-4">
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded-2xl border border-white/5 bg-[#131626] p-4 text-sm text-gray-300"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-white">
                    #{row.id} · {row.user_nickname}{" "}
                    <span className="text-xs font-normal text-gray-500">({row.user_email})</span>
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {row.created_at} · 채팅 #{row.chat_id} · 메시지 #{row.message_id}
                    {row.message_status === "error" && (
                      <span className="ml-2 text-rose-400">[API 오류]</span>
                    )}
                  </p>
                  <p className="mt-2 text-xs text-amber-300">
                    환불 예정: {row.refund_amount.toLocaleString()}P
                  </p>
                </div>
                <span
                  className={`rounded px-2 py-0.5 text-xs font-bold ${
                    row.status === "pending"
                      ? "bg-amber-500/20 text-amber-300"
                      : row.status === "approved"
                        ? "bg-emerald-500/20 text-emerald-300"
                        : "bg-gray-500/20 text-gray-400"
                  }`}
                >
                  {row.status === "pending" ? "대기" : row.status === "approved" ? "승인" : "반려"}
                </span>
              </div>

              <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-3 text-xs text-gray-400">
                {row.message_content.slice(0, 1500)}
                {row.message_content.length > 1500 ? "…" : ""}
              </pre>

              {row.validation_note && (
                <p className="mt-2 text-xs text-gray-500">메모: {row.validation_note}</p>
              )}

              <Link
                href={`/chat/${row.chat_id}`}
                className="mt-2 inline-block text-xs text-violet-400 hover:underline"
              >
                대화 열기 →
              </Link>

              {row.status === "pending" && (
                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
                  <label className="block flex-1">
                    <span className="text-xs text-gray-500">관리자 메모</span>
                    <input
                      type="text"
                      value={notes[row.id] ?? ""}
                      onChange={(e) =>
                        setNotes((prev) => ({ ...prev, [row.id]: e.target.value }))
                      }
                      placeholder="선택"
                      className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-violet-500/50"
                    />
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => review(row.id, "approve")}
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      환불 승인
                    </button>
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => review(row.id, "reject")}
                      className="rounded-lg border border-white/10 px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-white/5 disabled:opacity-50"
                    >
                      반려
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
