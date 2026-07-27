"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  CHAT_COMIC_MAX_INPUT_CHARS,
  CHAT_COMIC_MOODS,
  CHAT_COMIC_STYLE_PREVIEW_URL,
  CHAT_IMAGE_EXPRESSIONS,
  CHAT_IMAGE_GENERATION_DEFAULT_OPTIONS,
  CHAT_IMAGE_MOODS,
  CHAT_IMAGE_PLACEMENTS,
  resolveChatComicGenerationPrice,
  type ChatComicMood,
  type ChatComicPanelCount,
  type ChatImageExpression,
  type ChatImageMood,
  type ChatImagePlacement,
} from "@/lib/chatImageGeneration";
import {
  CHARACTER_ASSET_ALBUM_UPDATED_EVENT,
  appendCharacterAssetAlbumAsset,
  listCharacterAssetAlbums,
  saveCharacterAssetAlbum,
  type StoredCharacterAlbumAsset,
} from "@/lib/characterAssetUnlocks";
import { dispatchPointsDeducted } from "@/lib/pointsEvents";

const PERSONA_STORAGE_KEY = "habi:lastPersonaId";
const SD_FALLBACK_PRICE = 350;

type GeneratorTab = "sd" | "comic" | "album";
type ReferenceInfo = { id: number; name: string; imageUrl: string };
type Preflight = {
  ready: boolean;
  missing: string[];
  pricePoints: number;
  modelId: string;
  modelLabel: string;
  template: { id: string; name: string; previewUrl: string };
  character: ReferenceInfo;
  persona: ReferenceInfo | null;
  balance?: { total: number; paid: number; free: number };
  latestResult?: { imageUrl: string; chargedPoints: number; createdAt: string } | null;
};
type GenerateResult = {
  error?: string;
  imageUrl?: string;
  totalPointsCost?: number;
  remainingPoints?: number;
  paidPoints?: number;
  freePoints?: number;
  albumTag?: string;
  downloadName?: string;
};
type GeneratedImage = { imageUrl: string; albumTag: string; downloadName: string };

function currentRouteIds() {
  const match = window.location.pathname.match(/^\/chat\/(\d+)/);
  const params = new URLSearchParams(window.location.search);
  const personaId = Number(localStorage.getItem(PERSONA_STORAGE_KEY));
  const chatId = Number(params.get("chat"));
  return {
    characterId: match ? Number(match[1]) : null,
    chatId: Number.isInteger(chatId) && chatId > 0 ? chatId : null,
    personaId: Number.isInteger(personaId) && personaId > 0 ? personaId : null,
  };
}

function queryString(ids: ReturnType<typeof currentRouteIds>) {
  const params = new URLSearchParams();
  if (ids.characterId) params.set("characterId", String(ids.characterId));
  if (ids.chatId) params.set("chatId", String(ids.chatId));
  if (ids.personaId) params.set("personaId", String(ids.personaId));
  return params.toString();
}

function IconImageSpark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-4 w-4" aria-hidden>
      <rect x="3" y="5" width="14" height="14" rx="2" />
      <circle cx="8" cy="10" r="1.4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m5 17 4-4 3 3 2-2 3 3" />
      <path strokeLinecap="round" d="M19.5 2.5v4M17.5 4.5h4" />
    </svg>
  );
}

function ReferenceCard({ label, info }: { label: string; info: ReferenceInfo | null }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-2">
      <p className="mb-1.5 text-[10px] font-semibold text-zinc-400">{label}</p>
      <div className="flex items-center gap-2">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-black/25">
          {info?.imageUrl ? <img src={info.imageUrl} alt="" className="h-full w-full object-cover" /> : null}
        </div>
        <p className="min-w-0 truncate text-xs font-semibold text-zinc-200">{info?.name || "선택 안 됨"}</p>
      </div>
    </div>
  );
}

