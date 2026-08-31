"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import TrpgInviteLink from "../TrpgInviteLink";
import TrpgCampaignTitle from "../TrpgCampaignTitle";
import TrpgPartySlots from "../TrpgPartySlots";
import TrpgCampaignRoom from "../TrpgCampaignRoom";
import ChatImageGeneratorPanel from "@/components/ChatImageGeneratorPanel";
import { AppSectionCard } from "@/components/AppPageShell";
import type { TrpgActionType } from "@/lib/trpg/actionTypes";
import { trpgActionComposerForRound } from "@/lib/trpg/actionComposer";
import {
  applyReplySuggestionClick,
  TRPG_REPLY_SUGGESTION_USER_ERROR,
  normalizeTrpgReplySuggestionClientError,
  shouldPersistTrpgActionSuggestionAttemptFailed,
  type TrpgInputOrigin,
  type TrpgReplySuggestion,
} from "@/lib/trpg/replySuggestionShared";
import { statModifier, suggestBotStats } from "@/lib/trpg/stats";
import {
  clearTrpgActionSuggestionAttempt,
  loadTrpgActionSuggestionAttempt,
  loadTrpgActionSuggestionsCache,
  loadTrpgActionSuggestionsEnabled,
  saveTrpgActionSuggestionAttempt,
  saveTrpgActionSuggestionsCache,
  saveTrpgActionSuggestionsEnabled,
  shouldAutoRequestTrpgActionSuggestions,
} from "@/lib/trpg/displayPrefs";
import { trpgStartBlockedReason } from "@/lib/trpg/lobbyReady";
import { trpgReadyLabel } from "@/lib/trpg/readyLabel";
import type { TrpgCampaignSnapshot } from "@/lib/trpg/snapshot";
import { trpgBillingModeLabel } from "@/lib/trpg/labels";
import { trpgRoomGenerating } from "@/lib/trpg/roomClientState";
import {
  afterSnapshotObservationSettled,
  allocateRequestSeq,
  decideSnapshotApply,
  snapshotCompareState,
  TRPG_SNAPSHOT_POLL_MS,
} from "@/lib/trpg/snapshotObserver";
import { DEFAULT_TRPG_BILLING_MODE, TRPG_GM_GROSS_MARGIN, TRPG_RELATIONSHIP_MAX_CHARS, type TrpgBillingMode } from "@/lib/trpg/types";
import type { PublicPersonaListItem } from "@/lib/userPersonasClient";

/** Serialized snapshot observer cadence — ONE GET in flight. */
const POLL_MS = TRPG_SNAPSHOT_POLL_MS;

