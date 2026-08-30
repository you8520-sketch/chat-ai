"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type Ref,
} from "react";
import Link from "next/link";
import { AppSectionCard } from "@/components/AppPageShell";
import ChatSelectionQuoteToolbar from "@/components/ChatSelectionQuoteToolbar";
import { TRPG_VISIBLE_ACTION_TYPES, actionTypeLabelKo, type TrpgActionType } from "@/lib/trpg/actionTypes";
import {
  RECOVERY_DISCOVERY_HINT,
  SAFE_REST_COOLDOWN_HINT,
  SAFE_REST_ONGOING_NOTICE,
  contextualFirstAidDraft,
  contextualStatusTreatDraft,
  showContextualStatusTreat,
  contextualSafeRestDraft,
  showContextualFirstAid,
} from "@/lib/trpg/actionComposer";
import { parseTrpgBotAction } from "@/lib/trpg/botActionParse";
import {
  CHAT_GLOBAL_HEADER_OFFSET_CLASS,
  CHAT_ROOM_HEADER_OFFSET_CLASS,
  DEFAULT_CHAT_DISPLAY_PREFS,
  chatReadabilityRootStyle,
  ensureChatDisplayWebFontsLoaded,
  loadChatDisplayPrefs,
  saveChatDisplayPrefs,
  type ChatDisplayPrefs,
} from "@/lib/chatDisplayPrefs";
import { cacheUserChatPrefsClient, loadUserChatPrefsClient, type UserChatPrefs } from "@/lib/userChatPrefs";
import {
  loadTrpgDisplayPrefs,
  loadTrpgStreamIntervalMs,
  saveTrpgStreamIntervalMs,
} from "@/lib/trpg/displayPrefs";
import { mergeTrpgActionRolls, orphanTrpgRolls } from "@/lib/trpg/actionCardRolls";
import {
  resolveTrpgD20Tone,
  trpgActionCardCompactName,
  trpgRollOutcomeLabel,
} from "@/lib/trpg/actionCardUi";
import { formatTrpgRollCompact, trpgBillingModeLabel } from "@/lib/trpg/labels";
import { viewerSelfSheetCard } from "@/lib/trpg/partySheetPresentation";
import { parseTrpgSceneSpeech } from "@/lib/trpg/sceneSpeech";
import { trpgSceneBeatSpacingClass } from "@/lib/trpg/trpgSceneBeatSpacing";
import type { CharacterAsset } from "@/lib/characterAssets";
import type { TrpgPublicAiCharacterAssets } from "@/lib/trpg/aiCharacterContext";
import { loadUnlockedCharacterAssetUrls } from "@/lib/characterAssetUnlocks";
import { sanitizeTrpgActionDisplayText } from "@/lib/trpg/gmSceneAssets";
import type { TrpgCampaignSnapshot, TrpgPublicLog, TrpgPublicRoll } from "@/lib/trpg/snapshot";
import type { TrpgStatDefinition } from "@/lib/trpg/types";
import { TRPG_ACTION_MAX_CHARS } from "@/lib/trpg/types";
import { replyStanceLabelKo, type TrpgReplySuggestion } from "@/lib/trpg/replySuggestionShared";
import {
  isTrpgDicePreviewRuntime,
  logTrpgDicePreviewInstrument,
  previewDiceRollKey,
  resolveCampaignDicePreviewOverlay,
} from "@/lib/trpg/dicePreviewTheme";
import {
  hideCurrentRoundResults,
  holdCurrentRoundReveal,
  IDLE_DICE_PRESENTATION,
  nextDicePresentation,
  nextDiceRevealGateState,
  resolveDiceRevealGateReleaseReason,
  shouldHideIncomingRollSession,
  type TrpgDicePresentation,
  type TrpgDiceRevealGateReleaseReason,
  type TrpgDiceRevealGateState,
} from "@/lib/trpg/diceRevealGate";
import {
  shouldConsumeMountRollSession,
  activePresentationDiceSessionKey,
  overlayPresentationDismissed,
  trpgDiceRevealWatchdogMs,
  trpgDiceRollSessionKey,
} from "@/lib/trpg/diceRollUx";
import {
  activePresentationRollProgress,
  activePresentationRoll,
  advanceAfterActorResult,
  buildRoundPresentationActors,
  decideRoundPresentationMode,
  freezeLivePresentationActors,
  historicalPresentation,
  idlePresentation,
  resolveLiveActorDeclarationPresentation,
  isActorActionRevealBeatSatisfied,
  isActorPresentationReady,
  shouldDecorativeRevealAction,
  isRoundPresentationAwaitingMoreActors,
  isLiveRoundPresentationStarting,
  isRoundPresentationComplete,
  liveRoundCanonicalVisibleCount,
  liveRoundWaitCopy,
  liveRoundWaitKind,
  shouldShowLiveRoundWaitCopy,
  resultLaneActorIds,
  revealedActorIds,
  shouldShowActionJudgeBlock,
  ROUND_RESULT_HOLD_MS,
  resolveLiveActorPresentationTransition,
  resolveParticipantAdjudicationOutcome,
  selectVisibleActions,
  shouldGateLiveRoundPresentation,
  shouldShowGmNarration,
  startCinematicPresentation,
  trpgRoundPresentationSessionKey,
  trpgRoundPresentationWatchdogMs,
  type PresentationActor,
  type RoundPresentationState,
} from "@/lib/trpg/roundPresentation";
import {
  beginHiddenPresentationSession,
  catchUpHiddenPresentationState,
  isHiddenPresentationCatchUpActive,
  hiddenPresentationSessionStillActive,
  presentationStateEquals,
  shouldSkipDecorativeReveal,
  type HiddenPresentationSession,
} from "@/lib/trpg/presentationHiddenCatchUp";
import {
  decideLiveFollowOnGrowth,
  decideLiveFollowUpdate,
  decidePassiveScrollFollowUpdate,
  shouldDetachLiveFollowOnKey,
  shouldDetachLiveFollowOnTouchDelta,
  shouldDetachLiveFollowOnWheel,
  beginTrpgProgrammaticScroll,
  cancelTrpgProgrammaticScroll,
  createTrpgProgrammaticScrollHandle,
  isNearBottom,
  isNearPresentationCard,
  isNearReadingBandFollowElement,
  isTrpgScrollIntentKey,
  liveFreshGmNarrationRow,
  livePresentationActivityKey,
  readingBandFollowDeltaFromElement,
  resolveTrpgLiveFollowOwner,
  resolveEffectiveGmRevealComplete,
  resolveEffectiveActorRevealComplete,
  mergeActorRevealReport,
  shouldDetachLiveFollowOnUserIntent,
  shouldShowTrpgReplySuggestions,
  shouldSkipRevealFinishClick,
  type ActorRevealReport,
  type GmRevealReport,
  type TrpgLiveFollowOwner,
} from "@/lib/trpg/followLatest";
import {
  formatLiveTurnProcessStatus,
  isLiveTurnCinematicMotion,
  isLiveTurnProcessing,
  liveTurnBotProgress,
  liveTurnProcessStage,
  nextLiveTurnElapsedSec,
} from "@/lib/trpg/liveTurnStatus";
import { processElapsedSecFromStartedAt } from "@/lib/trpg/processTimer";
import TrpgCampaignTitle from "./TrpgCampaignTitle";
import TrpgCampaignRail from "./TrpgCampaignRail";
import TrpgUserChatPanel from "./TrpgUserChatPanel";
import TrpgDiceOverlay, { type TrpgDiceOverlayPlaybackState } from "./TrpgDiceOverlay";
import TrpgRollResultLane from "./TrpgRollResultLane";
import TrpgNamedProse, { TrpgGmTalk, quoteSelectStyle } from "./TrpgNamedProse";
import { resolveTrpgMountSeenKeys, useRevealedText } from "./useRevealedText";
import TrpgSceneToolbar from "./TrpgSceneToolbar";
import TrpgSelfSheetHud from "./TrpgSelfSheetHud";
import {
  resolveTrpgGmContentStreaming,
  resolveTrpgGmLiveAssetResolution,
  resolveTrpgGmPacingSource,
  resolveTrpgGmRevealActive,
  resolveTrpgGmRevealComplete,
  resolveTrpgGmShownNarration,
} from "@/lib/trpg/gmProviderStreamDisplay";
import {
  createPresentationSession,
  deriveAdjudicatedParticipantIdsFromLogRow,
  deriveExpectedPresentationActorIdsFromLogRow,
  deriveParticipantAdjudicationOutcomesFromLogRow,
  derivePresentationSceneTurnLiveProps,
  deriveResolutionOrderFromLogRow,
  filterRevealedActions,
  findPresentationLogRow,
  inferHeldPresentationRoundFromLog,
  isPresentationSessionReleased,
  nextReleasedPresentationRoundWatermark,
  presentationSessionMetadata,
  resolvePresentationLiveReady,
  resolvePresentationRoundNumber,
  resolvePresentationSourceRolls,
  shouldLatchPresentationRound,
  shouldShowNextActionInput,
  type LivePresentationSession,
} from "@/lib/trpg/presentationSession";

function useCampaignDicePreview(
  snap: TrpgCampaignSnapshot
): {
  phase: string;
  rolls: readonly TrpgPublicRoll[];
  inject: boolean;
  instrument: boolean;
  ready: boolean;
} {
  const [query, setQuery] = useState<{
    previewEnabled: boolean;
    queryPreview: string | null;
    queryPreviewD20: string | null;
  } | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setQuery({
      previewEnabled: isTrpgDicePreviewRuntime({
        nodeEnv: process.env.NODE_ENV,
        previewFlag: process.env.NEXT_PUBLIC_TRPG_DICE_PREVIEW,
        hostname: window.location.hostname,
      }),
      queryPreview: params.get("dicePreview"),
      queryPreviewD20: params.get("dicePreviewD20"),
    });
  }, []);
  const fixtureName =
    snap.sheets.find((card) => card.isSelf)?.sheet.name.trim() ||
    snap.participants.find((p) => p.id === snap.viewerParticipantId)?.displayName.trim() ||
    "권태현";
  if (!query) {
    return {
      phase: snap.round.phase,
      rolls: snap.currentRolls,
      inject: false,
      instrument: false,
      ready: false,
    };
  }
  const resolved = resolveCampaignDicePreviewOverlay({
    previewEnabled: query.previewEnabled,
    queryPreview: query.queryPreview,
    queryPreviewD20: query.queryPreviewD20,
    phase: snap.round.phase,
    currentRolls: snap.currentRolls,
    fixtureName,
  });
  return { ...resolved, instrument: query.previewEnabled, ready: true };
}

function imageCharacterId(snap: TrpgCampaignSnapshot): number | null {
  const companion = snap.participants.find((p) => p.kind === "ai_character" && p.characterId);
  if (companion?.characterId) return companion.characterId;
  return snap.sourceCharacterId;
}

function partyDisplayNames(snap: TrpgCampaignSnapshot): string[] {
  return snap.participants
    .map((p) => {
      const sheet = snap.sheets.find((card) => card.participantId === p.id);
      return (sheet?.sheet.name.trim() || p.displayName.trim());
    })
    .filter(Boolean);
}

function viewerSpeechNames(snap: TrpgCampaignSnapshot): string[] {
  const names: string[] = [];
  const sheet = snap.sheets.find((card) => card.isSelf)?.sheet.name.trim();
  if (sheet) names.push(sheet);
  const mine = snap.participants.find((p) => p.id === snap.viewerParticipantId);
  if (mine?.displayName.trim()) names.push(mine.displayName.trim());
  return names;
}

function speechVariant(speaker: string | null, selfNames: readonly string[]): "user" | "character" {
  const n = speaker?.trim();
  if (!n) return "character";
  const aliases = new Set<string>();
  for (const name of selfNames) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    aliases.add(trimmed);
    if (/^[가-힣]{3,4}$/.test(trimmed)) aliases.add(trimmed.slice(1));
  }
  if (aliases.has(n)) return "user";
  if (/^[가-힣]{3,4}$/.test(n) && aliases.has(n.slice(1))) return "user";
  return "character";
}

function openSceneImage(opts: {
  characterId: number | null;
  campaignId: number;
  campaignTitle: string;
  roundNumber: number;
  content: string;
  partyNames: string[];
}) {
  if (!opts.characterId) return;
  window.dispatchEvent(
    new CustomEvent("chat:image-generator:open", {
      detail: {
        characterId: opts.characterId,
        campaignId: opts.campaignId,
        campaignTitle: opts.campaignTitle,
        roundNumber: opts.roundNumber,
        content: opts.content,
        partyNames: opts.partyNames,
      },
    })
  );
}

