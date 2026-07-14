"use client";

import { useEffect, useMemo, useState } from "react";
import CharacterAssetImage from "@/components/CharacterAssetImage";
import {
  listCharacterAssetAlbums,
  type StoredCharacterAssetAlbum,
} from "@/lib/characterAssetUnlocks";
import type { CharacterAsset } from "@/lib/characterAssets";

type Album = StoredCharacterAssetAlbum;

type Props = {
  open: boolean;
  currentCharacterId: number;
  currentCharacterName: string;
  currentAssets: CharacterAsset[];
  onClose: () => void;
};

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

  useEffect(() => {
    if (!open) return;
    setAlbums(listCharacterAssetAlbums());
    setSelectedId(currentCharacterId);
  }, [currentCharacterId, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const currentAlbum = useMemo<Album>(
    () => ({
      characterId: currentCharacterId,
      characterName: currentCharacterName,
      assets: currentAssets.map((asset) => ({ url: asset.url, tag: asset.tag })),
      updatedAt: "",
    }),
    [currentAssets, currentCharacterId, currentCharacterName]
  );

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
      aria-label="해금 이미지 앨범"
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
            {selectedAlbum.assets.length === 0 ? (
              <p className="py-16 text-center text-sm text-zinc-500">
                아직 해금된 이미지가 없습니다.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {selectedAlbum.assets.map((asset) => (
                  <figure
                    key={asset.url}
                    className="overflow-hidden rounded-xl border border-white/10 bg-[#0a0a0a]"
                  >
                    <CharacterAssetImage
                      src={asset.url}
                      alt={asset.tag}
                      className="aspect-[3/4] w-full"
                      imgClassName="h-full w-full object-cover object-top"
                    />
                    <figcaption className="truncate px-2 py-1.5 text-[11px] text-zinc-400">
                      {asset.tag || "이미지"}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
