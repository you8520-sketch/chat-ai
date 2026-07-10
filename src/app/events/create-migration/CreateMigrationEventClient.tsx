"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { CHARACTER_THUMB_ASPECT } from "@/components/CharacterCard";
import StudioButton from "@/components/studio/StudioButton";
import { applicationStatusLabel, type CreateMigrationApplicationStatus } from "@/lib/createMigrationEventShared";
import { CREATE_MIGRATION_EVENT_REWARD } from "@/lib/plans";
import { cn, studioSurface, studioType } from "@/lib/studioDesign";

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

function statusPillClass(status: CreateMigrationApplicationStatus): string {
  if (status === "pending") return "bg-zinc-600/40 text-zinc-200";
  if (status === "approved") return "bg-violet-600/30 text-violet-200";
  return "bg-rose-600/30 text-rose-200";
}

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
      <span className="mt-4 inline-block rounded-full bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-zinc-400 ring-1 ring-white/10">
        CLOSED BETA
      </span>
      <h1 className={cn(studioType.heading, "mt-2")}>클로즈베타 캐릭터 제작 포인트 신청</h1>
      <p className={cn(studioType.body, "mt-2")}>
        공개로 저장한 내 캐릭터를 선택해 신청하세요. 관리자 승인 후 무료 포인트{" "}
        <span className="font-semibold text-zinc-50">{CREATE_MIGRATION_EVENT_REWARD.toLocaleString()}P</span>가
        지급됩니다.
      </p>

      <div className={cn(studioSurface.card, "mt-4 text-sm")}>
        <p className="font-semibold text-zinc-50">신청 조건</p>
        <ul className={cn(studioType.caption, "mt-2 list-inside list-disc space-y-1")}>
          <li>본인이 제작한 캐릭터</li>
          <li>공개(visibility: 공개)로 저장된 캐릭터</li>
          <li>캐릭터당 1회만 신청 가능 (승인·반려 포함)</li>
        </ul>
        <Link href="/create" className="mt-3 inline-block text-xs font-semibold text-violet-400 hover:underline">
          캐릭터 제작하러 가기 →
        </Link>
      </div>

      {toast && (
        <p className="mt-4 rounded-xl border border-white/10 bg-violet-600/10 px-4 py-3 text-sm text-violet-200">
          {toast}
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </p>
      )}

      {loading ? (
        <p className={cn(studioType.helper, "mt-12 text-center")}>불러오는 중…</p>
      ) : characters.length === 0 ? (
        <div className={cn(studioSurface.cardDashed, "mt-12 p-10 text-center")}>
          <p className={studioType.body}>신청 가능한 공개 캐릭터가 없습니다.</p>
          <p className={cn(studioType.caption, "mt-2")}>캐릭터를 제작한 뒤 공개로 저장해 주세요.</p>
          <StudioButton href="/create" className="mt-5">
            캐릭터 제작하기
          </StudioButton>
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
                className={cn(
                  "flex flex-col overflow-hidden rounded-xl border bg-[#131626]",
                  disabled ? "border-white/10 opacity-75" : "border-white/10",
                )}
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
                      className={cn(
                        "absolute left-2 top-2 rounded px-2 py-0.5 text-[10px] font-semibold",
                        statusPillClass(status),
                      )}
                    >
                      {applicationStatusLabel(status)}
                    </span>
                  )}
                </div>
                <div className="flex flex-1 flex-col p-3">
                  <h3 className="line-clamp-1 text-sm font-semibold text-zinc-50">{c.name}</h3>
                  <p className={cn(studioType.caption, "mt-1 line-clamp-2 min-h-[2.5rem]")}>
                    {c.tagline?.trim() || "한 줄 소개 없음"}
                  </p>
                  {c.moderation_status === "pending" && (
                    <p className="mt-1 text-[10px] text-zinc-400">검수 대기 중 (신청 가능)</p>
                  )}
                  {app?.admin_note && status === "rejected" && (
                    <p className="mt-1 text-[10px] text-rose-300">사유: {app.admin_note}</p>
                  )}
                  {canApply ? (
                    <StudioButton
                      type="button"
                      disabled={busyId === c.id}
                      onClick={() => apply(c.id)}
                      className="mt-3 w-full"
                    >
                      {busyId === c.id ? "처리 중…" : "신청하기"}
                    </StudioButton>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="mt-3 w-full cursor-not-allowed rounded-xl bg-white/5 py-2 text-sm font-semibold text-zinc-500"
                    >
                      {applicationStatusLabel(status!)}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
