"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AppSectionCard } from "@/components/AppPageShell";
import ChatSelectionQuoteToolbar from "@/components/ChatSelectionQuoteToolbar";
import { TRPG_ACTION_TYPES, actionTypeLabelKo, type TrpgActionType } from "@/lib/trpg/actionTypes";
import { parseTrpgBotAction } from "@/lib/trpg/botActionParse";
import {
  CHAT_ROOM_HEADER_OFFSET_CLASS,
  DEFAULT_CHAT_DISPLAY_PREFS,
  chatReadabilityRootStyle,
  ensureChatDisplayWebFontsLoaded,
  saveChatDisplayPrefs,
  type ChatDisplayPrefs,
} from "@/lib/chatDisplayPrefs";
import { cacheUserChatPrefsClient, loadUserChatPrefsClient, type UserChatPrefs } from "@/lib/userChatPrefs";
import { loadTrpgDisplayPrefs } from "@/lib/trpg/displayPrefs";
import { loadTrpgDiceTheme } from "@/lib/trpg/diceThemePrefs";
import { mergeTrpgActionRolls, orphanTrpgRolls } from "@/lib/trpg/actionCardRolls";
import {
  resolveTrpgD20Tone,
  trpgActionCardCompactName,
  trpgRollOutcomeLabel,
} from "@/lib/trpg/actionCardUi";
import { formatTrpgRollCompact, trpgBillingModeLabel } from "@/lib/trpg/labels";
import { parseTrpgSceneSpeech } from "@/lib/trpg/sceneSpeech";
import type { CharacterAsset } from "@/lib/characterAssets";
import type { TrpgCampaignSnapshot, TrpgPublicLog, TrpgPublicRoll } from "@/lib/trpg/snapshot";
import type { TrpgStatDefinition } from "@/lib/trpg/types";
import { TRPG_ACTION_MAX_CHARS } from "@/lib/trpg/types";
import type { TrpgReplySuggestion } from "@/lib/trpg/replySuggestions";
import {
  isTrpgDicePreviewRuntime,
  logTrpgDicePreviewInstrument,
  previewDiceRollKey,
  resolveCampaignDicePreviewOverlay,
} from "@/lib/trpg/dicePreviewTheme";
import type { TrpgD20ThemeId } from "@/lib/trpg/diceVisual";
import { PRODUCTION_D20_THEME } from "@/lib/trpg/diceVisual";
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
  trpgDiceRevealWatchdogMs,
  trpgDiceRollSessionKey,
} from "@/lib/trpg/diceRollUx";
import TrpgCampaignTitle from "./TrpgCampaignTitle";
import TrpgCampaignRail from "./TrpgCampaignRail";
import TrpgDiceOverlay, { type TrpgDiceOverlayPlaybackState } from "./TrpgDiceOverlay";
import TrpgRollResultLane from "./TrpgRollResultLane";
import TrpgNamedProse, { TrpgGmTalk } from "./TrpgNamedProse";
import TrpgSceneToolbar from "./TrpgSceneToolbar";
import TrpgSelfSheetHud from "./TrpgSelfSheetHud";
import { trpgLogRevealKeys, useRevealedText } from "./useRevealedText";

