"use client";

import { useEffect, useMemo, useState } from "react";
import CharacterAssetImage from "@/components/CharacterAssetImage";
import {
  listCharacterAssetAlbums,
  type StoredCharacterAssetAlbum,
} from "@/lib/characterAssetUnlocks";
import type { CharacterAsset } from "@/lib/characterAssets";

type AlbumAsset = {
  url: string;
  tag: string;
  generated?: boolean;
};

type Album = Omit<StoredCharacterAssetAlbum, "assets"> & {
  assets: AlbumAsset[];
};

type GeneratedAlbumEntry = {
  id: number;
  imageUrl: string;
  mode: "sd" | "comic";
  createdAt: string;
};

type Props = {
  open: boolean;
  currentCharacterId: number;
  currentCharacterName: string;
  currentAssets: CharacterAsset[];
  onClose: () => void;
};

function mergeAssets(...groups: AlbumAsset[][]): AlbumAsset[] {
  const seen = new Set<string>();
  const merged: AlbumAsset[] = [];
  for (const group of groups) {
    for (const asset of group) {
      const url = asset.url.trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      merged.push({ ...asset, url });
    }
  }
  return merged;
}

export function IconAlbum({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      className={className}
      aria-hidden
    >
      <rect x="4" y="5" width="14" height="14" rx="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 3h10a2 2 0 0 1 2 2v10" />
      <circle cx="9" cy="10" r="1.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m6.5 17 3.5-3.5 2.5 2.5 2-2L18 17" />
    </svg>
  );
}

