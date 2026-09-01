"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

import {
  CHAT_COMIC_GENERATION_DEFAULT_POINTS,
  CHAT_COMIC_MAX_INPUT_CHARS,
  CHAT_COMIC_PANEL_OPTIONS,
  CHAT_COMIC_TEMPLATE_PREVIEW_URL,
  type ChatComicPanelCount,
} from "@/lib/chatComicGeneration";
import {
  applyApprovedAiScenePlan,
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
  reflowScenePlanPanels,
  type ScenePlan,
  type SceneSourceMessage,
} from "@/lib/chatImageScenePlan";
import {
  resolveComicAiApplyPanelCount,
  shouldApplyComicAiPlanUpgrade,
  commitScenePanelCount,
} from "@/lib/chatImageScenePlanLifecycle";
import ChatSceneBuilder, {
  type SceneOutputMode,
} from "@/components/ChatSceneBuilder";
import type { ScenePanelCount } from "@/lib/chatImageScenePlan";
import TrpgImageSceneDiagnosticsPanel from "@/components/TrpgImageSceneDiagnosticsPanel";
import {
  draftCastIntentFromCandidatePool,
  mergeCastIntentDraft,
  selectedCastIntentSubjects,
  suggestAssetForSupportingName,
  type ChatImageCastIntentManifest,
  type SelectableCastAsset,
} from "@/lib/chatImageCast";
import type { ContentKind } from "@/lib/simulationMode";
import {
  TRPG_IMAGE_SCENE_MODE_DEFAULT,
  type TrpgImageSceneMode,
} from "@/lib/trpg/trpgImageSceneMode";
import {
  buildTrpgDiagnosticsResultIdentity,
  buildTrpgDiagnosticsSourceIdentity,
  clearedTrpgImageSceneDiagnostics,
  resolveTrpgImageSceneDiagnosticsFromResponse,
  resolveTrpgImageSceneDiagnosticsOnSourceReopen,
  shouldClearTrpgImageSceneDiagnosticsOnSourceOpen,
  type TrpgImageSceneDiagnosticsPayload,
} from "@/lib/trpg/trpgImageSceneDiagnosticsLifecycle";
import type { ClientVisibleVisualSubject } from "@/lib/visualSubjects";
import { emptySceneVisualScopeState } from "@/lib/chatImageSceneVisualScope";
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
  previewVisualAppearance,
  resolveChatImageAppearanceControlProduct,
  resolveEffectiveAppearanceMode,
  shouldShowChatImageAppearanceModeControl,
  type ChatImageAppearanceMode,
} from "@/lib/chatImageVisualIdentity";
import {
  CHAT_LD_ILLUSTRATION_DEFAULT_POINTS,
} from "@/lib/chatLdIllustrationGeneration";
import {
  CHAT_PERSONA_IMAGE_DEFAULT_POINTS,
  CHAT_PERSONA_IMAGE_TEMPLATE_ID,
} from "@/lib/chatPersonaImageGeneration";
import { dispatchPointsDeducted } from "@/lib/pointsEvents";

const PERSONA_STORAGE_KEY = "habi:lastPersonaId";
let characterIdOverride: number | null = null;

type Tab = "sd" | "comic";
type ResultMode = "sd" | "emoticon" | "couple_stamp" | "comic" | "illustration" | "persona";
type SdProduct = "gift" | "emoticon" | "coupleStamp";
type LdProduct = "scene" | "persona";

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
  character: ReferenceInfo & {
    hasSavedAppearance?: boolean;
    appearancePreview?: string;
  };
  contentKind?: ContentKind;
  characterImages?: Array<{ url: string; tag: string }>;
  castSelectableAssets?: SelectableCastAsset[];
  visualSubjects?: ClientVisibleVisualSubject[];
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
  generationId?: number;
  trpgImageSceneDiagnostics?: {
    mode: TrpgImageSceneMode;
    modeRequested: TrpgImageSceneMode;
    modeApplied: TrpgImageSceneMode;
    aiModel: string;
    aiAttempts: number;
    aiUsedFallback: boolean;
    aiDeterministicFallback: boolean;
    aiLatencyMs: number;
    canonicalLocation: string;
    selectedHeroScene: string;
    heroEventIds: string[];
    overSelectionRejected: boolean;
    fallbackReason?: string;
  };
};

type SavedAlbumEntry = {
  imageUrl: string;
};

type PartyCastMember = {
  participantId: number;
  name: string;
  kind: "human" | "ai_character";
  imageUrl: string | null;
  images: Array<{ url: string; tag: string }>;
};

function currentRouteIds() {
  const match = window.location.pathname.match(/^\/chat\/(\d+)/);
  const params = new URLSearchParams(window.location.search);
  const storedPersona = Number(localStorage.getItem(PERSONA_STORAGE_KEY));
  const chatId = Number(params.get("chat"));
  const parsedRouteCharacterId = match ? Number(match[1]) : Number.NaN;
  const routeCharacterId =
    Number.isInteger(parsedRouteCharacterId) && parsedRouteCharacterId > 0
      ? parsedRouteCharacterId
      : null;
  return {
    characterId:
      characterIdOverride && characterIdOverride > 0 ? characterIdOverride : routeCharacterId,
    chatId: Number.isInteger(chatId) && chatId > 0 ? chatId : null,
    personaId:
      Number.isInteger(storedPersona) && storedPersona > 0 ? storedPersona : null,
  };
}