export default function ChatImageGeneratorRailButton() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<GeneratorTab>("sd");
  const [info, setInfo] = useState<Preflight | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sdResult, setSdResult] = useState<GeneratedImage | null>(null);
  const [comicResult, setComicResult] = useState<GeneratedImage | null>(null);
  const [albumAssets, setAlbumAssets] = useState<StoredCharacterAlbumAsset[]>([]);

  const [placement, setPlacement] = useState<ChatImagePlacement>(CHAT_IMAGE_GENERATION_DEFAULT_OPTIONS.placement);
  const [topExpression, setTopExpression] = useState<ChatImageExpression>(CHAT_IMAGE_GENERATION_DEFAULT_OPTIONS.topExpression);
  const [bottomExpression, setBottomExpression] = useState<ChatImageExpression>(CHAT_IMAGE_GENERATION_DEFAULT_OPTIONS.bottomExpression);
  const [mood, setMood] = useState<ChatImageMood>(CHAT_IMAGE_GENERATION_DEFAULT_OPTIONS.mood);
  const [comicText, setComicText] = useState("");
  const [panelCount, setPanelCount] = useState<ChatComicPanelCount>(4);
  const [comicMood, setComicMood] = useState<ChatComicMood>("comic");

  const comicPrice = resolveChatComicGenerationPrice(panelCount);
  const result = tab === "comic" ? comicResult : sdResult;
  const preview = useMemo(() => {
    if (tab === "comic") {
      return {
        url: comicResult?.imageUrl || CHAT_COMIC_STYLE_PREVIEW_URL,
        alt: comicResult ? "생성된 컷만화" : "컷만화 예시",
        ratio: panelCount === 2 ? "aspect-[4/3]" : "aspect-[3/4]",
      };
    }
    return {
      url: sdResult?.imageUrl || info?.template.previewUrl || "",
      alt: sdResult ? "생성된 SD 이미지" : "선물상자 SD 고정틀",
      ratio: "aspect-[4/3]",
    };
  }, [comicResult, info?.template.previewUrl, panelCount, sdResult, tab]);

  const refreshAlbum = useCallback((characterId?: number | null) => {
    if (!characterId) return setAlbumAssets([]);
    const album = listCharacterAssetAlbums().find((item) => item.characterId === characterId);
    setAlbumAssets(album?.assets ?? []);
  }, []);

  const loadInfo = useCallback(async () => {
    setLoadingInfo(true);
    setError("");
    try {
      const response = await fetch(`/api/chat/image-generation?${queryString(currentRouteIds())}`, { cache: "no-store" });
      const data = (await response.json().catch(() => null)) as (Preflight & { error?: string }) | null;
      if (!response.ok || !data) throw new Error(data?.error || "이미지 생성 정보를 불러오지 못했습니다.");
      setInfo(data);
      if (data.character.imageUrl) {
        saveCharacterAssetAlbum(data.character.id, data.character.name, [{ url: data.character.imageUrl, tag: "대표 이미지" }]);
      }
      if (data.latestResult?.imageUrl) {
        setSdResult((previous) => previous ?? {
          imageUrl: data.latestResult!.imageUrl,
          albumTag: "AI SD 굿즈",
          downloadName: `${data.character.name}-SD-굿즈.webp`,
        });
      }
      refreshAlbum(data.character.id);
    } catch (caught) {
      setInfo(null);
      setError(caught instanceof Error ? caught.message : "이미지 생성 정보를 불러오지 못했습니다.");
    } finally {
      setLoadingInfo(false);
    }
  }, [refreshAlbum]);

  useEffect(() => {
    if (!open) return;
    void loadInfo();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !generating && !saving) setOpen(false);
    };
    const onAlbumUpdated = (event: Event) => {
      const id = (event as CustomEvent<{ characterId?: number }>).detail?.characterId;
      if (!id || id === info?.character.id) refreshAlbum(id ?? info?.character.id);
    };
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener(CHARACTER_ASSET_ALBUM_UPDATED_EVENT, onAlbumUpdated);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener(CHARACTER_ASSET_ALBUM_UPDATED_EVENT, onAlbumUpdated);
    };
  }, [generating, info?.character.id, loadInfo, open, refreshAlbum, saving]);

  function applyBilling(data: GenerateResult) {
    if (typeof data.totalPointsCost !== "number" || typeof data.remainingPoints !== "number") return;
    dispatchPointsDeducted({
      totalPointsCost: data.totalPointsCost,
      remainingPoints: data.remainingPoints,
      paidPoints: data.paidPoints ?? 0,
      freePoints: data.freePoints ?? 0,
    });
    setInfo((previous) => previous ? {
      ...previous,
      balance: { total: data.remainingPoints!, paid: data.paidPoints ?? 0, free: data.freePoints ?? 0 },
    } : previous);
  }

  async function postGeneration(url: string, body: Record<string, unknown>): Promise<GenerateResult> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 300_000);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ ...currentRouteIds(), ...body }),
      });
      const data = (await response.json().catch(() => null)) as GenerateResult | null;
      if (!response.ok || !data?.imageUrl) throw new Error(data?.error || "이미지 생성에 실패했습니다.");
      return data;
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function generateSd() {
    if (!info?.ready || generating) return;
    setGenerating(true); setError(""); setNotice("");
    try {
      const data = await postGeneration("/api/chat/image-generation", { placement, topExpression, bottomExpression, mood });
      setSdResult({ imageUrl: data.imageUrl!, albumTag: "AI SD 굿즈", downloadName: `${info.character.name}-SD-굿즈.webp` });
      applyBilling(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "이미지 생성 중 오류가 발생했습니다.");
    } finally {
      setGenerating(false);
    }
  }

  async function generateComic() {
    if (!info?.ready || generating || !comicText.trim()) return;
    setGenerating(true); setError(""); setNotice("");
    try {
      const data = await postGeneration("/api/chat/comic-generation", {
        sourceText: comicText.trim(), panelCount, mood: comicMood,
      });
      setComicResult({
        imageUrl: data.imageUrl!,
        albumTag: data.albumTag || `AI ${panelCount}컷 만화`,
        downloadName: data.downloadName || `${info.character.name}-${panelCount}컷-만화.webp`,
      });
      applyBilling(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "컷만화 생성 중 오류가 발생했습니다.");
    } finally {
      setGenerating(false);
    }
  }

  async function saveResult(image: GeneratedImage) {
    if (!info?.character || saving) return;
    setSaving(true); setError(""); setNotice("");
    appendCharacterAssetAlbumAsset(info.character.id, info.character.name, { url: image.imageUrl, tag: image.albumTag });
    refreshAlbum(info.character.id);
    try {
      const response = await fetch(image.imageUrl, { cache: "no-store" });
      if (!response.ok) throw new Error("download failed");
      const objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = image.downloadName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
      setNotice("이미지를 저장했고 캐릭터 앨범에도 추가했습니다.");
    } catch {
      const anchor = document.createElement("a");
      anchor.href = image.imageUrl;
      anchor.download = image.downloadName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setNotice("캐릭터 앨범에 보관했습니다. 브라우저가 파일 저장을 막으면 이미지를 길게 눌러 저장해 주세요.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex w-full flex-col items-center gap-0.5 rounded-md px-0 py-1.5 text-zinc-400 transition hover:bg-white/[0.06] hover:text-violet-200" title="이미지 생성">
        <IconImageSpark /><span className="text-[9px] font-medium">이미지</span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={() => !generating && !saving && setOpen(false)}>
          <section className="flex max-h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#111217] shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div><p className="text-[11px] font-semibold text-violet-300">OpenRouter · GPT Image 2</p><h2 className="text-base font-bold text-white">캐릭터 × 페르소나 이미지 만들기</h2></div>
              <button type="button" onClick={() => setOpen(false)} disabled={generating || saving} className="h-9 w-9 rounded-lg border border-white/10 text-lg text-zinc-300 hover:bg-white/10">×</button>
            </header>

            <nav className="grid grid-cols-3 border-b border-white/10 bg-black/10 p-2">
              {([['sd', 'SD 굿즈'], ['comic', '2~4컷 만화'], ['album', '캐릭터 앨범']] as const).map(([id, label]) => (
                <button key={id} type="button" onClick={() => { setTab(id); setError(""); setNotice(""); if (id === 'album') refreshAlbum(info?.character.id); }} disabled={generating || saving} className={`rounded-lg px-3 py-2 text-xs font-bold ${tab === id ? 'bg-violet-600 text-white' : 'text-zinc-400 hover:bg-white/[0.06]'}`}>{label}</button>
              ))}
            </nav>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {loadingInfo && !info ? <p className="py-12 text-center text-sm text-zinc-400">이미지 정보를 불러오는 중…</p> : tab === "album" ? (
                <div>
                  <div className="mb-3 flex items-end justify-between"><div><h3 className="text-sm font-bold text-white">{info?.character.name || '캐릭터'} 앨범</h3><p className="mt-1 text-[11px] text-zinc-500">기존 에셋과 저장한 SD·컷만화를 한곳에서 봅니다.</p></div><span className="text-xs text-zinc-400">{albumAssets.length.toLocaleString()}장</span></div>
                  {albumAssets.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{albumAssets.map((asset) => <figure key={asset.url} className="overflow-hidden rounded-xl border border-white/10 bg-black/25"><div className="flex aspect-[3/4] items-center justify-center p-1"><img src={asset.url} alt={asset.tag} className="max-h-full max-w-full object-contain" /></div><figcaption className="truncate px-2 py-2 text-[11px] text-zinc-400">{asset.tag || '이미지'}</figcaption></figure>)}</div> : <p className="rounded-xl border border-dashed border-white/10 py-16 text-center text-sm text-zinc-500">저장한 이미지가 없습니다.</p>}
                </div>
              ) : (
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(18rem,0.95fr)]">
                  <div className="space-y-3">
                    <div className="flex max-h-[62dvh] items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white p-1"><img src={preview.url} alt={preview.alt} className={`${preview.ratio} max-h-[60dvh] w-full object-contain`} /></div>
                    <p className="text-center text-[10px] leading-relaxed text-zinc-500">{result ? '저장하기를 누르면 파일 저장과 캐릭터 앨범 보관을 함께 처리합니다.' : tab === 'comic' ? '본문에서 장면·대사·표정을 자동 추출해 말풍선 포함 만화 한 장으로 만듭니다.' : '선물상자 구도와 장식을 유지하며 두 사람의 외형을 반영합니다.'}</p>
                    {result ? <button type="button" onClick={() => void saveResult(result)} disabled={saving} className="w-full rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-200 hover:bg-violet-500/15 disabled:opacity-50">{saving ? '저장 중…' : '저장하기 · 캐릭터 앨범에도 보관'}</button> : null}
                  </div>

                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2"><ReferenceCard label="채팅 캐릭터" info={info?.character ?? null} /><ReferenceCard label="선택 페르소나" info={info?.persona ?? null} /></div>
                    {tab === "sd" ? <>
                      <label className="block space-y-1"><span className="text-[11px] font-semibold text-zinc-400">자리 배치</span><select value={placement} onChange={(e) => setPlacement(e.target.value as ChatImagePlacement)} className="w-full rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 text-xs text-zinc-200">{CHAT_IMAGE_PLACEMENTS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
                      <div className="grid grid-cols-2 gap-2">{[['위 인물 표정', topExpression, setTopExpression], ['아래 인물 표정', bottomExpression, setBottomExpression]].map(([label, value, setter]) => <label key={String(label)} className="block space-y-1"><span className="text-[11px] font-semibold text-zinc-400">{String(label)}</span><select value={String(value)} onChange={(e) => (setter as (value: ChatImageExpression) => void)(e.target.value as ChatImageExpression)} className="w-full rounded-lg border border-white/10 bg-[#1a1a1a] px-2 py-2 text-xs text-zinc-200">{CHAT_IMAGE_EXPRESSIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>)}</div>
                      <label className="block space-y-1"><span className="text-[11px] font-semibold text-zinc-400">분위기</span><select value={mood} onChange={(e) => setMood(e.target.value as ChatImageMood)} className="w-full rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 text-xs text-zinc-200">{CHAT_IMAGE_MOODS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
                    </> : <>
                      <label className="block space-y-1"><span className="flex justify-between text-[11px] font-semibold text-zinc-400"><span>만화로 만들 본문</span><span className={comicText.length >= CHAT_COMIC_MAX_INPUT_CHARS ? 'text-amber-300' : 'text-zinc-500'}>{comicText.length}/{CHAT_COMIC_MAX_INPUT_CHARS}</span></span><textarea value={comicText} onChange={(e) => setComicText(e.target.value.slice(0, CHAT_COMIC_MAX_INPUT_CHARS))} maxLength={CHAT_COMIC_MAX_INPUT_CHARS} rows={8} placeholder="장면이나 RP 본문을 붙여넣으세요. 대사 추출, 말풍선, 표정과 컷 연출은 AI가 자동으로 구성합니다." className="w-full resize-y rounded-xl border border-white/10 bg-[#1a1a1a] px-3 py-2.5 text-xs leading-relaxed text-zinc-200 placeholder:text-zinc-600" /></label>
                      <div><span className="text-[11px] font-semibold text-zinc-400">컷 수</span><div className="mt-1 grid grid-cols-3 gap-2">{([2,3,4] as const).map((count) => <button key={count} type="button" onClick={() => setPanelCount(count)} className={`rounded-lg border px-3 py-2 text-xs font-bold ${panelCount === count ? 'border-violet-500/60 bg-violet-500/15 text-violet-100' : 'border-white/10 text-zinc-400'}`}>{count}컷</button>)}</div></div>
                      <label className="block space-y-1"><span className="text-[11px] font-semibold text-zinc-400">분위기</span><select value={comicMood} onChange={(e) => setComicMood(e.target.value as ChatComicMood)} className="w-full rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 text-xs text-zinc-200">{CHAT_COMIC_MOODS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
                    </>}

                    {info && !info.ready ? <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">먼저 {info.missing.join(', ')}를 등록해 주세요.</p> : null}
                    {error ? <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</p> : null}
                    {notice ? <p className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">{notice}</p> : null}
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[11px] text-zinc-400"><div className="flex justify-between"><span>모델</span><strong className="text-zinc-200">{info?.modelLabel ?? 'GPT Image 2'}</strong></div><div className="mt-1 flex justify-between"><span>{tab === 'comic' ? `${panelCount}컷 1장` : 'SD 1장'}</span><strong className="text-violet-200">{(tab === 'comic' ? comicPrice : info?.pricePoints ?? SD_FALLBACK_PRICE).toLocaleString()}P</strong></div>{info?.balance ? <div className="mt-1 flex justify-between"><span>보유 포인트</span><strong className="text-zinc-200">{info.balance.total.toLocaleString()}P</strong></div> : null}<p className="mt-2 text-zinc-500">생성 성공 후에만 차감하며 실패 결과에는 포인트를 차감하지 않습니다.</p></div>
                    <button type="button" onClick={() => void (tab === 'comic' ? generateComic() : generateSd())} disabled={generating || loadingInfo || !info?.ready || (tab === 'comic' && !comicText.trim()) || (info?.balance != null && info.balance.total < (tab === 'comic' ? comicPrice : info.pricePoints))} className="w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-bold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40">{generating ? (tab === 'comic' ? '본문을 구성하고 컷만화 생성 중…' : 'GPT Image 2로 생성 중…') : tab === 'comic' ? `${panelCount}컷 만화 생성 · ${comicPrice.toLocaleString()}P` : `${sdResult ? '다시 생성' : 'SD 이미지 생성'} · ${(info?.pricePoints ?? SD_FALLBACK_PRICE).toLocaleString()}P`}</button>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
