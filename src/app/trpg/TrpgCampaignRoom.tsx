"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppSectionCard } from "@/components/AppPageShell";
import NovelText from "@/components/NovelText";
import { TRPG_ACTION_TYPES, actionTypeLabelKo, type TrpgActionType } from "@/lib/trpg/actionTypes";
import {
  CHAT_ROOM_HEADER_OFFSET_CLASS,
  DEFAULT_CHAT_DISPLAY_PREFS,
  chatReadabilityStyle,
  normalizeFontSizePreset,
  type ChatFontSizePreset,
} from "@/lib/chatDisplayPrefs";
import { successLabelKo } from "@/lib/trpg/labels";
import { parseTrpgSceneSpeech } from "@/lib/trpg/sceneSpeech";
import type { TrpgCampaignSnapshot, TrpgPublicLog, TrpgPublicRoll } from "@/lib/trpg/snapshot";
import type { TrpgStatDefinition } from "@/lib/trpg/types";
import { TRPG_ACTION_MAX_CHARS } from "@/lib/trpg/types";
import TrpgCampaignTitle from "./TrpgCampaignTitle";
import TrpgCampaignRail from "./TrpgCampaignRail";
import TrpgNamedProse from "./TrpgNamedProse";
import TrpgSceneToolbar from "./TrpgSceneToolbar";

const FONT_STORAGE_KEY = "habi:trpg-fontSizePreset";

