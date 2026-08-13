"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { cn, studioSurface, studioType } from "@/lib/studioDesign";

type AlbumKind = "character" | "campaign";
type AlbumTab = "character" | "trpg";

type CatalogItem = {
  kind: AlbumKind;
  id: number;
  name: string;
  coverUrl: string | null;
  count: number;
};

type AlbumEntry = {
  id: number;
  imageUrl: string;
  mode: string;
  createdAt: string;
};

function positiveInt(raw: string | null): number | null {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function modeLabel(mode: string): string {
  switch (mode) {
    case "sd":
      return "SD 이미지";
    case "emoticon":
      return "이모티콘";
    case "couple_stamp":
      return "커플 인장";
    case "comic":
      return "컷만화";
    case "illustration":
      return "LD 일러스트";
    default:
      return "이미지";
  }
}

export default function AlbumsClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const characterId = positiveInt(searchParams.get("characterId"));
  const campaignId = positiveInt(searchParams.get("campaignId"));
  const requestedTab = searchParams.get("tab") === "trpg" ? "trpg" : "character";
  const tab: AlbumTab = campaignId ? "trpg" : characterId ? "character" : requestedTab;

  const [characters, setCharacters] = useState<CatalogItem[]>([]);
  const [campaigns, setCampaigns] = useState<CatalogItem[]>([]);
  const [entries, setEntries] = useState<AlbumEntry[]>([]);
  const [detailTitle, setDetailTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [deletingUrl, setDeletingUrl] = useState<string | null>(null);

  const detailKind: AlbumKind | null = campaignId ? "campaign" : characterId ? "character" : null;
  const catalog = tab === "trpg" ? campaigns : characters;

  const loadCatalog = useCallback(async () => {
    const response = await fetch("/api/chat/image-album?catalog=1", { cache: "no-store" });
    const data = (await response.json().catch(() => null)) as
      | { ok?: boolean; catalog?: { characters?: CatalogItem[]; campaigns?: CatalogItem[] }; error?: string }
      | null;
    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || "앨범 목록을 불러오지 못했습니다.");
    }
    setCharacters(Array.isArray(data.catalog?.characters) ? data.catalog.characters : []);
    setCampaigns(Array.isArray(data.catalog?.campaigns) ? data.catalog.campaigns : []);
  }, []);

  const loadDetail = useCallback(async () => {
    if (!characterId && !campaignId) {
      setEntries([]);
      setDetailTitle("");
      return;
    }
    const query = campaignId
      ? `campaignId=${encodeURIComponent(String(campaignId))}`
      : `characterId=${encodeURIComponent(String(characterId))}`;
    const response = await fetch(`/api/chat/image-album?${query}`, { cache: "no-store" });
    const data = (await response.json().catch(() => null)) as
      | { ok?: boolean; album?: AlbumEntry[]; title?: string; error?: string }
      | null;
    if (!response.ok || !data) {
      throw new Error(data?.error || "앨범을 불러오지 못했습니다.");
    }
    setEntries(Array.isArray(data.album) ? data.album : []);
    setDetailTitle(data.title?.trim() || (campaignId ? "TRPG 캠페인" : "캐릭터"));
  }, [campaignId, characterId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void (async () => {
      try {
        await loadCatalog();
        await loadDetail();
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "앨범을 불러오지 못했습니다.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadCatalog, loadDetail]);

  const openAlbum = (kind: AlbumKind, id: number) => {
    const params = new URLSearchParams();
    if (kind === "campaign") params.set("campaignId", String(id));
    else params.set("characterId", String(id));
    router.push(`/albums?${params.toString()}`);
  };

  const backToList = () => {
    router.push(tab === "trpg" ? "/albums?tab=trpg" : "/albums");
  };

  async function deleteEntry(imageUrl: string) {
    if (deletingUrl || !detailKind) return;
    setDeletingUrl(imageUrl);
    setError("");
    try {
      const response = await fetch("/api/chat/image-album", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          campaignId
            ? { campaignId, imageUrl }
            : { characterId, imageUrl }
        ),
      });
      const data = (await response.json().catch(() => null)) as
        | { ok?: boolean; album?: AlbumEntry[]; error?: string }
        | null;
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "이미지를 삭제하지 못했습니다.");
      }
      setEntries(Array.isArray(data.album) ? data.album : []);
      if (selectedUrl === imageUrl) setSelectedUrl(null);
      await loadCatalog();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "이미지를 삭제하지 못했습니다.");
    } finally {
      setDeletingUrl(null);
    }
  }

  const heading = useMemo(() => {
    if (detailKind === "campaign") return detailTitle || "TRPG 캠페인";
    if (detailKind === "character") return detailTitle || "캐릭터";
    return tab === "trpg" ? "TRPG 캠페인" : "일반 캐릭터";
  }, [detailKind, detailTitle, tab]);

  return (
    <div className="space-y-4">
      {detailKind ? (
        <button
          type="button"
          onClick={backToList}
          className={cn(studioSurface.backLink, "text-left")}
        >
          ← 앨범 목록
        </button>
      ) : (
        <div className={studioSurface.tabList}>
          <Link
            href="/albums"
            className={cn(
              "min-h-11 flex-1 rounded-lg px-3 py-2 text-center text-sm font-semibold transition",
              tab === "character" ? studioSurface.tabActive : studioSurface.tabIdle
            )}
          >
            일반 캐릭터
          </Link>
          <Link
            href="/albums?tab=trpg"
            className={cn(
              "min-h-11 flex-1 rounded-lg px-3 py-2 text-center text-sm font-semibold transition",
              tab === "trpg" ? studioSurface.tabActive : studioSurface.tabIdle
            )}
          >
            TRPG
          </Link>
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className={studioType.sectionTitle}>{heading}</h2>
          <p className={cn(studioType.helper, "mt-1")}>
            {detailKind === "campaign"
              ? "이 캠페인에서 만든 선택 턴 일러스트입니다."
              : detailKind === "character"
                ? "이 캐릭터 1:1 채팅에서 만든 이미지입니다. TRPG 장면은 TRPG 탭에 있습니다."
                : tab === "trpg"
                  ? "캠페인 제목별로 모은 TRPG 일러스트입니다."
                  : "캐릭터 1:1 채팅에서 만든 이미지만 모았습니다."}
          </p>
        </div>
        {detailKind === "campaign" && campaignId ? (
          <Link href={`/trpg/${campaignId}`} className={studioSurface.linkQuiet}>
            캠페인으로
          </Link>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-zinc-500">앨범을 불러오는 중…</p>
      ) : detailKind ? (
        entries.length === 0 ? (
          <p className="rounded-xl border border-white/10 bg-[#131626] px-4 py-8 text-center text-sm text-zinc-500">
            아직 저장된 이미지가 없습니다.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {entries.map((entry) => (
              <figure
                key={entry.id}
                className="overflow-hidden rounded-xl border border-white/10 bg-[#131626]"
              >
                <button
                  type="button"
                  onClick={() => setSelectedUrl(entry.imageUrl)}
                  className="block w-full"
                >
                  <img
                    src={entry.imageUrl}
                    alt=""
                    className="aspect-[2/3] w-full object-cover object-top"
                  />
                </button>
                <figcaption className="flex items-center justify-between gap-2 px-2 py-1.5">
                  <span className="truncate text-[10px] text-zinc-400">{modeLabel(entry.mode)}</span>
                  <button
                    type="button"
                    onClick={() => void deleteEntry(entry.imageUrl)}
                    disabled={deletingUrl === entry.imageUrl}
                    className="text-[10px] font-semibold text-zinc-500 hover:text-rose-300 disabled:opacity-40"
                  >
                    {deletingUrl === entry.imageUrl ? "삭제 중" : "삭제"}
                  </button>
                </figcaption>
              </figure>
            ))}
          </div>
        )
      ) : catalog.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-[#131626] px-4 py-8 text-center text-sm text-zinc-500">
          {tab === "trpg"
            ? "아직 TRPG 캠페인 앨범이 없습니다. 캠페인에서 선택 턴 일러스트를 만들면 여기에 모입니다."
            : "아직 일반 캐릭터 앨범이 없습니다. 채팅에서 이미지를 만들면 여기에 모입니다."}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {catalog.map((item) => (
            <button
              key={`${item.kind}-${item.id}`}
              type="button"
              onClick={() => openAlbum(item.kind, item.id)}
              className="overflow-hidden rounded-xl border border-white/10 bg-[#131626] text-left transition hover:border-violet-400/40"
            >
              <div className="aspect-[2/3] bg-black/30">
                {item.coverUrl ? (
                  <img src={item.coverUrl} alt="" className="h-full w-full object-cover object-top" />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-zinc-600">
                    이미지 없음
                  </div>
                )}
              </div>
              <div className="px-3 py-2">
                <p className="truncate text-sm font-semibold text-zinc-100">{item.name}</p>
                <p className="text-[11px] text-zinc-500">{item.count.toLocaleString()}장</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {selectedUrl ? (
        <div
          className="fixed inset-0 z-[140] flex items-center justify-center bg-black/75 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="앨범 이미지"
          onClick={() => setSelectedUrl(null)}
        >
          <img
            src={selectedUrl}
            alt=""
            className="max-h-[88dvh] max-w-full rounded-xl object-contain"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  );
}
