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
import { formatTrpgRollCompact } from "@/lib/trpg/labels";
import { parseTrpgSceneSpeech } from "@/lib/trpg/sceneSpeech";
import type { CharacterAsset } from "@/lib/characterAssets";
import type { TrpgCampaignSnapshot, TrpgPublicLog, TrpgPublicRoll } from "@/lib/trpg/snapshot";
import type { TrpgStatDefinition } from "@/lib/trpg/types";
import { TRPG_ACTION_MAX_CHARS } from "@/lib/trpg/types";
import type { TrpgReplySuggestion } from "@/lib/trpg/replySuggestions";
import TrpgCampaignTitle from "./TrpgCampaignTitle";
import TrpgCampaignRail from "./TrpgCampaignRail";
import TrpgNamedProse, { TrpgGmTalk } from "./TrpgNamedProse";
import TrpgSceneToolbar from "./TrpgSceneToolbar";
import TrpgSelfSheetHud from "./TrpgSelfSheetHud";
import { trpgLogRevealKeys, useRevealedText } from "./useRevealedText";

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
  onActionTypeChange,
  onActionBodyChange,
  onPartyBodyChange,
  onHostFillChange,
  onRequestSuggestions,
  onPickSuggestion,
  onSendAction,
  onSendParty,
  onHostFill,
  onRetryGm,
  onReroll,
  onTitleSaved,
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
  onRequestSuggestions: () => void;
  onPickSuggestion: (suggestion: TrpgReplySuggestion) => void;
  onSendAction: () => void;
  onSendParty: () => void;
  onHostFill: () => void;
  onRetryGm: () => void;
  onReroll: (roundNumber: number) => void;
  onTitleSaved: (title: string) => void;
}) {
  const [displayPrefs, setDisplayPrefs] = useState<ChatDisplayPrefs>(DEFAULT_CHAT_DISPLAY_PREFS);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toast, setToast] = useState("");
  const quoteSelectContainerRef = useRef<HTMLDivElement>(null);
  const suggestionsAnchorRef = useRef<HTMLDivElement>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accountPrefsRef = useRef<Pick<UserChatPrefs, "targetResponseChars" | "novelModeEnabled"> | null>(
    null
  );
  const phase = snap.round.phase;
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
  const seenLogKeysRef = useRef<Set<string> | null>(null);
  if (seenLogKeysRef.current === null) {
    seenLogKeysRef.current = new Set(trpgLogRevealKeys(snap.log));
  }
  const isFreshLogKey = (key: string) => !seenLogKeysRef.current!.has(key);
  const waitingOpening =
    sceneRows.length === 0 &&
    (starting || generating || phase === "ROLLING" || phase === "GENERATING_NARRATION" || phase === "NONE");
  const botFillTargets = useMemo(
    () => snap.participants.filter((p) => snap.hostFillBotIds.includes(p.id)),
    [snap.hostFillBotIds, snap.participants]
  );

  useEffect(() => {
    void ensureChatDisplayWebFontsLoaded();
    setDisplayPrefs(loadTrpgDisplayPrefs());
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
    if (suggestions.length === 0 && !suggestionsError) return;
    suggestionsAnchorRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
      inline: "nearest",
    });
  }, [suggestions, suggestionsError]);

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
    partyBody,
    onPartyBodyChange,
    onSendParty,
    busy,
  };

  const quoteCharacterName =
    snap.participants.find((p) => p.kind === "ai_character")?.displayName || snap.title || "TRPG";

  return (
    <div className="flex min-h-[calc(100dvh-6rem)] min-w-0 flex-1 items-stretch gap-0">
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
            </p>
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

          {snap.currentRolls.length > 0 && !sceneRows.some((row) => row.rolls.length > 0) ? (
            <AppSectionCard title="주사위">
              <DiceStrip rolls={snap.currentRolls} statDefs={snap.statDefs} />
              {phase === "GENERATING_NARRATION" || phase === "ROLLING" ? (
                <p className="mt-3 text-sm text-zinc-400">판정이 끝났습니다. GM이 각 행동을 보고 장면을 쓰고 있습니다…</p>
              ) : null}
            </AppSectionCard>
          ) : null}

          {sceneRows.map((row) => (
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
            />
          ))}

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
                  disabled={busy || suggestionsBusy}
                  onClick={onRequestSuggestions}
                  className="inline-flex min-h-10 items-center rounded-xl border border-violet-400/40 px-3 text-sm font-semibold text-violet-100 hover:bg-violet-500/10 disabled:opacity-50"
                >
                  {suggestionsBusy ? "예시 만드는 중…" : "✨ 행동 예시"}
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
              {suggestionsError || suggestions.length > 0 ? (
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
            <button
              type="button"
              disabled={busy}
              onClick={onRetryGm}
              className="inline-flex min-h-10 items-center rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 text-sm font-semibold text-rose-100"
            >
              GM 다시 시도
            </button>
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
  onReroll,
  onImage,
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
  onReroll: () => void;
  onImage: () => void;
}) {
  const revealNarration = isFreshLogKey(`n:${row.roundNumber}`);
  const shownNarration = useRevealedText(row.narration ?? "", revealNarration);
  const beats = shownNarration ? parseTrpgSceneSpeech(shownNarration, knownNames) : [];
  const rollsByParticipant = new Map(row.rolls.map((roll) => [roll.participantId, roll]));
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
          return (
            <div key={`${row.roundNumber}-${action.participantId}`}>
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
                assets={scenarioAssets}
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
