"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import CharacterAssetGalleryLightbox from "@/components/CharacterAssetGalleryLightbox";
import CharacterAssetImage from "@/components/CharacterAssetImage";
import { moderationLabel, type ModerationStatus } from "@/lib/characterVisibility";

type ReviewAsset = {
  url: string;
  tag: string;
  adultFlagged: boolean | null;
  moderationReject: boolean | null;
  moderationReason: string;
};

type Row = {
  id: number;
  name: string;
  nsfw: number;
  official: number;
  visibility: string;
  moderation_status: ModerationStatus;
  moderation_note: string;
  creator_id: number;
  creator_name: string;
  creator_email: string;
  updated_at: string;
  representative_image_url: string | null;
  assets: ReviewAsset[];
};

const FILTERS = [
  { id: "pending", label: "대기" },
  { id: "approved", label: "승인" },
  { id: "rejected", label: "반려" },
  { id: "all", label: "전체" },
] as const;

const EMPTY_UNLOCKED = new Set<string>();

function assetStateLabel(asset: ReviewAsset): { text: string; className: string } {
  if (asset.moderationReject === true) {
    return { text: "하드 반려", className: "bg-rose-600 text-white" };
  }
  if (asset.adultFlagged === true) {
    return { text: "검수 필요", className: "bg-amber-500 text-black" };
  }
  if (asset.adultFlagged === false) {
    return { text: "통과", className: "bg-emerald-700 text-white" };
  }
  return { text: "미분류", className: "bg-zinc-600 text-white" };
}

export default function AdminCharacterModerationClient() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("pending");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [lightbox, setLightbox] = useState<{
    name: string;
    assets: ReviewAsset[];
    index: number;
  } | null>(null);

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
      <h1 className="mt-4 text-2xl font-black text-white">캐릭터 이미지 검수</h1>
      <p className="mt-1 text-sm text-gray-400">
        애매한 선정성(관리자 검수 대상)으로 저장된 성인·일반 캐릭터가 대기합니다. 유두·성기 노출은
        하드 반려되어 여기 오지 않습니다. 레거시 미분류는 자동 통과이며 대기가 아닙니다.
        승인하면 홈에 올라갑니다.
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
                    {row.official === 1 ? " · 공식" : ""}
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

              {row.assets.length > 0 ? (
                <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {row.assets.map((asset, index) => {
                    const badge = assetStateLabel(asset);
                    return (
                      <button
                        key={`${row.id}-${asset.url}-${index}`}
                        type="button"
                        onClick={() =>
                          setLightbox({ name: row.name, assets: row.assets, index })
                        }
                        className={`relative overflow-hidden rounded-xl border ${
                          asset.adultFlagged === true
                            ? "border-amber-400"
                            : "border-white/10"
                        }`}
                      >
                        <CharacterAssetImage
                          src={asset.url}
                          alt={asset.tag || row.name}
                          imgClassName="block aspect-[3/4] w-full object-cover object-top"
                        />
                        <span
                          className={`absolute left-1 top-1 rounded px-1.5 py-0.5 text-[9px] font-black ${badge.className}`}
                        >
                          {badge.text}
                        </span>
                        {asset.tag ? (
                          <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] text-white">
                            {asset.tag}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : row.representative_image_url ? (
                <div className="mt-4 w-24 overflow-hidden rounded-xl border border-white/10">
                  <CharacterAssetImage
                    src={row.representative_image_url}
                    alt={row.name}
                    imgClassName="block aspect-[3/4] w-full object-cover object-top"
                  />
                </div>
              ) : (
                <p className="mt-3 text-xs text-zinc-500">제출된 이미지가 없습니다.</p>
              )}

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

      {lightbox ? (
        <CharacterAssetGalleryLightbox
          open
          assets={lightbox.assets.map((asset) => ({
            url: asset.url,
            tag: asset.tag,
            adultFlagged: asset.adultFlagged ?? undefined,
            moderationReject: asset.moderationReject ?? undefined,
            moderationReason: asset.moderationReason || undefined,
          }))}
          initialIndex={lightbox.index}
          characterName={lightbox.name}
          viewerIsCreator
          unlockedUrls={EMPTY_UNLOCKED}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </div>
  );
}