function turnPreviewFromContent(content: string): string {
  return content
    .replace(/<<<STATUS_VALUES[\s\S]*?>>>/gi, " ")
    .replace(/<<<STATUS[\s\S]*?>>>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  const [ldProduct, setLdProduct] = useState<LdProduct>("scene");
  const [sceneOutputMode, setSceneOutputMode] = useState<SceneOutputMode>("illustration");
  const [scenePanelCount, setScenePanelCount] = useState<ScenePanelCount>(3);
  const scenePanelCountRef = useRef<ScenePanelCount>(3);
  const commitPanelCount = useCallback((count: ScenePanelCount) => {
    commitScenePanelCount(scenePanelCountRef, count, setScenePanelCount);
  }, []);
  const [sceneMessages, setSceneMessages] = useState<SceneSourceMessage[]>([]);
  const [scenePlan, setScenePlan] = useState<ScenePlan | null>(null);
  const deterministicPlanCacheRef = useRef<Map<string, ScenePlan>>(new Map());
  const aiPlanCacheRef = useRef<Map<string, ScenePlan>>(new Map());
  const sceneSourceEpochRef = useRef(0);
  const scenePlanUserEditedRef = useRef(false);
  const comicDefaultAiPlanAppliedRef = useRef<string | null>(null);
  const sceneBriefAbortRef = useRef<AbortController | null>(null);
  const aiSuggestionAbortRef = useRef<AbortController | null>(null);
  const [aiSuggestedPlan, setAiSuggestedPlan] = useState<ScenePlan | null>(null);
  const [aiSuggestionLoading, setAiSuggestionLoading] = useState(false);
  const [aiSuggestionError, setAiSuggestionError] = useState("");
  const [hasAiSuggestionSession, setHasAiSuggestionSession] = useState(false);
  const [configuredCastNames, setConfiguredCastNames] = useState<string[]>([]);
  const [sceneVisualSubjects, setSceneVisualSubjects] = useState<ClientVisibleVisualSubject[]>([]);
  const [sceneCastSelectableAssets, setSceneCastSelectableAssets] = useState<SelectableCastAsset[]>(
    []
  );
  const [castIntent, setCastIntent] = useState<ChatImageCastIntentManifest | null>(null);
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
  const [actualCosts, setActualCosts] = useState<
    Partial<Record<ResultMode, { usd: number; krw: number }>>
  >({});
  const [savedUrls, setSavedUrls] = useState<Set<string>>(() => new Set());
  const [selectedCharacterImageUrl, setSelectedCharacterImageUrl] = useState("");
  const [characterAppearanceModeOverride, setCharacterAppearanceModeOverride] =
    useState<ChatImageAppearanceMode | null>(null);
  const [characterAppearancePreviewOpen, setCharacterAppearancePreviewOpen] =
    useState(false);
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
  /** Cap edits at the originally loaded turn length (no fixed 1,000 cap). */
  const [comicLoadedMaxChars, setComicLoadedMaxChars] = useState(0);
  const [summarizing, setSummarizing] = useState(false);
  const [campaignId, setCampaignId] = useState<number | null>(null);
  const [campaignRoundNumber, setCampaignRoundNumber] = useState<number | null>(null);
  const [trpgImageSceneMode, setTrpgImageSceneMode] = useState<TrpgImageSceneMode>(
    TRPG_IMAGE_SCENE_MODE_DEFAULT
  );
  const [trpgImageSceneDiagnostics, setTrpgImageSceneDiagnostics] =
    useState<GenerateResult["trpgImageSceneDiagnostics"]>(undefined);
  const trpgDiagnosticsCacheRef = useRef<{
    sourceIdentity: string;
    resultIdentity: string;
    diagnostics: TrpgImageSceneDiagnosticsPayload;
  } | null>(null);
  const lastTrpgGenerationIdRef = useRef<number | null>(null);
  const illustrationResultUrlRef = useRef(illustrationResultUrl);
  useEffect(() => {
    illustrationResultUrlRef.current = illustrationResultUrl;
  }, [illustrationResultUrl]);
  const clearTrpgImageSceneDiagnostics = useCallback(() => {
    setTrpgImageSceneDiagnostics(clearedTrpgImageSceneDiagnostics());
    trpgDiagnosticsCacheRef.current = null;
  }, []);
  const [campaignTitle, setCampaignTitle] = useState("");
  const [partyNames, setPartyNames] = useState<string[]>([]);
  const [partyCast, setPartyCast] = useState<PartyCastMember[]>([]);
  const [partyPicks, setPartyPicks] = useState<Record<number, string>>({});
  const [partyPickerId, setPartyPickerId] = useState<number | null>(null);
  const trpgCampaignMode = campaignId != null;

  useEffect(() => {
    const openGenerator = (event: Event) => {
      const detail = (event as CustomEvent<{
        messageId?: unknown;
        content?: unknown;
        characterId?: unknown;
        campaignId?: unknown;
        campaignTitle?: unknown;
        roundNumber?: unknown;
        partyNames?: unknown;
      }>).detail;
      const overrideId = Number(detail?.characterId);
      characterIdOverride =
        Number.isInteger(overrideId) && overrideId > 0 ? overrideId : null;
      const parsedCampaignId = Number(detail?.campaignId);
      setCampaignId(
        Number.isInteger(parsedCampaignId) && parsedCampaignId > 0 ? parsedCampaignId : null
      );
      const parsedRound = Number(detail?.roundNumber);
      setCampaignRoundNumber(
        Number.isInteger(parsedRound) && parsedRound >= 0 ? parsedRound : null
      );
      setCampaignTitle(
        typeof detail?.campaignTitle === "string" ? detail.campaignTitle.trim() : ""
      );
      setPartyCast([]);
      setPartyPicks({});
      setPartyPickerId(null);
      setPartyNames(
        Array.isArray(detail?.partyNames)
          ? detail.partyNames.filter((name): name is string => typeof name === "string" && name.trim().length > 0)
          : []
      );
      const messageId = Number(detail?.messageId);
      const nextSourceIdentity = buildTrpgDiagnosticsSourceIdentity({
        campaignId:
          Number.isInteger(parsedCampaignId) && parsedCampaignId > 0 ? parsedCampaignId : null,
        roundNumber:
          Number.isInteger(parsedRound) && parsedRound >= 0 ? parsedRound : null,
        sourceMessageId: Number.isFinite(messageId) && messageId > 0 ? messageId : null,
      });
      const currentResultIdentity = buildTrpgDiagnosticsResultIdentity({
        generationId: lastTrpgGenerationIdRef.current,
        imageUrl: illustrationResultUrlRef.current,
      });
      if (
        shouldClearTrpgImageSceneDiagnosticsOnSourceOpen({
          previousSourceIdentity: trpgDiagnosticsCacheRef.current?.sourceIdentity ?? null,
          nextSourceIdentity,
        })
      ) {
        clearTrpgImageSceneDiagnostics();
      } else {
        const restored = resolveTrpgImageSceneDiagnosticsOnSourceReopen({
          nextSourceIdentity,
          currentResultIdentity,
          cached: trpgDiagnosticsCacheRef.current,
          currentDiagnostics: trpgImageSceneDiagnostics,
        });
        if (restored !== trpgImageSceneDiagnostics) {
          setTrpgImageSceneDiagnostics(restored);
        }
      }
      setTrpgImageSceneMode(TRPG_IMAGE_SCENE_MODE_DEFAULT);
      const epoch = beginSceneSourceChange();
      setSourceMessageId(null);
      setSourceTurnPreview("");
      setComicSummary("");
      setComicLoadedMaxChars(0);
      setComicText("");
      setTab("comic");
      setLdProduct("scene");
      setSceneOutputMode("illustration");

      const preview = turnPreviewFromContent(String(detail?.content ?? ""));
      if (Number.isFinite(messageId) && messageId > 0) {
        setSourceMessageId(messageId);
        setSourceTurnPreview(preview.slice(0, 280));
        void loadSelectedTurnContent(messageId, epoch);
      } else if (preview) {
        setSourceTurnPreview(preview.slice(0, 280));
        setComicSummary(preview.slice(0, CHAT_COMIC_MAX_INPUT_CHARS));
        setComicLoadedMaxChars(Math.min(preview.length, CHAT_COMIC_MAX_INPUT_CHARS));
        applyPreviewSceneSource(preview, epoch);
      }
      setOpen(true);
    };
    window.addEventListener("chat:image-generator:open", openGenerator);
    return () => window.removeEventListener("chat:image-generator:open", openGenerator);
  }, [clearTrpgImageSceneDiagnostics, trpgImageSceneDiagnostics]);

  useEffect(() => {
    if (!trpgCampaignMode) return;
    setTab("comic");
    setLdProduct("scene");
    setSceneOutputMode("illustration");
  }, [trpgCampaignMode]);

  useEffect(() => {
    if (!open || !campaignId) {
      if (!campaignId) {
        setPartyCast([]);
        setPartyPicks({});
        setPartyPickerId(null);
      }
      return;
    }
    let cancelled = false;
    void fetch(`/api/trpg/campaigns/${campaignId}/illustration-cast`, { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as
          | {
              ok?: boolean;
              campaignTitle?: string;
              members?: PartyCastMember[];
              error?: string;
            }
          | null;
        if (!response.ok || !data?.ok) {
          throw new Error(data?.error || "파티 이미지를 불러오지 못했습니다.");
        }
        if (cancelled) return;
        const members = Array.isArray(data.members) ? data.members : [];
        setPartyCast(members);
        setPartyPicks(
          Object.fromEntries(
            members.map((member) => [member.participantId, member.imageUrl || ""])
          )
        );
        if (members.length > 0) {
          setPartyNames(members.map((member) => member.name));
        }
        if (data.campaignTitle?.trim()) setCampaignTitle(data.campaignTitle.trim());
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "파티 이미지를 불러오지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, [open, campaignId]);

  const sceneIsIllustration =
    ldProduct === "scene" && (trpgCampaignMode || sceneOutputMode === "illustration");
  const selectableCastAssets = useMemo((): readonly SelectableCastAsset[] => {
    if (sceneCastSelectableAssets.length) return sceneCastSelectableAssets;
    if (info?.castSelectableAssets?.length) return info.castSelectableAssets;
    return (info?.characterImages ?? []).map((image) => ({
      url: image.url,
      tag: image.tag,
    }));
  }, [info?.castSelectableAssets, info?.characterImages, sceneCastSelectableAssets]);
  const activeVisualSubjects = sceneVisualSubjects.length
    ? sceneVisualSubjects
    : info?.visualSubjects;
  const contentKind: ContentKind = info?.contentKind ?? "character";
  const reservedCastReferenceUrls = useMemo((): readonly string[] => {
    if (contentKind === "simulation") {
      const urls: string[] = [];
      const personaIncluded = castIntent?.subjects.some(
        (subject) => subject.role === "persona" && subject.included
      );
      if (personaIncluded && info?.persona?.imageUrl) {
        urls.push(info.persona.imageUrl);
      }
      for (const subject of castIntent?.subjects ?? []) {
        if (!subject.included) continue;
        const assetUrl = String(subject.requestedReferenceAssetUrl ?? "").trim();
        if (assetUrl) urls.push(assetUrl);
      }
      return urls;
    }
    const urls = [
      info?.persona?.imageUrl,
      selectedCharacterImageUrl || info?.character.imageUrl,
    ]
      .map((url) => String(url ?? "").trim())
      .filter(Boolean);
    return urls;
  }, [
    contentKind,
    castIntent,
    info?.persona?.imageUrl,
    info?.character.imageUrl,
    selectedCharacterImageUrl,
  ]);

  useEffect(() => {
    if (!scenePlan || trpgCampaignMode || !info) return;
    const draft = draftCastIntentFromCandidatePool({
      contentKind,
      personaName: info.persona?.name ?? "persona",
      mainCharacterName: info.character.name,
      configuredCharacterSetNames: configuredCastNames,
      castMentions: scenePlan.castMentions,
      events: scenePlan.events,
    });
    setCastIntent((current) => {
      const merged = mergeCastIntentDraft(current, draft, contentKind);
      return {
        ...merged,
        subjects: merged.subjects.map((subject) => {
          if (subject.role !== "supporting_character" || subject.requestedReferenceAssetUrl) {
            return subject;
          }
          const suggested = suggestAssetForSupportingName(
            subject.name,
            selectableCastAssets,
            activeVisualSubjects
          );
          return suggested
            ? { ...subject, requestedReferenceAssetUrl: suggested }
            : subject;
        }),
      };
    });
  }, [scenePlan, trpgCampaignMode, info, selectableCastAssets, activeVisualSubjects, configuredCastNames, contentKind]);
  const activeResultUrl =
    tab === "comic"
      ? ldProduct === "persona"
        ? personaResultUrl
        : sceneIsIllustration
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
        : sceneIsIllustration
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
  const primaryCharacterImageUrl =
    info?.characterImages?.[0]?.url || info?.character.imageUrl || "";
  const selectedCharacterUrl =
    selectedCharacterImageUrl || info?.character.imageUrl || "";
  const isPrimaryCharacterImage =
    !selectedCharacterUrl || selectedCharacterUrl === primaryCharacterImageUrl;
  const hasSavedAppearance = Boolean(info?.character.hasSavedAppearance);
  const characterAppearanceMode = resolveEffectiveAppearanceMode({
    sourceKind: "main_character",
    isPrimaryImage: isPrimaryCharacterImage,
    hasOwnSavedAppearance: hasSavedAppearance,
    hasOwnReference: Boolean(selectedCharacterUrl),
    override: characterAppearanceModeOverride,
  });
  const characterAppearanceFull = info?.character.appearancePreview?.trim() || "";
  const characterAppearancePreview = previewVisualAppearance(characterAppearanceFull);
  const appearanceControlProduct = resolveChatImageAppearanceControlProduct({
    surface: tab === "sd" ? "sd" : "ld",
    sdProduct,
    ldProduct,
    isTrpgParty: Boolean(campaignId),
  });
  const showAppearanceModeControl = shouldShowChatImageAppearanceModeControl({
    product: appearanceControlProduct,
    hasSavedAppearance,
  });
  const partyPickerMember = useMemo(
    () => partyCast.find((row) => row.participantId === partyPickerId) ?? null,
    [partyCast, partyPickerId]
  );

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
    if (campaignId) {
      try {
        const response = await fetch(
          `/api/chat/image-album?campaignId=${encodeURIComponent(String(campaignId))}`,
          { cache: "no-store" }
        );
        const data = (await response.json().catch(() => null)) as
          | { album?: SavedAlbumEntry[]; title?: string; error?: string }
          | null;
        if (!response.ok || !data) throw new Error(data?.error || "앨범을 불러오지 못했습니다.");
        const rows = Array.isArray(data.album) ? data.album : [];
        setSavedUrls(new Set(rows.map((item) => item.imageUrl)));
        if (data.title?.trim()) setCampaignTitle(data.title.trim());
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "앨범을 불러오지 못했습니다.");
      }
      return;
    }
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
  }, [campaignId]);

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
      setSelectedCharacterImageUrl((previous) => {
        if (selectableImages.some((image) => image.url === previous)) return previous;
        setCharacterAppearanceModeOverride(null);
        return data.character.imageUrl;
      });
      setCharacterPickerOpen(false);
      if (data.latestResult?.imageUrl) {
        if (data.latestResult.mode === "persona") {
          if (!personaResultUrl) setPersonaResultUrl(data.latestResult.imageUrl);
        } else if (data.latestResult.mode === "illustration") {
          if (!illustrationResultUrl) setIllustrationResultUrl(data.latestResult.imageUrl);
        } else if (data.latestResult.mode === "comic") {
          if (!comicResultUrl) setComicResultUrl(data.latestResult.imageUrl);
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
        window.dispatchEvent(
          new CustomEvent("chat:image-generator:completed", {
            detail: { jobId: trackedJobId },
          })
        );
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
      if (event.key === "Escape" && !saving) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, generating, saving]);

  async function generateSd() {
    if (campaignId || !info?.ready || generating) return;
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
          characterAppearanceMode,
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
    if (campaignId || !info?.personaReady || generating) return;
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
      setNotice("864×1440 페르소나 이미지를 완성했습니다. 저장하기로 내려받을 수 있습니다.");
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

  function isCurrentSceneSourceEpoch(epoch: number): boolean {
    return sceneSourceEpochRef.current === epoch;
  }

  function resetSceneSourceState() {
    setScenePlan(null);
    setCastIntent(null);
    setConfiguredCastNames([]);
    const clearedScope = emptySceneVisualScopeState();
    setSceneVisualSubjects(clearedScope.visualSubjects);
    setSceneCastSelectableAssets(clearedScope.castSelectableAssets);
    setSceneMessages([]);
    setAiSuggestedPlan(null);
    setAiSuggestionError("");
    setHasAiSuggestionSession(false);
    commitPanelCount(3);
    setAiSuggestionLoading(false);
    scenePlanUserEditedRef.current = false;
    comicDefaultAiPlanAppliedRef.current = null;
  }

  function beginSceneSourceChange(): number {
    sceneBriefAbortRef.current?.abort();
    aiSuggestionAbortRef.current?.abort();
    sceneBriefAbortRef.current = null;
    aiSuggestionAbortRef.current = null;
    const epoch = sceneSourceEpochRef.current + 1;
    sceneSourceEpochRef.current = epoch;
    resetSceneSourceState();
    return epoch;
  }

  function sceneCacheKey(messageId: number | null, summary: string) {
    const ids = currentRouteIds();
    return `${ids.chatId ?? "none"}:${messageId ?? "none"}:${summary}`;
  }

  function applyDeterministicScenePlan(
    messageId: number | null,
    summary: string,
    messages: SceneSourceMessage[],
    epoch: number
  ) {
    if (!isCurrentSceneSourceEpoch(epoch)) return;
    const key = sceneCacheKey(messageId, summary);
    const cached = deterministicPlanCacheRef.current.get(key);
    const plan = cached ?? buildDeterministicScenePlan(messages);
    if (!cached) deterministicPlanCacheRef.current.set(key, plan);
    setScenePlan(plan);
    commitPanelCount(plan.recommendedPanelCount);
    setAiSuggestedPlan(null);
    setAiSuggestionError("");
  }

  function applyPreviewSceneSource(preview: string, epoch: number) {
    if (!isCurrentSceneSourceEpoch(epoch)) return;
    const trimmed = preview.trim();
    if (!trimmed) return;
    const messages = buildSceneSourceMessages([{ id: 1, role: "user", content: trimmed }]);
    setSceneMessages(messages);
    setConfiguredCastNames([]);
    applyDeterministicScenePlan(null, trimmed, messages, epoch);
    if (sceneOutputMode === "comic") {
      void applyComicDefaultAiPlan({
        messageId: null,
        summary: trimmed,
        messages,
        epoch,
      });
    }
  }

  function applyComicAiPlanUpgrade(aiPlan: ScenePlan, epoch: number) {
    if (
      !shouldApplyComicAiPlanUpgrade({
        responseEpoch: epoch,
        currentEpoch: sceneSourceEpochRef.current,
        userEdited: scenePlanUserEditedRef.current,
      })
    ) {
      return;
    }
    const panelCount = resolveComicAiApplyPanelCount(scenePanelCountRef.current);
    const nextPlan = applyApprovedAiScenePlan(aiPlan, panelCount);
    setScenePlan(nextPlan);
    if (!info) return;
    const draft = draftCastIntentFromCandidatePool({
      contentKind,
      personaName: info.persona?.name ?? "persona",
      mainCharacterName: info.character.name,
      configuredCharacterSetNames: configuredCastNames,
      castMentions: nextPlan.castMentions,
      events: nextPlan.events,
    });
    setCastIntent((current) => mergeCastIntentDraft(current, draft, contentKind));
  }

  async function applyComicDefaultAiPlan(opts: {
    messageId: number | null;
    summary: string;
    messages?: SceneSourceMessage[];
    epoch: number;
    force?: boolean;
  }) {
    if (trpgCampaignMode || !isCurrentSceneSourceEpoch(opts.epoch)) return;
    const key = sceneCacheKey(opts.messageId, opts.summary);
    if (!opts.force && comicDefaultAiPlanAppliedRef.current === key) return;
    comicDefaultAiPlanAppliedRef.current = key;

    const cached = !opts.force ? aiPlanCacheRef.current.get(key) : undefined;
    if (cached) {
      applyComicAiPlanUpgrade(cached, opts.epoch);
      return;
    }

    setAiSuggestionLoading(true);
    setAiSuggestionError("");
    aiSuggestionAbortRef.current?.abort();
    const controller = new AbortController();
    aiSuggestionAbortRef.current = controller;
    try {
      const ids = currentRouteIds();
      const response = await fetch("/api/chat/comic-generation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          ...ids,
          mode: "scene_plan",
          messageId: opts.messageId ?? undefined,
          sourceText: opts.messageId ? undefined : opts.summary,
          panelCount: scenePanelCountRef.current,
        }),
      });
      if (!isCurrentSceneSourceEpoch(opts.epoch)) return;
      const data = (await response.json().catch(() => null)) as
        | { ok?: boolean; plan?: ScenePlan; error?: string }
        | null;
      if (!response.ok || !data?.plan) {
        return;
      }
      if (!isCurrentSceneSourceEpoch(opts.epoch)) return;
      aiPlanCacheRef.current.set(key, data.plan);
      applyComicAiPlanUpgrade(data.plan, opts.epoch);
    } catch (caught) {
      if (!isCurrentSceneSourceEpoch(opts.epoch)) return;
      if (caught instanceof DOMException && caught.name === "AbortError") return;
    } finally {
      if (isCurrentSceneSourceEpoch(opts.epoch)) {
        setAiSuggestionLoading(false);
      }
    }
  }

  async function requestAiSceneSuggestion(opts: {
    messageId: number | null;
    summary: string;
    messages?: SceneSourceMessage[];
    force?: boolean;
    epoch: number;
  }) {
    if (trpgCampaignMode || !isCurrentSceneSourceEpoch(opts.epoch)) return;
    const key = sceneCacheKey(opts.messageId, opts.summary);
    const cached = !opts.force ? aiPlanCacheRef.current.get(key) : undefined;
    if (cached) {
      if (!isCurrentSceneSourceEpoch(opts.epoch)) return;
      setAiSuggestedPlan(cached);
      setHasAiSuggestionSession(true);
      setAiSuggestionError("");
      return;
    }
    setAiSuggestionLoading(true);
    setAiSuggestionError("");
    aiSuggestionAbortRef.current?.abort();
    const controller = new AbortController();
    aiSuggestionAbortRef.current = controller;
    try {
      const ids = currentRouteIds();
      const response = await fetch("/api/chat/comic-generation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          ...ids,
          mode: "scene_plan",
          messageId: opts.messageId ?? undefined,
          sourceText: opts.messageId ? undefined : opts.summary,
          panelCount: scenePanelCountRef.current,
        }),
      });
      if (!isCurrentSceneSourceEpoch(opts.epoch)) return;
      const data = (await response.json().catch(() => null)) as
        | { ok?: boolean; plan?: ScenePlan; error?: string }
        | null;
      if (!response.ok || !data?.plan) {
        throw new Error(
          data?.error ||
            "AI 제안을 불러오지 못했습니다. 현재 직접 편집한 장면은 그대로 유지됩니다."
        );
      }
      if (!isCurrentSceneSourceEpoch(opts.epoch)) return;
      aiPlanCacheRef.current.set(key, data.plan);
      setAiSuggestedPlan(data.plan);
      setHasAiSuggestionSession(true);
    } catch (caught) {
      if (!isCurrentSceneSourceEpoch(opts.epoch)) return;
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setAiSuggestionError(
        caught instanceof Error
          ? caught.message
          : "AI 제안을 불러오지 못했습니다. 현재 직접 편집한 장면은 그대로 유지됩니다."
      );
    } finally {
      if (isCurrentSceneSourceEpoch(opts.epoch)) {
        setAiSuggestionLoading(false);
      }
    }
  }

  function applyAiSceneSuggestion() {
    if (!aiSuggestedPlan || !info) return;
    const nextPlan = applyApprovedAiScenePlan(
      aiSuggestedPlan,
      resolveComicAiApplyPanelCount(scenePanelCountRef.current)
    );
    scenePlanUserEditedRef.current = false;
    setScenePlan(nextPlan);
    const draft = draftCastIntentFromCandidatePool({
      contentKind,
      personaName: info.persona?.name ?? "persona",
      mainCharacterName: info.character.name,
      configuredCharacterSetNames: configuredCastNames,
      castMentions: nextPlan.castMentions,
      events: nextPlan.events,
    });
    setCastIntent((current) => mergeCastIntentDraft(current, draft, contentKind));
    setAiSuggestedPlan(null);
    setAiSuggestionError("");
  }

  function cancelAiSceneSuggestion() {
    setAiSuggestedPlan(null);
    setAiSuggestionError("");
  }

  async function loadSelectedTurnContent(messageId: number, epoch: number) {
    if (!isCurrentSceneSourceEpoch(epoch)) return;
    setSummarizing(true);
    setError("");
    setNotice("");
    sceneBriefAbortRef.current?.abort();
    const controller = new AbortController();
    sceneBriefAbortRef.current = controller;
    try {
      const ids = currentRouteIds();
      const response = await fetch("/api/chat/comic-generation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          ...ids,
          mode: "scene_brief",
          messageId,
        }),
      });
      if (!isCurrentSceneSourceEpoch(epoch)) return;
      const data = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            summary?: string;
            messages?: SceneSourceMessage[];
            configuredCastNames?: string[];
            visualSubjects?: ClientVisibleVisualSubject[];
            castSelectableAssets?: SelectableCastAsset[];
            contentKind?: ContentKind;
            error?: string;
          }
        | null;
      if (!response.ok || !data?.summary) {
        throw new Error(data?.error || "턴 내용을 불러오지 못했습니다.");
      }
      if (!isCurrentSceneSourceEpoch(epoch)) return;
      setComicSummary(data.summary);
      setComicLoadedMaxChars(data.summary.length);
      const messages = Array.isArray(data.messages) ? data.messages : [];
      setSceneMessages(messages);
      setConfiguredCastNames(
        Array.isArray(data.configuredCastNames)
          ? data.configuredCastNames.filter((name) => typeof name === "string" && name.trim())
          : []
      );
      setSceneVisualSubjects(Array.isArray(data.visualSubjects) ? data.visualSubjects : []);
      setSceneCastSelectableAssets(
        Array.isArray(data.castSelectableAssets) ? data.castSelectableAssets : []
      );
      if (data.contentKind === "simulation" || data.contentKind === "character") {
        setInfo((previous) =>
          previous ? { ...previous, contentKind: data.contentKind } : previous
        );
      }
      applyDeterministicScenePlan(messageId, data.summary, messages, epoch);
      if (sceneOutputMode === "comic") {
        void applyComicDefaultAiPlan({
          messageId,
          summary: data.summary,
          messages,
          epoch,
        });
      }
    } catch (caught) {
      if (!isCurrentSceneSourceEpoch(epoch)) return;
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : "턴 내용을 불러오지 못했습니다.");
    } finally {
      if (isCurrentSceneSourceEpoch(epoch)) {
        setSummarizing(false);
      }
    }
  }

  async function generateComic() {
    if (!info?.ready || generating) return;
    const isIllustration = sceneIsIllustration;
    if (campaignId && !isIllustration) return;
    const sourceText = comicText.trim();
    const summaryText = comicSummary.trim();
    if (!isIllustration && !sourceMessageId && !sourceText) {
      setError("만화로 만들 턴을 선택하거나 내용을 입력해 주세요.");
      return;
    }
    if (!isIllustration && sourceMessageId && !summaryText) {
      setError("선택 턴 내용을 불러오는 중입니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    const comicInput = sourceMessageId ? summaryText : sourceText;
    const comicMaxChars = sourceMessageId
      ? comicLoadedMaxChars || comicInput.length
      : CHAT_COMIC_MAX_INPUT_CHARS;
    if (!isIllustration && comicInput.length > comicMaxChars) {
      setError(
        sourceMessageId
          ? `컷만화로 만들 내용은 불러온 턴 길이(${comicMaxChars.toLocaleString()}자)를 넘길 수 없습니다.`
          : `내용은 최대 ${CHAT_COMIC_MAX_INPUT_CHARS.toLocaleString()}자까지 입력할 수 있습니다.`
      );
      return;
    }
    if (!isIllustration && !trpgCampaignMode && !scenePlan) {
      setError("장면 원본을 불러오는 중입니다. 잠시 후 다시 시도해 주세요.");
      return;
    }

    setGenerating(true);
    setError("");
    setNotice("");
    clearTrpgImageSceneDiagnostics();
    if (isIllustration) setIllustrationResultUrl("");
    else setComicResultUrl("");
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
          messageId: sourceMessageId ?? undefined,
          sourceText: isIllustration
            ? campaignId
              ? comicSummary.trim() || sourceTurnPreview || undefined
              : undefined
            : comicInput || undefined,
          scenePlan: !campaignId ? scenePlan ?? undefined : undefined,
          castIntent:
            !campaignId && castIntent ? castIntent : undefined,
          panelCount:
            !isIllustration && scenePlan
              ? scenePanelCount
              : undefined,
          campaignId: isIllustration && campaignId ? campaignId : undefined,
          roundNumber:
            isIllustration && campaignId && campaignRoundNumber != null
              ? campaignRoundNumber
              : undefined,
          characterImageUrl: selectedCharacterImageUrl || info.character.imageUrl,
          characterAppearanceMode,
          castImagePicks:
            isIllustration && campaignId
              ? partyCast
                  .map((member) => ({
                    participantId: member.participantId,
                    imageUrl: partyPicks[member.participantId] || member.imageUrl || "",
                  }))
                  .filter((pick) => pick.imageUrl)
              : undefined,
          trpgImageSceneMode:
            isIllustration && campaignId ? trpgImageSceneMode : undefined,
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
      if (data.upstreamCostUsd != null && data.upstreamCostKrw != null) {
        setActualCosts((previous) => ({
          ...previous,
          [isIllustration ? "illustration" : "comic"]: {
            usd: data.upstreamCostUsd!,
            krw: data.upstreamCostKrw!,
          },
        }));
      }
      const diagnostics = resolveTrpgImageSceneDiagnosticsFromResponse(data);
      setTrpgImageSceneDiagnostics(diagnostics);
      if (diagnostics && isIllustration && campaignId != null) {
        const generationId =
          typeof data.generationId === "number" && data.generationId > 0
            ? data.generationId
            : null;
        if (generationId) lastTrpgGenerationIdRef.current = generationId;
        const resultIdentity = buildTrpgDiagnosticsResultIdentity({
          generationId,
          imageUrl: data.imageUrl,
        });
        trpgDiagnosticsCacheRef.current = {
          sourceIdentity: buildTrpgDiagnosticsSourceIdentity({
            campaignId,
            roundNumber: campaignRoundNumber,
            sourceMessageId,
          }),
          resultIdentity,
          diagnostics,
        };
      }
      updateBalance(data);
      setNotice(
        isIllustration
          ? campaignId
            ? `선택 턴 일러스트를 만들어 「${campaignTitle || "TRPG"}」 캠페인 앨범에 추가했습니다.`
            : "선택 턴의 핵심 장면으로 2:3 LD 일러스트를 만들어 캐릭터 앨범에 추가했습니다."
          : "승인된 장면 구성으로 컷만화를 만들고 앨범에 추가했습니다."
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

  const modalTitle = trpgCampaignMode ? "선택 턴 일러스트" : "이미지 생성";

  return (
    <>
      {showRailTrigger ? (
        <button
          type="button"
          onClick={() => {
            characterIdOverride = null;
            setCampaignId(null);
            setCampaignRoundNumber(null);
            setCampaignTitle("");
            setPartyNames([]);
            setPartyCast([]);
            setPartyPicks({});
            setPartyPickerId(null);
            setSourceMessageId(null);
            setSourceTurnPreview("");
            setComicSummary("");
            setComicLoadedMaxChars(0);
            beginSceneSourceChange();
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
            if (!saving) setOpen(false);
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
                  disabled={saving}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-lg text-zinc-300 hover:bg-white/10 disabled:opacity-40"
                  aria-label="닫기"
                >
                  ×
                </button>
              </div>
              {!trpgCampaignMode ? (
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
              ) : (
                <p className="mt-2 pb-3 text-[11px] text-zinc-500">
                  캠페인에서는 선택 턴 일러스트만 만들 수 있습니다.
                </p>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {loadingInfo && !info ? (
                <p className="py-12 text-center text-sm text-zinc-400">이미지 정보를 불러오는 중…</p>
              ) : (
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(19rem,0.95fr)]">
                  <div className="space-y-3">
                    {tab === "comic" && !trpgCampaignMode ? (
                      <div className="grid grid-cols-2 gap-1 rounded-xl bg-black/25 p-1">
                        {(
                          [
                            ["scene", "장면 만들기"],
                            ["persona", "페르소나"],
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
                            ? ldProduct === "scene" || ldProduct === "persona"
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
                                : sceneIsIllustration
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
                                : sceneIsIllustration
                                ? "선택 턴 LD 일러스트 참조 이미지"
                                : "2~4컷 만화 예시"
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
                              : sceneIsIllustration
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
                          ? "생성 결과는 864×1440 WebP로 저장되며 아래 버튼으로 내려받을 수 있습니다."
                          : activeSaved
                          ? campaignId
                            ? `「${campaignTitle || "TRPG"}」 캠페인 앨범에 저장된 이미지입니다.`
                            : "캐릭터 앨범에 저장된 이미지입니다."
                          : campaignId
                            ? `생성 결과는 「${campaignTitle || "TRPG"}」 캠페인 앨범에 저장됩니다.`
                          : "생성 결과는 기존 캐릭터 이미지 앨범에 자동으로 추가됩니다."
                        : tab === "comic"
                          ? ldProduct === "persona"
                            ? "선택 페르소나의 성별·외관 설정을 반영하고, 캐릭터 이미지는 그림체만 직접 참조합니다."
                            : ldProduct === "scene"
                            ? campaignId
                              ? `파티 전원${partyNames.length ? `(${partyNames.join(", ")})` : ""}이 한 장면에 함께 나옵니다. 아래에서 멤버마다 참조 이미지를 고르세요. 포인트는 1:1 일러스트와 같습니다.`
                              : "같은 장면 구성으로 한 장 일러스트 또는 컷만화를 만듭니다."
                            : "같은 장면 구성으로 한 장 일러스트 또는 컷만화를 만듭니다."
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
                    {trpgCampaignMode ? (
                      <>
                        <div className="grid grid-cols-2 gap-2">
                          {partyCast.map((member) => {
                            const picked = partyPicks[member.participantId] || member.imageUrl || "";
                            return (
                              <ReferenceCard
                                key={member.participantId}
                                label={member.kind === "human" ? "플레이어" : "캐릭터"}
                                info={{
                                  id: member.participantId,
                                  name: member.name,
                                  imageUrl: picked,
                                }}
                                onClick={
                                  member.images.length > 1
                                    ? () =>
                                        setPartyPickerId((previous) =>
                                          previous === member.participantId
                                            ? null
                                            : member.participantId
                                        )
                                    : undefined
                                }
                              />
                            );
                          })}
                        </div>
                        {partyCast.length === 0 ? (
                          <p className="text-[10px] text-zinc-500">파티 이미지를 불러오는 중…</p>
                        ) : null}
                        {trpgCampaignMode ? (
                          <div className="rounded-xl border border-amber-400/25 bg-amber-950/20 p-3 space-y-2">
                            <p className="text-[10px] font-semibold text-amber-200">
                              장면 초점
                            </p>
                            <div className="flex flex-wrap gap-2 text-[11px]">
                              <label className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2 py-1">
                                <input
                                  type="radio"
                                  name="trpg-image-scene-mode"
                                  checked={trpgImageSceneMode === "RAW"}
                                  onChange={() => {
                                    clearTrpgImageSceneDiagnostics();
                                    setTrpgImageSceneMode("RAW");
                                  }}
                                />
                                CURRENT_RAW
                              </label>
                              <label className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2 py-1">
                                <input
                                  type="radio"
                                  name="trpg-image-scene-mode"
                                  checked={trpgImageSceneMode === "AI_FOCUS"}
                                  onChange={() => {
                                    clearTrpgImageSceneDiagnostics();
                                    setTrpgImageSceneMode("AI_FOCUS");
                                  }}
                                />
                                AI_FOCUS
                              </label>
                            </div>
                            {trpgImageSceneDiagnostics ? (
                              <TrpgImageSceneDiagnosticsPanel
                                diagnostics={trpgImageSceneDiagnostics}
                              />
                            ) : null}
                          </div>
                        ) : null}
                        {partyPickerMember && partyPickerMember.images.length > 1 ? (
                          <div className="rounded-xl border border-violet-400/20 bg-black/25 p-2">
                            <p className="mb-2 text-[10px] font-semibold text-violet-200">
                              {partyPickerMember.name} 참조 이미지
                            </p>
                            <div className="grid max-h-52 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
                              {partyPickerMember.images.map((image) => {
                                const selected =
                                  image.url ===
                                  (partyPicks[partyPickerMember.participantId] ||
                                    partyPickerMember.imageUrl ||
                                    "");
                                return (
                                  <button
                                    key={image.url}
                                    type="button"
                                    onClick={() => {
                                      setPartyPicks((previous) => ({
                                        ...previous,
                                        [partyPickerMember.participantId]: image.url,
                                      }));
                                      setPartyPickerId(null);
                                    }}
                                    className={`overflow-hidden rounded-lg border text-left transition ${
                                      selected
                                        ? "border-violet-400 bg-violet-500/15"
                                        : "border-white/10 bg-white/[0.03] hover:border-white/25"
                                    }`}
                                    aria-label={`${partyPickerMember.name} 이미지 선택: ${image.tag || "이미지"}`}
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
                      </>
                    ) : (
                      <>
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
                                  if (image.url !== selectedCharacterImageUrl) {
                                    setCharacterAppearanceModeOverride(null);
                                  }
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
                    {showAppearanceModeControl ? (
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                        <p className="text-[10px] font-semibold text-zinc-400">외형 기준</p>
                        <div className="mt-1.5 space-y-1 text-[11px] text-zinc-300">
                          <label className="flex items-start gap-2">
                            <input
                              type="radio"
                              name="character-appearance-mode"
                              className="mt-0.5"
                              checked={characterAppearanceMode === "image_only"}
                              disabled={generating}
                              onChange={() => setCharacterAppearanceModeOverride("image_only")}
                            />
                            <span>선택 이미지 기준</span>
                          </label>
                          <label className="flex items-start gap-2">
                            <input
                              type="radio"
                              name="character-appearance-mode"
                              className="mt-0.5"
                              checked={characterAppearanceMode === "image_plus_saved"}
                              disabled={generating}
                              onChange={() =>
                                setCharacterAppearanceModeOverride("image_plus_saved")
                              }
                            />
                            <span>메인 캐릭터 설정 외형도 함께 적용</span>
                          </label>
                        </div>
                        {characterAppearanceMode === "image_plus_saved" ? (
                          <div className="mt-2 text-[10px] leading-relaxed text-zinc-500">
                            <p className="font-semibold text-zinc-400">메인 캐릭터 외형</p>
                            <p className="mt-0.5 whitespace-pre-wrap">
                              {characterAppearanceFull
                                ? characterAppearancePreview.preview
                                : "저장된 캐릭터 외형 설정을 함께 적용합니다."}
                            </p>
                            {characterAppearancePreview.truncated ? (
                              <button
                                type="button"
                                className="mt-1 font-semibold text-violet-300"
                                onClick={() =>
                                  setCharacterAppearancePreviewOpen((previous) => !previous)
                                }
                              >
                                {characterAppearancePreviewOpen ? "접기" : "더 보기"}
                              </button>
                            ) : null}
                            {characterAppearancePreviewOpen &&
                            characterAppearancePreview.truncated ? (
                              <p className="mt-1 whitespace-pre-wrap text-zinc-400">
                                {characterAppearancePreview.full}
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">
                            이번 생성만 선택한 이미지를 기준으로 합니다. 저장된 메인 캐릭터
                            외형은 바꾸지 않습니다.
                          </p>
                        )}
                      </div>
                    ) : null}
                      </>
                    )}
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
                              캐릭터 이미지는 외형이 아니라 그림체 참조로만 전달됩니다. 864×1440(3:5)로 직접 생성하고, 공급자 응답 크기가 다를 때만 중앙 기준으로 안전하게 보정합니다.
                            </p>
                          </div>
                        ) : null}
                        {ldProduct === "scene" && campaignId ? (
                          <div className="space-y-2 rounded-xl border border-violet-400/20 bg-violet-500/[0.06] p-3 text-[11px] leading-relaxed text-zinc-300">
                            <p>
                              <strong className="text-violet-200">
                                「{campaignTitle || "TRPG"}」 캠페인 앨범
                              </strong>
                              {" · "}
                              {partyNames.length
                                ? `${partyNames.join(", ")}이(가) 한 장면에 함께 나옵니다.`
                                : "유저 포함 파티 전원(최대 4명)이 한 장면에 함께 나옵니다."}
                              {" "}멤버마다 참조 이미지를 고를 수 있고, 포인트는 1:1 선택 턴 일러스트와 같습니다.
                              {" "}
                              <Link
                                href={`/albums?campaignId=${campaignId}`}
                                className="font-semibold text-violet-200 underline decoration-violet-400/40 underline-offset-2 hover:text-white"
                              >
                                캠페인 앨범 보기
                              </Link>
                            </p>
                          </div>
                        ) : null}
                        {ldProduct === "scene" && !campaignId ? (
                          <ChatSceneBuilder
                            sourcePreview={comicSummary || sourceTurnPreview}
                            sourceLoading={summarizing}
                            plan={scenePlan}
                            planLoading={summarizing}
                            aiSuggestedPlan={aiSuggestedPlan}
                            aiSuggestionLoading={aiSuggestionLoading}
                            aiSuggestionError={aiSuggestionError}
                            hasAiSuggestionSession={hasAiSuggestionSession}
                            castManifest={castIntent}
                            selectableAssets={selectableCastAssets}
                            visualSubjects={activeVisualSubjects}
                            reservedReferenceUrls={reservedCastReferenceUrls}
                            contentKind={contentKind}
                            personaName={info?.persona?.name ?? "유저"}
                            characterName={info?.character.name ?? "캐릭터"}
                            outputMode={sceneOutputMode}
                            panelCount={scenePanelCount}
                            disabled={generating}
                            onOutputModeChange={(mode) => {
                              setSceneOutputMode(mode);
                              if (!scenePlan) return;
                              if (mode === "comic") {
                                scenePlanUserEditedRef.current = false;
                                setScenePlan(
                                  reflowScenePlanPanels(scenePlan, scenePanelCount)
                                );
                                void applyComicDefaultAiPlan({
                                  messageId: sourceMessageId,
                                  summary: comicSummary || sourceTurnPreview,
                                  messages: sceneMessages,
                                  epoch: sceneSourceEpochRef.current,
                                });
                              }
                            }}
                            onPanelCountChange={(count) => {
                              commitPanelCount(count);
                              if (!scenePlan) return;
                              scenePlanUserEditedRef.current = false;
                              setScenePlan(reflowScenePlanPanels(scenePlan, count));
                            }}
                            onPlanChange={(nextPlan) => {
                              scenePlanUserEditedRef.current = true;
                              setScenePlan(nextPlan);
                            }}
                            onCastChange={setCastIntent}
                            onRequestAiSuggestion={() => {
                              void requestAiSceneSuggestion({
                                messageId: sourceMessageId,
                                summary: comicSummary || sourceTurnPreview,
                                messages: sceneMessages,
                                force: hasAiSuggestionSession,
                                epoch: sceneSourceEpochRef.current,
                              });
                            }}
                            onApplyAiSuggestion={applyAiSceneSuggestion}
                            onCancelAiSuggestion={cancelAiSceneSuggestion}
                          />
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
                                : sceneIsIllustration
                                ? [{
                                    label: "선택 턴 LD 일러스트",
                                    cost: info.averageCosts.illustration,
                                  }]
                                : CHAT_COMIC_PANEL_OPTIONS.map(({ id: panelCount }) => ({
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
                            (ldProduct === "scene" &&
                              !campaignId &&
                              (!scenePlan || summarizing)) ||
                            (info?.balance != null &&
                              info.balance.total < activePrice)
                          }
                          className="w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {generating
                            ? ldProduct === "persona"
                              ? "페르소나 이미지 생성 중…"
                              : sceneIsIllustration
                                ? "장면 일러스트 생성 중…"
                                : "컷만화 생성 중…"
                            : activeResultUrl
                              ? `다시 생성 · ${activePrice.toLocaleString()}P`
                              : `${
                                  ldProduct === "persona"
                                    ? "페르소나 이미지 생성"
                                    : sceneIsIllustration
                                    ? "한 장 일러스트 생성"
                                    : "컷만화 생성"
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
                        이미지를 생성하고 있습니다. 이 창을 닫고 채팅을 계속해도 생성은 계속되고,
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