export default function ChatAssetAlbumModal({
  open,
  currentCharacterId,
  currentCharacterName,
  currentAssets,
  onClose,
}: Props) {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [selectedId, setSelectedId] = useState(currentCharacterId);
  const [generatedAssets, setGeneratedAssets] = useState<AlbumAsset[]>([]);
  const [generatedLoading, setGeneratedLoading] = useState(false);
  const [generatedError, setGeneratedError] = useState("");
  const [selectedAsset, setSelectedAsset] = useState<AlbumAsset | null>(null);

  useEffect(() => {
    if (!open) return;
    setAlbums(
      listCharacterAssetAlbums().map((album) => ({
        ...album,
        assets: album.assets.map((asset) => ({ ...asset, generated: false })),
      }))
    );
    setSelectedId(currentCharacterId);
    setGeneratedAssets([]);
    setGeneratedError("");
    setSelectedAsset(null);
    setGeneratedLoading(true);

    let cancelled = false;
    void fetch(
      `/api/chat/image-album?characterId=${encodeURIComponent(String(currentCharacterId))}`,
      { cache: "no-store" }
    )
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as
          | { album?: GeneratedAlbumEntry[]; error?: string }
          | null;
        if (!response.ok || !data) {
          throw new Error(data?.error || "생성 이미지 앨범을 불러오지 못했습니다.");
        }
        if (cancelled) return;
        const rows = Array.isArray(data.album) ? data.album : [];
        setGeneratedAssets(
          rows.map((item) => ({
            url: item.imageUrl,
            tag: item.mode === "comic" ? "AI 컷만화" : "AI SD 굿즈",
            generated: true,
          }))
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setGeneratedError(
          error instanceof Error ? error.message : "생성 이미지 앨범을 불러오지 못했습니다."
        );
      })
      .finally(() => {
        if (!cancelled) setGeneratedLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentCharacterId, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const currentAlbum = useMemo<Album>(() => {
    const storedCurrent = albums.find((album) => album.characterId === currentCharacterId);
    const canonicalAssets: AlbumAsset[] = currentAssets.map((asset) => ({
      url: asset.url,
      tag: asset.tag,
      generated: false,
    }));
    return {
      characterId: currentCharacterId,
      characterName: currentCharacterName,
      assets: mergeAssets(canonicalAssets, storedCurrent?.assets ?? [], generatedAssets),
      updatedAt: storedCurrent?.updatedAt ?? "",
    };
  }, [albums, currentAssets, currentCharacterId, currentCharacterName, generatedAssets]);

  const mergedAlbums = useMemo(() => {
    const others = albums.filter((album) => album.characterId !== currentCharacterId);
    return [currentAlbum, ...others].filter((album) => album.assets.length > 0);
  }, [albums, currentAlbum, currentCharacterId]);

  const selectedAlbum =
    mergedAlbums.find((album) => album.characterId === selectedId) ?? mergedAlbums[0] ?? currentAlbum;

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="이미지 앨범"
      onClick={onClose}
    >
      <section
        className="flex max-h-[min(86dvh,48rem)] w-full max-w-5xl overflow-hidden rounded-2xl border border-white/10 bg-[#101010] shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        <aside className="hidden w-52 shrink-0 border-r border-white/10 bg-black/20 p-2 md:block">
          <p className="px-2 py-2 text-[11px] font-bold text-zinc-500">앨범 선택</p>
          <div className="space-y-1">
            {mergedAlbums.map((album) => (
              <button
                key={album.characterId}
                type="button"
                onClick={() => setSelectedId(album.characterId)}
                className={`w-full rounded-lg px-2 py-2 text-left text-xs transition ${
                  selectedAlbum.characterId === album.characterId
                    ? "bg-white/10 text-white"
                    : "text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100"
                }`}
              >
                <span className="block truncate font-semibold">{album.characterName}</span>
                <span className="text-[10px] text-zinc-500">
                  {album.assets.length.toLocaleString()}장
                </span>
              </button>
            ))}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-violet-200/80">이미지 앨범</p>
              <h2 className="truncate text-base font-bold text-white">{selectedAlbum.characterName}</h2>
              {selectedAlbum.characterId === currentCharacterId ? (
                <p className="mt-0.5 text-[10px] text-zinc-500">
                  기존 캐릭터 에셋과 저장한 SD·컷만화를 함께 표시합니다.
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <select
                value={selectedAlbum.characterId}
                onChange={(e) => setSelectedId(Number(e.target.value))}
                className="max-w-40 rounded-lg border border-white/10 bg-[#171717] px-2 py-1.5 text-xs text-zinc-100 outline-none md:hidden"
              >
                {mergedAlbums.map((album) => (
                  <option key={album.characterId} value={album.characterId}>
                    {album.characterName}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-lg text-zinc-300 hover:bg-white/10 hover:text-white"
                aria-label="앨범 닫기"
              >
                ×
              </button>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {generatedLoading && selectedAlbum.characterId === currentCharacterId ? (
              <p className="mb-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-400">
                저장한 생성 이미지를 불러오는 중…
              </p>
            ) : null}
            {generatedError && selectedAlbum.characterId === currentCharacterId ? (
              <p className="mb-3 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                {generatedError}
              </p>
            ) : null}
            {selectedAlbum.assets.length === 0 ? (
              <p className="py-16 text-center text-sm text-zinc-500">
                아직 앨범 이미지가 없습니다.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {selectedAlbum.assets.map((asset) => (
                  <figure
                    key={asset.url}
                    className="overflow-hidden rounded-xl border border-white/10 bg-[#0a0a0a]"
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedAsset(asset)}
                      className="block w-full cursor-zoom-in bg-transparent"
                      aria-label={`${asset.tag || "이미지"} 크게 보기`}
                    >
                      <CharacterAssetImage
                        src={asset.url}
                        alt={asset.tag}
                        className="aspect-[3/4] w-full"
                        imgClassName={
                          asset.generated
                            ? "h-full w-full object-contain object-center"
                            : "h-full w-full object-cover object-top"
                        }
                      />
                    </button>
                    <figcaption className="flex items-center justify-between gap-2 px-2 py-1.5 text-[11px] text-zinc-400">
                      <span className="truncate">{asset.tag || "이미지"}</span>
                      {asset.generated ? (
                        <span className="shrink-0 rounded bg-violet-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-violet-200">
                          생성
                        </span>
                      ) : null}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
      {selectedAsset ? (
        <div
          className="fixed inset-0 z-[135] flex items-center justify-center bg-black/90 p-3 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="앨범 이미지 크게 보기"
          onClick={(event) => {
            event.stopPropagation();
            setSelectedAsset(null);
          }}
        >
          <div
            className="relative flex h-full w-full max-w-6xl items-center justify-center"
            onClick={(event) => event.stopPropagation()}
          >
            <CharacterAssetImage
              src={selectedAsset.url}
              alt={selectedAsset.tag || "앨범 이미지"}
              className="flex h-full w-full items-center justify-center"
              imgClassName="max-h-full max-w-full object-contain"
            />
            <button
              type="button"
              onClick={() => setSelectedAsset(null)}
              className="absolute right-1 top-1 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/60 text-xl text-white hover:bg-black/80"
              aria-label="크게 보기 닫기"
            >
              ×
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
