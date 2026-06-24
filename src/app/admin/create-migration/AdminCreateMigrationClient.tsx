"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { CHARACTER_THUMB_ASPECT } from "@/components/CharacterCard";
import { applicationStatusLabel, type CreateMigrationApplicationStatus } from "@/lib/createMigrationEventShared";
import { CREATE_MIGRATION_EVENT_REWARD } from "@/lib/plans";

type ApplicationRow = {
  id: number;
  user_id: number;
  character_id: number;
  status: CreateMigrationApplicationStatus;
  admin_note: string;
  created_at: string;
  character_name: string;
  user_nickname: string;
  user_email: string;
};

const FILTERS = [
  { id: "pending", label: "대기" },
  { id: "approved", label: "승인" },
  { id: "rejected", label: "반려" },
  { id: "all", label: "전체" },
] as const;

export default function AdminCreateMigrationClient() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("pending");
  const [rows, setRows] = useState<ApplicationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const res = await fetch(`/api/admin/create-migration?status=${filter}`);
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
    const res = await fetch(`/api/admin/create-migration/${id}`, {
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
      <h1 className="mt-4 text-2xl font-black text-white">캐릭터 제작 포인트 신청 — 관리</h1>
      <p className="mt-1 text-sm text-gray-400">
        승인 시 신청자에게 {CREATE_MIGRATION_EVENT_REWARD.toLocaleString()}P(무료) 지급
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
                  <p className="text-lg font-bold text-white">{row.character_name}</p>
                  <p className="mt-1 text-sm text-gray-400">
                    @{row.user_nickname} · {row.user_email}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    신청 #{row.id} · 캐릭터 ID {row.character_id} · {row.created_at}
                  </p>
                  <Link
                    href={`/character/${row.character_id}`}
                    className="mt-2 inline-block text-xs text-violet-400 hover:underline"
                  >
                    캐릭터 보기 →
                  </Link>
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

              {row.status === "pending" && (
                <div className="mt-4 space-y-3 border-t border-white/5 pt-4">
                  <input
                    type="text"
                    placeholder="관리자 메모 (반려 시 사용자에게 표시)"
                    value={notes[row.id] ?? ""}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [row.id]: e.target.value }))}
                    className="w-full rounded-xl bg-[#0e1120] px-4 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-violet-500"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => review(row.id, "approve")}
                      className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      승인 · {CREATE_MIGRATION_EVENT_REWARD.toLocaleString()}P 지급
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
