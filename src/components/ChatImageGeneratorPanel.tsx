"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  CHAT_COMIC_GENERATION_DEFAULT_POINTS,
  CHAT_COMIC_MAX_INPUT_CHARS,
  CHAT_COMIC_TEMPLATE_PREVIEW_URL,
  type ChatComicPanelCount,
} from "@/lib/chatComicGeneration";
import {
  CHAT_COUPLE_STAMP_BACKGROUNDS,
  CHAT_COUPLE_STAMP_BORDERS,
  CHAT_COUPLE_STAMP_DEFAULT_OPTIONS,
  CHAT_COUPLE_STAMP_EXPRESSIONS,
  CHAT_COUPLE_STAMP_GENERATION_DEFAULT_POINTS,
  CHAT_COUPLE_STAMP_HEIGHTS,
  CHAT_COUPLE_STAMP_TEMPLATE_ID,
  CHAT_COUPLE_STAMP_TEMPLATE_PREVIEW_URL,
  type ChatCoupleStampBackground,
  type ChatCoupleStampBorder,
  type ChatCoupleStampExpression,
  type ChatCoupleStampHeight,
} from "@/lib/chatCoupleStampGeneration";
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
import {
  CHAT_LD_ILLUSTRATION_DEFAULT_POINTS,
} from "@/lib/chatLdIllustrationGeneration";
import {
  CHAT_PERSONA_IMAGE_DEFAULT_POINTS,
  CHAT_PERSONA_IMAGE_TEMPLATE_ID,
} from "@/lib/chatPersonaImageGeneration";
import { dispatchPointsDeducted } from "@/lib/pointsEvents";

const PERSONA_STORAGE_KEY = "habi:lastPersonaId";

type Tab = "sd" | "comic";
type ResultMode = "sd" | "emoticon" | "couple_stamp" | "comic" | "illustration" | "persona";
type SdProduct = "gift" | "emoticon" | "coupleStamp";
type LdProduct = "comic" | "illustration" | "persona";

const SD_PRODUCTS: readonly SdProduct[] = ["gift", "emoticon", "coupleStamp"];

function cycleSdProduct(current: SdProduct, direction: -1 | 1): SdProduct {
  const index = SD_PRODUCTS.indexOf(current);
  return SD_PRODUCTS[(index + direction + SD_PRODUCTS.length) % SD_PRODUCTS.length]!;
}

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
  personaReady: boolean;
  personaMissing: string[];
  pricePoints: number;
  modelId: string;
  modelLabel: string;
  template: { id: string; name: string; previewUrl: string };
  character: ReferenceInfo;
  characterImages?: Array<{ url: string; tag: string }>;
  persona: (ReferenceInfo & { gender?: string; appearancePreview?: string }) | null;
  balance?: { total: number; paid: number; free: number };
  averageCosts?: {
    exchangeRateKrwPerUsd: number;
    sd: AverageImageCost;
    emoticon: AverageImageCost;
    coupleStamp: AverageImageCost;
    illustration: AverageImageCost;
    persona: AverageImageCost;
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
  activeJob?: {
    id: number;
    status: "running" | "completed" | "failed";
    mode: string;
    templateId: string;
    resultUrl: string | null;
    errorMessage: string | null;
    startedAt: string;
  } | null;
};

/** Poll cadence while a server-side generation job is still running. */
const JOB_POLL_INTERVAL_MS = 4000;

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

type ChatImageGeneratorPanelProps = {
  /** When false, only the modal host mounts (message toolbar opens via event). */
  showRailTrigger?: boolean;
};

