"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import {
  CHAT_COMIC_GENERATION_DEFAULT_POINTS,
  CHAT_COMIC_MAX_INPUT_CHARS,
  CHAT_COMIC_MOODS,
  CHAT_COMIC_TEMPLATE_PREVIEW_URL,
  type ChatComicMood,
  type ChatComicPanelCount,
} from "@/lib/chatComicGeneration";
import {
  CHAT_EMOTICON_GENERATION_DEFAULT_POINTS,
  CHAT_EMOTICON_TEMPLATE_ID,
  CHAT_EMOTICON_TEMPLATE_PREVIEW_URL,
} from "@/lib/chatEmoticonGeneration";
import {
  CHAT_IMAGE_EXPRESSIONS,
  CHAT_IMAGE_GENERATION_DEFAULT_POINTS,
  CHAT_IMAGE_GENERATION_DEFAULT_OPTIONS,
  CHAT_IMAGE_MOODS,
  CHAT_IMAGE_PLACEMENTS,
  type ChatImageExpression,
  type ChatImageMood,
  type ChatImagePlacement,
} from "@/lib/chatImageGeneration";
import { dispatchPointsDeducted } from "@/lib/pointsEvents";

const PERSONA_STORAGE_KEY = "habi:lastPersonaId";

type Tab = "sd" | "comic";
type ResultMode = "sd" | "emoticon" | "comic";
type SdProduct = "gift" | "emoticon";

type ReferenceInfo = {
  id: number;
  name: string;
  imageUrl: string;
};

type AverageImageCost = {
  averageUsd: number | null;
  averageKrw: number | null;
  sampleCount: number;
};

type Preflight = {
  ready: boolean;
  missing: string[];
  pricePoints: number;
  modelId: string;
  modelLabel: string;
  template: { id: string; name: string; previewUrl: string };
  character: ReferenceInfo;
  characterImages?: Array<{ url: string; tag: string }>;
  persona: ReferenceInfo | null;
  balance?: { total: number; paid: number; free: number };
  averageCosts?: {
    exchangeRateKrwPerUsd: number;
    sd: AverageImageCost;
    emoticon: AverageImageCost;
    comic: Record<ChatComicPanelCount, AverageImageCost>;
  };
  latestResult?: {
    imageUrl: string;
    chargedPoints: number;
    createdAt: string;
    mode?: ResultMode;
    title?: string;
    panelCount?: ChatComicPanelCount;
    upstreamCostUsd?: number;
    upstreamCostKrw?: number;
  } | null;
};

type GenerateResult = {
  ok?: boolean;
  error?: string;
  imageUrl?: string;
  title?: string;
  mode?: ResultMode;
  templateId?: string;
  panelCount?: ChatComicPanelCount;
  upstreamCostUsd?: number;
  upstreamCostKrw?: number;
  totalPointsCost?: number;
  remainingPoints?: number;
  paidPoints?: number;
  freePoints?: number;
  savedToCharacterAlbum?: boolean;
};

type SavedAlbumEntry = {
  imageUrl: string;
};

function currentRouteIds() {
  const match = window.location.pathname.match(/^\/chat\/(\d+)/);
  const params = new URLSearchParams(window.location.search);
  const storedPersona = Number(localStorage.getItem(PERSONA_STORAGE_KEY));
  const chatId = Number(params.get("chat"));
  return {
    characterId: match ? Number(match[1]) : null,
    chatId: Number.isInteger(chatId) && chatId > 0 ? chatId : null,
    personaId:
      Number.isInteger(storedPersona) && storedPersona > 0 ? storedPersona : null,
  };
}

function queryString(ids: ReturnType<typeof currentRouteIds>) {
  const params = new URLSearchParams();
  if (ids.characterId) params.set("characterId", String(ids.characterId));
  if (ids.chatId) params.set("chatId", String(ids.chatId));
  if (ids.personaId) params.set("personaId", String(ids.personaId));
  return params.toString();
}

function IconImageSpark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      className={className}
      aria-hidden
    >
      <rect x="3" y="5" width="14" height="14" rx="2" />
      <circle cx="8" cy="10" r="1.4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m5 17 4-4 3 3 2-2 3 3" />
      <path strokeLinecap="round" d="M19.5 2.5v4M17.5 4.5h4" />
    </svg>
  );
}

