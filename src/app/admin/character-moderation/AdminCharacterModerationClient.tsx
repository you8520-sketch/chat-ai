"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { moderationLabel, type ModerationStatus } from "@/lib/characterVisibility";

type Row = {
  id: number;
  name: string;
  nsfw: number;
  visibility: string;
  moderation_status: ModerationStatus;
  moderation_note: string;
  creator_id: number;
  creator_name: string;
  creator_email: string;
  updated_at: string;
};

const FILTERS = [
  { id: "pending", label: "대기" },
  { id: "approved", label: "승인" },
  { id: "rejected", label: "반려" },
  { id: "all", label: "전체" },
] as const;

export default function AdminCharacterModerationClient() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("pending");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const res = await fetch(`/api/admin/character-moderation?status=${filter}`);
    const data = (await res.json()) as { characters?: Row[]; error?: string };
    setLoading(false);
    if (!res.ok) {
      setError(data.error || "목록을 불러오지 못했습니다.");
      return;
    }
    setRows(data.characters ?? []);
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function review(id: number, action: "approve" | "reject") {
    setBusyId(id);
    setError("");
    const res = await fetch(`/api/admin/character-moderation/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, adminNote: notes[id] ?? "" }),
    });
    const data = (await res.json()) as { error?: string };
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
      <h1 className="mt-4 text-2xl font-black text-white">성인 캐릭터 홈 노출 검수</h1>
      <p className="mt-1 text-sm text-gray-400">
        에셋 태깅에서 성인용으로 걸린 캐릭터만 대기합니다. 승인하면 홈에 올라갑니다.
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            type="button"
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              filter === f.id ? "bg-violet-600 text-white" : "border border-white/10 text-zinc-300"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="mt-12 text-center text-sm text-gray-500">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className="mt-12 text-center text-sm text-gray-500">표시할 캐릭터가 없습니다.</p>
      ) : (
        <ul className="mt-6 space-y-4">
          {rows.map((row) => (
            <li key={row.id} className="rounded-2xl border border-white/5 bg-[#131626] p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-bold text-white">{row.name}</p>
                  <p className="mt-1 text-sm text-gray-400">
                    @{row.creator_name} · {row.creator_email}
                    {row.nsfw === 1 ? " · 성인" : " · 일반"}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    #{row.id} · {row.visibility} · {row.updated_at}
                  </p>
                  {row.moderation_note ? (
                    <p className="mt-2 text-xs text-amber-200/80">{row.moderation_note}</p>
                  ) : null}
                  <Link
                    href={`/character/${row.id}`}
                    className="mt-2 inline-block text-xs text-violet-400 hover:underline"
                  >
                    캐릭터 보기 →
                  </Link>
                </div>
                <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-zinc-200">
                  {moderationLabel(row.moderation_status)}
                </span>
              </div>
              {row.moderation_status === "pending" ? (
                <div className="mt-4 space-y-2">
                  <input
                    value={notes[row.id] ?? ""}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [row.id]: e.target.value }))}
                    placeholder="관리자 메모 (선택)"
                    className="min-h-10 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-sm text-zinc-100"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => void review(row.id, "approve")}
                      className="inline-flex min-h-10 items-center rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      홈 노출 승인
                    </button>
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => void review(row.id, "reject")}
                      className="inline-flex min-h-10 items-center rounded-xl border border-rose-500/30 px-4 text-sm font-semibold text-rose-200 disabled:opacity-50"
                    >
                      반려
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