function loadFontPreset(): ChatFontSizePreset {
  try {
    return normalizeFontSizePreset(localStorage.getItem(FONT_STORAGE_KEY));
  } catch {
    return "medium";
  }
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

function openSceneImage(opts: {
  characterId: number | null;
  campaignId: number;
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
  onActionTypeChange,
  onActionBodyChange,
  onPartyBodyChange,
  onHostFillChange,
  onSendAction,
  onSendParty,
  onHostFill,
  onRetryGm,
  onReroll,
  onDelete,
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
  onSendAction: () => void;
  onSendParty: () => void;
  onHostFill: () => void;
  onRetryGm: () => void;
  onReroll: (roundNumber: number) => void;
  onDelete: () => void;
  onTitleSaved: (title: string) => void;
}) {
  const [fontSizePreset, setFontSizePreset] = useState<ChatFontSizePreset>("medium");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const phase = snap.round.phase;
  const waitingOthers = snap.workType === "wait_humans";
  const knownNames = [
    ...snap.participants.map((p) => p.displayName),
    ...snap.sheets.map((s) => s.sheet.name),
    "GM",
  ].filter((name, i, all) => name.trim() && all.indexOf(name) === i);
  const imageId = imageCharacterId(snap);
  const partyNames = partyDisplayNames(snap);
  const sceneRows = snap.log.filter((row) => row.narration || row.actions.some((a) => a.revealed && a.body));
  const waitingOpening =
    sceneRows.length === 0 &&
    (starting || generating || phase === "ROLLING" || phase === "GENERATING_NARRATION" || phase === "NONE");
  const botFillTargets = useMemo(
    () => snap.participants.filter((p) => snap.hostFillBotIds.includes(p.id)),
    [snap.hostFillBotIds, snap.participants]
  );

  useEffect(() => {
    setFontSizePreset(loadFontPreset());
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileMenuOpen]);

  function changeFont(preset: ChatFontSizePreset) {
    setFontSizePreset(preset);
    try {
      localStorage.setItem(FONT_STORAGE_KEY, preset);
    } catch {
      /* ignore */
    }
  }

  const railProps = {
    snap,
    fontSizePreset,
    onFontSizePresetChange: changeFont,
    partyBody,
    onPartyBodyChange,
    onSendParty,
    busy,
  };

  return (
    <div className="flex min-h-[calc(100dvh-6rem)] min-w-0 flex-1 items-stretch gap-0">
      <div
        className="flex min-w-0 flex-1 flex-col"
        style={chatReadabilityStyle({
          fontSizePreset,
          fontFamily: "system",
          paragraphSpacingPreset: "normal",
        })}
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

        <div className="mt-4 flex-1 space-y-4">
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
              statDefs={snap.statDefs}
              canReroll={snap.canRerollRoundNumber === row.roundNumber && !generating}
              canImage={Boolean(imageId) && Boolean(row.narration)}
              busy={busy || generating}
              onReroll={() => onReroll(row.roundNumber)}
              onImage={() =>
                openSceneImage({
                  characterId: imageId,
                  campaignId: snap.id,
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
              <button
                type="button"
                disabled={busy || !actionBody.trim()}
                onClick={onSendAction}
                className="mt-3 inline-flex min-h-10 items-center rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
              >
                행동 제출
              </button>
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

          {snap.viewerIsHost ? (
            <button
              type="button"
              disabled={busy}
              onClick={onDelete}
              className="rounded-lg border border-rose-500/30 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/10 disabled:opacity-50"
            >
              캠페인 삭제
            </button>
          ) : null}
        </div>
      </div>

      <aside
        className={`chat-room-right-rail sticky ${CHAT_ROOM_HEADER_OFFSET_CLASS} z-40 hidden w-16 shrink-0 flex-col gap-1 self-start overflow-visible px-1 py-2 min-[576px]:flex min-[576px]:w-[68px]`}
      >
        <TrpgCampaignRail {...railProps} />
      </aside>

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
  statDefs,
  canReroll,
  canImage,
  busy,
  onReroll,
  onImage,
}: {
  row: TrpgPublicLog;
  knownNames: string[];
  statDefs: TrpgStatDefinition[];
  canReroll: boolean;
  canImage: boolean;
  busy: boolean;
  onReroll: () => void;
  onImage: () => void;
}) {
  const beats = row.narration ? parseTrpgSceneSpeech(row.narration, knownNames) : [];
  const rolledIds = new Set(row.rolls.map((roll) => roll.participantId));
  const visibleActions = row.actions.filter(
    (a) => a.revealed && a.body.trim() && !rolledIds.has(a.participantId)
  );
  const showToolbar = canReroll || canImage || row.billedPoints != null;
  return (
    <article className="rounded-xl border border-white/10 bg-[#131626] p-4 sm:p-5">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {row.roundNumber === 0 ? "시작" : `장면 ${row.roundNumber}`}
      </p>
      <div className="space-y-4">
        {visibleActions.map((action) => (
          <TrpgNamedProse
            key={`${row.roundNumber}-${action.participantId}`}
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
            text={action.body}
            variant={action.kind === "human" ? "user" : "character"}
          />
        ))}
        {row.rolls.length > 0 ? <DiceStrip rolls={row.rolls} statDefs={statDefs} /> : null}
        {beats.map((beat, i) =>
          beat.speaker ? (
            <TrpgNamedProse
              key={`${row.roundNumber}-gm-${i}`}
              name={beat.speaker}
              text={beat.text}
              variant="character"
            />
          ) : (
            <NovelText
              key={`${row.roundNumber}-gm-${i}`}
              content={beat.text}
              display={DEFAULT_CHAT_DISPLAY_PREFS}
              variant="character"
              paragraphMode="author"
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
    <ul className="space-y-3">
      {rolls.map((roll) => {
        const statLabel = statDefs.find((d) => d.key === roll.statKey)?.label ?? roll.statKey;
        const typeLabel = roll.actionType ? actionTypeLabelKo(roll.actionType) : "행동";
        return (
          <li
            key={`${roll.participantId}-${roll.d20}-${roll.finalScore}`}
            className="rounded-2xl border border-white/10 bg-[#161922] px-4 py-3"
          >
            <div className="flex items-start gap-3">
              <div className="min-w-[4.5rem] text-center">
                <p className="text-3xl font-black tabular-nums text-zinc-50">{roll.d20}</p>
                <p className={`text-sm font-semibold ${roll.success ? "text-emerald-300" : "text-rose-300"}`}>
                  {successLabelKo(roll.tier)}
                </p>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-zinc-100">
                  {roll.name}
                  {roll.kind === "ai_character" ? (
                    <span className="ml-1.5 text-[10px] font-medium text-orange-300/80">AI</span>
                  ) : null}
                </p>
                {roll.actionBody.trim() ? (
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">{roll.actionBody}</p>
                ) : (
                  <p className="mt-1 text-sm text-zinc-500">제출한 행동이 아직 없습니다.</p>
                )}
                <p className="mt-1.5 text-xs text-zinc-500">
                  {typeLabel}이라 {statLabel} 판정 · {roll.finalScore} vs DC {roll.dc}
                </p>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