function ReferenceCard({
  label,
  info,
  onClick,
}: {
  label: string;
  info: ReferenceInfo | null;
  onClick?: () => void;
}) {
  const content = (
    <>
      <p className="mb-1.5 text-[10px] font-semibold text-zinc-400">{label}</p>
      <div className="flex items-center gap-2">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-black/25">
          {info?.imageUrl ? (
            <img src={info.imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-[9px] text-zinc-600">
              이미지 없음
            </div>
          )}
        </div>
        <p className="min-w-0 truncate text-xs font-semibold text-zinc-200">
          {info?.name || "선택 안 됨"}
        </p>
      </div>
      {onClick ? (
        <p className="mt-1.5 text-[9px] font-semibold text-violet-300">
          눌러서 해금 이미지 선택
        </p>
      ) : null}
    </>
  );
  const className =
    "min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-2 text-left";
  return onClick ? (
    <button type="button" onClick={onClick} className={`${className} hover:border-violet-400/40`}>
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}

function PriceBox({
  balance,
  averageCosts,
  averageCost,
  exchangeRateKrwPerUsd,
}: {
  balance?: { total: number; paid: number; free: number };
  averageCosts?: Array<{ label: string; cost: AverageImageCost }>;
  averageCost?: AverageImageCost;
  exchangeRateKrwPerUsd?: number;
}) {
  const costRows =
    averageCosts ?? (averageCost ? [{ label: "평균", cost: averageCost }] : []);
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[11px] text-zinc-400">
      {balance ? (
        <div className="flex justify-between gap-3">
          <span>보유 포인트</span>
          <strong className="text-zinc-200">{balance.total.toLocaleString()}P</strong>
        </div>
      ) : null}
      {costRows.length ? (
        <div className="mt-2 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-2.5 py-2 text-amber-100">
          <p className="font-semibold">관리자 종류별 평균 API 원가</p>
          <div className="mt-1 space-y-1">
            {costRows.map(({ label, cost }) => (
              <p key={label} className="leading-relaxed">
                <strong>{label}</strong>:{" "}
                {cost.averageUsd != null && cost.averageKrw != null ? (
                  <>
                    약 {cost.averageKrw.toLocaleString()}원 · ${cost.averageUsd.toFixed(6)}
                    {" · "}성공 {cost.sampleCount.toLocaleString()}건
                  </>
                ) : (
                  <span className="text-amber-200/70">집계 기록 없음</span>
                )}
              </p>
            ))}
          </div>
          {exchangeRateKrwPerUsd != null ? (
            <p className="mt-1 text-amber-200/70">
              적용 환율 {exchangeRateKrwPerUsd.toLocaleString()}원/USD
            </p>
          ) : null}
        </div>
      ) : null}
      <p className="mt-2 leading-relaxed text-zinc-500">
        생성에 성공한 경우에만 차감됩니다. 실패한 요청에는 포인트를 차감하지 않습니다.
      </p>
    </div>
  );
}

function downloadImage(imageUrl: string, mode: ResultMode) {
  const anchor = document.createElement("a");
  anchor.href = imageUrl;
  anchor.download = `habi-${mode}-${Date.now()}.webp`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export default function ChatImageGeneratorPanel() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("sd");
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [info, setInfo] = useState<Preflight | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sdProduct, setSdProduct] = useState<SdProduct>("gift");
  const [sdResultUrl, setSdResultUrl] = useState("");
  const [emoticonResultUrl, setEmoticonResultUrl] = useState("");
  const [comicResultUrl, setComicResultUrl] = useState("");
  const [comicTitle, setComicTitle] = useState("");
  const [comicPanelCount, setComicPanelCount] = useState<ChatComicPanelCount | null>(null);
  const [actualCosts, setActualCosts] = useState<
    Partial<Record<ResultMode, { usd: number; krw: number }>>
  >({});
  const [savedUrls, setSavedUrls] = useState<Set<string>>(() => new Set());
  const [selectedCharacterImageUrl, setSelectedCharacterImageUrl] = useState("");
  const [characterPickerOpen, setCharacterPickerOpen] = useState(false);

  const [placement, setPlacement] = useState<ChatImagePlacement>(
    CHAT_IMAGE_GENERATION_DEFAULT_OPTIONS.placement
  );
  const [topExpression, setTopExpression] = useState<ChatImageExpression>(
    CHAT_IMAGE_GENERATION_DEFAULT_OPTIONS.topExpression
  );
  const [bottomExpression, setBottomExpression] = useState<ChatImageExpression>(
    CHAT_IMAGE_GENERATION_DEFAULT_OPTIONS.bottomExpression
  );
  const [sdMood, setSdMood] = useState<ChatImageMood>(
    CHAT_IMAGE_GENERATION_DEFAULT_OPTIONS.mood
  );
  const [comicText, setComicText] = useState("");
  const [comicMood, setComicMood] = useState<ChatComicMood>("comic");

  const activeResultUrl =
    tab === "comic"
      ? comicResultUrl
      : sdProduct === "emoticon"
        ? emoticonResultUrl
        : sdResultUrl;
  const activeMode: ResultMode =
    tab === "comic" ? "comic" : sdProduct === "emoticon" ? "emoticon" : "sd";
  const activePrice =
    activeMode === "comic"
      ? CHAT_COMIC_GENERATION_DEFAULT_POINTS
      : activeMode === "emoticon"
        ? CHAT_EMOTICON_GENERATION_DEFAULT_POINTS
        : info?.pricePoints ?? CHAT_IMAGE_GENERATION_DEFAULT_POINTS;
  const activeSaved = activeResultUrl ? savedUrls.has(activeResultUrl) : false;
  const selectedCharacterInfo = useMemo<ReferenceInfo | null>(() => {
    if (!info?.character) return null;
    return {
      ...info.character,
      imageUrl: selectedCharacterImageUrl || info.character.imageUrl,
    };
  }, [info?.character, selectedCharacterImageUrl]);

  const updateBalance = useCallback((data: GenerateResult) => {
    if (
      typeof data.totalPointsCost === "number" &&
      typeof data.remainingPoints === "number"
    ) {
      dispatchPointsDeducted({
        totalPointsCost: data.totalPointsCost,
        remainingPoints: data.remainingPoints,
        paidPoints: data.paidPoints ?? 0,
        freePoints: data.freePoints ?? 0,
      });
    }
    if (typeof data.remainingPoints === "number") {
      setInfo((previous) =>
        previous
          ? {
              ...previous,
              balance: {
                total: data.remainingPoints!,
                paid: data.paidPoints ?? previous.balance?.paid ?? 0,
                free: data.freePoints ?? previous.balance?.free ?? 0,
              },
            }
          : previous
      );
    }
  }, []);

  const loadSavedImages = useCallback(async () => {
    const ids = currentRouteIds();
    if (!ids.characterId) return;
    try {
      const response = await fetch(
        `/api/chat/image-album?characterId=${encodeURIComponent(String(ids.characterId))}`,
        { cache: "no-store" }
      );
      const data = (await response.json().catch(() => null)) as
        | { album?: SavedAlbumEntry[]; error?: string }
        | null;
      if (!response.ok || !data) throw new Error(data?.error || "앨범을 불러오지 못했습니다.");
      const rows = Array.isArray(data.album) ? data.album : [];
      setSavedUrls(new Set(rows.map((item) => item.imageUrl)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "앨범을 불러오지 못했습니다.");
    }
  }, []);

  const loadInfo = useCallback(async () => {
    setLoadingInfo(true);
    setError("");
    try {
      const ids = currentRouteIds();
      const response = await fetch(`/api/chat/image-generation?${queryString(ids)}`, {
        cache: "no-store",
      });
      const data = (await response.json().catch(() => null)) as
        | (Preflight & { error?: string })
        | null;
      if (!response.ok || !data) throw new Error(data?.error || "이미지 생성 정보를 불러오지 못했습니다.");
      setInfo(data);
      const selectableImages = Array.isArray(data.characterImages)
        ? data.characterImages
        : [];
      setSelectedCharacterImageUrl((previous) =>
        selectableImages.some((image) => image.url === previous)
          ? previous
          : data.character.imageUrl
      );
      setCharacterPickerOpen(false);
      if (data.latestResult?.imageUrl) {
        if (data.latestResult.mode === "comic") {
          if (!comicResultUrl) setComicResultUrl(data.latestResult.imageUrl);
          setComicTitle(data.latestResult.title || "");
          setComicPanelCount(data.latestResult.panelCount ?? null);
        } else if (data.latestResult.mode === "emoticon") {
          if (!emoticonResultUrl) setEmoticonResultUrl(data.latestResult.imageUrl);
        } else if (!sdResultUrl) {
          setSdResultUrl(data.latestResult.imageUrl);
        }
        if (
          data.latestResult.mode &&
          data.latestResult.upstreamCostUsd != null &&
          data.latestResult.upstreamCostKrw != null
        ) {
          setActualCosts((previous) => ({
            ...previous,
            [data.latestResult!.mode!]: {
              usd: data.latestResult!.upstreamCostUsd!,
              krw: data.latestResult!.upstreamCostKrw!,
            },
          }));
        }
      }
      await loadSavedImages();
    } catch (caught) {
      setInfo(null);
      setError(caught instanceof Error ? caught.message : "이미지 생성 정보를 불러오지 못했습니다.");
    } finally {
      setLoadingInfo(false);
    }
  }, [comicResultUrl, emoticonResultUrl, loadSavedImages, sdResultUrl]);

  useEffect(() => {
    if (!open) return;
    void loadInfo();
  }, [open, loadInfo]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !generating && !saving) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, generating, saving]);

  async function generateSd() {
    if (!info?.ready || generating) return;
    setGenerating(true);
    setError("");
    setNotice("");
    if (sdProduct === "emoticon") setEmoticonResultUrl("");
    else setSdResultUrl("");
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 300_000);
    try {
      const ids = currentRouteIds();
      const response = await fetch("/api/chat/image-generation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          ...ids,
          placement,
          topExpression,
          bottomExpression,
          mood: sdMood,
          templateId:
            sdProduct === "emoticon"
              ? CHAT_EMOTICON_TEMPLATE_ID
              : info.template.id,
          characterImageUrl: selectedCharacterImageUrl || info.character.imageUrl,
        }),
      });
      const data = (await response.json().catch(() => null)) as GenerateResult | null;
      if (!response.ok || !data?.imageUrl) {
        if (data) updateBalance(data);
        throw new Error(data?.error || "SD 이미지 생성에 실패했습니다.");
      }
      if (sdProduct === "emoticon") setEmoticonResultUrl(data.imageUrl);
      else setSdResultUrl(data.imageUrl);
      if (data.savedToCharacterAlbum) {
        setSavedUrls((previous) => new Set(previous).add(data.imageUrl!));
      }
      if (data.upstreamCostUsd != null && data.upstreamCostKrw != null) {
        setActualCosts((previous) => ({
          ...previous,
          [sdProduct === "emoticon" ? "emoticon" : "sd"]: {
            usd: data.upstreamCostUsd!,
            krw: data.upstreamCostKrw!,
          },
        }));
      }
      updateBalance(data);
      setNotice(
        sdProduct === "emoticon"
          ? "랜덤 문구 9종 이모티콘을 완성해 기존 캐릭터 이미지 앨범에 추가했습니다."
          : "완성되어 기존 캐릭터 이미지 앨범에 자동으로 추가했습니다."
      );
      void loadInfo();
    } catch (caught) {
      const timedOut = caught instanceof DOMException && caught.name === "AbortError";
      setError(
        timedOut
          ? "이미지 생성 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요."
          : caught instanceof Error
            ? caught.message
            : "이미지 생성 중 오류가 발생했습니다."
      );
    } finally {
      window.clearTimeout(timer);
      setGenerating(false);
    }
  }

  async function generateComic() {
    if (!info?.ready || generating) return;
    const sourceText = comicText.trim();
    if (!sourceText) {
      setError("만화로 만들 내용을 입력해 주세요.");
      return;
    }
    if (sourceText.length > CHAT_COMIC_MAX_INPUT_CHARS) {
      setError(`내용은 최대 ${CHAT_COMIC_MAX_INPUT_CHARS}자까지 입력할 수 있습니다.`);
      return;
    }

    setGenerating(true);
    setError("");
    setNotice("");
    setComicResultUrl("");
    setComicTitle("");
    setComicPanelCount(null);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 300_000);
    try {
      const ids = currentRouteIds();
      const response = await fetch("/api/chat/comic-generation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          ...ids,
          sourceText,
          mood: comicMood,
          characterImageUrl: selectedCharacterImageUrl || info.character.imageUrl,
        }),
      });
      const data = (await response.json().catch(() => null)) as GenerateResult | null;
      if (!response.ok || !data?.imageUrl) {
        if (data) updateBalance(data);
        throw new Error(data?.error || "컷만화 생성에 실패했습니다.");
      }
      setComicResultUrl(data.imageUrl);
      if (data.savedToCharacterAlbum) {
        setSavedUrls((previous) => new Set(previous).add(data.imageUrl!));
      }
      setComicTitle(data.title || "");
      setComicPanelCount(data.panelCount ?? null);
      if (data.upstreamCostUsd != null && data.upstreamCostKrw != null) {
        setActualCosts((previous) => ({
          ...previous,
          comic: {
            usd: data.upstreamCostUsd!,
            krw: data.upstreamCostKrw!,
          },
        }));
      }
      updateBalance(data);
      setNotice("대사·말풍선·표정 연출을 자동 구성해 기존 캐릭터 이미지 앨범에 추가했습니다.");
      void loadInfo();
    } catch (caught) {
      const timedOut = caught instanceof DOMException && caught.name === "AbortError";
      setError(
        timedOut
          ? "컷만화 생성 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요."
          : caught instanceof Error
            ? caught.message
            : "컷만화 생성 중 오류가 발생했습니다."
      );
    } finally {
      window.clearTimeout(timer);
      setGenerating(false);
    }
  }

  async function saveCurrentResult() {
    if (!activeResultUrl || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await downloadImage(activeResultUrl, activeMode);
      setNotice("이미지 파일을 컴퓨터에 저장했습니다.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  const modalTitle = tab === "sd" ? "캐릭터 × 페르소나 SD 굿즈" : "2~4컷 만화 만들기";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full flex-col items-center gap-0.5 rounded-md px-0 py-1.5 text-zinc-400 transition hover:bg-white/[0.06] hover:text-violet-200"
        title="SD 굿즈와 2~4컷 만화 생성"
        aria-label="이미지 생성"
      >
        <IconImageSpark className="h-4 w-4 shrink-0" />
        <span className="max-w-full px-0.5 text-center text-[9px] font-medium leading-[1.15] tracking-tight">
          이미지
        </span>
      </button>

      {open ? createPortal(
        <div
          className="fixed inset-0 z-[140] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="이미지 생성"
          onClick={() => {
            if (!generating && !saving) setOpen(false);
          }}
        >
          <section
            className="flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#111217] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="shrink-0 border-b border-white/10 px-4 pt-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-bold text-white">{modalTitle}</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={generating || saving}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-lg text-zinc-300 hover:bg-white/10 disabled:opacity-40"
                  aria-label="닫기"
                >
                  ×
                </button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-black/25 p-1">
                {(
                  [
                    ["sd", "SD 굿즈"],
                    ["comic", "2~4컷 만화"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setTab(id);
                      setError("");
                      setNotice("");
                    }}
                    disabled={generating || saving}
                    className={`rounded-lg px-2 py-2 text-xs font-semibold transition ${
                      tab === id
                        ? "bg-violet-600 text-white"
                        : "text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {loadingInfo && !info ? (
                <p className="py-12 text-center text-sm text-zinc-400">이미지 정보를 불러오는 중…</p>
              ) : (
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(19rem,0.95fr)]">
                  <div className="space-y-3">
                    <div className="relative flex max-h-[64dvh] min-h-56 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white p-1">
                      <img
                        src={
                          activeResultUrl ||
                          (tab === "comic"
                            ? CHAT_COMIC_TEMPLATE_PREVIEW_URL
                            : sdProduct === "emoticon"
                              ? CHAT_EMOTICON_TEMPLATE_PREVIEW_URL
                              : info?.template.previewUrl || "")
                        }
                        alt={
                          activeResultUrl
                            ? tab === "comic"
                              ? "생성된 컷만화"
                              : sdProduct === "emoticon"
                                ? "생성된 랜덤 9종 이모티콘"
                                : "생성된 SD 이미지"
                            : tab === "comic"
                              ? "2~4컷 만화 예시"
                              : sdProduct === "emoticon"
                                ? "랜덤 9종 이모티콘 고정틀"
                                : "선물상자 SD 고정틀"
                        }
                        className={`max-h-[62dvh] w-full object-contain ${
                          tab === "comic"
                            ? "aspect-[3/4]"
                            : sdProduct === "emoticon"
                              ? "aspect-square"
                              : "aspect-[3/2]"
                        }`}
                      />
                      {tab === "sd" ? (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              setSdProduct((previous) =>
                                previous === "gift" ? "emoticon" : "gift"
                              )
                            }
                            disabled={generating || saving}
                            className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-xl font-bold text-white shadow hover:bg-black/70 disabled:opacity-40"
                            aria-label="이전 SD 굿즈"
                          >
                            ‹
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setSdProduct((previous) =>
                                previous === "gift" ? "emoticon" : "gift"
                              )
                            }
                            disabled={generating || saving}
                            className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-xl font-bold text-white shadow hover:bg-black/70 disabled:opacity-40"
                            aria-label="다음 SD 굿즈"
                          >
                            ›
                          </button>
                        </>
                      ) : null}
                    </div>
                    <p className="text-center text-[10px] leading-relaxed text-zinc-500">
                      {activeResultUrl
                        ? activeSaved
                          ? "캐릭터 앨범에 저장된 이미지입니다."
                          : "생성 결과는 기존 캐릭터 이미지 앨범에 자동으로 추가됩니다."
                        : tab === "comic"
                          ? "본문만 붙여넣으면 핵심 대사·말풍선·표정과 2~4컷 구성을 자동으로 만듭니다."
                          : sdProduct === "emoticon"
                            ? "매번 다른 문구 9개를 뽑아 캐릭터 단독·페르소나 단독·두 사람 장면을 섞어 만듭니다."
                            : "선물상자·리본·인형·사탕 장식을 유지하면서 두 사람의 외형을 반영합니다."}
                    </p>
                    {tab === "sd" ? (
                      <div className="flex items-center justify-center gap-2 text-[10px]">
                        <span className={sdProduct === "gift" ? "text-violet-300" : "text-zinc-600"}>
                          ●
                        </span>
                        <span className={sdProduct === "emoticon" ? "text-violet-300" : "text-zinc-600"}>
                          ●
                        </span>
                        <strong className="ml-1 text-zinc-400">
                          {sdProduct === "gift" ? "선물상자 2인 SD" : "랜덤 9종 이모티콘"}
                        </strong>
                      </div>
                    ) : null}
                    {activeResultUrl ? (
                      <button
                        type="button"
                        onClick={() => void saveCurrentResult()}
                        disabled={saving}
                        className="block w-full rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2.5 text-center text-xs font-bold text-violet-200 hover:bg-violet-500/15 disabled:opacity-40"
                      >
                        {saving
                          ? "저장 중…"
                          : "저장하기"}
                      </button>
                    ) : null}
                  </div>

                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <ReferenceCard
                        label="채팅 캐릭터"
                        info={selectedCharacterInfo}
                        onClick={
                          (info?.characterImages?.length ?? 0) > 1
                            ? () => setCharacterPickerOpen((previous) => !previous)
                            : undefined
                        }
                      />
                      <ReferenceCard label="선택 페르소나" info={info?.persona ?? null} />
                    </div>
                    {characterPickerOpen && (info?.characterImages?.length ?? 0) > 1 ? (
                      <div className="rounded-xl border border-violet-400/20 bg-black/25 p-2">
                        <p className="mb-2 text-[10px] font-semibold text-violet-200">
                          해금된 캐릭터 이미지
                        </p>
                        <div className="grid max-h-52 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
                          {info!.characterImages!.map((image) => {
                            const selected = image.url === selectedCharacterImageUrl;
                            return (
                              <button
                                key={image.url}
                                type="button"
                                onClick={() => {
                                  setSelectedCharacterImageUrl(image.url);
                                  setCharacterPickerOpen(false);
                                }}
                                className={`overflow-hidden rounded-lg border text-left transition ${
                                  selected
                                    ? "border-violet-400 bg-violet-500/15"
                                    : "border-white/10 bg-white/[0.03] hover:border-white/25"
                                }`}
                                aria-label={`캐릭터 이미지 선택: ${image.tag || "이미지"}`}
                              >
                                <img
                                  src={image.url}
                                  alt=""
                                  className="aspect-square w-full object-cover object-top"
                                />
                                <span className="block truncate px-1.5 py-1 text-[9px] text-zinc-300">
                                  {image.tag || "이미지"}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                    {actualCosts[activeMode] ? (
                      <p className="rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-[11px] text-amber-100">
                        관리자 방금 생성 실제 API 원가: $
                        {actualCosts[activeMode]!.usd.toFixed(6)} · 약{" "}
                        {actualCosts[activeMode]!.krw.toLocaleString()}원
                      </p>
                    ) : null}

                    {tab === "sd" ? (
                      <>
                        {sdProduct === "gift" ? (
                          <>
                          <label className="block space-y-1">
                          <span className="text-[11px] font-semibold text-zinc-400">자리 배치</span>
                          <select
                            value={placement}
                            onChange={(event) => setPlacement(event.target.value as ChatImagePlacement)}
                            disabled={generating}
                            className="w-full rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 text-xs text-zinc-200 outline-none focus:border-violet-500/50"
                          >
                            {CHAT_IMAGE_PLACEMENTS.map((item) => (
                              <option key={item.id} value={item.id}>{item.label}</option>
                            ))}
                          </select>
                        </label>
                          <div className="grid grid-cols-2 gap-2">
                          <label className="block space-y-1">
                            <span className="text-[11px] font-semibold text-zinc-400">위 인물 표정</span>
                            <select
                              value={topExpression}
                              onChange={(event) => setTopExpression(event.target.value as ChatImageExpression)}
                              disabled={generating}
                              className="w-full rounded-lg border border-white/10 bg-[#1a1a1a] px-2 py-2 text-xs text-zinc-200 outline-none focus:border-violet-500/50"
                            >
                              {CHAT_IMAGE_EXPRESSIONS.map((item) => (
                                <option key={item.id} value={item.id}>{item.label}</option>
                              ))}
                            </select>
                          </label>
                          <label className="block space-y-1">
                            <span className="text-[11px] font-semibold text-zinc-400">아래 인물 표정</span>
                            <select
                              value={bottomExpression}
                              onChange={(event) => setBottomExpression(event.target.value as ChatImageExpression)}
                              disabled={generating}
                              className="w-full rounded-lg border border-white/10 bg-[#1a1a1a] px-2 py-2 text-xs text-zinc-200 outline-none focus:border-violet-500/50"
                            >
                              {CHAT_IMAGE_EXPRESSIONS.map((item) => (
                                <option key={item.id} value={item.id}>{item.label}</option>
                              ))}
                            </select>
                          </label>
                          </div>
                          <label className="block space-y-1">
                          <span className="text-[11px] font-semibold text-zinc-400">분위기</span>
                          <select
                            value={sdMood}
                            onChange={(event) => setSdMood(event.target.value as ChatImageMood)}
                            disabled={generating}
                            className="w-full rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 text-xs text-zinc-200 outline-none focus:border-violet-500/50"
                          >
                            {CHAT_IMAGE_MOODS.map((item) => (
                              <option key={item.id} value={item.id}>{item.label}</option>
                            ))}
                          </select>
                          </label>
                          </>
                        ) : (
                          <div className="rounded-xl border border-violet-400/20 bg-violet-500/[0.06] p-3 text-[11px] leading-relaxed text-zinc-300">
                            <strong className="text-violet-200">랜덤 9종 · 900×900 · 중품질 고정</strong>
                            <p className="mt-1">
                              문구 풀에서 매번 중복 없이 9개를 선택하고, 캐릭터 단독 3개·페르소나 단독
                              3개·두 사람 장면 3개를 문구에 맞는 표정과 행동으로 구성합니다.
                            </p>
                          </div>
                        )}
                        <PriceBox
                          balance={info?.balance}
                          averageCosts={
                            info?.averageCosts
                              ? [
                                  {
                                    label:
                                      sdProduct === "emoticon"
                                        ? "랜덤 9종 이모티콘"
                                        : "선물상자 SD 고정틀",
                                    cost:
                                      sdProduct === "emoticon"
                                        ? info.averageCosts.emoticon
                                        : info.averageCosts.sd,
                                  },
                                ]
                              : undefined
                          }
                          exchangeRateKrwPerUsd={info?.averageCosts?.exchangeRateKrwPerUsd}
                        />
                        <button
                          type="button"
                          onClick={() => void generateSd()}
                          disabled={
                            generating ||
                             loadingInfo ||
                             !info?.ready ||
                             (info.balance != null && info.balance.total < activePrice)
                          }
                          className="w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                           {generating
                             ? sdProduct === "emoticon"
                               ? "랜덤 이모티콘 9종 생성 중…"
                               : "SD 이미지 생성 중…"
                             : activeResultUrl
                               ? `다시 생성 · ${activePrice.toLocaleString()}P`
                               : `${sdProduct === "emoticon" ? "랜덤 9종 이모티콘 생성" : "SD 이미지 생성"} · ${activePrice.toLocaleString()}P`}
                        </button>
                      </>
                    ) : (
                      <>
                        <label className="block space-y-1">
                          <span className="flex items-center justify-between text-[11px] font-semibold text-zinc-400">
                            <span>만화로 만들 내용</span>
                            <span className={comicText.length >= CHAT_COMIC_MAX_INPUT_CHARS ? "text-amber-300" : "text-zinc-500"}>
                              {comicText.length}/{CHAT_COMIC_MAX_INPUT_CHARS}
                            </span>
                          </span>
                          <textarea
                            value={comicText}
                            onChange={(event) =>
                              setComicText(event.target.value.slice(0, CHAT_COMIC_MAX_INPUT_CHARS))
                            }
                            disabled={generating}
                            rows={9}
                            placeholder="장면이나 RP 본문을 붙여넣으세요. AI가 핵심 대사를 추출하고 말풍선·표정·컷 구성을 자동으로 처리합니다."
                            className="w-full resize-y rounded-xl border border-white/10 bg-[#1a1a1a] px-3 py-2.5 text-xs leading-relaxed text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet-500/50"
                          />
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="block space-y-1">
                            <span className="text-[11px] font-semibold text-zinc-400">컷 수</span>
                            <div className="rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 text-xs text-zinc-300">
                              AI 자동 · 2~4컷
                            </div>
                          </div>
                          <label className="block space-y-1">
                            <span className="text-[11px] font-semibold text-zinc-400">분위기</span>
                            <select
                              value={comicMood}
                              onChange={(event) => setComicMood(event.target.value as ChatComicMood)}
                              disabled={generating}
                              className="w-full rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 text-xs text-zinc-200 outline-none focus:border-violet-500/50"
                            >
                              {CHAT_COMIC_MOODS.map((item) => (
                                <option key={item.id} value={item.id}>{item.label}</option>
                              ))}
                            </select>
                          </label>
                        </div>
                        {comicTitle ? (
                          <p className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-300">
                            생성 제목: <strong>{comicTitle}</strong>
                            {comicPanelCount ? ` · AI가 ${comicPanelCount}컷으로 구성` : ""}
                          </p>
                        ) : null}
                        <PriceBox
                          balance={info?.balance}
                          averageCosts={
                            info?.averageCosts
                              ? ([2, 3, 4] as const).map((panelCount) => ({
                                  label: `${panelCount}컷 만화`,
                                  cost: info.averageCosts!.comic[panelCount],
                                }))
                              : undefined
                          }
                          exchangeRateKrwPerUsd={info?.averageCosts?.exchangeRateKrwPerUsd}
                        />
                        <button
                          type="button"
                          onClick={() => void generateComic()}
                          disabled={
                            generating ||
                            loadingInfo ||
                            !info?.ready ||
                            !comicText.trim() ||
                            (info.balance != null &&
                              info.balance.total < CHAT_COMIC_GENERATION_DEFAULT_POINTS)
                          }
                          className="w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {generating
                            ? "대사와 컷을 구성해 만화 생성 중…"
                            : comicResultUrl
                              ? `다시 생성 · ${CHAT_COMIC_GENERATION_DEFAULT_POINTS.toLocaleString()}P`
                              : `자동 컷만화 생성 · ${CHAT_COMIC_GENERATION_DEFAULT_POINTS.toLocaleString()}P`}
                        </button>
                      </>
                    )}

                    {info && !info.ready ? (
                      <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200">
                        먼저 {info.missing.join(", ")}를 등록해 주세요.
                      </p>
                    ) : null}
                    {notice ? (
                      <p className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs leading-relaxed text-emerald-200">
                        {notice}
                      </p>
                    ) : null}
                    {error ? (
                      <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs leading-relaxed text-rose-200">
                        {error}
                      </p>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>,
        document.body
      ) : null}
    </>
  );
}
