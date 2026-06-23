"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  applicationStatusLabel,
  type CreateMigrationApplicationStatus,
} from "@/lib/createMigrationEventShared";
import {
  MAX_ADMIN_FREE_POINT_GRANT,
  MIN_ADMIN_FREE_POINT_GRANT,
} from "@/lib/adminPointGrantConstants";

type ApplicationRow = {
  id: number;
  user_id: number;
  status: CreateMigrationApplicationStatus;
  reward_amount: number | null;
  admin_note: string;
  created_at: string;
  user_nickname: string;
  user_email: string;
};

const FILTERS = [
  { id: "pending", label: "대기" },
  { id: "approved", label: "승인" },
  { id: "rejected", label: "반려" },
  { id: "all", label: "전체" },
] as const;

export default function AdminBetaFreePointClient() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("pending");
  const [rows, setRows] = useState<ApplicationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const res = await fetch(`/api/admin/beta-free-points?status=${filter}`);
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error || "목록을 불러오지 못했습니다.");
      return;
    }
    setRows(data.applications ?? []);
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  async function review(id: number, action: "approve" | "reject") {
    setBusyId(id);
    setError("");
    const body: { action: string; adminNote: string; amount?: number } = {
      action,
      adminNote: notes[id] ?? "",
    };
    if (action === "approve") {
      const parsed = Number(amounts[id]);
      if (!Number.isFinite(parsed)) {
        setBusyId(null);
        setError("지급 포인트를 입력해 주세요.");
        return;
      }
      body.amount = parsed;
    }

    const res = await fetch(`/api/admin/beta-free-points/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
      <h1 className="mt-4 text-2xl font-black text-white">클로즈베타 무료 포인트 — 관리</h1>
      <p className="mt-1 text-sm text-gray-400">
        승인 시 입력한 포인트({MIN_ADMIN_FREE_POINT_GRANT}~
        {MAX_ADMIN_FREE_POINT_GRANT.toLocaleString()}P)를 무료 포인트로 지급합니다.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`rounded-full px-3 py-1 text-sm ${
              filter === f.id ? "bg-violet-600 text-white" : "bg-white/5 text-gray-300 hover:bg-white/10"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </p>
      )}

      {loading ? (
        <p className="mt-12 text-center text-sm text-gray-500">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className="mt-12 text-center text-sm text-gray-500">표시할 신청이 없습니다.</p>
      ) : (
        <ul className="mt-6 space-y-4">
          {rows.map((row) => (
            <li key={row.id} className="rounded-2xl border border-white/5 bg-[#131626] p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-bold text-white">@{row.user_nickname}</p>
                  <p className="mt-1 text-sm text-gray-400">{row.user_email}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    신청 #{row.id} · 사용자 ID {row.user_id} · {row.created_at}
                  </p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold ${
                    row.status === "pending"
                      ? "bg-amber-600/20 text-amber-300"
                      : row.status === "approved"
                        ? "bg-emerald-600/20 text-emerald-300"
                        : "bg-zinc-600/30 text-zinc-300"
                  }`}
                >
                  {applicationStatusLabel(row.status)}
                </span>
              </div>

              {row.status === "approved" && row.reward_amount != null && (
                <p className="mt-3 text-sm text-emerald-300">
                  지급: {row.reward_amount.toLocaleString()}P
                </p>
              )}

              {row.status === "pending" && (
                <div className="mt-4 space-y-3 border-t border-white/5 pt-4">
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="block">
                      <span className="text-xs text-gray-400">지급 포인트</span>
                      <input
                        type="number"
                        min={MIN_ADMIN_FREE_POINT_GRANT}
                        max={MAX_ADMIN_FREE_POINT_GRANT}
                        step="0.1"
                        placeholder="예: 5000"
                        value={amounts[row.id] ?? ""}
                        onChange={(e) => setAmounts((prev) => ({ ...prev, [row.id]: e.target.value }))}
                        className="mt-1 w-40 rounded-xl bg-[#0e1120] px-4 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-violet-500"
                      />
                    </label>
                    <input
                      type="text"
                      placeholder="관리자 메모 (선택, 반려 시 사용자에게 표시)"
                      value={notes[row.id] ?? ""}
                      onChange={(e) => setNotes((prev) => ({ ...prev, [row.id]: e.target.value }))}
                      className="min-w-[12rem] flex-1 rounded-xl bg-[#0e1120] px-4 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-violet-500"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => review(row.id, "approve")}
                      className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      승인 · 포인트 지급
                    </button>
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => review(row.id, "reject")}
                      className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm font-bold text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
                    >
                      반려
                    </button>
                  </div>
                </div>
              )}

              {row.admin_note && row.status !== "pending" && (
                <p className="mt-3 text-xs text-gray-500">메모: {row.admin_note}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
