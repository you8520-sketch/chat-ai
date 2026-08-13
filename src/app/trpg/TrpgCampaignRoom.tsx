"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppSectionCard } from "@/components/AppPageShell";
import { TRPG_ACTION_TYPES, actionTypeLabelKo, type TrpgActionType } from "@/lib/trpg/actionTypes";
import {
  CHAT_ROOM_HEADER_OFFSET_CLASS,
  chatReadabilityStyle,
  normalizeFontSizePreset,
  type ChatFontSizePreset,
} from "@/lib/chatDisplayPrefs";
import { successLabelKo } from "@/lib/trpg/labels";
import type { TrpgCampaignSnapshot } from "@/lib/trpg/snapshot";
import { TRPG_ACTION_MAX_CHARS } from "@/lib/trpg/types";
import TrpgCampaignTitle from "./TrpgCampaignTitle";
import TrpgCampaignRail from "./TrpgCampaignRail";

const FONT_STORAGE_KEY = "habi:trpg-fontSizePreset";

function loadFontPreset(): ChatFontSizePreset {
  try {
    return normalizeFontSizePreset(localStorage.getItem(FONT_STORAGE_KEY));
  } catch {
    return "medium";
  }
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
  onDelete: () => void;
  onTitleSaved: (title: string) => void;
}) {
  const [fontSizePreset, setFontSizePreset] = useState<ChatFontSizePreset>("medium");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const phase = snap.round.phase;
  const waitingOthers = snap.workType === "wait_humans";
  const scenes = snap.log.filter((row) => row.narration);
  const waitingOpening =
    scenes.length === 0 &&
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

          {snap.currentRolls.length > 0 ? (
            <AppSectionCard title="주사위">
              <ul className="flex flex-wrap gap-3">
                {snap.currentRolls.map((roll) => (
                  <li
                    key={`${roll.participantId}-${roll.d20}-${roll.finalScore}`}
                    className="min-w-[7rem] rounded-2xl border border-white/10 bg-[#161922] px-4 py-3 text-center"
                  >
                    <p className="text-3xl font-black tabular-nums text-zinc-50">{roll.d20}</p>
                    <p className={`mt-1 text-sm font-semibold ${roll.success ? "text-emerald-300" : "text-rose-300"}`}>
                      {successLabelKo(roll.tier)}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {roll.name} · {snap.statDefs.find((d) => d.key === roll.statKey)?.label ?? roll.statKey} ·{" "}
                      {roll.finalScore} vs DC {roll.dc}
                    </p>
                  </li>
                ))}
              </ul>
              {phase === "GENERATING_NARRATION" || phase === "ROLLING" ? (
                <p className="mt-3 text-sm text-zinc-400">판정이 끝났습니다. GM이 장면을 쓰고 있습니다…</p>
              ) : null}
            </AppSectionCard>
          ) : null}

          {scenes.map((row) => (
            <article
              key={row.roundNumber}
              className="rounded-xl border border-white/10 bg-[#131626] p-4 sm:p-5"
            >
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {row.roundNumber === 0 ? "시작" : `장면 ${row.roundNumber}`}
              </p>
              <p
                className="whitespace-pre-wrap leading-relaxed text-zinc-100"
                style={{ fontSize: "var(--font-size-chat)", lineHeight: "var(--line-height-chat)" }}
              >
                {row.narration}
              </p>
            </article>
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