export default function TrpgCampaignRoom({
  snap,
  starting,
  generating,
  busy,
  error,
  actionType,
  actionBody,
  partyBody,
  suggestions,
  suggestionsBusy,
  suggestionsError,
  suggestionsEnabled,
  onActionTypeChange,
  onActionBodyChange,
  onPartyBodyChange,
  onToggleSuggestions,
  onRetrySuggestions,
  onPickSuggestion,
  onSendAction,
  onSendParty,
  onRetryBots,
  onRetryGm,
  onReroll,
  onTitleSaved,
  onBillingModeChange,
}: {
  snap: TrpgCampaignSnapshot;
  starting: boolean;
  generating: boolean;
  busy: boolean;
  error: string;
  actionType: TrpgActionType;
  actionBody: string;
  partyBody: string;
  onActionTypeChange: (value: TrpgActionType) => void;
  onActionBodyChange: (value: string) => void;
  onPartyBodyChange: (value: string) => void;
  suggestions: TrpgReplySuggestion[];
  suggestionsBusy: boolean;
  suggestionsError: string;
  suggestionsEnabled: boolean;
  onToggleSuggestions: () => void;
  onRetrySuggestions: () => void;
  onPickSuggestion: (suggestion: TrpgReplySuggestion) => void;
  onSendAction: () => void;
  onSendParty: () => void;
  onRetryBots: () => void;
  onRetryGm: () => void;
  onReroll: (roundNumber: number) => void;
  onTitleSaved: (title: string) => void;
  onBillingModeChange?: (mode: TrpgCampaignSnapshot["billingMode"]) => void;
}) {
  const [displayPrefs, setDisplayPrefs] = useState<ChatDisplayPrefs>(DEFAULT_CHAT_DISPLAY_PREFS);
  const [streamIntervalMs, setStreamIntervalMs] = useState(DEFAULT_CHAT_DISPLAY_PREFS.streamIntervalMs);
  const [toast, setToast] = useState("");
  const quoteSelectContainerRef = useRef<HTMLDivElement>(null);
  const suggestionsAnchorRef = useRef<HTMLDivElement>(null);
  const nextActionRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const narrationStartRef = useRef<HTMLDivElement | null>(null);
  const narrationEndRef = useRef<HTMLSpanElement | null>(null);
  const declarationEndRef = useRef<HTMLSpanElement | null>(null);
  const declarationGrowthRef = useRef<HTMLDivElement | null>(null);
  const activePresentationCardRef = useRef<HTMLDivElement | null>(null);
  const liveGmRevealStateRef = useRef({ complete: false, progressive: false });
  const narrationFollowRafRef = useRef<number | null>(null);
  const followScrollRafRef = useRef<number | null>(null);
  const manualScrollDetachedRef = useRef(false);
  const hasLeftFollowZoneSinceDetachRef = useRef(false);
  const programmaticScrollRef = useRef(false);
  const programmaticScrollHandleRef = useRef(createTrpgProgrammaticScrollHandle());
  const hasScrolledToLatestRef = useRef<number | null>(null);
  const followLatestRef = useRef(true);
  const seenSceneLenRef = useRef(0);
  const seenActivityKeyRef = useRef("");
  const liveSceneRef = useRef<HTMLElement | null>(null);
  const currentNarrationRef = useRef("");
  const liveFreshGmRoundRef = useRef<number | null>(null);
  const [gmRevealReport, setGmRevealReport] = useState<GmRevealReport>({
    roundNumber: null,
    complete: false,
    progressive: false,
  });
  const [actorRevealReport, setActorRevealReport] = useState<ActorRevealReport>({
    roundNumber: null,
    participantId: null,
    complete: false,
    progressive: false,
  });
  const [documentHidden, setDocumentHidden] = useState(
    () => typeof document !== "undefined" && document.visibilityState === "hidden"
  );
  const [hiddenPresentationSession, setHiddenPresentationSession] =
    useState<HiddenPresentationSession | null>(null);
  const [consumedDecorativeSessionKey, setConsumedDecorativeSessionKey] = useState<string | null>(null);
  const [declarationRevealEpoch, setDeclarationRevealEpoch] = useState(0);
  const [followLatest, setFollowLatest] = useState(true);
  const [unseenLatest, setUnseenLatest] = useState(false);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accountPrefsRef = useRef<Pick<UserChatPrefs, "targetResponseChars" | "novelModeEnabled"> | null>(
    null
  );
  const [roundShow, setRoundShow] = useState<RoundPresentationState>(idlePresentation());
  const serverRoundNumber = snap.round.number;
  const phase = snap.round.phase;
  const dicePreview = useCampaignDicePreview(snap);
  const [presentationSession, setPresentationSession] = useState<LivePresentationSession | null>(null);
  const releasedPresentationRoundRef = useRef(0);
  const latchedPresentationSessionKeyRef = useRef<string | null>(null);
  const releasedPresentationRoundWatermark = releasedPresentationRoundRef.current;
  const inferredHeldPresentationRound = inferHeldPresentationRoundFromLog({
    serverRoundNumber,
    serverPhase: String(phase),
    log: snap.log,
    roundShow,
    releasedPresentationRoundWatermark,
  });
  const presentationRoundNumber = resolvePresentationRoundNumber({
    serverRoundNumber,
    session: presentationSession,
    roundShow,
    inferredHeldRound: inferredHeldPresentationRound,
    releasedPresentationRoundWatermark,
  });
  const presentationLogRow = useMemo(
    () => findPresentationLogRow(snap.log, presentationRoundNumber),
    [snap.log, presentationRoundNumber]
  );
  const currentLogRow = useMemo(
    () => snap.log.find((row) => row.roundNumber === serverRoundNumber) ?? null,
    [snap.log, serverRoundNumber]
  );
  const sessionMeta = presentationSessionMetadata({
    session: presentationSession,
    presentationRoundNumber,
    serverRoundNumber,
    serverExpectedPresentationActorIds: snap.round.expectedPresentationActorIds ?? [],
    serverResolutionOrder: (snap.resolutionOrder ?? []).map((entry) => entry.participantId),
  });
  const presentationResolutionOrder = sessionMeta.resolutionOrder;
  const expectedPresentationActorIds = sessionMeta.expectedPresentationActorIds;
  const sourceActions = useMemo(() => {
    if (presentationRoundNumber !== serverRoundNumber) {
      return filterRevealedActions(presentationLogRow?.actions ?? []);
    }
    return filterRevealedActions(currentLogRow?.actions ?? []);
  }, [currentLogRow, presentationLogRow, presentationRoundNumber, serverRoundNumber]);
  const sourceRolls = useMemo(
    () =>
      resolvePresentationSourceRolls({
        presentationRoundNumber,
        serverRoundNumber,
        presentationLogRow,
        serverCurrentRolls: snap.currentRolls,
        dicePreviewRolls: dicePreview.rolls,
      }),
    [
      dicePreview.rolls,
      presentationLogRow,
      presentationRoundNumber,
      serverRoundNumber,
      snap.currentRolls,
    ]
  );
  const presentationAdjudicatedIds = useMemo((): number[] =>
    presentationRoundNumber !== serverRoundNumber
      ? deriveAdjudicatedParticipantIdsFromLogRow(presentationLogRow)
      : (snap.adjudicatedParticipantIds ?? []),
    [presentationLogRow, presentationRoundNumber, serverRoundNumber, snap.adjudicatedParticipantIds]
  );
  const liveReady = resolvePresentationLiveReady({
    presentationRoundNumber,
    serverRoundNumber,
    serverPhase: String(phase),
    sourceActions,
    sourceRolls,
    resolutionOrder: presentationResolutionOrder,
    adjudicatedParticipantIds: presentationAdjudicatedIds,
  });
  const rollSessionKey = useMemo(
    () => trpgDiceRollSessionKey(presentationRoundNumber, sourceRolls),
    [presentationRoundNumber, sourceRolls]
  );
  const adjudicatedParticipantIds = useMemo(
    () => new Set(presentationAdjudicatedIds),
    [presentationAdjudicatedIds]
  );
  const participantAdjudicationOutcomes = useMemo(() => {
    if (presentationRoundNumber !== serverRoundNumber) {
      return deriveParticipantAdjudicationOutcomesFromLogRow(presentationLogRow);
    }
    return new Map(
      Object.entries(snap.participantAdjudicationOutcomes ?? {}).map(([id, outcome]) => [
        Number(id),
        outcome,
      ])
    );
  }, [
    presentationLogRow,
    presentationRoundNumber,
    serverRoundNumber,
    snap.participantAdjudicationOutcomes,
  ]);
  const seenLogKeysRef = useRef<Set<string> | null>(null);
  if (seenLogKeysRef.current === null) {
    seenLogKeysRef.current = new Set(
      resolveTrpgMountSeenKeys({
        log: snap.log,
        currentRoundNumber: snap.round.number,
        liveReady,
      })
    );
  }
  const declarationConsumedIds = useMemo(
    () =>
      new Set(
        sourceActions
          .filter(
            (action) =>
              action.kind === "ai_character" &&
              seenLogKeysRef.current!.has(`a:${presentationRoundNumber}:${action.participantId}`)
          )
          .map((action) => action.participantId)
      ),
    [declarationRevealEpoch, presentationRoundNumber, sourceActions]
  );
  const frozenActorsRef = useRef<{ round: number; actors: PresentationActor[] } | null>(null);
  const liveActors = useMemo(
    () =>
      buildRoundPresentationActors({
        resolutionOrder: presentationResolutionOrder,
        actions: sourceActions,
        rolls: sourceRolls,
      }),
    [presentationResolutionOrder, sourceActions, sourceRolls]
  );
  const frozenActors = freezeLivePresentationActors({
    previous:
      frozenActorsRef.current?.round === presentationRoundNumber ? frozenActorsRef.current.actors : null,
    next: liveActors,
    ready: liveReady,
    roundNumber: presentationRoundNumber,
    frozenRound: frozenActorsRef.current?.round ?? null,
  });
  frozenActorsRef.current = liveReady
    ? { round: presentationRoundNumber, actors: frozenActors.actors }
    : frozenActorsRef.current?.round === presentationRoundNumber
      ? frozenActorsRef.current
      : null;
  const presentationActors = frozenActors.actors;
  const awaitingMorePresentationActors =
    presentationRoundNumber !== serverRoundNumber
      ? false
      : isRoundPresentationAwaitingMoreActors({
          phase: String(phase),
          workType: snap.workType,
          botGenerationInFlight: snap.botGenerationInFlight,
        });
  const queueSessionKey = useMemo(
    () =>
      trpgRoundPresentationSessionKey({
        roundNumber: presentationRoundNumber,
        rolls: sourceRolls,
        actions: sourceActions,
        ready: liveReady,
      }),
    [liveReady, presentationRoundNumber, sourceActions, sourceRolls]
  );
  const queueKeyRef = useRef("");
  const presentationActorKey = presentationActors
    .map((actor) => `${actor.actorId}:${actor.roll?.participantId ?? 0}:${actor.roll?.d20 ?? 0}`)
    .join("|");
  const [overlayPlayback, setOverlayPlayback] = useState<TrpgDiceOverlayPlaybackState>({
    visible: false,
    settled: false,
    dismissed: true,
    roundNumber: presentationRoundNumber,
    sessionKey: "",
  });
  const handleOverlayPlaybackChange = useCallback((state: TrpgDiceOverlayPlaybackState) => {
    setOverlayPlayback(state);
  }, []);
  const [presentation, setPresentation] = useState<TrpgDicePresentation>(IDLE_DICE_PRESENTATION);
  const firstKeyObservationRef = useRef(true);
  const previewTimesRef = useRef({
    rollObservedAt: 0,
    gateHeldAt: 0,
    overlayVisibleAt: 0,
    overlayDismissedAt: 0,
    firstResultVisibleAt: 0,
    firstNarrationVisibleAt: 0,
    phaseAtFirstRollObservation: "",
  });
  const cinematicActiveRoll = useMemo(() => {
    if (roundShow.mode !== "cinematic" || roundShow.phase !== "actor-dice") return null;
    return presentationActors[roundShow.presentationIndex]?.roll ?? null;
  }, [presentationActors, roundShow.mode, roundShow.phase, roundShow.presentationIndex]);
  const presentationDiceSessionKey = useMemo(
    () =>
      activePresentationDiceSessionKey({
        roundNumber: presentationRoundNumber,
        mode: roundShow.mode,
        phase: roundShow.phase,
        activeRoll: cinematicActiveRoll,
        aggregateRollSessionKey: rollSessionKey,
      }),
    [cinematicActiveRoll, presentationRoundNumber, rollSessionKey, roundShow.mode, roundShow.phase]
  );
  useEffect(() => {
    if (!dicePreview.ready) return;
    const isFirstObservation = firstKeyObservationRef.current;
    firstKeyObservationRef.current = false;
    const mountConsume = shouldConsumeMountRollSession({
      rollSessionKey: queueSessionKey || rollSessionKey,
      replayOnMount: dicePreview.inject,
      isFirstObservation,
    });
    const mode = decideRoundPresentationMode({
      consumeOnMount: mountConsume,
      actorCount: liveReady ? presentationActors.length : 0,
    });
    if (queueKeyRef.current !== queueSessionKey || (roundShow.mode === "idle" && mode !== "idle")) {
      queueKeyRef.current = queueSessionKey;
      setHiddenPresentationSession(null);
      setConsumedDecorativeSessionKey(null);
      if (mode === "historical") setRoundShow(historicalPresentation());
      else if (mode === "cinematic") setRoundShow({ mode: "cinematic", ...startCinematicPresentation() });
      else setRoundShow(idlePresentation());
    }
    setPresentation((prev) =>
      nextDicePresentation(prev, {
        rollSessionKey,
        roundNumber: presentationRoundNumber,
        overlayVisible: overlayPlayback.visible,
        overlaySettled: overlayPlayback.settled,
        overlayDismissed: overlayPresentationDismissed({
          overlayDismissed: overlayPlayback.dismissed,
          overlaySessionKey: overlayPlayback.sessionKey,
          presentationDiceSessionKey,
        }),
        mountConsume,
        roundPresentationComplete: isRoundPresentationComplete(roundShow),
      })
    );
    if (dicePreview.instrument && rollSessionKey && isFirstObservation === false && !mountConsume) {
      const times = previewTimesRef.current;
      if (!times.rollObservedAt) {
        times.rollObservedAt = Date.now();
        times.phaseAtFirstRollObservation = String(phase);
      }
    }
  }, [
    dicePreview.inject,
    dicePreview.instrument,
    dicePreview.ready,
    overlayPlayback.dismissed,
    overlayPlayback.sessionKey,
    overlayPlayback.settled,
    overlayPlayback.visible,
    phase,
    liveReady,
    presentationActors.length,
    presentationDiceSessionKey,
    queueSessionKey,
    rollSessionKey,
    roundShow,
    presentationRoundNumber,
  ]);
  useEffect(() => {
    if (
      !shouldLatchPresentationRound({
        latchRound: presentationRoundNumber,
        releasedPresentationRoundWatermark,
        roundShow,
        queueSessionKey,
        latchedPresentationSessionKey: latchedPresentationSessionKeyRef.current,
      })
    ) {
      if (roundShow.mode !== "cinematic") {
        latchedPresentationSessionKeyRef.current = null;
      }
      return;
    }
    latchedPresentationSessionKeyRef.current = queueSessionKey;
    const latchRound = presentationRoundNumber;
    const latchLogRow = findPresentationLogRow(snap.log, latchRound);
    const latchResolutionOrder =
      latchRound === serverRoundNumber
        ? (snap.resolutionOrder ?? []).map((entry) => entry.participantId)
        : deriveResolutionOrderFromLogRow(latchLogRow);
    const latchExpected =
      latchRound === serverRoundNumber
        ? (snap.round.expectedPresentationActorIds ?? [])
        : deriveExpectedPresentationActorIdsFromLogRow(latchLogRow, latchResolutionOrder);
    setPresentationSession(
      createPresentationSession({
        roundNumber: latchRound,
        expectedPresentationActorIds: latchExpected,
        resolutionOrder: latchResolutionOrder,
      })
    );
  }, [
    presentationRoundNumber,
    queueSessionKey,
    releasedPresentationRoundWatermark,
    roundShow.mode,
    serverRoundNumber,
    snap.log,
    snap.resolutionOrder,
    snap.round.expectedPresentationActorIds,
  ]);
  useEffect(() => {
    if (roundShow.mode !== "cinematic" || roundShow.phase !== "actor-dice") return;
    const current = presentationActors[roundShow.presentationIndex];
    const activeKey = current?.roll
      ? trpgDiceRollSessionKey(presentationRoundNumber, [current.roll])
      : "";
    const decision = resolveLiveActorPresentationTransition({
      mode: roundShow.mode,
      phase: roundShow.phase,
      presentationIndex: roundShow.presentationIndex,
      actors: presentationActors,
      rolls: sourceRolls,
      adjudicatedParticipantIds,
      declarationConsumedIds,
      participantAdjudicationOutcomes,
      awaitingMoreActors: awaitingMorePresentationActors,
      expectedPresentationActorIds,
      overlayDismissed: overlayPlayback.dismissed,
      overlaySessionKey: overlayPlayback.sessionKey,
      activeRollSessionKey: activeKey,
    });
    if (decision.kind !== "transition") return;
    setRoundShow((prev) => {
      if (prev.mode !== "cinematic" || prev.phase !== "actor-dice") return prev;
      return { ...prev, ...decision.next };
    });
  }, [
    overlayPlayback.dismissed,
    overlayPlayback.sessionKey,
    adjudicatedParticipantIds,
    awaitingMorePresentationActors,
    declarationConsumedIds,
    expectedPresentationActorIds,
    participantAdjudicationOutcomes,
    presentationActors,
    roundShow.mode,
    roundShow.phase,
    roundShow.presentationIndex,
    sourceRolls,
    snap.round.number,
  ]);
  const incomingSessionHidden = shouldHideIncomingRollSession({
    rollSessionKey,
    presentationSessionKey: presentation.sessionKey,
    isFirstObservation: firstKeyObservationRef.current,
    replayOnMount: dicePreview.inject,
  });
  const hideCurrentResults =
    hideCurrentRoundResults(presentation, presentationRoundNumber) || incomingSessionHidden;
  const revealWatchdogMs = Math.max(
    trpgDiceRevealWatchdogMs(snap.currentRolls.length),
    trpgRoundPresentationWatchdogMs({
      actorCount: presentationActors.length,
      rollCount: dicePreview.rolls.length,
    })
  );
  const [revealGate, setRevealGate] = useState<TrpgDiceRevealGateState>({ gatedRound: null, holding: false });
  const [revealGateReleased, setRevealGateReleased] = useState(true);
  const [revealGateReleaseReason, setRevealGateReleaseReason] = useState<TrpgDiceRevealGateReleaseReason | null>(
    null
  );
  useEffect(() => {
    setRevealGate((prev) =>
      nextDiceRevealGateState(prev, {
        roundNumber: presentationRoundNumber,
        presentation,
      })
    );
  }, [presentation, presentationRoundNumber]);
  useEffect(() => {
    if (!hideCurrentResults) {
      if (presentation.state === "dismissed") {
        setRevealGateReleased(true);
        setRevealGateReleaseReason("dismissed");
      } else {
        setRevealGateReleased(true);
        setRevealGateReleaseReason(null);
      }
      return;
    }
    setRevealGateReleased(false);
    const id = window.setTimeout(() => {
      setRevealGateReleased(true);
      setRevealGateReleaseReason("watchdog");
    }, revealWatchdogMs);
    return () => window.clearTimeout(id);
  }, [hideCurrentResults, presentation.state, revealWatchdogMs]);
  // #509 Outcome B: passive first-ready visibility shield only.
  // Must not own actor order, action-beat advance, dice, result, or GM.
  const holdCurrentRound = holdCurrentRoundReveal({
    incomingSessionHidden,
    presentationHidesRound: hideCurrentRoundResults(presentation, presentationRoundNumber),
    revealGateReleased,
  });
  const gatedRoundNumber = holdCurrentRound ? presentationRoundNumber : null;
  const waitingOthers = snap.workType === "wait_humans";
  const livePending =
    !liveReady &&
    (sourceActions.length > 0 ||
      snap.myDraft?.locked === true ||
      phase === "BOT_ACTION" ||
      phase === "LOCKING_ACTIONS" ||
      phase === "ADJUDICATING" ||
      phase === "ROLLING" ||
      snap.workType === "generate_bots" ||
      snap.workType === "acquire_gm_lock");
  const presentationStarting = isLiveRoundPresentationStarting({
    liveReady,
    mode: roundShow.mode,
    queueSessionKey,
  });
  const gateLiveRound = shouldGateLiveRoundPresentation({
    mode: roundShow.mode,
    previewReady: dicePreview.ready,
    livePending,
    presentationStarting,
  });
  const knownNames = [
    ...snap.participants.map((p) => p.displayName),
    ...snap.sheets.map((s) => s.sheet.name),
    "GM",
  ].filter((name, i, all) => name.trim() && all.indexOf(name) === i);
  const imageId = imageCharacterId(snap);
  const partyNames = partyDisplayNames(snap);
  const selfSheet = viewerSelfSheetCard(
    snap.sheets,
    snap.viewerParticipantId
  );
  const sceneRows = snap.log.filter((row) => row.narration || row.actions.some((a) => a.revealed && a.body));
  const visibleSceneRows = sceneRows;
  const cinematicRevealedIds = revealedActorIds({
    actors: presentationActors,
    state: roundShow,
  });
  const cinematicLaneIds = resultLaneActorIds({ actors: presentationActors, state: roundShow });
  const cinematicShowGm = shouldShowGmNarration(roundShow);
  const activeRoll = activePresentationRoll({ actors: presentationActors, state: roundShow });
  const activeRollProgress = activePresentationRollProgress({
    actors: presentationActors,
    state: roundShow,
  });
  const overlayRolls = activeRoll ? [activeRoll] : [];
  const activePresentationActor = presentationActors[roundShow.presentationIndex] ?? null;
  const activeActorAdjudicationOutcome = activePresentationActor
    ? resolveParticipantAdjudicationOutcome(
        activePresentationActor.actorId,
        participantAdjudicationOutcomes
      )
    : undefined;
  const liveRevealedActionIds = visibleSceneRows
    .filter((row) => row.roundNumber === serverRoundNumber)
    .flatMap((row) => row.actions.filter((a) => a.revealed && a.body.trim()).map((a) => a.participantId));
  const orphanRolls = holdCurrentRound
    ? []
    : orphanTrpgRolls({
        currentRolls: snap.currentRolls,
        revealedActionParticipantIds: liveRevealedActionIds,
      });
  const isFreshLogKey = (key: string) => !seenLogKeysRef.current!.has(key);
  const consumedDeclarationAiIds = declarationConsumedIds;
  const liveDeclaration = resolveLiveActorDeclarationPresentation({
    mode: roundShow.mode,
    phase: roundShow.phase,
    presentationIndex: roundShow.presentationIndex,
    presentationActors,
    actions: sourceActions,
    consumedAiIds: declarationConsumedIds,
  });
  const preCinematicVisibleIds = liveDeclaration.visibleActionIds;
  const waitingOpening =
    visibleSceneRows.length === 0 &&
    (starting || generating || phase === "ROLLING" || phase === "GENERATING_NARRATION" || phase === "NONE");
  const waitKind = liveRoundWaitKind({
    phase: String(phase),
    workType: snap.workType,
    viewerLocked: snap.myDraft?.locked === true,
    narrationRerolling: snap.narrationRerolling,
    waitingOpening,
  });
  const waitCopy = shouldShowLiveRoundWaitCopy({
    waitKind,
    mode: roundShow.mode,
    presentationStarting,
  })
    ? liveRoundWaitCopy(waitKind)
    : null;
  const cinematicMotion = isLiveTurnCinematicMotion(roundShow.mode, roundShow.phase);
  const freshGmRow = liveFreshGmNarrationRow({
    log: snap.log,
    seenKeys: seenLogKeysRef.current!,
  });
  const liveGmStreamDraft =
    presentationRoundNumber === serverRoundNumber && phase === "GENERATING_NARRATION"
      ? snap.gmNarrationDraft?.text?.trim() ?? ""
      : "";
  const liveFollowRound = freshGmRow?.roundNumber ?? presentationRoundNumber;
  const heldPresentationActive = presentationRoundNumber !== serverRoundNumber;
  const presentationCanonicalNarration = presentationLogRow?.narration?.trim() ?? "";
  const currentNarration = heldPresentationActive
    ? roundShow.phase === "gm-narration" || roundShow.phase === "complete"
      ? presentationCanonicalNarration
      : ""
    : (freshGmRow?.narration ?? (liveGmStreamDraft || currentLogRow?.narration))?.trim() || "";
  currentNarrationRef.current = currentNarration;
  liveFreshGmRoundRef.current = freshGmRow?.roundNumber ?? null;
  const gmTextReady = cinematicShowGm && (currentNarration.length > 0 || liveGmStreamDraft.length > 0);
  const hiddenCatchUpActive = isHiddenPresentationCatchUpActive({
    documentHidden,
    session: hiddenPresentationSession,
    sessionKey: queueSessionKey,
    cinematic: roundShow.mode === "cinematic",
  });
  const hiddenRoundSessionActive = hiddenPresentationSessionStillActive({
    session: hiddenPresentationSession,
    sessionKey: queueSessionKey,
  });
  const skipDecorativeReveal = shouldSkipDecorativeReveal({
    consumedSessionKey: consumedDecorativeSessionKey,
    sessionKey: queueSessionKey,
    hiddenCatchUpActive,
  });
  const cinematicActorAction =
    roundShow.mode === "cinematic" && roundShow.phase === "actor-action";
  const activePresentationActorId =
    cinematicMotion && presentationActors[roundShow.presentationIndex]
      ? presentationActors[roundShow.presentationIndex].actorId
      : null;
  const activePresentationAction =
    activePresentationActorId != null
      ? sourceActions.find((action) => action.participantId === activePresentationActorId)
      : null;
  const effectiveActorRevealComplete = resolveEffectiveActorRevealComplete({
    roundNumber: presentationRoundNumber,
    activeParticipantId: activePresentationActorId,
    report: actorRevealReport,
  });
  const activeResolutionActionAlreadyConsumed =
    activePresentationActorId != null &&
    consumedDeclarationAiIds.has(activePresentationActorId);
  const activeActorRevealBeatSatisfied =
    liveDeclaration.currentActorDeclarationComplete &&
    isActorActionRevealBeatSatisfied({
      actionKind: activePresentationAction?.kind,
      isFreshAiAction:
        activePresentationAction?.kind === "ai_character" &&
        isFreshLogKey(`a:${presentationRoundNumber}:${activePresentationAction.participantId}`),
      alreadyCompleted: false,
      resolutionActionAlreadyConsumed: activeResolutionActionAlreadyConsumed,
      effectiveActorRevealComplete,
      skipDecorativeReveal,
    });
  const cinematicAiActionActive =
    cinematicActorAction && activePresentationAction?.kind === "ai_character";
  useEffect(() => {
    if (typeof document === "undefined") return;
    const syncHidden = () => {
      const hidden = document.visibilityState === "hidden";
      setDocumentHidden(hidden);
      if (hidden && queueSessionKey) {
        setHiddenPresentationSession(
          beginHiddenPresentationSession({
            sessionKey: queueSessionKey,
            roundNumber: presentationRoundNumber,
          })
        );
      }
    };
    document.addEventListener("visibilitychange", syncHidden);
    syncHidden();
    return () => document.removeEventListener("visibilitychange", syncHidden);
  }, [presentationRoundNumber, queueSessionKey]);
  useEffect(() => {
    if (!hiddenCatchUpActive) return;
    if (roundShow.mode !== "cinematic") return;
    const caught = catchUpHiddenPresentationState({
      state: roundShow,
      actors: presentationActors,
      gmTextAvailable: gmTextReady,
    });
    if (!presentationStateEquals(caught, roundShow)) {
      setRoundShow(caught);
    }
    setConsumedDecorativeSessionKey(queueSessionKey);
  }, [
    gmTextReady,
    hiddenCatchUpActive,
    presentationActors,
    queueSessionKey,
    roundShow,
  ]);
  useEffect(() => {
    if (roundShow.mode !== "cinematic") return;
    if (!hiddenRoundSessionActive) return;
    if (!gmTextReady) return;
    if (roundShow.phase !== "gm-narration" && roundShow.phase !== "complete") return;
    const caught = catchUpHiddenPresentationState({
      state: roundShow,
      actors: presentationActors,
      gmTextAvailable: true,
    });
    if (!presentationStateEquals(caught, roundShow)) {
      setRoundShow(caught);
    }
    setConsumedDecorativeSessionKey(queueSessionKey);
  }, [
    gmTextReady,
    hiddenRoundSessionActive,
    presentationActors,
    queueSessionKey,
    roundShow,
  ]);
  useEffect(() => {
    if (hiddenCatchUpActive) return;
    if (roundShow.mode !== "cinematic") return;
    if (roundShow.phase === "actor-action") {
      const current = presentationActors[roundShow.presentationIndex];
      if (!current?.action) return;
      if (!activeActorRevealBeatSatisfied) return;
      if (
        !isActorPresentationReady({
          actor: current,
          adjudicatedParticipantIds,
          declarationConsumedIds,
        })
      ) {
        return;
      }
      const decision = resolveLiveActorPresentationTransition({
        mode: roundShow.mode,
        phase: roundShow.phase,
        presentationIndex: roundShow.presentationIndex,
        actors: presentationActors,
        rolls: sourceRolls,
        adjudicatedParticipantIds,
        declarationConsumedIds,
        participantAdjudicationOutcomes,
        awaitingMoreActors: awaitingMorePresentationActors,
        expectedPresentationActorIds,
        actionRevealComplete: true,
      });
      if (decision.kind !== "transition") return;
      setRoundShow((prev) => {
        if (prev.mode !== "cinematic" || prev.phase !== "actor-action") return prev;
        return { ...prev, ...decision.next };
      });
      return;
    }
    if (roundShow.phase === "actor-result") {
      if (skipDecorativeReveal) {
        setRoundShow((prev) => {
          if (prev.mode !== "cinematic" || prev.phase !== "actor-result") return prev;
          return {
            ...prev,
            ...advanceAfterActorResult({
              actors: presentationActors,
              presentationIndex: prev.presentationIndex,
              adjudicatedParticipantIds,
              declarationConsumedIds,
              awaitingMoreActors: awaitingMorePresentationActors,
              expectedPresentationActorIds,
            }),
          };
        });
        return;
      }
      const id = window.setTimeout(() => {
        setRoundShow((prev) => {
          if (prev.mode !== "cinematic" || prev.phase !== "actor-result") return prev;
          return {
            ...prev,
            ...advanceAfterActorResult({
              actors: presentationActors,
              presentationIndex: prev.presentationIndex,
              adjudicatedParticipantIds,
              declarationConsumedIds,
              awaitingMoreActors: awaitingMorePresentationActors,
              expectedPresentationActorIds,
            }),
          };
        });
      }, ROUND_RESULT_HOLD_MS);
      return () => window.clearTimeout(id);
    }
  }, [
    activeActorRevealBeatSatisfied,
    adjudicatedParticipantIds,
    awaitingMorePresentationActors,
    declarationConsumedIds,
    expectedPresentationActorIds,
    hiddenCatchUpActive,
    participantAdjudicationOutcomes,
    presentationActorKey,
    presentationActors,
    roundShow.mode,
    roundShow.phase,
    roundShow.presentationIndex,
    skipDecorativeReveal,
    snap.round.number,
  ]);
  const processStage = liveTurnProcessStage({
    waitingOpening,
    narrationRerolling: snap.narrationRerolling,
    workType: snap.workType,
    phase: String(phase),
    viewerLocked: snap.myDraft?.locked === true,
    cinematicMotion,
    presentationStarting,
    gmTextReady,
    botGenerationInFlight: snap.botGenerationInFlight,
    overlayVisible: overlayPlayback.visible,
    presentationMode: roundShow.mode,
    presentationPhase: roundShow.phase,
    cinematicAiActionActive,
    gmProseRevealing:
      cinematicShowGm &&
      currentNarration.length > 0 &&
      gmRevealReport.progressive,
  });
  const processingActive = isLiveTurnProcessing({
    waitingOpening,
    narrationRerolling: snap.narrationRerolling,
    viewerLocked: snap.myDraft?.locked === true,
    phase: String(phase),
    workType: snap.workType,
    cinematicMotion,
    presentationStarting,
    gmTextReady,
    botGenerationInFlight: snap.botGenerationInFlight,
  });
  const botProgress = processStage === "bots" ? liveTurnBotProgress(snap.participants) : null;
  const fallbackStartedAtRef = useRef<number | null>(null);
  const [processElapsedSec, setProcessElapsedSec] = useState(0);
  useEffect(() => {
    if (!processingActive) {
      setProcessElapsedSec(0);
      fallbackStartedAtRef.current = null;
      return;
    }
    const tick = () => {
      if (snap.processStartedAtMs != null) {
        setProcessElapsedSec(processElapsedSecFromStartedAt(snap.processStartedAtMs, Date.now()));
        return;
      }
      const next = nextLiveTurnElapsedSec({
        active: true,
        startedAt: fallbackStartedAtRef.current,
        now: Date.now(),
      });
      fallbackStartedAtRef.current = next.startedAt;
      setProcessElapsedSec(next.elapsedSec);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [processingActive, snap.processStartedAtMs, snap.processStage, snap.id, snap.round.number]);
  const processStatus =
    processStage !== "none" && !overlayPlayback.visible
      ? formatLiveTurnProcessStatus({
          stage: processStage,
          elapsedSec: processElapsedSec,
          botProgress,
        })
      : null;
  const presentationGmRevealRound =
    roundShow.mode === "cinematic" &&
    (roundShow.phase === "gm-narration" || roundShow.phase === "complete")
      ? presentationRoundNumber
      : freshGmRow?.roundNumber ?? null;
  const effectiveGmRevealComplete = resolveEffectiveGmRevealComplete({
    freshGmRound: presentationGmRevealRound,
    report: gmRevealReport,
  });
  const nextActionVisible = shouldShowNextActionInput({
    serverPhase: String(phase),
    hasUnlockedDraft: Boolean(snap.myDraft && !snap.myDraft.locked),
    session: presentationSession,
    roundShow,
    gmRevealComplete: effectiveGmRevealComplete,
  });
  useEffect(() => {
    if (presentationSession == null) return;
    if (isPresentationSessionReleased({ roundShow, gmRevealComplete: effectiveGmRevealComplete })) {
      releasedPresentationRoundRef.current = nextReleasedPresentationRoundWatermark(
        releasedPresentationRoundRef.current,
        presentationSession.roundNumber
      );
      setPresentationSession(null);
      setRoundShow(idlePresentation());
    }
  }, [effectiveGmRevealComplete, presentationSession, roundShow]);
  const liveFollowOwner = resolveTrpgLiveFollowOwner({
    cinematicMotion,
    activeDeclarationReveal: liveDeclaration.activeDeclarationActorId != null,
    freshGmRound: freshGmRow?.roundNumber ?? null,
    gmRevealComplete: effectiveGmRevealComplete,
    nextActionVisible,
  });
  const unlockedUrlsByCharacterId = useMemo(() => {
    const map = new Map<number, Set<string>>();
    for (const row of snap.aiCharacterAssets ?? []) {
      map.set(row.characterId, loadUnlockedCharacterAssetUrls(row.characterId));
    }
    return map;
  }, [snap.aiCharacterAssets]);
  const characterCatalog = snap.aiCharacterAssets ?? [];
  const showReplySuggestions = shouldShowTrpgReplySuggestions({
    suggestionsEnabled,
    freshGmRound: freshGmRow?.roundNumber ?? null,
    gmRevealComplete: effectiveGmRevealComplete,
    hasSuggestions: suggestions.length > 0,
    hasSuggestionsError: Boolean(suggestionsError),
  });
  const handleLiveGmRevealChange = useCallback((report: GmRevealReport) => {
    liveGmRevealStateRef.current = {
      complete: report.complete,
      progressive: report.progressive ?? false,
    };
    setGmRevealReport(report);
  }, []);
  const handleActiveActorRevealChange = useCallback((report: ActorRevealReport) => {
    setActorRevealReport((prev) => mergeActorRevealReport(prev, report));
  }, []);
  const handleDeclarationRevealChange = useCallback(
    (report: ActorRevealReport) => {
      if (!report.complete || report.participantId == null) return;
      const key = `a:${report.roundNumber}:${report.participantId}`;
      if (seenLogKeysRef.current?.has(key)) return;
      seenLogKeysRef.current?.add(key);
      setDeclarationRevealEpoch((epoch) => epoch + 1);
    },
    []
  );
  const showInlineWait = Boolean(waitCopy) && !processStatus;
  const followActivityKey = livePresentationActivityKey({
    roundNumber: presentationRoundNumber,
    mode: roundShow.mode,
    phase: roundShow.phase,
    presentationIndex: roundShow.presentationIndex,
    revealedActorCount: cinematicRevealedIds.length,
    resultLaneCount: cinematicLaneIds.length,
    gmVisible: cinematicShowGm && gmTextReady,
    preCinematicVisibleIds,
  });

  useEffect(() => {
    void ensureChatDisplayWebFontsLoaded();
    setDisplayPrefs(loadTrpgDisplayPrefs());
    setStreamIntervalMs(loadTrpgStreamIntervalMs());
    const cached = loadUserChatPrefsClient();
    accountPrefsRef.current = {
      targetResponseChars: cached.targetResponseChars,
      novelModeEnabled: cached.novelModeEnabled,
    };
    void (async () => {
      try {
        const res = await fetch("/api/user/chat-prefs", { cache: "no-store" });
        const data = (await res.json()) as { prefs?: UserChatPrefs };
        if (!res.ok || !data.prefs) return;
        accountPrefsRef.current = {
          targetResponseChars: data.prefs.targetResponseChars,
          novelModeEnabled: data.prefs.novelModeEnabled,
        };
      } catch {
        /* local prefs already applied */
      }
    })();
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(id);
  }, [toast]);

  const cancelPendingFollowScroll = useCallback(() => {
    if (narrationFollowRafRef.current != null) {
      window.cancelAnimationFrame(narrationFollowRafRef.current);
      narrationFollowRafRef.current = null;
    }
    if (followScrollRafRef.current != null) {
      window.cancelAnimationFrame(followScrollRafRef.current);
      followScrollRafRef.current = null;
    }
  }, []);

  const syncProgrammaticScrollActive = useCallback((active: boolean) => {
    programmaticScrollRef.current = active;
  }, []);

  const cancelProgrammaticScrollOwnership = useCallback(() => {
    cancelTrpgProgrammaticScroll({
      handle: programmaticScrollHandleRef.current,
      onActiveChange: syncProgrammaticScrollActive,
      removeScrollEndListener: (handler) => {
        window.removeEventListener("scrollend", handler);
      },
    });
  }, [syncProgrammaticScrollActive]);

  const detachLiveFollow = useCallback(() => {
    if (!shouldDetachLiveFollowOnUserIntent()) return;
    cancelPendingFollowScroll();
    cancelProgrammaticScrollOwnership();
    manualScrollDetachedRef.current = true;
    hasLeftFollowZoneSinceDetachRef.current = false;
    followLatestRef.current = false;
    setFollowLatest(false);
  }, [cancelPendingFollowScroll, cancelProgrammaticScrollOwnership]);

  const runProgrammaticScroll = useCallback(
    (fn: () => void, behavior: ScrollBehavior = "instant") => {
      beginTrpgProgrammaticScroll({
        handle: programmaticScrollHandleRef.current,
        behavior,
        onActiveChange: syncProgrammaticScrollActive,
        addScrollEndListener: (handler) => {
          window.addEventListener("scrollend", handler, { once: true, passive: true });
        },
        removeScrollEndListener: (handler) => {
          window.removeEventListener("scrollend", handler);
        },
      });
      fn();
    },
    [syncProgrammaticScrollActive]
  );

  const alignReadingBandEnd = useCallback(
    (el: Element, behavior: ScrollBehavior) => {
      const apply = () => {
        const delta = readingBandFollowDeltaFromElement(el);
        if (delta === 0) return;
        window.scrollBy({ top: delta, behavior });
      };
      if (behavior === "smooth") {
        runProgrammaticScroll(apply, behavior);
        return;
      }
      cancelPendingFollowScroll();
      narrationFollowRafRef.current = window.requestAnimationFrame(() => {
        narrationFollowRafRef.current = null;
        runProgrammaticScroll(apply, behavior);
      });
    },
    [cancelPendingFollowScroll, runProgrammaticScroll]
  );

  const alignNarrationEnd = useCallback(
    (behavior: ScrollBehavior) => {
      const el = narrationEndRef.current;
      if (!el) return;
      alignReadingBandEnd(el, behavior);
    },
    [alignReadingBandEnd]
  );

  const scrollToFollowOwner = useCallback(
    (owner: TrpgLiveFollowOwner, behavior: ScrollBehavior = "instant") => {
      switch (owner) {
        case "GM_NARRATION_END":
          if (narrationEndRef.current) alignNarrationEnd(behavior);
          break;
        case "ACTIVE_DECLARATION_END":
          if (declarationEndRef.current) alignReadingBandEnd(declarationEndRef.current, behavior);
          break;
        case "CURRENT_ACTOR":
          if (activePresentationCardRef.current) {
            runProgrammaticScroll(() => {
              activePresentationCardRef.current?.scrollIntoView({
                behavior,
                block: "center",
                inline: "nearest",
              });
            }, behavior);
          } else if (bottomRef.current) {
            runProgrammaticScroll(() => {
              bottomRef.current?.scrollIntoView({ behavior, block: "end", inline: "nearest" });
            }, behavior);
          }
          break;
        case "NEXT_ACTION": {
          const target = nextActionRef.current ?? suggestionsAnchorRef.current ?? bottomRef.current;
          if (target) {
            runProgrammaticScroll(() => {
              target.scrollIntoView({ behavior, block: "end", inline: "nearest" });
            }, behavior);
          } else {
            runProgrammaticScroll(() => {
              window.scrollTo({ top: document.documentElement.scrollHeight, behavior });
            }, behavior);
          }
          break;
        }
        case "NONE":
        default:
          if (bottomRef.current) {
            runProgrammaticScroll(() => {
              bottomRef.current?.scrollIntoView({ behavior, block: "end", inline: "nearest" });
            }, behavior);
          } else {
            runProgrammaticScroll(() => {
              window.scrollTo({ top: document.documentElement.scrollHeight, behavior });
            }, behavior);
          }
          break;
      }
    },
    [alignNarrationEnd, alignReadingBandEnd, runProgrammaticScroll]
  );

  const isNearFollowOwner = useCallback((owner: TrpgLiveFollowOwner): boolean => {
    const root = document.documentElement;
    switch (owner) {
      case "GM_NARRATION_END":
        return narrationEndRef.current
          ? isNearReadingBandFollowElement(narrationEndRef.current)
          : false;
      case "ACTIVE_DECLARATION_END":
        return declarationEndRef.current
          ? isNearReadingBandFollowElement(declarationEndRef.current)
          : false;
      case "CURRENT_ACTOR":
        return activePresentationCardRef.current
          ? isNearPresentationCard(activePresentationCardRef.current)
          : false;
      case "NEXT_ACTION":
      case "NONE":
      default:
        return isNearBottom({
          scrollHeight: root.scrollHeight,
          scrollTop: window.scrollY,
          clientHeight: root.clientHeight,
        });
    }
  }, []);

  const scrollToLatest = useCallback(
    (behavior: ScrollBehavior = "instant") => {
      scrollToFollowOwner(liveFollowOwner, behavior);
      manualScrollDetachedRef.current = false;
      hasLeftFollowZoneSinceDetachRef.current = false;
      followLatestRef.current = true;
      setFollowLatest(true);
      setUnseenLatest(false);
    },
    [liveFollowOwner, scrollToFollowOwner]
  );

  useLayoutEffect(() => {
    hasScrolledToLatestRef.current = null;
    followLatestRef.current = true;
    manualScrollDetachedRef.current = false;
    hasLeftFollowZoneSinceDetachRef.current = false;
    cancelProgrammaticScrollOwnership();
    setFollowLatest(true);
    setUnseenLatest(false);
    seenSceneLenRef.current = 0;
    seenActivityKeyRef.current = "";
    liveGmRevealStateRef.current = { complete: false, progressive: false };
    setGmRevealReport({ roundNumber: null, complete: false, progressive: false });
  }, [cancelProgrammaticScrollOwnership, snap.id]);

  useLayoutEffect(() => {
    if (waitingOpening && sceneRows.length === 0) return;

    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }

    const isFirstEntry = hasScrolledToLatestRef.current !== snap.id;
    if (isFirstEntry) {
      scrollToLatest("instant");
      hasScrolledToLatestRef.current = snap.id;
      seenSceneLenRef.current = sceneRows.length;
      seenActivityKeyRef.current = followActivityKey;
      let secondFrame = 0;
      const firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => scrollToLatest("instant"));
        hasScrolledToLatestRef.current = snap.id;
        seenSceneLenRef.current = sceneRows.length;
        seenActivityKeyRef.current = followActivityKey;
      });
      return () => {
        window.cancelAnimationFrame(firstFrame);
        window.cancelAnimationFrame(secondFrame);
      };
    }

    if (sceneRows.length > seenSceneLenRef.current) {
      seenSceneLenRef.current = sceneRows.length;
      const rowFollow = decideLiveFollowUpdate({
        following: followLatestRef.current,
        activityChanged: true,
      });
      if (rowFollow.autoFollow) scrollToLatest("instant");
      else if (rowFollow.unseenLatest) setUnseenLatest(true);
    }

    if (followActivityKey && followActivityKey !== seenActivityKeyRef.current) {
      seenActivityKeyRef.current = followActivityKey;
      const activityFollow = decideLiveFollowUpdate({
        following: followLatestRef.current,
        activityChanged: true,
      });
      if (activityFollow.autoFollow) {
        requestAnimationFrame(() => {
          if (followLatestRef.current) scrollToLatest("instant");
        });
      } else if (activityFollow.unseenLatest) {
        setUnseenLatest(true);
      }
    }
  }, [followActivityKey, sceneRows.length, scrollToLatest, snap.id, waitingOpening]);

  useEffect(() => {
    const sceneEl = liveSceneRef.current;
    const declarationGrowthEl =
      liveFollowOwner === "ACTIVE_DECLARATION_END" ? declarationGrowthRef.current : null;
    const liveRevealActive =
      roundShow.mode === "cinematic" ||
      presentationStarting ||
      liveDeclaration.activeDeclarationActorId != null ||
      Boolean(currentNarration);
    if (!sceneEl || !liveRevealActive) return;
    const observer = new ResizeObserver(() => {
      const growth = decideLiveFollowOnGrowth({ following: followLatestRef.current });
      if (growth.autoFollow) {
        if (followScrollRafRef.current != null) {
          window.cancelAnimationFrame(followScrollRafRef.current);
        }
        followScrollRafRef.current = window.requestAnimationFrame(() => {
          followScrollRafRef.current = null;
          if (!followLatestRef.current || manualScrollDetachedRef.current) return;
          scrollToFollowOwner(liveFollowOwner, "instant");
        });
      } else if (growth.unseenLatest) {
        setUnseenLatest(true);
      }
    });
    observer.observe(sceneEl);
    if (declarationGrowthEl) observer.observe(declarationGrowthEl);
    return () => observer.disconnect();
  }, [
    currentNarration,
    liveDeclaration.activeDeclarationActorId,
    liveFollowOwner,
    presentationStarting,
    roundShow.mode,
    scrollToFollowOwner,
    snap.round.number,
  ]);

  useLayoutEffect(() => {
    if (!followLatestRef.current || manualScrollDetachedRef.current) return;
    if (liveDeclaration.activeDeclarationActorId == null) return;
    scrollToFollowOwner("ACTIVE_DECLARATION_END", "instant");
  }, [liveDeclaration.activeDeclarationActorId, scrollToFollowOwner]);

  useEffect(() => {
    const onScroll = () => {
      if (programmaticScrollRef.current) return;
      const near = isNearFollowOwner(liveFollowOwner);
      const update = decidePassiveScrollFollowUpdate({
        manualDetached: manualScrollDetachedRef.current,
        following: followLatestRef.current,
        nearFollowOwner: near,
        hasLeftFollowZoneSinceDetach: hasLeftFollowZoneSinceDetachRef.current,
      });
      hasLeftFollowZoneSinceDetachRef.current = update.hasLeftFollowZoneSinceDetach;
      if (update.rejoin) {
        manualScrollDetachedRef.current = false;
        followLatestRef.current = true;
        setFollowLatest(true);
        setUnseenLatest(false);
        return;
      }
      if (manualScrollDetachedRef.current) {
        if (update.unseenLatest) setUnseenLatest(true);
        return;
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [isNearFollowOwner, liveFollowOwner]);

  useEffect(() => {
    const liveRevealActive =
      roundShow.mode === "cinematic" ||
      presentationStarting ||
      liveDeclaration.activeDeclarationActorId != null ||
      Boolean(currentNarrationRef.current);
    if (!liveRevealActive) return;

    let touchStartY = 0;

    const onWheel = (event: WheelEvent) => {
      if (shouldDetachLiveFollowOnWheel(event.deltaY)) {
        detachLiveFollow();
      }
    };

    const onTouchStart = (event: TouchEvent) => {
      touchStartY = event.touches[0]?.clientY ?? 0;
    };

    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY ?? touchStartY;
      const deltaY = touchStartY - y;
      if (Math.abs(deltaY) > 4 && shouldDetachLiveFollowOnTouchDelta(deltaY)) {
        detachLiveFollow();
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const gutter = window.innerWidth - event.clientX;
      if (gutter <= 24) {
        detachLiveFollow();
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest("input, textarea, select, [contenteditable='true']"))
      ) {
        return;
      }
      if (shouldDetachLiveFollowOnKey(event.key)) {
        detachLiveFollow();
      }
    };

    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    liveDeclaration.activeDeclarationActorId,
    detachLiveFollow,
    presentationStarting,
    roundShow.mode,
  ]);

  useLayoutEffect(() => {
    if (!followLatestRef.current) return;
    if (liveFollowOwner !== "NEXT_ACTION") return;
    if (!showReplySuggestions && !nextActionVisible) return;
    scrollToFollowOwner("NEXT_ACTION", "smooth");
  }, [
    liveFollowOwner,
    nextActionVisible,
    scrollToFollowOwner,
    showReplySuggestions,
    suggestions,
    suggestionsError,
  ]);

  const changeDisplayPrefs = useCallback((next: ChatDisplayPrefs) => {
    const current = loadChatDisplayPrefs();
    const isolated: ChatDisplayPrefs = {
      ...next,
      streamIntervalMs: current.streamIntervalMs,
      streamCharsPerTick: current.streamCharsPerTick,
    };
    setDisplayPrefs(isolated);
    saveChatDisplayPrefs(isolated);
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      const account = accountPrefsRef.current;
      if (!account) return;
      void (async () => {
        try {
          const res = await fetch("/api/user/chat-prefs", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              targetResponseChars: account.targetResponseChars,
              novelModeEnabled: account.novelModeEnabled,
              displayPrefs: isolated,
            }),
          });
          const data = (await res.json().catch(() => null)) as { prefs?: UserChatPrefs } | null;
          if (res.ok && data?.prefs) {
            cacheUserChatPrefsClient(data.prefs);
            saveChatDisplayPrefs(data.prefs.displayPrefs ?? isolated);
          }
        } catch {
          /* local toggle already applied */
        }
      })();
    }, 400);
  }, []);

  const changeStreamIntervalMs = useCallback((intervalMs: number) => {
    setStreamIntervalMs(intervalMs);
    saveTrpgStreamIntervalMs(intervalMs);
  }, []);

  const railProps = {
    snap,
    displayPrefs,
    onDisplayPrefsChange: changeDisplayPrefs,
    streamIntervalMs,
    onStreamIntervalMsChange: changeStreamIntervalMs,
    partyBody,
    onPartyBodyChange,
    onSendParty,
    busy,
  };

  const quoteCharacterName =
    snap.participants.find((p) => p.kind === "ai_character")?.displayName || snap.title || "TRPG";

  useEffect(() => {
    if (!dicePreview.instrument) return;
    const times = previewTimesRef.current;
    if (holdCurrentRound && !times.gateHeldAt) times.gateHeldAt = Date.now();
    if (overlayPlayback.visible && !times.overlayVisibleAt) times.overlayVisibleAt = Date.now();
    if (overlayPlayback.dismissed && overlayPlayback.sessionKey === presentationDiceSessionKey && !times.overlayDismissedAt) {
      times.overlayDismissedAt = Date.now();
    }
    if (!holdCurrentRound && rollSessionKey && times.overlayDismissedAt && !times.firstResultVisibleAt) {
      times.firstResultVisibleAt = Date.now();
      times.firstNarrationVisibleAt = Date.now();
    }
    logTrpgDicePreviewInstrument({
      roundNumber: snap.round.number,
      phase: String(phase),
      currentRollsLength: snap.currentRolls.length,
      rollKey: previewDiceRollKey(snap.currentRolls),
      rollSessionKey,
      phaseAtFirstRollObservation: times.phaseAtFirstRollObservation || String(phase),
      presentationState: presentation.state,
      gateHeld: holdCurrentRound,
      overlayVisible: overlayPlayback.visible,
      overlayDismissed: overlayPlayback.dismissed,
      orphanRollCountRendered: orphanRolls.length,
      currentRoundSceneRendered: visibleSceneRows.some((row) => row.roundNumber === snap.round.number),
      roundPresentationPhase: roundShow.phase,
      activeRollActorId: activeRoll?.participantId ?? null,
      releaseReason: resolveDiceRevealGateReleaseReason({
        presentation,
        watchdogFired: revealGateReleaseReason === "watchdog",
      }),
      rollObservedAt: times.rollObservedAt || undefined,
      gateHeldAt: times.gateHeldAt || undefined,
      overlayVisibleAt: times.overlayVisibleAt || undefined,
      overlayDismissedAt: times.overlayDismissedAt || undefined,
      firstResultVisibleAt: times.firstResultVisibleAt || undefined,
      firstNarrationVisibleAt: times.firstNarrationVisibleAt || undefined,
      incomingSessionHidden,
      watchdogMs: revealWatchdogMs,
      overlayMounted: overlayPlayback.visible,
    });
  }, [
    dicePreview.instrument,
    holdCurrentRound,
    incomingSessionHidden,
    orphanRolls.length,
    overlayPlayback.dismissed,
    overlayPlayback.sessionKey,
    overlayPlayback.visible,
    phase,
    presentation,
    presentationDiceSessionKey,
    revealGateReleaseReason,
    revealWatchdogMs,
    rollSessionKey,
    snap.currentRolls,
    snap.round.number,
    visibleSceneRows,
    roundShow.phase,
    activeRoll?.participantId,
  ]);

  const declarationGrowthObserverAttached =
    liveFollowOwner === "ACTIVE_DECLARATION_END" && liveDeclaration.activeDeclarationActorId != null;

  return (
    <div
      className="flex min-h-[calc(100dvh-6rem)] min-w-0 flex-1 items-stretch gap-0 pt-[5.25rem] min-[576px]:pt-0"
      data-trpg-reveal-gate-held={holdCurrentRound ? "true" : "false"}
      data-trpg-reveal-gate-release-reason={revealGateReleaseReason ?? undefined}
      data-trpg-dice-presentation={presentation.state}
      data-trpg-dice-session-key={rollSessionKey || undefined}
      data-trpg-dice-watchdog-ms={revealWatchdogMs}
      data-trpg-dice-incoming-hide={incomingSessionHidden ? "true" : "false"}
      data-trpg-gated-round={gatedRoundNumber ?? undefined}
      data-trpg-round-presentation-mode={roundShow.mode}
      data-trpg-round-presentation-phase={roundShow.phase}
      data-trpg-round-presentation-index={roundShow.presentationIndex}
      data-trpg-round-revealed-actors={cinematicRevealedIds.join(",") || undefined}
      data-trpg-round-actor-count={presentationActors.length}
      data-trpg-round-source-actions={sourceActions.length}
      data-trpg-round-source-rolls={sourceRolls.length}
      data-trpg-presentation-ready={liveReady ? "true" : "false"}
      data-trpg-live-pending={livePending ? "true" : "false"}
      data-trpg-presentation-starting={presentationStarting ? "true" : "false"}
      data-trpg-canonical-visible={liveRoundCanonicalVisibleCount({
        gated: gateLiveRound,
        mode: roundShow.mode,
        actions: sourceActions,
        revealedActorIds: cinematicRevealedIds,
        preCinematicVisibleIds,
      })}
      data-trpg-follow-activity={followActivityKey || undefined}
      data-trpg-follow-latest={followLatest ? "true" : "false"}
      data-trpg-stream-interval-ms={streamIntervalMs}
      data-trpg-live-follow-round={liveFollowRound}
      data-trpg-live-follow-owner={liveFollowOwner}
      data-trpg-unseen-latest={unseenLatest ? "true" : "false"}
      data-trpg-active-actor-id={activePresentationActor?.actorId ?? undefined}
      data-trpg-active-actor-adjudication-outcome={activeActorAdjudicationOutcome ?? undefined}
      data-trpg-active-actor-has-roll={activePresentationActor?.roll ? "true" : "false"}
      data-trpg-active-dice-session-key={presentationDiceSessionKey || undefined}
      data-trpg-overlay-roll-count={overlayRolls.length}
      data-trpg-overlay-visible={overlayPlayback.visible ? "true" : "false"}
      data-trpg-overlay-playback-session-key={overlayPlayback.sessionKey || undefined}
      data-trpg-declaration-growth-observer-attached={declarationGrowthObserverAttached ? "true" : "false"}
    >
      <aside
        className="fixed left-3 right-3 top-[4.5rem] z-[60] rounded-2xl border border-white/10 bg-[#101010]/95 p-2 shadow-[0_12px_30px_rgba(0,0,0,0.45)] backdrop-blur min-[576px]:hidden"
        aria-label="캠페인 도구"
      >
        <TrpgCampaignRail {...railProps} compact />
      </aside>
      <aside
        className={`sticky ${CHAT_GLOBAL_HEADER_OFFSET_CLASS} z-30 hidden h-[calc(100dvh-7.5rem)] w-[260px] shrink-0 flex-col self-start overflow-hidden border-r border-white/10 bg-[#101010]/90 min-[576px]:flex`}
        data-trpg-user-chat-desktop
      >
        <TrpgUserChatPanel
          snap={snap}
          partyBody={partyBody}
          onPartyBodyChange={onPartyBodyChange}
          onSendParty={onSendParty}
          busy={busy}
        />
      </aside>
      <div
        className="flex min-w-0 flex-1 flex-col"
        style={chatReadabilityRootStyle(displayPrefs)}
      >
        <header className="flex items-start justify-between gap-3 border-b border-white/5 pb-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-violet-300/80">TRPG 캠페인</p>
            {snap.viewerIsHost ? (
              <TrpgCampaignTitle
                campaignId={snap.id}
                title={snap.title}
                canEdit
                onSaved={onTitleSaved}
                inputClassName="min-h-10 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-xl font-semibold tracking-tight text-zinc-50 outline-none focus:border-violet-400/40"
              />
            ) : (
              <h1 className="truncate text-xl font-semibold tracking-tight text-zinc-50">{snap.title}</h1>
            )}
            <p className="mt-1 text-xs text-zinc-500">
              <Link href="/trpg" className="text-violet-300 hover:text-violet-200">
                로비
              </Link>
              {" · "}
              <Link href={`/albums?campaignId=${snap.id}`} className="text-violet-300 hover:text-violet-200">
                앨범
              </Link>
              {" · "}라운드 {snap.round.number}
              {" · "}
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold text-zinc-300">
                {trpgBillingModeLabel(snap.billingMode)}
              </span>
            </p>
            {snap.billingMode === "host_pays" && !snap.viewerIsHost ? (
              <p className="mt-1 text-xs text-violet-200/80">이 방의 플레이 비용은 방장이 부담합니다.</p>
            ) : null}
          </div>
        </header>

        {snap.viewerIsHost && snap.billingMode === "split_even" && onBillingModeChange ? (
          <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
            <p className="text-xs text-zinc-400">비용은 지금 균등 부담입니다. 방장 전액 부담으로 바꿀 수 있습니다.</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => onBillingModeChange("host_pays")}
              className="mt-2 inline-flex min-h-8 items-center rounded-lg border border-white/10 px-3 text-xs font-semibold text-zinc-100 hover:bg-white/10 disabled:opacity-50"
            >
              방장이 전액 부담으로 변경
            </button>
          </div>
        ) : null}

        {error ? (
          <p className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </p>
        ) : null}

        <div ref={quoteSelectContainerRef} className="mt-4 flex-1 space-y-4">
          {waitingOpening ? (
            <AppSectionCard title="장면">
              <p className="text-sm leading-relaxed text-zinc-300">
                GM이 세계관과 캐릭터를 보고 첫 장면을 쓰고 있습니다. 1–2분 걸릴 수 있습니다.
              </p>
            </AppSectionCard>
          ) : null}

          {showInlineWait ? (
            <p className="text-sm text-zinc-400" data-trpg-live-wait={waitKind}>
              {waitCopy}
            </p>
          ) : null}

          {(snap.resolutionOrder ?? []).length > 0 ? (
            <AppSectionCard title="행동 순서">
              <ol className="space-y-1 text-sm text-zinc-300">
                {(snap.resolutionOrder ?? []).map((entry, index) => (
                  <li key={entry.participantId} className="tabular-nums">
                    {index + 1} {entry.name} ·{" "}
                    {entry.statKey ? `${entry.statLabel} ${entry.statValue}` : `슬롯 ${entry.slotIndex}`}
                  </li>
                ))}
              </ol>
            </AppSectionCard>
          ) : null}

          {orphanRolls.length > 0 ? (
            <AppSectionCard title="주사위">
              <DiceStrip rolls={orphanRolls} statDefs={snap.statDefs} />
              {phase === "GENERATING_NARRATION" || phase === "ROLLING" ? (
                <p className="mt-3 text-sm text-zinc-400">판정이 끝났습니다. GM이 각 행동을 보고 장면을 쓰고 있습니다…</p>
              ) : null}
            </AppSectionCard>
          ) : null}

          {visibleSceneRows.map((row) => {
            const gated = holdCurrentRound && row.roundNumber === presentationRoundNumber;
            const sceneLive = derivePresentationSceneTurnLiveProps({
              rowRoundNumber: row.roundNumber,
              presentationRoundNumber,
              gateLiveRound,
              roundShow,
              cinematicRevealedIds,
              cinematicLaneIds,
              cinematicShowGm,
              preCinematicVisibleIds,
              serverGmStreamDraft:
                presentationRoundNumber === serverRoundNumber && phase === "GENERATING_NARRATION"
                  ? snap.gmNarrationDraft?.text?.trim() ?? ""
                  : "",
              presentationLogNarration: row.narration,
            });
            const isLiveRow = sceneLive.isLiveRow;
            const liveRevealedActorIds = sceneLive.revealedActorIds;
            const liveResultLaneIds = sceneLive.resultLaneActorIds;
            const liveShowGmNarration = sceneLive.showGmNarration;
            const liveGmStreamDraft = sceneLive.gmStreamDraft;
            const presentationRowRolls =
              row.roundNumber === presentationRoundNumber ? sourceRolls : [];
            return (
            <SceneTurn
              key={row.roundNumber}
              row={row}
              knownNames={knownNames}
              selfNames={viewerSpeechNames(snap)}
              statDefs={snap.statDefs}
              display={displayPrefs}
              canReroll={snap.canRerollRoundNumber === row.roundNumber && !generating}
              canImage={Boolean(imageId) && Boolean(row.narration?.trim())}
              busy={busy || generating}
              scenarioAssets={snap.scenarioAssets ?? []}
              scenarioNpcImages={snap.scenarioNpcImages ?? []}
              characterCatalog={characterCatalog}
              viewerUserId={snap.viewerUserId}
              unlockedUrlsByCharacterId={unlockedUrlsByCharacterId}
              campaignId={snap.id}
              isFreshLogKey={isFreshLogKey}
              liveRolls={presentationRowRolls}
              revealedActorIds={liveRevealedActorIds}
              resultLaneActorIds={liveResultLaneIds}
              showGmNarration={liveShowGmNarration}
              gmStreamDraft={liveGmStreamDraft || undefined}
              partyHumanCount={snap.partyHumanCount}
              partyBotCount={snap.partyBotCount}
              viewerIsHost={snap.viewerIsHost}
              billingMode={row.billingMode ?? snap.billingMode}
              onReroll={() => onReroll(row.roundNumber)}
              onImage={() =>
                openSceneImage({
                  characterId: imageId,
                  campaignId: snap.id,
                  campaignTitle: snap.title,
                  roundNumber: row.roundNumber,
                  content: row.narration ?? "",
                  partyNames,
                })
              }
              revealGateHeld={gated}
              streamIntervalMs={streamIntervalMs}
              liveScene={row.roundNumber === liveFollowRound}
              liveSceneRef={row.roundNumber === liveFollowRound ? liveSceneRef : undefined}
              narrationStartRef={row.roundNumber === liveFollowRound ? narrationStartRef : undefined}
              narrationEndRef={row.roundNumber === liveFollowRound ? narrationEndRef : undefined}
              liveGmRevealStateRef={
                row.roundNumber === liveFollowRound ? liveGmRevealStateRef : undefined
              }
              onLiveGmRevealChange={
                row.roundNumber === liveFollowRound ? handleLiveGmRevealChange : undefined
              }
              activePresentationActorId={
                row.roundNumber === presentationRoundNumber && gateLiveRound
                  ? activePresentationActorId
                  : undefined
              }
              activePresentationCardRef={
                row.roundNumber === presentationRoundNumber && activePresentationActorId != null
                  ? activePresentationCardRef
                  : undefined
              }
              onActiveActorRevealChange={
                row.roundNumber === presentationRoundNumber && gateLiveRound
                  ? handleActiveActorRevealChange
                  : undefined
              }
              skipDecorativeReveal={
                row.roundNumber === presentationRoundNumber && gateLiveRound ? skipDecorativeReveal : false
              }
              cinematicActorAction={
                row.roundNumber === presentationRoundNumber && gateLiveRound ? cinematicActorAction : false
              }
              preCinematicVisibleIds={
                row.roundNumber === presentationRoundNumber && gateLiveRound ? preCinematicVisibleIds : []
              }
              activeDeclarationRevealId={
                row.roundNumber === presentationRoundNumber && gateLiveRound
                  ? liveDeclaration.activeDeclarationActorId
                  : null
              }
              declarationEndRef={
                row.roundNumber === presentationRoundNumber && gateLiveRound
                  ? declarationEndRef
                  : undefined
              }
              declarationGrowthRef={
                row.roundNumber === presentationRoundNumber && gateLiveRound
                  ? declarationGrowthRef
                  : undefined
              }
              consumedDeclarationAiIds={
                row.roundNumber === presentationRoundNumber && gateLiveRound
                  ? [...consumedDeclarationAiIds]
                  : []
              }
              onDeclarationRevealChange={
                row.roundNumber === presentationRoundNumber && gateLiveRound
                  ? handleDeclarationRevealChange
                  : undefined
              }
            />
            );
          })}

          {nextActionVisible ? (
            <div ref={nextActionRef} data-trpg-next-action>
            <AppSectionCard title="시나리오 행동">
              <p className="mb-3 text-sm text-zinc-400">
                세계 안에서 무엇을 할지 적으세요. 유저끼리 대화는 「유저 채팅」입니다.
              </p>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {TRPG_VISIBLE_ACTION_TYPES.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    data-trpg-action-chip={kind}
                    onClick={() => onActionTypeChange(kind)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      actionType === kind
                        ? "bg-violet-600 text-white"
                        : "border border-white/10 bg-white/5 text-zinc-300"
                    }`}
                  >
                    {actionTypeLabelKo(kind)}
                  </button>
                ))}
              </div>
              {(() => {
                const selfSheet = viewerSelfSheetCard(
                  snap.sheets,
                  snap.viewerParticipantId
                )?.sheet;
                const viewerId = snap.viewerParticipantId;
                const treatable = (snap.ongoingEffects ?? []).some(
                  (effect) =>
                    effect.participantId === viewerId &&
                    (effect.kind === "periodic_harm" || effect.kind === "control")
                );
                const hp = selfSheet?.hp ?? 0;
                const maxHp = selfSheet?.maxHp ?? 0;
                const firstAid = selfSheet
                  ? showContextualFirstAid({ hp, maxHp, treatableOngoing: treatable })
                  : false;
                const firstAidDraft = selfSheet
                  ? contextualFirstAidDraft({
                      hp,
                      maxHp,
                      effectLabels: (snap.ongoingEffects ?? [])
                        .filter((effect) => effect.participantId === viewerId)
                        .map((effect) => effect.label),
                    })
                  : null;
                const statusTreat = showContextualStatusTreat({ treatableOngoing: treatable });
                const statusTreatDraft = contextualStatusTreatDraft(
                  (snap.ongoingEffects ?? [])
                    .filter((effect) => effect.participantId === viewerId)
                    .map((effect) => effect.label)
                );
                const rest = snap.safeRest;
                const showRest = Boolean(rest?.available && hp < maxHp);
                const showHint = snap.showRecoveryHint === true;
                return (
                  <>
                    {showHint ? (
                      <p className="mb-2 text-[10px] leading-4 text-zinc-500">{RECOVERY_DISCOVERY_HINT}</p>
                    ) : null}
                    {showHint && rest?.blockedReason === "cooldown" ? (
                      <p className="mb-2 text-[10px] leading-4 text-zinc-500">{SAFE_REST_COOLDOWN_HINT}</p>
                    ) : null}
                    {firstAid || statusTreat || showRest ? (
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {firstAid && firstAidDraft ? (
                          <button
                            type="button"
                            data-contextual="first-aid"
                            onClick={() => {
                              onActionTypeChange(firstAidDraft.actionType);
                              onActionBodyChange(firstAidDraft.body);
                            }}
                            className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-100"
                          >
                            🩹 응급처치
                          </button>
                        ) : null}
                        {statusTreat ? (
                          <button
                            type="button"
                            data-contextual="status-treat"
                            onClick={() => {
                              onActionTypeChange(statusTreatDraft.actionType);
                              onActionBodyChange(statusTreatDraft.body);
                            }}
                            className="rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-100"
                          >
                            💊 상태 치료
                          </button>
                        ) : null}
                        {showRest && rest ? (
                          <button
                            type="button"
                            data-contextual="safe-rest"
                            onClick={() => {
                              const draft = contextualSafeRestDraft();
                              onActionTypeChange(draft.actionType);
                              onActionBodyChange(draft.body);
                            }}
                            className="rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-100"
                            title={treatable ? SAFE_REST_ONGOING_NOTICE : undefined}
                          >
                            {`🏕 안전한 휴식 · HP +${rest.healAmount}`}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {showRest && treatable ? (
                      <p className="mb-2 text-[10px] leading-4 text-zinc-500">{SAFE_REST_ONGOING_NOTICE}</p>
                    ) : null}
                  </>
                );
              })()}
              <textarea
                value={actionBody}
                onChange={(e) => onActionBodyChange(e.target.value)}
                maxLength={TRPG_ACTION_MAX_CHARS}
                rows={4}
                placeholder="무엇을 하는가"
                className="w-full rounded-xl border border-white/10 bg-[#161922] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-400/40"
              />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  role="switch"
                  aria-checked={suggestionsEnabled}
                  aria-label="행동 예시"
                  disabled={busy}
                  onClick={onToggleSuggestions}
                  className={`inline-flex min-h-10 items-center rounded-xl border px-3 text-sm font-semibold disabled:opacity-50 ${
                    suggestionsEnabled
                      ? "border-violet-400/50 bg-violet-500/15 text-violet-100"
                      : "border-white/10 bg-white/5 text-zinc-400 hover:border-white/20 hover:text-zinc-200"
                  }`}
                >
                  {suggestionsEnabled
                    ? suggestionsBusy
                      ? "예시 만드는 중…"
                      : "행동 예시 켜짐"
                    : "행동 예시 꺼짐"}
                </button>
                <button
                  type="button"
                  disabled={busy || !actionBody.trim()}
                  onClick={onSendAction}
                  className="inline-flex min-h-10 items-center rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
                >
                  행동 제출
                </button>
              </div>
              {showReplySuggestions ? (
                <div ref={suggestionsAnchorRef} className="scroll-mb-28">
                  {suggestionsError ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <p className="text-sm text-rose-200">{suggestionsError}</p>
                      <button
                        type="button"
                        disabled={busy || suggestionsBusy}
                        onClick={onRetrySuggestions}
                        className="inline-flex min-h-9 items-center rounded-lg border border-rose-300/30 bg-rose-300/10 px-3 text-xs font-semibold text-rose-100 hover:bg-rose-300/15 disabled:opacity-50"
                      >
                        다시 시도
                      </button>
                    </div>
                  ) : null}
                  {suggestions.length > 0 ? (
                    <ul className="mt-3 space-y-2">
                      {suggestions.map((item) => (
                        <li key={`${item.stance}:${item.actionType}:${item.text}`}>
                          <button
                            type="button"
                            data-trpg-reply-stance={item.stance}
                            onClick={() => onPickSuggestion(item)}
                            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left hover:bg-white/[0.07]"
                          >
                            <span className="flex items-baseline gap-2">
                              <span className="text-xs font-semibold text-violet-200">
                                {replyStanceLabelKo(item.stance)}
                              </span>
                              <span className="text-[10px] font-medium text-zinc-500">
                                {actionTypeLabelKo(item.actionType)}
                              </span>
                            </span>
                            {item.stage ? (
                              <p className="mt-1 text-sm text-zinc-300">{item.stage}</p>
                            ) : null}
                            {item.speech ? (
                              <p className={`${item.stage ? "mt-0.5" : "mt-1"} text-sm text-zinc-100`}>
                                「{item.speech}」
                              </p>
                            ) : null}
                            {!item.stage && !item.speech ? (
                              <p className="mt-1 text-sm text-zinc-200">{item.text}</p>
                            ) : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </AppSectionCard>
            </div>
          ) : null}

          {snap.myDraft?.locked && waitingOthers && waitKind !== "wait_humans" ? (
            <p className="text-sm text-zinc-400">제출했습니다. 다른 플레이어를 기다립니다.</p>
          ) : null}

          {snap.botRetryRequired && snap.viewerIsHost ? (
            <AppSectionCard title="동료 행동 생성">
              <p className="mb-3 text-sm text-zinc-400">동료 행동 생성에 실패했습니다.</p>
              <button
                type="button"
                disabled={busy || snap.botGenerationInFlight}
                onClick={onRetryBots}
                className="inline-flex min-h-10 items-center rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                동료 행동 다시 생성
              </button>
            </AppSectionCard>
          ) : null}

          {phase === "ERROR_RECOVERY" && snap.viewerIsHost ? (
            <div className="space-y-2">
              <p className="text-sm text-rose-200">{snap.gmFailureHint || "GM 생성 실패"}</p>
              {snap.gmFailureKind === "billing_insufficient" || snap.gmFailureKind === "billing_error" ? (
                <>
                  {snap.gmFailureKind === "billing_insufficient" ? (
                    <p className="text-xs leading-relaxed text-zinc-400">
                      포인트를 충전한 뒤 같은 장면을 다시 생성하지 않고 과금만 재시도할 수 있습니다.
                    </p>
                  ) : null}
                  {snap.hasPendingGmResult ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={onRetryGm}
                      className="inline-flex min-h-10 items-center rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 text-sm font-semibold text-amber-100"
                    >
                      과금 다시 시도
                    </button>
                  ) : (
                    <p className="text-xs leading-relaxed text-zinc-400">
                      이 라운드는 과금만 다시 시도할 저장 결과가 없습니다. 같은 장면을 다시 만들지
                      않고는 이어서 진행할 수 없으니, 새 캠페인에서 플레이해 주세요.
                    </p>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={onRetryGm}
                  className="inline-flex min-h-10 items-center rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 text-sm font-semibold text-rose-100"
                >
                  GM 다시 시도
                </button>
              )}
            </div>
          ) : null}
          <div ref={bottomRef} aria-hidden="true" className="h-px w-full scroll-mb-28" />
        </div>
        {selfSheet ? (
          <TrpgSelfSheetHud
            card={selfSheet}
            statDefs={snap.statDefs}
            ongoingEffects={snap.ongoingEffects}
            mechanicsLines={snap.mechanicsLines}
          />
        ) : null}
      </div>

      <aside
        className="chat-room-right-rail hidden w-16 shrink-0 self-stretch bg-[#0b0d14] min-[576px]:flex min-[576px]:w-[68px]"
        data-trpg-right-rail
      >
        <div
          className={`sticky ${CHAT_ROOM_HEADER_OFFSET_CLASS} z-40 flex h-fit w-full flex-col gap-1 self-start px-1 py-2`}
        >
          <TrpgCampaignRail {...railProps} />
        </div>
      </aside>

      <ChatSelectionQuoteToolbar
        containerRef={quoteSelectContainerRef}
        characterName={quoteCharacterName}
        onToast={setToast}
      />

      <TrpgDiceOverlay
        phase={dicePreview.phase}
        rolls={overlayRolls}
        resolutionOrder={snap.resolutionOrder}
        previewInstrument={dicePreview.instrument}
        roundNumber={presentationRoundNumber}
        replayOnMount={dicePreview.inject}
        rollProgress={activeRollProgress}
        statDefs={snap.statDefs}
        onPlaybackStateChange={handleOverlayPlaybackChange}
      />

      {processStatus || (!followLatest && unseenLatest) ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-[5.75rem] z-[64] flex flex-col items-center gap-2 px-3 pb-[env(safe-area-inset-bottom)]">
          {processStatus ? (
            <p
              className="pointer-events-none max-w-[min(24rem,calc(100vw-1.5rem))] rounded-full border border-white/15 bg-[#161616]/95 px-3 py-1.5 text-xs font-medium text-zinc-100 shadow-lg"
              data-trpg-live-turn-status={processStage}
              data-trpg-live-turn-elapsed={processElapsedSec}
              role="status"
              aria-live="polite"
            >
              {processStatus}
            </p>
          ) : null}
          {!followLatest && unseenLatest ? (
            <button
              type="button"
              onClick={() => scrollToLatest("smooth")}
              className="pointer-events-auto rounded-full border border-white/15 bg-[#161616]/95 px-4 py-2 text-xs font-semibold text-zinc-100 shadow-lg"
              data-trpg-jump-latest
            >
              최신으로 ↓
            </button>
          ) : null}
        </div>
      ) : null}

      {toast ? (
        <p className="fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-full border border-white/10 bg-[#161616]/95 px-4 py-2 text-xs text-zinc-100 shadow-lg">
          {toast}
        </p>
      ) : null}

    </div>
  );
}

function SceneTurn({
  row,
  knownNames,
  selfNames,
  statDefs,
  display,
  canReroll,
  canImage,
  busy,
  scenarioAssets,
  scenarioNpcImages = [],
  characterCatalog = [],
  campaignId,
  viewerUserId,
  unlockedUrlsByCharacterId,
  isFreshLogKey,
  liveRolls,
  revealedActorIds: revealedIds,
  resultLaneActorIds: laneIds,
  showGmNarration,
  gmStreamDraft,
  partyHumanCount,
  partyBotCount,
  viewerIsHost,
  billingMode,
  onReroll,
  onImage,
  revealGateHeld,
  streamIntervalMs,
  liveScene,
  liveSceneRef,
  narrationStartRef,
  narrationEndRef,
  liveGmRevealStateRef,
  onLiveGmRevealChange,
  activePresentationActorId,
  activePresentationCardRef,
  onActiveActorRevealChange,
  skipDecorativeReveal = false,
  cinematicActorAction = false,
  preCinematicVisibleIds = [],
  activeDeclarationRevealId = null,
  declarationEndRef,
  declarationGrowthRef,
  consumedDeclarationAiIds = [],
  onDeclarationRevealChange,
}: {
  row: TrpgPublicLog;
  knownNames: string[];
  selfNames: string[];
  statDefs: TrpgStatDefinition[];
  display: ChatDisplayPrefs;
  canReroll: boolean;
  canImage: boolean;
  busy: boolean;
  scenarioAssets: CharacterAsset[];
  scenarioNpcImages?: import("@/lib/trpg/scenarioNpcAssets").TrpgPublicScenarioNpcImage[];
  characterCatalog?: TrpgPublicAiCharacterAssets[];
  campaignId: number;
  viewerUserId: number;
  unlockedUrlsByCharacterId: ReadonlyMap<number, ReadonlySet<string>>;
  isFreshLogKey: (key: string) => boolean;
  liveRolls: TrpgPublicRoll[];
  revealedActorIds?: number[];
  resultLaneActorIds?: number[];
  showGmNarration?: boolean;
  /** Server-owned live narration draft during GENERATING_NARRATION. */
  gmStreamDraft?: string;
  partyHumanCount?: number;
  partyBotCount?: number;
  viewerIsHost: boolean;
  billingMode?: TrpgCampaignSnapshot["billingMode"];
  onReroll: () => void;
  onImage: () => void;
  revealGateHeld?: boolean;
  streamIntervalMs: number;
  liveScene?: boolean;
  liveSceneRef?: Ref<HTMLElement | null>;
  narrationStartRef?: Ref<HTMLDivElement | null>;
  narrationEndRef?: Ref<HTMLSpanElement | null>;
  liveGmRevealStateRef?: MutableRefObject<{ complete: boolean; progressive: boolean }>;
  onLiveGmRevealChange?: (report: GmRevealReport) => void;
  activePresentationActorId?: number | null;
  activePresentationCardRef?: Ref<HTMLDivElement | null>;
  onActiveActorRevealChange?: (report: ActorRevealReport) => void;
  skipDecorativeReveal?: boolean;
  cinematicActorAction?: boolean;
  preCinematicVisibleIds?: readonly number[];
  activeDeclarationRevealId?: number | null;
  declarationEndRef?: Ref<HTMLSpanElement | null>;
  declarationGrowthRef?: Ref<HTMLDivElement | null>;
  consumedDeclarationAiIds?: readonly number[];
  onDeclarationRevealChange?: (report: ActorRevealReport) => void;
}) {
  const allowGm = showGmNarration !== false && !revealGateHeld;
  const pacingSource = resolveTrpgGmPacingSource({
    gmStreamDraft,
    canonicalNarration: row.narration,
  });
  const revealNarration = resolveTrpgGmRevealActive({
    allowGm,
    skipDecorativeReveal,
    isFreshLogKey: isFreshLogKey(`n:${row.roundNumber}`),
  });
  const narrationReveal = useRevealedText(pacingSource, revealNarration, "gm", streamIntervalMs);
  const shownNarration = resolveTrpgGmShownNarration({
    allowGm,
    skipDecorativeReveal,
    pacingSource,
    visibleCursorText: narrationReveal.shownText,
  });
  const fullNarrationLen = Array.from(pacingSource).length;
  const shownNarrationLen = Array.from(shownNarration).length;
  const gmRevealProgressive = shownNarrationLen > 0 && shownNarrationLen < fullNarrationLen;
  const gmContentStreaming = resolveTrpgGmContentStreaming({
    allowGm,
    canonicalNarration: row.narration,
    pacingSource,
    decorativeRevealActive: revealNarration,
    decorativeProgressive: gmRevealProgressive,
  });
  const gmRevealComplete = resolveTrpgGmRevealComplete({
    allowGm,
    skipDecorativeReveal,
    pacingSource,
    decorativeShownLen: shownNarrationLen,
  });
  const canonicalCommitted = Boolean(row.narration?.trim());
  const liveAssetResolution = resolveTrpgGmLiveAssetResolution({
    canonicalCommitted,
    revealComplete: gmRevealComplete,
  });
  const gmDisplayNarration = liveAssetResolution ? (row.narration ?? shownNarration) : shownNarration;
  const gmScenarioAssets = liveAssetResolution ? scenarioAssets : [];
  const gmCharacterCatalog = liveAssetResolution ? (characterCatalog ?? []) : [];
  const gmNpcCatalog = liveAssetResolution ? scenarioNpcImages : [];
  useLayoutEffect(() => {
    if (!liveGmRevealStateRef) return;
    liveGmRevealStateRef.current = {
      progressive: gmRevealProgressive,
      complete: gmRevealComplete,
    };
    onLiveGmRevealChange?.({
      roundNumber: row.roundNumber,
      complete: gmRevealComplete,
      progressive: gmRevealProgressive,
    });
  }, [
    gmRevealComplete,
    gmRevealProgressive,
    liveGmRevealStateRef,
    onLiveGmRevealChange,
  ]);
  const beats = allowGm && gmDisplayNarration ? parseTrpgSceneSpeech(gmDisplayNarration, knownNames) : [];
  const rollsByParticipant = mergeTrpgActionRolls({ rowRolls: row.rolls, liveRolls });
  const revealedActions = row.actions.filter((a) => a.revealed && a.body.trim());
  const visibleActions =
    revealedIds != null ? selectVisibleActions(revealedActions, revealedIds) : revealedActions;
  const showToolbar = canReroll || canImage || row.billedPoints != null;
  return (
    <article
      ref={liveScene ? liveSceneRef : undefined}
      data-trpg-live-scene={liveScene ? "true" : undefined}
      className="rounded-xl border border-white/10 bg-[#131626] p-4 sm:p-5"
    >
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500" data-quote-ignore>
        {row.roundNumber === 0 ? "시작" : `장면 ${row.roundNumber}`}
      </p>
      <div
        className="space-y-3 select-text [touch-action:pan-y] [-webkit-user-select:text]"
        data-quote-assistant
        style={quoteSelectStyle}
      >
        {visibleActions.map((action) => {
          const parsed = parseTrpgBotAction(action.body);
          const roll = rollsByParticipant.get(action.participantId);
          const intent = parsed.intent.trim();
          const resultRevealed = laneIds == null || laneIds.includes(action.participantId);
          const showCompactRoll = Boolean(roll && resultRevealed);
          const showJudge = shouldShowActionJudgeBlock({
            kind: action.kind,
            hasIntent: Boolean(intent),
            hasRoll: Boolean(roll),
            resultRevealed,
          });
          const outcome = roll ? trpgRollOutcomeLabel(roll.tier) : null;
          const tone = roll ? resolveTrpgD20Tone(roll.d20, roll.tier) : null;
          const showResultLane = Boolean(roll && tone && outcome && resultRevealed);
          const isActivePresentationCard =
            activePresentationActorId != null && action.participantId === activePresentationActorId;
          const actionFreshKey = `a:${row.roundNumber}:${action.participantId}`;
          const actionIsFresh = isFreshLogKey(actionFreshKey);
          const decorativeReveal = shouldDecorativeRevealAction({
            kind: action.kind,
            participantId: action.participantId,
            activeRevealActorId: activePresentationActorId ?? null,
            isFresh: actionIsFresh,
            skipDecorativeReveal,
            cinematicActorAction,
            declarationRevealActive: activeDeclarationRevealId === action.participantId,
            resolutionActionAlreadyConsumed: consumedDeclarationAiIds.includes(action.participantId),
          });
          const isActiveDeclarationCard = activeDeclarationRevealId === action.participantId;
          return (
            <div
              key={`${row.roundNumber}-${action.participantId}`}
              ref={isActivePresentationCard ? activePresentationCardRef : undefined}
              data-trpg-action-card
              data-trpg-presentation-active={isActivePresentationCard ? "true" : undefined}
            >
              {showResultLane && roll && tone && outcome ? (
                <div data-quote-ignore>
                  <TrpgRollResultLane
                    layout="mobile"
                    d20={roll.d20}
                    tone={tone}
                    outcome={outcome}
                    compactName={trpgActionCardCompactName(action.name, action.kind)}
                  />
                </div>
              ) : null}
              <div className="flex items-start gap-3">
                {showResultLane && roll && tone && outcome ? (
                  <div data-quote-ignore>
                    <TrpgRollResultLane layout="desktop" d20={roll.d20} tone={tone} outcome={outcome} />
                  </div>
                ) : null}
                <div className="min-w-0 flex-1">
                  <div
                    ref={
                      isActiveDeclarationCard && decorativeReveal && declarationGrowthRef
                        ? declarationGrowthRef
                        : undefined
                    }
                    data-trpg-declaration-growth={isActiveDeclarationCard ? "true" : undefined}
                  >
                    <TrpgNamedProse
                      name={action.name}
                      hint={
                        action.kind === "ai_character"
                          ? action.actionType
                            ? `AI · ${actionTypeLabelKo(action.actionType)}`
                            : "AI 캐릭터"
                          : action.actionType
                            ? actionTypeLabelKo(action.actionType)
                            : undefined
                      }
                      text={sanitizeTrpgActionDisplayText(parsed.prose || action.body)}
                      variant={action.kind === "human" ? "user" : "character"}
                      display={display}
                      accent={false}
                      dialogueAccent={false}
                      resolveSceneAssets={false}
                      paragraphMode={action.kind === "ai_character" ? "ai" : "author"}
                      hideMobileLabel={showResultLane}
                      quoteAssistantRoot={false}
                      reveal={decorativeReveal}
                      streamIntervalMs={streamIntervalMs}
                      onRevealChange={
                        isActiveDeclarationCard && onDeclarationRevealChange
                          ? (report) =>
                              onDeclarationRevealChange({
                                roundNumber: row.roundNumber,
                                participantId: action.participantId,
                                complete: report.complete,
                                progressive: report.progressive,
                              })
                          : isActivePresentationCard && onActiveActorRevealChange
                          ? (report) =>
                              onActiveActorRevealChange({
                                roundNumber: row.roundNumber,
                                participantId: action.participantId,
                                complete: report.complete,
                                progressive: report.progressive,
                              })
                          : undefined
                      }
                    />
                    {isActiveDeclarationCard && decorativeReveal && declarationEndRef ? (
                      <span
                        ref={declarationEndRef}
                        data-trpg-declaration-end
                        aria-hidden="true"
                        className="inline-block h-px w-px"
                      />
                    ) : null}
                  </div>
                  {showJudge ? (
                    <div className="mt-1.5 space-y-0.5 font-sans" data-quote-ignore>
                      <p className="text-[11px] font-medium text-zinc-500">GM 판정용</p>
                      {intent ? (
                        <p className="text-xs leading-relaxed text-zinc-400">{intent}</p>
                      ) : null}
                      {showCompactRoll && roll ? (
                        <p className="text-[11px] tabular-nums text-zinc-500">
                          {formatTrpgRollCompact({
                            statLabel: statDefs.find((d) => d.key === roll.statKey)?.label ?? roll.statKey,
                            d20: roll.d20,
                            finalScore: roll.finalScore,
                            dc: roll.dc,
                            tier: roll.tier,
                          })}
                        </p>
                      ) : action.kind === "ai_character" && !roll ? (
                        <p className="text-[11px] text-zinc-500">판정 없음 · 대화</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
        {beats.length > 0 ? (
          <div
            ref={liveScene ? narrationStartRef : undefined}
            data-trpg-narration-start={liveScene ? "true" : undefined}
            data-trpg-narration-body={revealNarration ? "true" : undefined}
            onClick={
              revealNarration && !narrationReveal.complete
                ? (event) => {
                    if (shouldSkipRevealFinishClick(event.target)) return;
                    narrationReveal.finish();
                  }
                : undefined
            }
          >
            {beats.map((beat, i) => {
              const spacingClass = trpgSceneBeatSpacingClass(beat, beats[i - 1] ?? null);
              return (
                <div key={`${row.roundNumber}-gm-${i}`} className={spacingClass || undefined}>
                  {beat.speaker === "GM" ? (
                    <TrpgGmTalk
                      text={beat.text}
                      assets={gmScenarioAssets}
                      characterCatalog={gmCharacterCatalog}
                      npcCatalog={gmNpcCatalog}
                      campaignId={campaignId}
                      roundNumber={row.roundNumber}
                      quoteAssistantRoot={false}
                      contentStreaming={gmContentStreaming}
                      viewerUserId={viewerUserId}
                      unlockedUrlsByCharacterId={unlockedUrlsByCharacterId}
                    />
                  ) : (
                    <TrpgNamedProse
                      name={beat.speaker}
                      text={beat.text}
                      variant={speechVariant(beat.speaker, selfNames)}
                      accent={Boolean(beat.speaker)}
                      display={display}
                      assets={scenarioAssets}
                      characterCatalog={characterCatalog}
                      npcCatalog={scenarioNpcImages}
                      campaignId={campaignId}
                      roundNumber={row.roundNumber}
                      quoteAssistantRoot={false}
                      paragraphMode="ai"
                      dialogueAccent={false}
                      contentStreaming={gmContentStreaming}
                    />
                  )}
                </div>
              );
            })}
            {liveScene && revealNarration ? (
              <span
                ref={narrationEndRef}
                data-trpg-narration-end
                aria-hidden="true"
                className="inline-block h-px w-px"
              />
            ) : null}
          </div>
        ) : null}
      </div>
      {showToolbar ? (
        <TrpgSceneToolbar
          billedPoints={row.billedPoints}
          viewerSharePoints={row.viewerSharePoints}
          humanCount={row.humanCount ?? partyHumanCount}
          botCount={row.botCount ?? partyBotCount}
          billingHint={row.billingHint}
          billingMode={billingMode}
          viewerIsHost={viewerIsHost}
          canReroll={canReroll}
          canImage={canImage}
          busy={busy}
          onReroll={onReroll}
          onImage={onImage}
        />
      ) : null}
    </article>
  );
}

function DiceStrip({
  rolls,
  statDefs,
}: {
  rolls: TrpgPublicRoll[];
  statDefs: TrpgStatDefinition[];
}) {
  return (
    <ul className="space-y-1.5 font-sans">
      {rolls.map((roll) => {
        const statLabel = statDefs.find((d) => d.key === roll.statKey)?.label ?? roll.statKey;
        return (
          <li
            key={`${roll.participantId}-${roll.d20}-${roll.finalScore}`}
            className="rounded-xl border border-white/10 bg-[#161922] px-3 py-2"
          >
            <p className="text-xs font-semibold text-zinc-200">
              {roll.name}
              {roll.kind === "ai_character" ? (
                <span className="ml-1.5 text-[10px] font-medium text-orange-300/80">AI</span>
              ) : null}
            </p>
            <p className="mt-0.5 text-[11px] tabular-nums text-zinc-400">
              {formatTrpgRollCompact({
                statLabel,
                d20: roll.d20,
                finalScore: roll.finalScore,
                dc: roll.dc,
                tier: roll.tier,
              })}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