export default function TrpgRoomClient({
  initial,
  personas: initialPersonas,
  trpgAiFocusExperimentAccess = false,
}: {
  initial: TrpgCampaignSnapshot;
  personas: PublicPersonaListItem[];
  trpgAiFocusExperimentAccess?: boolean;
}) {
  const [snap, setSnap] = useState(initial);
  const [selectedPersonaId, setSelectedPersonaId] = useState<number | null>(
    initial.viewerPersonaId ?? initialPersonas[0]?.id ?? null
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(
    () => snap.sheets.find((s) => s.isSelf)?.sheet.name || snap.participants.find((p) => p.userId)?.displayName || ""
  );
  const [stats, setStats] = useState<Record<string, number>>(() => {
    const mine = snap.sheets.find((s) => s.isSelf)?.sheet.stats;
    const next: Record<string, number> = {};
    for (const def of snap.statDefs) {
      next[def.key] = mine?.[def.key] ?? snap.suggestedPcStats?.[def.key] ?? 5;
    }
    return next;
  });
  const [actionType, setActionType] = useState<TrpgActionType>("free");
  const [actionBody, setActionBody] = useState(snap.myDraft?.body ?? "");
  const [suggestions, setSuggestions] = useState<TrpgReplySuggestion[]>([]);
  const [suggestionsBusy, setSuggestionsBusy] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState("");
  const [suggestionsEnabled, setSuggestionsEnabled] = useState(false);
  const [inputOrigin, setInputOrigin] = useState<TrpgInputOrigin>("manual");
  const [suggestionRound, setSuggestionRound] = useState<number | null>(null);
  const suggestionsBusyRef = useRef(false);
  const autoRequestedRoundRef = useRef<number | null>(null);
  const [partyBody, setPartyBody] = useState("");
  const [relationshipBrief, setRelationshipBrief] = useState(initial.relationshipBrief ?? "");
  const [starting, setStarting] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(
    () => snap.viewerParticipantId ?? snap.participants.find((p) => p.kind === "human")?.id ?? null
  );

  const setup = snap.campaignStatus === "CHARACTER_SETUP" || snap.campaignStatus === "WAITING_FOR_PLAYERS";
  const spent = Object.values(stats).reduce((a, b) => a + b, 0);
  const remaining = snap.pointPool - spent;
  const phase = snap.round.phase;
  const generating = trpgRoomGenerating({
    phase,
    workType: snap.workType,
    botGenerationInFlight: snap.botGenerationInFlight,
    narrationRerolling: snap.narrationRerolling,
  });

  const appliedRoundRef = useRef(initial.round.number);
  const snapRef = useRef(snap);
  const setupRef = useRef(setup);
  setupRef.current = setup;
  /** ONE request sequence domain for all snapshot-producing async responses. */
  const requestSeqRef = useRef(0);
  const appliedSeqRef = useRef(0);
  const advanceKickInFlightRef = useRef(false);
  const apply = useCallback((next: TrpgCampaignSnapshot) => {
    const reset = trpgActionComposerForRound(appliedRoundRef.current, next.round.number, next.myDraft);
    appliedRoundRef.current = next.round.number;
    setSnap(next);
    if (reset) {
      setActionBody(reset.body);
      setActionType(reset.actionType);
    } else if (next.myDraft?.body) {
      setActionBody(next.myDraft.body);
    }
  }, []);

  const applyObservedSnapshot = useCallback(
    (next: TrpgCampaignSnapshot, responseSeq: number, cancelled: boolean) => {
      const previous = snapRef.current;
      const decision = decideSnapshotApply({
        cancelled,
        responseSeq,
        appliedSeq: appliedSeqRef.current,
        previous: snapshotCompareState(previous),
        next: snapshotCompareState(next),
      });
      if (!decision.apply) return false;
      appliedSeqRef.current = responseSeq;
      // SYNC_COMPARISON_REF — update before setSnap so back-to-back responses compare correctly.
      snapRef.current = next;
      apply(next);
      return true;
    },
    [apply]
  );

  const nextRequestSeq = useCallback(() => {
    const allocated = allocateRequestSeq(requestSeqRef.current);
    requestSeqRef.current = allocated.nextCurrent;
    return allocated.seq;
  }, []);

  useEffect(() => {
    if (suggestionRound == null) {
      setSuggestionRound(snap.round.number);
      return;
    }
    if (suggestionRound !== snap.round.number) {
      const reset = trpgActionComposerForRound(suggestionRound, snap.round.number, snap.myDraft);
      if (reset) {
        setActionBody(reset.body);
        setActionType(reset.actionType);
      }
      const cached = loadTrpgActionSuggestionsCache(snap.id, snap.round.number);
      setSuggestions(cached ?? []);
      autoRequestedRoundRef.current = cached?.length ? snap.round.number : null;
      setSuggestionsError("");
      setInputOrigin("manual");
      setSuggestionRound(snap.round.number);
    }
  }, [snap.id, snap.myDraft, snap.round.number, suggestionRound]);

  const refresh = useCallback(async () => {
    const seq = nextRequestSeq();
    const res = await fetch(`/api/trpg/campaigns/${snap.id}`, { cache: "no-store" });
    const data = (await res.json()) as { campaign?: TrpgCampaignSnapshot; error?: string };
    if (!res.ok || !data.campaign) throw new Error(data.error || "불러오지 못했습니다.");
    applyObservedSnapshot(data.campaign, seq, false);
    return data.campaign;
  }, [applyObservedSnapshot, nextRequestSeq, snap.id]);

  // SNAPSHOT_OBSERVER=true — one serialized GET; not restarted by workType/phase.
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    let inFlight = false;
    const campaignId = snap.id;

    const launchAdvanceKick = (campaignIdToKick: number) => {
      advanceKickInFlightRef.current = true;
      void (async () => {
        try {
          // ADVANCE_RESPONSE_OWNS_PRESENTATION=false — observer GET owns live state.
          await fetch(`/api/trpg/campaigns/${campaignIdToKick}/advance`, { method: "POST" });
        } catch {
          /* ignore kick errors; lease/CAS remain server authority */
        } finally {
          advanceKickInFlightRef.current = false;
        }
      })();
    };

    const scheduleNext = (delayMs: number) => {
      if (cancelled) return;
      timer = window.setTimeout(() => {
        void observeOnce();
      }, delayMs);
    };

    const observeOnce = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      // ONE_REQUEST_SEQ_OWNER — allocate at request START, shared with commands.
      const responseSeq = nextRequestSeq();
      let shouldKick = false;
      try {
        const res = await fetch(`/api/trpg/campaigns/${campaignId}`, { cache: "no-store" });
        const data = (await res.json()) as { campaign?: TrpgCampaignSnapshot; error?: string };
        if (!cancelled && res.ok && data.campaign) {
          applyObservedSnapshot(data.campaign, responseSeq, cancelled);
          shouldKick = data.campaign.shouldKickAdvance === true;
        }
      } catch {
        /* ignore poll errors */
      } finally {
        inFlight = false;
        if (cancelled) return;
        const tick = afterSnapshotObservationSettled({
          setup: setupRef.current,
          shouldKickAdvance: shouldKick,
          advanceKickInFlight: advanceKickInFlightRef.current,
          pollMs: POLL_MS,
        });
        // SNAPSHOT_OBSERVER_WAITS_FOR_ADVANCE=false
        if (tick.launchAdvanceKick) {
          launchAdvanceKick(campaignId);
        }
        scheduleNext(tick.scheduleNextMs);
      }
    };

    scheduleNext(POLL_MS);
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [applyObservedSnapshot, nextRequestSeq, snap.id]);

  async function run(path: string, body?: unknown) {
    setBusy(true);
    setError("");
    const seq = nextRequestSeq();
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = (await res.json()) as { campaign?: TrpgCampaignSnapshot; error?: string };
      if (!res.ok || !data.campaign) throw new Error(data.error || "실패했습니다.");
      applyObservedSnapshot(data.campaign, seq, false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const requestSuggestions = useCallback(async () => {
    if (suggestionsBusyRef.current) return;
    suggestionsBusyRef.current = true;
    setSuggestionsBusy(true);
    setSuggestionsError("");
    setError("");
    let response: Response | null = null;
    try {
      response = await fetch(`/api/trpg/campaigns/${snap.id}/reply-suggestions`, {
        method: "POST",
        signal: AbortSignal.timeout(50_000),
      });
      const data = (await response.json().catch(() => null)) as {
        suggestions?: TrpgReplySuggestion[];
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(data?.error || TRPG_REPLY_SUGGESTION_USER_ERROR);
      }
      if (!data?.suggestions?.length) {
        throw new Error(data?.error || "행동 예시를 만들지 못했습니다.");
      }
      setSuggestions(data.suggestions);
      saveTrpgActionSuggestionsCache(snap.id, snap.round.number, data.suggestions);
      clearTrpgActionSuggestionAttempt(snap.id);
    } catch (e) {
      if (shouldPersistTrpgActionSuggestionAttemptFailed(response)) {
        saveTrpgActionSuggestionAttempt(snap.id, snap.round.number, "failed");
      }
      const message = normalizeTrpgReplySuggestionClientError(e);
      setSuggestionsError(message);
      setError(message);
      // Definitive server failures persist "failed" so reload won't auto-retry.
      // Ambiguous transport failures keep "pending" for durable DB / inflight recovery.
      // Never clear autoRequestedRoundRef on failure — that would cause an endless auto-retry/flicker loop.
    } finally {
      suggestionsBusyRef.current = false;
      setSuggestionsBusy(false);
    }
  }, [snap.id, snap.round.number]);

  useEffect(() => {
    setSuggestionsEnabled(loadTrpgActionSuggestionsEnabled());
    const cached = loadTrpgActionSuggestionsCache(snap.id, snap.round.number);
    if (cached?.length) {
      setSuggestions(cached);
      autoRequestedRoundRef.current = snap.round.number;
      clearTrpgActionSuggestionAttempt(snap.id);
      return;
    }
    const attempt = loadTrpgActionSuggestionAttempt(snap.id, snap.round.number);
    if (attempt === "failed") {
      autoRequestedRoundRef.current = snap.round.number;
      setSuggestionsError(TRPG_REPLY_SUGGESTION_USER_ERROR);
    }
    // Mount-only: restore cache or failed auto-attempt marker so reload never re-auto-generates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!suggestionsEnabled) return;
    const cached = loadTrpgActionSuggestionsCache(snap.id, snap.round.number);
    if (cached?.length) {
      setSuggestions(cached);
      autoRequestedRoundRef.current = snap.round.number;
      clearTrpgActionSuggestionAttempt(snap.id);
      return;
    }
    const autoAttempt = loadTrpgActionSuggestionAttempt(snap.id, snap.round.number);
    if (autoAttempt === "failed") {
      autoRequestedRoundRef.current = snap.round.number;
      setSuggestionsError(TRPG_REPLY_SUGGESTION_USER_ERROR);
      return;
    }
    if (
      !shouldAutoRequestTrpgActionSuggestions({
        enabled: true,
        phase: String(phase),
        hasDraft: Boolean(snap.myDraft),
        locked: snap.myDraft?.locked === true,
        requestedRound: autoRequestedRoundRef.current,
        roundNumber: snap.round.number,
      })
    ) {
      return;
    }
    saveTrpgActionSuggestionAttempt(snap.id, snap.round.number, "pending");
    autoRequestedRoundRef.current = snap.round.number;
    void requestSuggestions();
  }, [phase, requestSuggestions, snap.id, snap.myDraft, snap.round.number, suggestionsEnabled]);

  function toggleSuggestionsEnabled() {
    const nextOn = !suggestionsEnabled;
    setSuggestionsEnabled(nextOn);
    saveTrpgActionSuggestionsEnabled(nextOn);
    if (!nextOn) {
      setSuggestions([]);
      setSuggestionsError("");
      autoRequestedRoundRef.current = null;
      clearTrpgActionSuggestionAttempt(snap.id);
      return;
    }
    const cached = loadTrpgActionSuggestionsCache(snap.id, snap.round.number);
    if (cached?.length) {
      setSuggestions(cached);
      autoRequestedRoundRef.current = snap.round.number;
      return;
    }
    if (
      shouldAutoRequestTrpgActionSuggestions({
        enabled: true,
        phase: String(phase),
        hasDraft: Boolean(snap.myDraft),
        locked: snap.myDraft?.locked === true,
        requestedRound: autoRequestedRoundRef.current,
        roundNumber: snap.round.number,
      })
    ) {
      autoRequestedRoundRef.current = snap.round.number;
      void requestSuggestions();
    }
  }

  function retrySuggestions() {
    if (suggestionsBusyRef.current) return;
    saveTrpgActionSuggestionAttempt(snap.id, snap.round.number, "pending");
    autoRequestedRoundRef.current = snap.round.number;
    setSuggestionsError("");
    void requestSuggestions();
  }

  async function saveRelationship() {
    await runPatch({ relationshipBrief });
  }

  async function saveBillingMode(next: TrpgBillingMode) {
    if (next === snap.billingMode) return;
    await runPatch({ billingMode: next });
  }

  async function runPatch(body: unknown) {
    setBusy(true);
    setError("");
    const seq = nextRequestSeq();
    try {
      const res = await fetch(`/api/trpg/campaigns/${snap.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { campaign?: TrpgCampaignSnapshot; error?: string };
      if (!res.ok || !data.campaign) throw new Error(data.error || "실패했습니다.");
      applyObservedSnapshot(data.campaign, seq, false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function addCharacter(characterId: number) {
    await run(`/api/trpg/campaigns/${snap.id}/companions`, { characterIds: [characterId] });
  }

  async function applyPersona(personaId: number) {
    setSelectedPersonaId(personaId);
    try {
      localStorage.setItem("habi:lastPersonaId", String(personaId));
    } catch {
      /* ignore */
    }
    await run(`/api/trpg/campaigns/${snap.id}/sheet`, {
      personaId,
      stats,
      participantId: snap.viewerParticipantId,
    });
  }

  async function sendParty() {
    const text = partyBody.trim();
    if (!text) return;
    setBusy(true);
    setError("");
    const seq = nextRequestSeq();
    try {
      const res = await fetch(`/api/trpg/campaigns/${snap.id}/party-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      const data = (await res.json()) as { campaign?: TrpgCampaignSnapshot; error?: string };
      if (!res.ok || !data.campaign) throw new Error(data.error || "보내지 못했습니다.");
      setPartyBody("");
      applyObservedSnapshot(data.campaign, seq, false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const editing = snap.participants.find((p) => p.id === editingId) ?? null;
  const startBlocked = trpgStartBlockedReason({
    participants: snap.participants,
    viewerParticipantId: snap.viewerParticipantId,
    editingId,
    remaining,
  });
  const partyReady = startBlocked == null;

  async function startCampaign() {
    if (!partyReady || busy) return;
    setBusy(true);
    setError("");
    setStarting(true);
    window.scrollTo(0, 0);
    try {
      if (snap.viewerIsHost) {
        const seq = nextRequestSeq();
        const relRes = await fetch(`/api/trpg/campaigns/${snap.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ relationshipBrief, billingMode: snap.billingMode }),
        });
        const relData = (await relRes.json()) as { campaign?: TrpgCampaignSnapshot; error?: string };
        if (!relRes.ok || !relData.campaign) {
          throw new Error(relData.error || "관계 설정을 저장하지 못했습니다.");
        }
        applyObservedSnapshot(relData.campaign, seq, false);
      }
      if (editing && remaining >= 0) {
        const seq = nextRequestSeq();
        const sheetRes = await fetch(`/api/trpg/campaigns/${snap.id}/sheet`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            stats,
            participantId: editing.id,
            ...(editing.kind !== "ai_character" && selectedPersonaId != null
              ? { personaId: selectedPersonaId }
              : {}),
            ...(snap.viewerIsHost ? { relationshipBrief } : {}),
          }),
        });
        const sheetData = (await sheetRes.json()) as { campaign?: TrpgCampaignSnapshot; error?: string };
        if (!sheetRes.ok || !sheetData.campaign) {
          throw new Error(sheetData.error || "시트를 저장하지 못했습니다.");
        }
        applyObservedSnapshot(sheetData.campaign, seq, false);
      }
      const seq = nextRequestSeq();
      const startRes = await fetch(`/api/trpg/campaigns/${snap.id}/start`, { method: "POST" });
      const startData = (await startRes.json()) as { campaign?: TrpgCampaignSnapshot; error?: string };
      if (!startRes.ok || !startData.campaign) {
        throw new Error(startData.error || "시작하지 못했습니다.");
      }
      applyObservedSnapshot(startData.campaign, seq, false);
      setStarting(false);
    } catch (e) {
      setStarting(false);
      setError(e instanceof Error ? e.message : "실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const target = snap.participants.find((p) => p.id === editingId);
    if (!target) return;
    const sheet = snap.sheets.find((s) => s.participantId === editingId);
    const next: Record<string, number> = {};
    for (const def of snap.statDefs) {
      next[def.key] =
        sheet?.sheet.stats[def.key] ??
        (target.kind === "human" ? snap.suggestedPcStats?.[def.key] : undefined) ??
        def.min;
    }
    setStats(next);
    if (target.kind === "human") setName(sheet?.sheet.name || target.displayName);
    // Lobby poll refreshes `snap` every 1.5s. Resyncing on sheet identity was wiping unsaved numbers back to 5.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when switching whose sheet we edit
  }, [editingId]);
  if (!setup || starting) {
    return (
      <>
        <TrpgCampaignRoom
          snap={snap}
          starting={starting}
          generating={generating}
          busy={busy}
          error={error}
          actionType={actionType}
          actionBody={actionBody}
          partyBody={partyBody}
          onActionTypeChange={setActionType}
          onActionBodyChange={setActionBody}
          onPartyBodyChange={setPartyBody}
          suggestions={suggestions}
          suggestionsBusy={suggestionsBusy}
          suggestionsError={suggestionsError}
          suggestionsEnabled={suggestionsEnabled}
          onToggleSuggestions={toggleSuggestionsEnabled}
          onRetrySuggestions={retrySuggestions}
          onPickSuggestion={(item) => {
            const filled = applyReplySuggestionClick(item);
            setActionType(filled.actionType);
            setActionBody(filled.actionBody);
            setInputOrigin(filled.inputOrigin);
          }}
          onSendAction={() =>
            void run(`/api/trpg/campaigns/${snap.id}/action`, {
              body: actionBody,
              actionType,
              inputOrigin,
            })
          }
          onSendParty={() => void sendParty()}
          onRetryBots={() => void run(`/api/trpg/campaigns/${snap.id}/retry-bots`)}
          onRetryGm={() => void run(`/api/trpg/campaigns/${snap.id}/advance`)}
          onReroll={(roundNumber) =>
            void run(`/api/trpg/campaigns/${snap.id}/reroll`, { roundNumber })
          }
          onTitleSaved={(title) => setSnap((prev) => ({ ...prev, title }))}
          onBillingModeChange={(mode) => void saveBillingMode(mode)}
        />
        <ChatImageGeneratorPanel
          showRailTrigger={false}
          trpgAiFocusExperimentAccess={trpgAiFocusExperimentAccess}
        />
      </>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 pt-6">
      <header className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-violet-300/80">TRPG</p>
        {snap.viewerIsHost ? (
          <TrpgCampaignTitle
            campaignId={snap.id}
            title={snap.title}
            canEdit
            onSaved={(title) => setSnap((prev) => ({ ...prev, title }))}
            inputClassName="min-h-12 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-2xl font-semibold tracking-tight text-zinc-50 outline-none focus:border-violet-400/40"
          />
        ) : (
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">{snap.title}</h1>
        )}
        <p className="text-sm text-zinc-500">
          <Link href="/trpg" className="text-violet-300 hover:text-violet-200">
            로비
          </Link>
          {" · "}라운드 {snap.round.number} · {phase === "NONE" ? snap.campaignStatus : phase}
          {" · "}
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold text-zinc-300">
            {trpgBillingModeLabel(snap.billingMode ?? DEFAULT_TRPG_BILLING_MODE)}
          </span>
        </p>
        {snap.billingMode === "host_pays" && !snap.viewerIsHost ? (
          <p className="text-xs text-violet-200/80">이 방의 플레이 비용은 방장이 부담합니다.</p>
        ) : null}
        {setup && snap.viewerIsHost && snap.participants.filter((p) => p.kind === "human").length <= 1 ? (
          <p className="text-xs text-zinc-500">
            새 캠페인을 시작하면 시작 전 혼자 초안은 삭제됩니다. 다른 사람이 들어오면 유지됩니다.
          </p>
        ) : null}
        <p className="text-xs leading-relaxed text-zinc-500">
          봇이 있으면 호출이 두 번입니다. 봇 자리는 DeepSeek V4 Pro(thinking 끔, 1:1 채팅과 같음)가
          캐릭터 카드로 행동을 쓰고, GM은 같은 Pro(thinking 켬)가 장면을 씁니다. Flash는 쓰지 않습니다.
          마진은 둘 다 {Math.round(TRPG_GM_GROSS_MARGIN * 100)}%이며 실제 토큰은 사람만 냅니다.
          GM 서술은 3,000자를 넘기며, 캐릭터마다 분량을 주고 마지막에 GM 상황 설명을 넣습니다. 상한은 없습니다.
          캠페인 사실(HP·아이템·퀘스트·플래그)은 DB가 원본이고, 최근 3라운드만 원문으로 넣습니다.
          채팅처럼 분기할 수 없습니다. 한 타임라인만 앞으로 갑니다.
          방장이 봇 행동을 대신 넣으면 그 라운드 봇 호출은 없습니다.
          {snap.lastBilledPoints != null ? ` 최근 라운드 ${snap.lastBilledPoints}P.` : ""}
        </p>
      </header>

      {error ? (
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>
      ) : null}

      {setup && snap.viewerIsHost ? (
        <TrpgPartySlots
          snap={snap}
          busy={busy}
          personas={initialPersonas}
          selectedPersonaId={selectedPersonaId}
          onPersonaChange={(id) => void applyPersona(id)}
          onAddCharacter={(id) => void addCharacter(id)}
        />
      ) : null}

      {setup ? (
        <AppSectionCard title="비용 부담 방식">
          {snap.viewerIsHost ? (
            <fieldset className="space-y-3" disabled={busy}>
              <legend className="sr-only">비용 부담 방식</legend>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
                <input
                  type="radio"
                  name="trpg-billing-mode"
                  className="mt-1"
                  checked={(snap.billingMode ?? DEFAULT_TRPG_BILLING_MODE) === "split_even"}
                  disabled={snap.billingModeLocked}
                  onChange={() => void saveBillingMode("split_even")}
                />
                <span>
                  <span className="block text-sm font-semibold text-zinc-100">함께 나누기</span>
                  <span className="mt-1 block text-xs leading-relaxed text-zinc-400">
                    참가한 플레이어끼리 라운드 비용을 나눠 냅니다.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
                <input
                  type="radio"
                  name="trpg-billing-mode"
                  className="mt-1"
                  checked={snap.billingMode === "host_pays"}
                  onChange={() => void saveBillingMode("host_pays")}
                />
                <span>
                  <span className="block text-sm font-semibold text-zinc-100">방장이 전액 부담</span>
                  <span className="mt-1 block text-xs leading-relaxed text-zinc-400">
                    다른 플레이어는 포인트가 없어도 함께 플레이할 수 있습니다. 이 방의 TRPG 비용은 방장이
                    모두 부담합니다.
                  </span>
                </span>
              </label>
              {snap.billingModeLocked ? (
                <p className="text-xs text-zinc-500">
                  방장 전액 부담을 시작한 뒤에는 현재 캠페인 동안 다시 균등분배로 바꿀 수 없습니다.
                </p>
              ) : null}
            </fieldset>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-zinc-100">
                {trpgBillingModeLabel(snap.billingMode ?? DEFAULT_TRPG_BILLING_MODE)}
              </p>
              <p className="text-sm leading-relaxed text-zinc-400">
                {snap.billingMode === "host_pays"
                  ? "이 방의 플레이 비용은 방장이 부담합니다."
                  : "참가한 플레이어끼리 라운드 비용을 나눠 냅니다."}
              </p>
            </div>
          )}
        </AppSectionCard>
      ) : null}

      {setup ? (
        <AppSectionCard title="관계 설정">
          <p className="mb-3 text-sm text-zinc-400">
            유저와 플레이어 캐릭터가 서로 어떤 사이인지 짧게 적으세요. 캠페인 시작 전에 적용되며, GM과
            캐릭터가 이 관계를 보고 말합니다.
          </p>
          {snap.viewerIsHost ? (
            <>
              <textarea
                value={relationshipBrief}
                onChange={(e) => setRelationshipBrief(e.target.value.slice(0, TRPG_RELATIONSHIP_MAX_CHARS))}
                rows={4}
                maxLength={TRPG_RELATIONSHIP_MAX_CHARS}
                placeholder={relationshipPlaceholder(snap.participants.map((p) => p.displayName))}
                className="w-full rounded-xl border border-white/10 bg-[#161922] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-400/40"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void saveRelationship()}
                  className="inline-flex min-h-10 items-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-zinc-100 hover:bg-white/10 disabled:opacity-50"
                >
                  관계 적용
                </button>
                <p className="text-xs text-zinc-500">
                  {relationshipBrief.trim().length}/{TRPG_RELATIONSHIP_MAX_CHARS}자 · 시작을 눌러도 저장됩니다.
                </p>
              </div>
            </>
          ) : (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
              {snap.relationshipBrief?.trim() || "방장이 시작 전에 관계를 적습니다."}
            </p>
          )}
        </AppSectionCard>
      ) : null}

      {snap.inviteCode && !(setup && snap.viewerIsHost) ? (
        <TrpgInviteLink
          code={snap.inviteCode}
          canJoin={setup && snap.participants.length < snap.maxSlots}
          billingMode={snap.billingMode}
        />
      ) : null}

      <AppSectionCard title="파티">
        <ul className="flex flex-wrap gap-2">
          {snap.participants.map((p) => (
            <li
              key={p.id}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-zinc-200"
            >
              {p.displayName}
              {p.kind === "ai_character" ? " · AI" : ""}
              {p.id === snap.viewerParticipantId ? " · 나" : ""}
              {" · "}
              {p.hasSheet ? trpgReadyLabel(p.ready) : "시트 없음"}
            </li>
          ))}
        </ul>
      </AppSectionCard>

      {snap.sheets.length > 0 ? (
        <AppSectionCard title="상태창">
          <div className="grid gap-3 sm:grid-cols-2">
            {snap.sheets.map((card) => (
              <div
                key={card.participantId}
                className={`rounded-xl border p-3 text-sm text-zinc-200 ${
                  card.isSelf ? "border-violet-400/30 bg-violet-500/10" : "border-white/10 bg-white/[0.03]"
                }`}
              >
                <div className="trpg-sheet-hud" dangerouslySetInnerHTML={{ __html: card.html }} />
              </div>
            ))}
          </div>
        </AppSectionCard>
      ) : null}

      {setup ? (
        <AppSectionCard title="능력치 배분">
          <p className="mb-3 text-sm text-zinc-400">
            각 능력치는 5–15입니다. 주사위는 d20 하나고, 능력치는 눈에 더하는 보정입니다 (5=+0, 9=+2, 15=+5).{" "}
            {snap.pointPool}포인트 안에서 배분합니다. HP는 체력(없으면 체격) ×5입니다. 남은 포인트{" "}
            <span className={remaining < 0 ? "font-semibold text-rose-300" : "font-semibold text-zinc-200"}>
              {remaining}
            </span>
            .
            {remaining < 0
              ? " 합계가 넘었습니다. 다른 능력치를 낮추면 저장할 수 있습니다."
              : snap.viewerIsHost
                ? " 참가자는 고른 페르소나에 맞게 직접 배분합니다. AI 캐릭터는 본문 키워드로 자동 배분하거나 방장이 로비에서 맞춥니다."
                : " 고른 페르소나에 맞게 직접 배분하세요. 시나리오 제작자가 숫자를 정해 두지 않습니다."}
          </p>
          {snap.viewerIsHost && snap.participants.length > 1 ? (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {snap.participants
                .filter((p) => p.kind === "human" ? p.id === snap.viewerParticipantId : true)
                .map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setEditingId(p.id)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      editingId === p.id
                        ? "bg-violet-600 text-white"
                        : "border border-white/10 bg-white/5 text-zinc-300"
                    }`}
                  >
                    {p.displayName}
                    {p.kind === "ai_character" ? " · AI" : " · 나"}
                  </button>
                ))}
            </div>
          ) : null}
          {editing?.kind !== "ai_character" ? (
            <label className="mb-3 block text-sm text-zinc-300">
              이름
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 min-h-10 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-sm text-zinc-100 outline-none focus:border-violet-400/40"
              />
            </label>
          ) : (
            <p className="mb-3 text-sm text-zinc-300">{editing.displayName} 시트</p>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {snap.statDefs.map((def) => {
              const value = stats[def.key] ?? def.min;
              const mod = statModifier(value);
              return (
              <label key={def.key} className="text-sm text-zinc-300">
                {def.label}{" "}
                <span className="text-xs text-zinc-500">({mod >= 0 ? `+${mod}` : String(mod)})</span>
                <input
                  type="number"
                  min={def.min}
                  max={def.max}
                  value={value}
                  onChange={(e) =>
                    setStats((prev) => ({ ...prev, [def.key]: Number(e.target.value) }))
                  }
                  className="mt-1 min-h-10 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-sm text-zinc-100 outline-none focus:border-violet-400/40"
                />
              </label>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || remaining < 0 || !editing}
              onClick={() =>
                void run(`/api/trpg/campaigns/${snap.id}/sheet`, {
                  name,
                  stats,
                  participantId: editing?.id,
                  ...(snap.viewerIsHost ? { relationshipBrief } : {}),
                })
              }
              className="inline-flex min-h-10 items-center rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
            >
              시트 저장
            </button>
            <button
              type="button"
              disabled={busy || !editing}
              onClick={() =>
                setStats(
                  editing?.kind === "ai_character"
                    ? suggestBotStats(editing.displayName + "\n" + snap.worldBrief, snap.pointPool, snap.statDefs)
                    : suggestBotStats(name + "\n" + snap.worldBrief, snap.pointPool, snap.statDefs)
                )
              }
              className="inline-flex min-h-10 items-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-zinc-100 hover:bg-white/10 disabled:opacity-50"
            >
              자동 배분
            </button>
            {snap.viewerIsHost ? (
              <span className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy || !partyReady}
                  onClick={() => void startCampaign()}
                  className="inline-flex min-h-10 items-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-zinc-100 hover:bg-white/10 disabled:opacity-50"
                >
                  캠페인 시작
                </button>
                {startBlocked ? <p className="text-xs text-zinc-500">{startBlocked}</p> : null}
              </span>
            ) : (
              <p className="self-center text-xs text-zinc-500">방장이 시작하면 첫 장면이 나옵니다.</p>
            )}
          </div>
        </AppSectionCard>
      ) : null}
    </div>
  );
}

function relationshipPlaceholder(names: string[]): string {
  const party = names.map((n) => n.trim()).filter(Boolean);
  if (party.length >= 3) {
    return `예: ${party[0]}과 ${party[1]}은 소꿉친구. ${party[2]}는 ${party[0]}의 후배.`;
  }
  if (party.length === 2) {
    return `예: ${party[0]}과 ${party[1]}은 소꿉친구. 서로를 잘 알고 반말한다.`;
  }
  return "예: 렌과 권태현은 소꿉친구. 강이현은 렌을 선배로 따른다.";
}
