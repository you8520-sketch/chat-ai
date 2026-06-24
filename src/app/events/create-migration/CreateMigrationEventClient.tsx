"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { CHARACTER_THUMB_ASPECT } from "@/components/CharacterCard";
import { applicationStatusLabel, type CreateMigrationApplicationStatus } from "@/lib/createMigrationEventShared";
import { CREATE_MIGRATION_EVENT_REWARD } from "@/lib/plans";

type ApplicationInfo = {
  id: number;
  status: CreateMigrationApplicationStatus;
  admin_note: string;
  created_at: string;
};

type CharacterItem = {
  id: number;
  name: string;
  tagline: string;
  emoji: string;
  hue: number;
  images: string;
  moderation_status: string;
  application: ApplicationInfo | null;
};

export default function CreateMigrationEventClient() {
  const router = useRouter();
  const [characters, setCharacters] = useState<CharacterItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const res = await fetch("/api/events/create-migration");
    if (res.status === 401) {
      router.push("/login?redirect=/events/create-migration");
      return;
    }
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error || "목록을 불러오지 못했습니다.");
      return;
    }
    setCharacters(data.characters ?? []);
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  async function apply(characterId: number) {
    setBusyId(characterId);
    setError("");
    const res = await fetch("/api/events/create-migration", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ characterId }),
    });
    const data = await res.json();
    setBusyId(null);
    if (!res.ok) {
      setError(data.error || "신청에 실패했습니다.");
      return;
    }
    setToast("신청이 접수되었습니다. 관리자 승인 후 포인트가 지급됩니다.");
    await load();
    setTimeout(() => setToast(""), 4000);
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Link href="/" className="text-sm text-violet-400 hover:underline">
        ← 홈
      </Link>
      <p className="mt-4 text-xs font-bold uppercase tracking-wider text-emerald-300/90">CLOSED BETA</p>
      <h1 className="mt-1 text-2xl font-black text-white">클로즈베타 캐릭터 제작 포인트 신청</h1>
      <p className="mt-2 text-sm leading-relaxed text-gray-400">
        공개로 저장한 내 캐릭터를 선택해 신청하세요. 관리자 승인 후 무료 포인트{" "}
        <span className="font-bold text-emerald-300">{CREATE_MIGRATION_EVENT_REWARD.toLocaleString()}P</span>가
        지급됩니다.
      </p>

      <div className="mt-4 rounded-xl border border-white/5 bg-[#131626] p-4 text-sm text-gray-400">
        <p className="font-semibold text-white">신청 조건</p>
        <ul className="mt-2 list-inside list-disc space-y-1 text-xs">
          <li>본인이 제작한 캐릭터</li>
          <li>공개(visibility: 공개)로 저장된 캐릭터</li>
          <li>캐릭터당 1회만 신청 가능 (승인·반려 포함)</li>
        </ul>
        <Link href="/create" className="mt-3 inline-block text-xs font-semibold text-violet-400 hover:underline">
          캐릭터 제작하러 가기 →
        </Link>
      </div>

      {toast && (
        <p className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {toast}
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </p>
      )}

      {loading ? (
        <p className="mt-12 text-center text-sm text-gray-500">불러오는 중…</p>
      ) : characters.length === 0 ? (
        <div className="mt-12 rounded-2xl border border-dashed border-white/10 bg-[#131626] p-10 text-center">
          <p className="text-sm text-gray-400">신청 가능한 공개 캐릭터가 없습니다.</p>
          <p className="mt-2 text-xs text-gray-500">캐릭터를 제작한 뒤 공개로 저장해 주세요.</p>
          <Link
            href="/create"
            className="mt-5 inline-block rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-500"
          >
            캐릭터 제작하기
          </Link>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {characters.map((c) => {
            const thumb = (JSON.parse(c.images || "[]") as string[])[0];
            const app = c.application;
            const canApply = !app;
            const disabled = !!app;
            const status = app?.status;

            return (
              <article
                key={c.id}
                className={`flex flex-col overflow-hidden rounded-xl border bg-[#131626] ${
                  disabled ? "border-white/5 opacity-75" : "border-white/10"
                }`}
              >
                <div
                  className={`relative ${CHARACTER_THUMB_ASPECT} w-full overflow-hidden`}
                  style={{
                    background: `linear-gradient(135deg, hsl(${c.hue} 60% 22%), hsl(${(c.hue + 60) % 360} 60% 12%))`,
                  }}
                >
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt={c.name} className="h-full w-full object-cover object-top" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-5xl">{c.emoji}</span>
                  )}
                  {status && (
                    <span
                      className={`absolute left-2 top-2 rounded px-2 py-0.5 text-[10px] font-bold ${
                        status === "pending"
                          ? "bg-amber-600 text-white"
                          : status === "approved"
                            ? "bg-emerald-600 text-white"
                            : "bg-zinc-600 text-white"
                      }`}
                    >
                      {applicationStatusLabel(status)}
                    </span>
                  )}
                </div>
                <div className="flex flex-1 flex-col p-3">
                  <h3 className="line-clamp-1 text-sm font-bold text-white">{c.name}</h3>
                  <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-xs text-gray-400">
                    {c.tagline?.trim() || "한 줄 소개 없음"}
                  </p>
                  {c.moderation_status === "pending" && (
                    <p className="mt-1 text-[10px] text-amber-400/90">검수 대기 중 (신청 가능)</p>
                  )}
                  {app?.admin_note && status === "rejected" && (
                    <p className="mt-1 text-[10px] text-rose-300">사유: {app.admin_note}</p>
                  )}
                  <button
                    type="button"
                    disabled={!canApply || busyId === c.id}
                    onClick={() => apply(c.id)}
                    className={`mt-3 w-full rounded-lg py-2 text-sm font-bold transition ${
                      canApply
                        ? "bg-emerald-500 text-black hover:bg-emerald-400 disabled:opacity-50"
                        : "cursor-not-allowed bg-white/5 text-gray-500"
                    }`}
                  >
                    {busyId === c.id
                      ? "처리 중…"
                      : canApply
                        ? "신청하기"
                        : applicationStatusLabel(status!)}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