function useCampaignDicePreview(
  snap: TrpgCampaignSnapshot,
  savedTheme: TrpgD20ThemeId
): {
  theme: TrpgD20ThemeId;
  phase: string;
  rolls: readonly TrpgPublicRoll[];
  inject: boolean;
  instrument: boolean;
} {
  const [query, setQuery] = useState({ previewEnabled: false, queryTheme: null as string | null, queryPreview: null as string | null });
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setQuery({
      previewEnabled: isTrpgDicePreviewRuntime({
        nodeEnv: process.env.NODE_ENV,
        previewFlag: process.env.NEXT_PUBLIC_TRPG_DICE_PREVIEW,
        hostname: window.location.hostname,
      }),
      queryTheme: params.get("diceTheme"),
      queryPreview: params.get("dicePreview"),
    });
  }, []);
  const fixtureName =
    snap.sheets.find((card) => card.isSelf)?.sheet.name.trim() ||
    snap.participants.find((p) => p.id === snap.viewerParticipantId)?.displayName.trim() ||
    "권태현";
  const resolved = resolveCampaignDicePreviewOverlay({
    previewEnabled: query.previewEnabled,
    queryTheme: query.queryTheme,
    queryPreview: query.queryPreview,
    savedTheme,
    phase: snap.round.phase,
    currentRolls: snap.currentRolls,
    fixtureName,
  });
  return { ...resolved, instrument: query.previewEnabled };
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
  hostFill,
  suggestions,
  suggestionsBusy,
  suggestionsError,
  suggestionsEnabled,
  onActionTypeChange,
  onActionBodyChange,
  onPartyBodyChange,
  onHostFillChange,
  onToggleSuggestions,
  onPickSuggestion,
  onSendAction,
  onSendParty,
  onHostFill,
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
  hostFill: string;
  onActionTypeChange: (value: TrpgActionType) => void;
  onActionBodyChange: (value: string) => void;
  onPartyBodyChange: (value: string) => void;
  onHostFillChange: (value: string) => void;
  suggestions: TrpgReplySuggestion[];
  suggestionsBusy: boolean;
  suggestionsError: string;
  suggestionsEnabled: boolean;
  onToggleSuggestions: () => void;
  onPickSuggestion: (suggestion: TrpgReplySuggestion) => void;
  onSendAction: () => void;
  onSendParty: () => void;
  onHostFill: () => void;
  onRetryGm: () => void;
  onReroll: (roundNumber: number) => void;
  onTitleSaved: (title: string) => void;
  onBillingModeChange?: (mode: TrpgCampaignSnapshot["billingMode"]) => void;
}) {
  const [displayPrefs, setDisplayPrefs] = useState<ChatDisplayPrefs>(DEFAULT_CHAT_DISPLAY_PREFS);
  const [diceTheme, setDiceTheme] = useState<TrpgD20ThemeId>(PRODUCTION_D20_THEME);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toast, setToast] = useState("");
  const quoteSelectContainerRef = useRef<HTMLDivElement>(null);
  const suggestionsAnchorRef = useRef<HTMLDivElement>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accountPrefsRef = useRef<Pick<UserChatPrefs, "targetResponseChars" | "novelModeEnabled"> | null>(
    null
  );
  const phase = snap.round.phase;
  const dicePreview = useCampaignDicePreview(snap, diceTheme);
  const rollSessionKey = useMemo(
    () => trpgDiceRollSessionKey(snap.round.number, snap.currentRolls),
    [snap.currentRolls, snap.round.number]
  );
  const [overlayPlayback, setOverlayPlayback] = useState<TrpgDiceOverlayPlaybackState>({
    visible: false,
    settled: false,
    dismissed: true,
    roundNumber: snap.round.number,
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
  useEffect(() => {
    const isFirstObservation = firstKeyObservationRef.current;
    firstKeyObservationRef.current = false;
    const mountConsume = shouldConsumeMountRollSession({
      rollSessionKey,
      replayOnMount: dicePreview.inject,
      isFirstObservation,
    });
    setPresentation((prev) =>
      nextDicePresentation(prev, {
        rollSessionKey,
        roundNumber: snap.round.number,
        overlayVisible: overlayPlayback.visible,
        overlaySettled: overlayPlayback.settled,
        overlayDismissed: overlayPlayback.dismissed && overlayPlayback.sessionKey === rollSessionKey,
        mountConsume,
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
    overlayPlayback.dismissed,
    overlayPlayback.sessionKey,
    overlayPlayback.settled,
    overlayPlayback.visible,
    phase,
    rollSessionKey,
    snap.round.number,
  ]);
  const incomingSessionHidden = shouldHideIncomingRollSession({
    rollSessionKey,
    presentationSessionKey: presentation.sessionKey,
    isFirstObservation: firstKeyObservationRef.current,
    replayOnMount: dicePreview.inject,
  });
  const hideCurrentResults =
    hideCurrentRoundResults(presentation, snap.round.number) || incomingSessionHidden;
  const revealWatchdogMs = trpgDiceRevealWatchdogMs(snap.currentRolls.length);
  const [revealGate, setRevealGate] = useState<TrpgDiceRevealGateState>({ gatedRound: null, holding: false });
  const [revealGateReleased, setRevealGateReleased] = useState(true);
  const [revealGateReleaseReason, setRevealGateReleaseReason] = useState<TrpgDiceRevealGateReleaseReason | null>(
    null
  );
  useEffect(() => {
    setRevealGate((prev) =>
      nextDiceRevealGateState(prev, {
        roundNumber: snap.round.number,
        presentation,
      })
    );
  }, [presentation, snap.round.number]);
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
  const holdCurrentRound = holdCurrentRoundReveal({
    incomingSessionHidden,
    presentationHidesRound: hideCurrentRoundResults(presentation, snap.round.number),
    revealGateReleased,
  });
  const gatedRoundNumber = holdCurrentRound ? snap.round.number : null;
  const waitingOthers = snap.workType === "wait_humans";
  const knownNames = [
    ...snap.participants.map((p) => p.displayName),
    ...snap.sheets.map((s) => s.sheet.name),
    "GM",
  ].filter((name, i, all) => name.trim() && all.indexOf(name) === i);
  const imageId = imageCharacterId(snap);
  const partyNames = partyDisplayNames(snap);
  const selfSheet = snap.sheets.find((card) => card.isSelf);
  const sceneRows = snap.log.filter((row) => row.narration || row.actions.some((a) => a.revealed && a.body));
  const visibleSceneRows = gatedRoundNumber != null
    ? sceneRows.filter((row) => row.roundNumber !== gatedRoundNumber)
    : sceneRows;
  const liveRevealedActionIds = visibleSceneRows
    .filter((row) => row.roundNumber === snap.round.number)
    .flatMap((row) => row.actions.filter((a) => a.revealed && a.body.trim()).map((a) => a.participantId));
  const orphanRolls = holdCurrentRound
    ? []
    : orphanTrpgRolls({
        currentRolls: snap.currentRolls,
        revealedActionParticipantIds: liveRevealedActionIds,
      });
  const seenLogKeysRef = useRef<Set<string> | null>(null);
  if (seenLogKeysRef.current === null) {
    seenLogKeysRef.current = new Set(trpgLogRevealKeys(snap.log));
  }
  const isFreshLogKey = (key: string) => !seenLogKeysRef.current!.has(key);
  const waitingOpening =
    visibleSceneRows.length === 0 &&
    (starting || generating || phase === "ROLLING" || phase === "GENERATING_NARRATION" || phase === "NONE");
  const botFillTargets = useMemo(
    () => snap.participants.filter((p) => snap.hostFillBotIds.includes(p.id)),
    [snap.hostFillBotIds, snap.participants]
  );

  useEffect(() => {
    void ensureChatDisplayWebFontsLoaded();
    setDisplayPrefs(loadTrpgDisplayPrefs());
    setDiceTheme(loadTrpgDiceTheme());
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

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useLayoutEffect(() => {
    if (!suggestionsEnabled) return;
    if (suggestions.length === 0 && !suggestionsError) return;
    suggestionsAnchorRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
      inline: "nearest",
    });
  }, [suggestions, suggestionsEnabled, suggestionsError]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileMenuOpen]);

  const changeDisplayPrefs = useCallback((next: ChatDisplayPrefs) => {
    setDisplayPrefs(next);
    saveChatDisplayPrefs(next);
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
              displayPrefs: next,
            }),
          });
          const data = (await res.json().catch(() => null)) as { prefs?: UserChatPrefs } | null;
          if (res.ok && data?.prefs) {
            cacheUserChatPrefsClient(data.prefs);
            saveChatDisplayPrefs(data.prefs.displayPrefs ?? next);
          }
        } catch {
          /* local toggle already applied */
        }
      })();
    }, 400);
  }, []);

  const railProps = {
    snap,
    displayPrefs,
    onDisplayPrefsChange: changeDisplayPrefs,
    diceTheme,
    onDiceThemeChange: setDiceTheme,
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
    if (overlayPlayback.dismissed && overlayPlayback.sessionKey === rollSessionKey && !times.overlayDismissedAt) {
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
      theme: dicePreview.theme,
      overlayMounted: overlayPlayback.visible,
    });
  }, [
    dicePreview.instrument,
    dicePreview.theme,
    holdCurrentRound,
    incomingSessionHidden,
    orphanRolls.length,
    overlayPlayback.dismissed,
    overlayPlayback.sessionKey,
    overlayPlayback.visible,
    phase,
    presentation,
    revealGateReleaseReason,
    revealWatchdogMs,
    rollSessionKey,
    snap.currentRolls,
    snap.round.number,
    visibleSceneRows,
  ]);

  return (
    <div
      className="flex min-h-[calc(100dvh-6rem)] min-w-0 flex-1 items-stretch gap-0"
      data-trpg-reveal-gate-held={holdCurrentRound ? "true" : "false"}
      data-trpg-reveal-gate-release-reason={revealGateReleaseReason ?? undefined}
      data-trpg-dice-presentation={presentation.state}
      data-trpg-dice-session-key={rollSessionKey || undefined}
      data-trpg-dice-watchdog-ms={revealWatchdogMs}
      data-trpg-dice-incoming-hide={incomingSessionHidden ? "true" : "false"}
    >
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
          <div className="min-[576px]:hidden">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-zinc-200"
              aria-label="캠페인 메뉴"
              aria-expanded={mobileMenuOpen}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-5 w-5" aria-hidden>
                <circle cx="12" cy="5" r="1.25" fill="currentColor" stroke="none" />
                <circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none" />
                <circle cx="12" cy="19" r="1.25" fill="currentColor" stroke="none" />
              </svg>
            </button>
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

          {generating && !waitingOpening ? (
            <p className="text-sm text-zinc-400">
              {snap.narrationRerolling ? "장면을 리롤하고 있습니다…" : "GM이 장면을 쓰고 있습니다…"}
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
            const gated = holdCurrentRound && row.roundNumber === snap.round.number;
            return (
            <SceneTurn
              key={row.roundNumber}
              row={row}
              knownNames={knownNames}
              selfNames={viewerSpeechNames(snap)}
              statDefs={snap.statDefs}
              display={displayPrefs}
              canReroll={snap.canRerollRoundNumber === row.roundNumber && !generating}
              canImage={Boolean(imageId) && Boolean(row.narration)}
              busy={busy || generating}
              scenarioAssets={snap.scenarioAssets ?? []}
              isFreshLogKey={isFreshLogKey}
              liveRolls={row.roundNumber === snap.round.number ? snap.currentRolls : []}
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
            />
            );
          })}

          {phase === "ACTION_INPUT" && snap.myDraft && !snap.myDraft.locked ? (
            <AppSectionCard title="시나리오 행동">
              <p className="mb-3 text-sm text-zinc-400">
                세계 안에서 무엇을 할지 적으세요. 유저끼리 잡담은 오른쪽 「잡담」입니다.
              </p>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {TRPG_ACTION_TYPES.map((kind) => (
                  <button
                    key={kind}
                    type="button"
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
              {suggestionsEnabled && (suggestionsError || suggestions.length > 0) ? (
                <div ref={suggestionsAnchorRef} className="scroll-mb-28">
                  {suggestionsError ? (
                    <p className="mt-2 text-sm text-rose-200">{suggestionsError}</p>
                  ) : null}
                  {suggestions.length > 0 ? (
                    <ul className="mt-3 space-y-2">
                      {suggestions.map((item) => (
                        <li key={`${item.actionType}:${item.text}`}>
                          <button
                            type="button"
                            onClick={() => onPickSuggestion(item)}
                            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left hover:bg-white/[0.07]"
                          >
                            <span className="text-xs font-semibold text-violet-200">
                              {actionTypeLabelKo(item.actionType)}
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
          ) : null}

          {snap.myDraft?.locked && waitingOthers ? (
            <p className="text-sm text-zinc-400">제출했습니다. 다른 플레이어를 기다립니다.</p>
          ) : null}

          {snap.needsHostFill && snap.viewerIsHost ? (
            <AppSectionCard title="봇 행동 대신 입력">
              <p className="mb-3 text-sm text-zinc-400">
                플레이어 캐릭터 행동 생성에 실패했습니다. 방장이 이 라운드 행동을 넣습니다.
              </p>
              {botFillTargets.map((bot) => (
                <p key={bot.id} className="mb-2 text-sm text-zinc-300">
                  {bot.displayName}
                </p>
              ))}
              <textarea
                value={hostFill}
                onChange={(e) => onHostFillChange(e.target.value)}
                rows={3}
                className="w-full rounded-xl border border-white/10 bg-[#161922] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-400/40"
              />
              <button
                type="button"
                disabled={busy || !hostFill.trim() || !botFillTargets[0]}
                onClick={onHostFill}
                className="mt-3 inline-flex min-h-10 items-center rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                봇 행동 넣기
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
        </div>
        {selfSheet ? <TrpgSelfSheetHud card={selfSheet} statDefs={snap.statDefs} /> : null}
      </div>

      <aside
        className={`chat-room-right-rail sticky ${CHAT_ROOM_HEADER_OFFSET_CLASS} z-40 hidden w-16 shrink-0 flex-col gap-1 self-start overflow-visible px-1 py-2 min-[576px]:flex min-[576px]:w-[68px]`}
      >
        <TrpgCampaignRail {...railProps} />
      </aside>

      <ChatSelectionQuoteToolbar
        containerRef={quoteSelectContainerRef}
        characterName={quoteCharacterName}
        disabled={busy || generating}
        onToast={setToast}
      />

      <TrpgDiceOverlay
        phase={dicePreview.phase}
        rolls={dicePreview.rolls}
        resolutionOrder={snap.resolutionOrder}
        theme={dicePreview.theme}
        previewInstrument={dicePreview.instrument}
        roundNumber={snap.round.number}
        replayOnMount={dicePreview.inject}
        onPlaybackStateChange={handleOverlayPlaybackChange}
      />

      {toast ? (
        <p className="fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-full border border-white/10 bg-[#161616]/95 px-4 py-2 text-xs text-zinc-100 shadow-lg">
          {toast}
        </p>
      ) : null}

      {mobileMenuOpen ? (
        <div className="fixed inset-0 z-[60] min-[576px]:hidden" role="presentation">
          <button
            type="button"
            className="absolute inset-0 bg-black/25"
            aria-label="메뉴 닫기"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside
            className="absolute right-1 top-[4.25rem] z-10 flex w-14 flex-col gap-1 rounded-xl border border-white/10 bg-[#101010]/95 px-1 py-1 shadow-[-10px_0_28px_rgba(0,0,0,0.45)] backdrop-blur"
            aria-label="캠페인 메뉴"
          >
            <TrpgCampaignRail {...railProps} compact />
          </aside>
        </div>
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
  isFreshLogKey,
  liveRolls,
  partyHumanCount,
  partyBotCount,
  viewerIsHost,
  billingMode,
  onReroll,
  onImage,
  revealGateHeld,
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
  isFreshLogKey: (key: string) => boolean;
  liveRolls: TrpgPublicRoll[];
  partyHumanCount?: number;
  partyBotCount?: number;
  viewerIsHost: boolean;
  billingMode?: TrpgCampaignSnapshot["billingMode"];
  onReroll: () => void;
  onImage: () => void;
  revealGateHeld?: boolean;
}) {
  const revealNarration = !revealGateHeld && isFreshLogKey(`n:${row.roundNumber}`);
  const shownNarration = useRevealedText(row.narration ?? "", revealNarration);
  const beats = shownNarration ? parseTrpgSceneSpeech(shownNarration, knownNames) : [];
  const rollsByParticipant = mergeTrpgActionRolls({ rowRolls: row.rolls, liveRolls });
  const visibleActions = row.actions.filter((a) => a.revealed && a.body.trim());
  const showToolbar = canReroll || canImage || row.billedPoints != null;
  return (
    <article className="rounded-xl border border-white/10 bg-[#131626] p-4 sm:p-5">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {row.roundNumber === 0 ? "시작" : `장면 ${row.roundNumber}`}
      </p>
      <div className="space-y-3">
        {visibleActions.map((action) => {
          const parsed = parseTrpgBotAction(action.body);
          const roll = rollsByParticipant.get(action.participantId);
          const intent = parsed.intent.trim();
          const showJudge = action.kind === "ai_character" || Boolean(intent) || Boolean(roll);
          const outcome = roll ? trpgRollOutcomeLabel(roll.tier) : null;
          const tone = roll ? resolveTrpgD20Tone(roll.d20, roll.tier) : null;
          return (
            <div key={`${row.roundNumber}-${action.participantId}`} data-trpg-action-card>
              {roll && tone && outcome ? (
                <TrpgRollResultLane
                  layout="mobile"
                  d20={roll.d20}
                  tone={tone}
                  outcome={outcome}
                  compactName={trpgActionCardCompactName(action.name, action.kind)}
                />
              ) : null}
              <div className="flex items-start gap-3">
                {roll && tone && outcome ? (
                  <TrpgRollResultLane layout="desktop" d20={roll.d20} tone={tone} outcome={outcome} />
                ) : null}
                <div className="min-w-0 flex-1">
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
                    text={parsed.prose || action.body}
                    variant={action.kind === "human" ? "user" : "character"}
                    display={display}
                    accent={false}
                    dialogueAccent={false}
                    assets={scenarioAssets}
                    paragraphMode={action.kind === "ai_character" ? "ai" : "author"}
                    reveal={
                      action.kind === "ai_character" &&
                      isFreshLogKey(`a:${row.roundNumber}:${action.participantId}`)
                    }
                  />
                  {showJudge ? (
                    <div className="mt-1.5 space-y-0.5 font-sans">
                      <p className="text-[11px] font-medium text-zinc-500">GM 판정용</p>
                      {intent ? (
                        <p className="text-xs leading-relaxed text-zinc-400">{intent}</p>
                      ) : null}
                      {roll ? (
                        <p className="text-[11px] tabular-nums text-zinc-500">
                          {formatTrpgRollCompact({
                            statLabel: statDefs.find((d) => d.key === roll.statKey)?.label ?? roll.statKey,
                            d20: roll.d20,
                            finalScore: roll.finalScore,
                            dc: roll.dc,
                            tier: roll.tier,
                          })}
                        </p>
                      ) : action.kind === "ai_character" ? (
                        <p className="text-[11px] text-zinc-500">판정 없음 · 대화</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
        {beats.map((beat, i) =>
          beat.speaker === "GM" ? (
            <TrpgGmTalk
              key={`${row.roundNumber}-gm-${i}`}
              text={beat.text}
              assets={scenarioAssets}
            />
          ) : (
            <TrpgNamedProse
              key={`${row.roundNumber}-gm-${i}`}
              name={beat.speaker}
              text={beat.text}
              variant={speechVariant(beat.speaker, selfNames)}
              accent={Boolean(beat.speaker)}
              display={display}
              assets={scenarioAssets}
            />
          )
        )}
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