export default function ChatImageGeneratorPanel({
  showRailTrigger = true,
}: ChatImageGeneratorPanelProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("comic");
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [trackedJobId, setTrackedJobId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [info, setInfo] = useState<Preflight | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sdProduct, setSdProduct] = useState<SdProduct>("gift");
  const [ldProduct, setLdProduct] = useState<LdProduct>("illustration");
  const [coupleHeight, setCoupleHeight] = useState<ChatCoupleStampHeight>(
    CHAT_COUPLE_STAMP_DEFAULT_OPTIONS.height
  );
  const [coupleBackground, setCoupleBackground] = useState<ChatCoupleStampBackground>(
    CHAT_COUPLE_STAMP_DEFAULT_OPTIONS.background
  );
  const [coupleBorder, setCoupleBorder] = useState<ChatCoupleStampBorder>(
    CHAT_COUPLE_STAMP_DEFAULT_OPTIONS.border
  );
  const [coupleCharacterExpression, setCoupleCharacterExpression] =
    useState<ChatCoupleStampExpression>(
      CHAT_COUPLE_STAMP_DEFAULT_OPTIONS.characterExpression
    );
  const [couplePersonaExpression, setCouplePersonaExpression] =
    useState<ChatCoupleStampExpression>(
      CHAT_COUPLE_STAMP_DEFAULT_OPTIONS.personaExpression
    );
  const [sdResultUrl, setSdResultUrl] = useState("");
  const [emoticonResultUrl, setEmoticonResultUrl] = useState("");
  const [coupleStampResultUrl, setCoupleStampResultUrl] = useState("");
  const [comicResultUrl, setComicResultUrl] = useState("");
  const [illustrationResultUrl, setIllustrationResultUrl] = useState("");
  const [personaResultUrl, setPersonaResultUrl] = useState("");
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
  const [sourceMessageId, setSourceMessageId] = useState<number | null>(null);
  const [sourceTurnPreview, setSourceTurnPreview] = useState("");
  const [comicSummary, setComicSummary] = useState("");
  const [summarizing, setSummarizing] = useState(false);

  useEffect(() => {
    const openGenerator = (event: Event) => {
      const detail = (event as CustomEvent<{ messageId?: unknown; content?: unknown }>)
        .detail;
      const messageId = Number(detail?.messageId);
      if (Number.isFinite(messageId) && messageId > 0) {
        setSourceMessageId(messageId);
        const preview = String(detail?.content ?? "")
          .replace(/<<<STATUS_VALUES[\s\S]*?>>>/gi, " ")
          .replace(/<<<STATUS[\s\S]*?>>>/gi, " ")
          .replace(/<!--[\s\S]*?-->/g, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        setSourceTurnPreview(preview.slice(0, 280));
        setTab("comic");
        setLdProduct("illustration");
        setComicText("");
        setComicSummary("");
      }
      setOpen(true);
    };
    window.addEventListener("chat:image-generator:open", openGenerator);
    return () => window.removeEventListener("chat:image-generator:open", openGenerator);
  }, []);

  const activeResultUrl =
    tab === "comic"
      ? ldProduct === "persona"
        ? personaResultUrl
        : ldProduct === "illustration"
          ? illustrationResultUrl
          : comicResultUrl
      : sdProduct === "emoticon"
        ? emoticonResultUrl
        : sdProduct === "coupleStamp"
          ? coupleStampResultUrl
          : sdResultUrl;
  const activeMode: ResultMode =
    tab === "comic"
      ? ldProduct === "persona"
        ? "persona"
        : ldProduct === "illustration"
          ? "illustration"
          : "comic"
      : sdProduct === "emoticon"
        ? "emoticon"
        : sdProduct === "coupleStamp"
          ? "couple_stamp"
          : "sd";
  const activePrice =
    activeMode === "persona"
      ? CHAT_PERSONA_IMAGE_DEFAULT_POINTS
      : activeMode === "illustration"
      ? CHAT_LD_ILLUSTRATION_DEFAULT_POINTS
      : activeMode === "comic"
      ? CHAT_COMIC_GENERATION_DEFAULT_POINTS
      : activeMode === "emoticon"
        ? CHAT_EMOTICON_GENERATION_DEFAULT_POINTS
        : activeMode === "couple_stamp"
          ? CHAT_COUPLE_STAMP_GENERATION_DEFAULT_POINTS
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
      // A generation started before a refresh keeps running on the server, so restore
      // the 생성중 state instead of offering an enabled button for a paid job.
      if (data.activeJob?.status === "running") {
        setTrackedJobId(data.activeJob.id);
        setGenerating(true);
      }
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
        if (data.latestResult.mode === "persona") {
          if (!personaResultUrl) setPersonaResultUrl(data.latestResult.imageUrl);
        } else if (data.latestResult.mode === "illustration") {
          if (!illustrationResultUrl) setIllustrationResultUrl(data.latestResult.imageUrl);
        } else if (data.latestResult.mode === "comic") {
          if (!comicResultUrl) setComicResultUrl(data.latestResult.imageUrl);
          setComicTitle(data.latestResult.title || "");
          setComicPanelCount(data.latestResult.panelCount ?? null);
        } else if (data.latestResult.mode === "emoticon") {
          if (!emoticonResultUrl) setEmoticonResultUrl(data.latestResult.imageUrl);
        } else if (data.latestResult.mode === "couple_stamp") {
          if (!coupleStampResultUrl) setCoupleStampResultUrl(data.latestResult.imageUrl);
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
  }, [
    comicResultUrl,
    coupleStampResultUrl,
    emoticonResultUrl,
    illustrationResultUrl,
    personaResultUrl,
    loadSavedImages,
    sdResultUrl,
  ]);

  useEffect(() => {
    if (!open) return;
    void loadInfo();
  }, [open, loadInfo]);

  const loadInfoRef = useRef(loadInfo);
  useEffect(() => {
    loadInfoRef.current = loadInfo;
  }, [loadInfo]);

  /** Watch a job that was started outside this panel instance until it terminalizes. */
  useEffect(() => {
    if (trackedJobId == null) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const ids = currentRouteIds();
        const response = await fetch(`/api/chat/image-generation?${queryString(ids)}`, {
          cache: "no-store",
        });
        const data = (await response.json().catch(() => null)) as Preflight | null;
        if (cancelled || !data) return;
        const job = data.activeJob;
        if (job && job.id === trackedJobId && job.status === "running") return;
        setTrackedJobId(null);
        setGenerating(false);
        if (job && job.id === trackedJobId && job.status === "failed") {
          setError(job.errorMessage || "이미지 생성이 중단되었습니다.");
          return;
        }
        setNotice("이미지 생성이 완료되었습니다.");
        await loadInfoRef.current();
      } catch {
        // Transient network failure — keep polling.
      }
    };
    const interval = window.setInterval(() => void poll(), JOB_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [trackedJobId]);

  /** Generation survives a refresh, but warn before the user loses the result view. */
  useEffect(() => {
    if (!generating) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [generating]);

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
    else if (sdProduct === "coupleStamp") setCoupleStampResultUrl("");
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
              : sdProduct === "coupleStamp"
                ? CHAT_COUPLE_STAMP_TEMPLATE_ID
                : info.template.id,
          characterImageUrl: selectedCharacterImageUrl || info.character.imageUrl,
          ...(sdProduct === "coupleStamp"
            ? {
                coupleHeight,
                coupleBackground,
                coupleBorder,
                coupleCharacterExpression,
                couplePersonaExpression,
              }
            : {}),
        }),
      });
      const data = (await response.json().catch(() => null)) as GenerateResult | null;
      if (!response.ok || !data?.imageUrl) {
        if (data) updateBalance(data);
        throw new Error(data?.error || "SD 이미지 생성에 실패했습니다.");
      }
      if (sdProduct === "emoticon") setEmoticonResultUrl(data.imageUrl);
      else if (sdProduct === "coupleStamp") setCoupleStampResultUrl(data.imageUrl);
      else setSdResultUrl(data.imageUrl);
      if (data.savedToCharacterAlbum) {
        setSavedUrls((previous) => new Set(previous).add(data.imageUrl!));
      }
      if (data.upstreamCostUsd != null && data.upstreamCostKrw != null) {
        setActualCosts((previous) => ({
          ...previous,
          [
            sdProduct === "emoticon"
              ? "emoticon"
              : sdProduct === "coupleStamp"
                ? "couple_stamp"
                : "sd"
          ]: {
            usd: data.upstreamCostUsd!,
            krw: data.upstreamCostKrw!,
          },
        }));
      }
      updateBalance(data);
      setNotice(
        sdProduct === "emoticon"
          ? "랜덤 문구 9종 이모티콘을 완성해 기존 캐릭터 이미지 앨범에 추가했습니다."
          : sdProduct === "coupleStamp"
            ? "선택한 커플 인장을 완성해 기존 캐릭터 이미지 앨범에 추가했습니다."
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

  async function generatePersona() {
    if (!info?.personaReady || generating) return;
    setGenerating(true);
    setError("");
    setNotice("");
    setPersonaResultUrl("");
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
          personaId: info.persona?.id ?? null,
          templateId: CHAT_PERSONA_IMAGE_TEMPLATE_ID,
          characterImageUrl: selectedCharacterImageUrl || info.character.imageUrl,
        }),
      });
      const data = (await response.json().catch(() => null)) as GenerateResult | null;
      if (!response.ok || !data?.imageUrl) {
        if (data) updateBalance(data);
        throw new Error(data?.error || "페르소나 이미지 생성에 실패했습니다.");
      }
      setPersonaResultUrl(data.imageUrl);
      if (data.upstreamCostUsd != null && data.upstreamCostKrw != null) {
        setActualCosts((previous) => ({
          ...previous,
          persona: { usd: data.upstreamCostUsd!, krw: data.upstreamCostKrw! },
        }));
      }
      updateBalance(data);
      setNotice("840×1400 페르소나 이미지를 완성했습니다. 저장하기로 내려받을 수 있습니다.");
      void loadInfo();
    } catch (caught) {
      const timedOut = caught instanceof DOMException && caught.name === "AbortError";
      setError(
        timedOut
          ? "페르소나 이미지 생성 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요."
          : caught instanceof Error
            ? caught.message
            : "페르소나 이미지 생성 중 오류가 발생했습니다."
      );
    } finally {
      window.clearTimeout(timer);
      setGenerating(false);
    }
  }

  async function summarizeSelectedTurn() {
    if (!sourceMessageId || summarizing) return;
    setSummarizing(true);
    setError("");
    setNotice("");
    try {
      const ids = currentRouteIds();
      const response = await fetch("/api/chat/comic-generation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...ids,
          mode: "scene_brief",
          messageId: sourceMessageId,
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | { ok?: boolean; summary?: string; error?: string }
        | null;
      if (!response.ok || !data?.summary) {
        throw new Error(data?.error || "턴 요약을 만들지 못했습니다.");
      }
      setComicSummary(data.summary);
      setNotice("선택 턴 요약이 준비되었습니다. 대사를 확인·수정한 뒤 생성해 주세요.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "턴 요약에 실패했습니다.");
    } finally {
      setSummarizing(false);
    }
  }

  async function generateComic() {
    if (!info?.ready || generating) return;
    const isIllustration = ldProduct === "illustration";
    const sourceText = comicText.trim();
    const summaryText = comicSummary.trim();
    if (!isIllustration && !sourceMessageId && !sourceText) {
      setError("만화로 만들 턴을 선택하거나 내용을 입력해 주세요.");
      return;
    }
    if (!isIllustration && sourceMessageId && !summaryText) {
      setError("먼저 ‘현재 턴 요약’을 눌러 대사가 포함된 요약을 확인해 주세요.");
      return;
    }
    const comicInput = sourceMessageId ? summaryText : sourceText;
    if (!isIllustration && comicInput.length > CHAT_COMIC_MAX_INPUT_CHARS) {
      setError(`내용은 최대 ${CHAT_COMIC_MAX_INPUT_CHARS}자까지 입력할 수 있습니다.`);
      return;
    }
    if (!isIllustration && !/["“”]/.test(comicInput)) {
      setError("컷만화에는 최소 1개의 대사가 필요합니다. 요약에 대사를 넣어 주세요.");
      return;
    }

    setGenerating(true);
    setError("");
    setNotice("");
    if (isIllustration) setIllustrationResultUrl("");
    else setComicResultUrl("");
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
          mode: isIllustration ? "illustration" : "comic",
          messageId: isIllustration ? sourceMessageId ?? undefined : undefined,
          sourceText: isIllustration ? undefined : comicInput || undefined,
          characterImageUrl: selectedCharacterImageUrl || info.character.imageUrl,
        }),
      });
      const data = (await response.json().catch(() => null)) as GenerateResult | null;
      if (!response.ok || !data?.imageUrl) {
        if (data) updateBalance(data);
        throw new Error(data?.error || "컷만화 생성에 실패했습니다.");
      }
      if (isIllustration) setIllustrationResultUrl(data.imageUrl);
      else setComicResultUrl(data.imageUrl);
      if (data.savedToCharacterAlbum) {
        setSavedUrls((previous) => new Set(previous).add(data.imageUrl!));
      }
      if (!isIllustration) {
        setComicTitle(data.title || "");
        setComicPanelCount(data.panelCount ?? null);
      }
      if (data.upstreamCostUsd != null && data.upstreamCostKrw != null) {
        setActualCosts((previous) => ({
          ...previous,
          [isIllustration ? "illustration" : "comic"]: {
            usd: data.upstreamCostUsd!,
            krw: data.upstreamCostKrw!,
          },
        }));
      }
      updateBalance(data);
      setNotice(
        isIllustration
          ? "선택 턴의 핵심 장면으로 2:3 LD 일러스트를 만들어 캐릭터 앨범에 추가했습니다."
          : "선택 턴의 중요 대사(원문)와 배경을 추출해 컷만화를 만들고 앨범에 추가했습니다."
      );
      void loadInfo();
    } catch (caught) {
      const timedOut = caught instanceof DOMException && caught.name === "AbortError";
      setError(
        timedOut
          ? `${isIllustration ? "LD 일러스트" : "컷만화"} 생성 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.`
          : caught instanceof Error
            ? caught.message
            : `${isIllustration ? "LD 일러스트" : "컷만화"} 생성 중 오류가 발생했습니다.`
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

  const modalTitle = "이미지 생성";

  return (
    <>
      {showRailTrigger ? (
        <button
          type="button"
          onClick={() => {
            setSourceMessageId(null);
            setSourceTurnPreview("");
            setComicSummary("");
            setOpen(true);
          }}
          className="flex w-full flex-col items-center gap-0.5 rounded-md px-0 py-1.5 text-zinc-400 transition hover:bg-white/[0.06] hover:text-violet-200"
          title="SD 이미지와 LD 이미지 생성"
          aria-label="이미지 생성"
        >
          <IconImageSpark className="h-4 w-4 shrink-0" />
          <span className="max-w-full px-0.5 text-center text-[9px] font-medium leading-[1.15] tracking-tight">
            이미지
          </span>
        </button>
      ) : null}

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
                    ["comic", "LD 이미지"],
                    ["sd", "SD 이미지"],
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
                    {tab === "comic" ? (
                      <div className="grid grid-cols-3 gap-1 rounded-xl bg-black/25 p-1">
                        {(
                          [
                            ["illustration", "선택 턴 일러스트"],
                            ["persona", "페르소나"],
                            ["comic", "자동 컷만화"],
                          ] as const
                        ).map(([id, label]) => (
                          <button
                            key={id}
                            type="button"
                            onClick={() => {
                              setLdProduct(id);
                              setError("");
                              setNotice("");
                            }}
                            disabled={generating || saving}
                            className={`rounded-lg px-2 py-2 text-xs font-semibold transition ${
                              ldProduct === id
                                ? "bg-violet-600 text-white"
                                : "text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <div
                      className={`relative flex max-h-[64dvh] min-h-56 items-center justify-center overflow-hidden rounded-2xl border border-white/10 ${
                        tab === "comic" ? "bg-[#08090d] p-0" : "bg-white p-1"
                      }`}
                    >
                      <img
                        src={
                          activeResultUrl ||
                          (tab === "comic"
                            ? ldProduct === "illustration" || ldProduct === "persona"
                              ? selectedCharacterInfo?.imageUrl || CHAT_COMIC_TEMPLATE_PREVIEW_URL
                              : CHAT_COMIC_TEMPLATE_PREVIEW_URL
                            : sdProduct === "emoticon"
                              ? CHAT_EMOTICON_TEMPLATE_PREVIEW_URL
                              : sdProduct === "coupleStamp"
                                ? CHAT_COUPLE_STAMP_TEMPLATE_PREVIEW_URL
                              : info?.template.previewUrl || "")
                        }
                        alt={
                          activeResultUrl
                            ? tab === "comic"
                              ? ldProduct === "persona"
                                ? "생성된 페르소나 이미지"
                                : ldProduct === "illustration"
                                ? "생성된 선택 턴 LD 일러스트"
                                : "생성된 컷만화"
                              : sdProduct === "emoticon"
                                ? "생성된 랜덤 9종 이모티콘"
                                : sdProduct === "coupleStamp"
                                  ? "생성된 커플 인장"
                                : "생성된 SD 이미지"
                            : tab === "comic"
                              ? ldProduct === "persona"
                                ? "캐릭터 그림체 참조 이미지"
                                : ldProduct === "illustration"
                                ? "선택 턴 LD 일러스트 참조 이미지"
                                : "3~4컷 만화 예시"
                              : sdProduct === "emoticon"
                                ? "랜덤 9종 이모티콘 고정틀"
                                : sdProduct === "coupleStamp"
                                  ? "커플 인장 고정틀 샘플"
                                : "선물상자 SD 고정틀"
                        }
                        className={`max-h-[62dvh] object-contain ${
                          tab === "comic"
                            ? ldProduct === "persona"
                              ? "aspect-[3/5] h-auto max-w-full"
                              : ldProduct === "illustration"
                                ? "aspect-[2/3] h-auto max-w-full"
                              : "h-auto max-w-full"
                            : sdProduct === "emoticon" || sdProduct === "coupleStamp"
                              ? "aspect-square w-full"
                              : "aspect-[3/2] w-full"
                        }`}
                      />
                      {tab === "sd" ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setSdProduct((previous) => cycleSdProduct(previous, -1))}
                            disabled={generating || saving}
                            className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-xl font-bold text-white shadow hover:bg-black/70 disabled:opacity-40"
                            aria-label="이전 SD 이미지"
                          >
                            ‹
                          </button>
                          <button
                            type="button"
                            onClick={() => setSdProduct((previous) => cycleSdProduct(previous, 1))}
                            disabled={generating || saving}
                            className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-xl font-bold text-white shadow hover:bg-black/70 disabled:opacity-40"
                            aria-label="다음 SD 이미지"
                          >
                            ›
                          </button>
                        </>
                      ) : null}
                    </div>
                    <p className="text-center text-[10px] leading-relaxed text-zinc-500">
                      {activeResultUrl
                        ? activeMode === "persona"
                          ? "생성 결과는 840×1400 WebP로 저장되며 아래 버튼으로 내려받을 수 있습니다."
                          : activeSaved
                          ? "캐릭터 앨범에 저장된 이미지입니다."
                          : "생성 결과는 기존 캐릭터 이미지 앨범에 자동으로 추가됩니다."
                        : tab === "comic"
                          ? ldProduct === "persona"
                            ? "선택 페르소나의 성별·외관 설정을 반영하고, 캐릭터 이미지는 그림체만 직접 참조합니다."
                            : ldProduct === "illustration"
                            ? "현재 채팅의 최신 턴을 자동으로 읽어 두 사람의 외형과 그림체를 최대한 닮게 반영합니다."
                            : "본문만 붙여넣으면 핵심 대사·말풍선·표정과 3~4컷 구성을 자동으로 만듭니다."
                          : sdProduct === "emoticon"
                            ? "매번 다른 문구 9개를 뽑아 캐릭터 단독·페르소나 단독·두 사람 장면을 섞어 만듭니다."
                            : sdProduct === "coupleStamp"
                              ? "고정틀 샘플에서 모티프를 고른 뒤 키·배경·테두리·동물귀 옵션으로 원형 커플 인장 한 장을 만듭니다."
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
                        <span className={sdProduct === "coupleStamp" ? "text-violet-300" : "text-zinc-600"}>
                          ●
                        </span>
                        <strong className="ml-1 text-zinc-400">
                          {sdProduct === "gift"
                            ? "선물상자 2인 SD"
                            : sdProduct === "emoticon"
                              ? "랜덤 9종 이모티콘"
                              : "커플 인장"}
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
                        ) : sdProduct === "emoticon" ? null : (
                          <div className="space-y-2">
                            <div className="grid grid-cols-2 gap-2">
                              <label className="block space-y-1">
                                <span className="text-[11px] font-semibold text-zinc-400">캐릭터 표정</span>
                                <select
                                  value={coupleCharacterExpression}
                                  onChange={(event) =>
                                    setCoupleCharacterExpression(
                                      event.target.value as ChatCoupleStampExpression
                                    )
                                  }
                                  disabled={generating}
                                  className="w-full rounded-lg border border-white/10 bg-[#1a1a1a] px-2 py-2 text-xs text-zinc-200 outline-none focus:border-violet-500/50"
                                >
                                  {CHAT_COUPLE_STAMP_EXPRESSIONS.map((item) => (
                                    <option key={item.id} value={item.id}>
                                      {item.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="block space-y-1">
                                <span className="text-[11px] font-semibold text-zinc-400">페르소나 표정</span>
                                <select
                                  value={couplePersonaExpression}
                                  onChange={(event) =>
                                    setCouplePersonaExpression(
                                      event.target.value as ChatCoupleStampExpression
                                    )
                                  }
                                  disabled={generating}
                                  className="w-full rounded-lg border border-white/10 bg-[#1a1a1a] px-2 py-2 text-xs text-zinc-200 outline-none focus:border-violet-500/50"
                                >
                                  {CHAT_COUPLE_STAMP_EXPRESSIONS.map((item) => (
                                    <option key={item.id} value={item.id}>
                                      {item.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>
                            <label className="block space-y-1">
                              <span className="text-[11px] font-semibold text-zinc-400">키 높이</span>
                              <select
                                value={coupleHeight}
                                onChange={(event) =>
                                  setCoupleHeight(event.target.value as ChatCoupleStampHeight)
                                }
                                disabled={generating}
                                className="w-full rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 text-xs text-zinc-200 outline-none focus:border-violet-500/50"
                              >
                                {CHAT_COUPLE_STAMP_HEIGHTS.map((item) => (
                                  <option key={item.id} value={item.id}>
                                    {item.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="block space-y-1">
                              <span className="text-[11px] font-semibold text-zinc-400">배경 장식</span>
                              <select
                                value={coupleBackground}
                                onChange={(event) =>
                                  setCoupleBackground(
                                    event.target.value as ChatCoupleStampBackground
                                  )
                                }
                                disabled={generating}
                                className="w-full rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 text-xs text-zinc-200 outline-none focus:border-violet-500/50"
                              >
                                {CHAT_COUPLE_STAMP_BACKGROUNDS.map((item) => (
                                  <option key={item.id} value={item.id}>
                                    {item.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="block space-y-1">
                              <span className="text-[11px] font-semibold text-zinc-400">테두리 장식</span>
                              <select
                                value={coupleBorder}
                                onChange={(event) =>
                                  setCoupleBorder(event.target.value as ChatCoupleStampBorder)
                                }
                                disabled={generating}
                                className="w-full rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 text-xs text-zinc-200 outline-none focus:border-violet-500/50"
                              >
                                {CHAT_COUPLE_STAMP_BORDERS.map((item) => (
                                  <option key={item.id} value={item.id}>
                                    {item.label}
                                  </option>
                                ))}
                              </select>
                            </label>
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
                                        : sdProduct === "coupleStamp"
                                          ? "커플 인장"
                                        : "선물상자 SD 고정틀",
                                    cost:
                                      sdProduct === "emoticon"
                                        ? info.averageCosts.emoticon
                                        : sdProduct === "coupleStamp"
                                          ? info.averageCosts.coupleStamp
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
                               : sdProduct === "coupleStamp"
                                 ? "커플 인장 생성 중…"
                               : "SD 이미지 생성 중…"
                             : activeResultUrl
                               ? `다시 생성 · ${activePrice.toLocaleString()}P`
                               : `${
                                   sdProduct === "emoticon"
                                     ? "랜덤 9종 이모티콘 생성"
                                     : sdProduct === "coupleStamp"
                                       ? "커플 인장 생성"
                                       : "SD 이미지 생성"
                                 } · ${activePrice.toLocaleString()}P`}
                        </button>
                      </>
                    ) : (
                      <>
                        {ldProduct === "persona" ? (
                          <div className="space-y-2 rounded-xl border border-violet-400/20 bg-violet-500/[0.06] p-3 text-[11px] leading-relaxed text-zinc-300">
                            <p>
                              <strong className="text-violet-200">선택 페르소나 설정으로 생성</strong>
                              <br />성별: {info?.persona == null ? "선택 안 됨" : info.persona.gender === "male" ? "남성" : info.persona.gender === "female" ? "여성" : "기타"}
                            </p>
                            <p className="whitespace-pre-line text-zinc-400">
                              {info?.persona?.appearancePreview || "인식 가능한 외관 설정이 없습니다."}
                            </p>
                            <p className="text-zinc-500">
                              캐릭터 이미지는 외형이 아니라 그림체 참조로만 전달됩니다. 840×1400(3:5)로 직접 생성하고, 공급자 응답 크기가 다를 때만 중앙 기준으로 안전하게 보정합니다.
                            </p>
                          </div>
                        ) : null}
                        {ldProduct === "illustration" || ldProduct === "comic" ? (
                          <div className="space-y-2 rounded-xl border border-violet-400/20 bg-violet-500/[0.06] p-3 text-[11px] leading-relaxed text-zinc-300">
                            {sourceMessageId ? (
                              <>
                                <p>
                                  <strong className="text-violet-200">선택 턴 자동 인식</strong>
                                  {" · "}DeepSeek V4 Flash가 배경·행동을 정리하고, 중요 대사는 원문 그대로 유지합니다.
                                </p>
                                {sourceTurnPreview ? (
                                  <p className="line-clamp-4 whitespace-pre-wrap text-zinc-400">
                                    {sourceTurnPreview}
                                  </p>
                                ) : null}
                              </>
                            ) : (
                              <p>
                                채팅 메시지 아래 이미지 버튼을 누르면 그 턴 기준으로 장면이 잡힙니다.
                                {ldProduct === "comic"
                                  ? " 또는 아래에 내용을 직접 붙여넣을 수 있습니다."
                                  : " 버튼 없이 생성하면 가장 최근 턴을 사용합니다."}
                              </p>
                            )}
                          </div>
                        ) : null}
                        {ldProduct === "comic" ? (
                          <>
                            {sourceMessageId ? (
                              <div className="space-y-2">
                                <button
                                  type="button"
                                  onClick={() => void summarizeSelectedTurn()}
                                  disabled={summarizing || generating}
                                  className="w-full rounded-lg border border-violet-400/40 bg-violet-500/15 px-3 py-2 text-xs font-semibold text-violet-100 transition hover:bg-violet-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  {summarizing ? "선택 턴 요약 중…" : "현재 턴 요약 (DeepSeek)"}
                                </button>
                                {comicSummary ? (
                                  <label className="block space-y-1">
                                    <span className="flex items-center justify-between text-[11px] font-semibold text-zinc-400">
                                      <span>요약 수정 (대사 원문 유지)</span>
                                      <span className={comicSummary.length >= CHAT_COMIC_MAX_INPUT_CHARS ? "text-amber-300" : "text-zinc-500"}>
                                        {comicSummary.length}/{CHAT_COMIC_MAX_INPUT_CHARS}
                                      </span>
                                    </span>
                                    <textarea
                                      value={comicSummary}
                                      onChange={(event) =>
                                        setComicSummary(event.target.value.slice(0, CHAT_COMIC_MAX_INPUT_CHARS))
                                      }
                                      disabled={generating}
                                      rows={8}
                                      className="w-full resize-y rounded-xl border border-white/10 bg-[#1a1a1a] px-3 py-2.5 text-xs leading-relaxed text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet-500/50"
                                    />
                                    <p className="text-[10px] text-zinc-500">
                                      컷만화에는 최소 1개의 대사가 필요합니다. 대사를 지우면 생성할 수 없습니다.
                                    </p>
                                  </label>
                                ) : null}
                              </div>
                            ) : (
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
                                  placeholder="장면이나 RP 본문을 붙여넣으세요. 중요 대사는 원문 그대로 살리고 말풍선·표정·컷을 자동 구성합니다."
                                  className="w-full resize-y rounded-xl border border-white/10 bg-[#1a1a1a] px-3 py-2.5 text-xs leading-relaxed text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet-500/50"
                                />
                              </label>
                            )}
                            <div className="block space-y-1">
                              <span className="text-[11px] font-semibold text-zinc-400">컷 수</span>
                              <div className="rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 text-xs text-zinc-300">
                                AI 자동 · 3~4컷 · 분위기는 요약 내용을 따릅니다
                              </div>
                            </div>
                          </>
                        ) : null}
                        {ldProduct === "comic" && comicTitle ? (
                          <p className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-300">
                            생성 제목: <strong>{comicTitle}</strong>
                            {comicPanelCount ? ` · AI가 ${comicPanelCount}컷으로 구성` : ""}
                          </p>
                        ) : null}
                        <PriceBox
                          balance={info?.balance}
                          averageCosts={
                            info?.averageCosts
                              ? ldProduct === "persona"
                                ? [{
                                    label: "페르소나 LD 이미지",
                                    cost: info.averageCosts.persona,
                                  }]
                                : ldProduct === "illustration"
                                ? [{
                                    label: "선택 턴 LD 일러스트",
                                    cost: info.averageCosts.illustration,
                                  }]
                                : ([3, 4] as const).map((panelCount) => ({
                                    label: `${panelCount}컷 만화`,
                                    cost: info.averageCosts!.comic[panelCount],
                                  }))
                              : undefined
                          }
                          exchangeRateKrwPerUsd={info?.averageCosts?.exchangeRateKrwPerUsd}
                        />
                        <button
                          type="button"
                          onClick={() => void (ldProduct === "persona" ? generatePersona() : generateComic())}
                          disabled={
                            generating ||
                            loadingInfo ||
                            (ldProduct === "persona" ? !info?.personaReady : !info?.ready) ||
                            (ldProduct === "comic" &&
                              (sourceMessageId ? !comicSummary.trim() : !comicText.trim())) ||
                            (info?.balance != null &&
                              info.balance.total < activePrice)
                          }
                          className="w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {generating
                            ? ldProduct === "persona"
                              ? "페르소나 이미지 생성 중…"
                              : ldProduct === "illustration"
                                ? "선택 턴 장면 추출·일러스트 생성 중…"
                                : "중요 대사 추출·컷 구성 중…"
                            : activeResultUrl
                              ? `다시 생성 · ${activePrice.toLocaleString()}P`
                              : `${
                                  ldProduct === "persona"
                                    ? "페르소나 이미지 생성"
                                    : ldProduct === "illustration"
                                    ? "선택 턴 일러스트 생성"
                                    : "자동 컷만화 생성"
                                } · ${activePrice.toLocaleString()}P`}
                        </button>
                      </>
                    )}

                    {info && (tab === "comic" && ldProduct === "persona" ? !info.personaReady : !info.ready) ? (
                      <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200">
                        먼저 {(tab === "comic" && ldProduct === "persona" ? info.personaMissing : info.missing).join(", ")}를 등록해 주세요.
                        {tab === "comic" && ldProduct === "persona" && info.personaMissing.some((item) => item.startsWith("페르소나") || item === "선택 페르소나") ? (
                          <a href="/persona" className="ml-2 font-semibold underline underline-offset-2 hover:text-amber-100">
                            페르소나 설정 열기
                          </a>
                        ) : null}
                      </p>
                    ) : null}
                    {generating ? (
                      <p className="rounded-lg border border-violet-500/25 bg-violet-500/10 px-3 py-2 text-xs leading-relaxed text-violet-200">
                        이미지를 생성하고 있습니다. 새로고침하거나 창을 닫아도 생성은 계속되고,
                        {activeMode === "persona"
                          ? "완료되면 이 창에서 결과를 저장할 수 있습니다."
                          : "완료되면 캐릭터 이미지 앨범에 저장됩니다."}
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
