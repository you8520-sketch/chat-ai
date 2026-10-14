"use client";

import { useState } from "react";
import {
  moderationLabel,
  visibilityLabel,
  type CharacterVisibility,
  type ModerationStatus,
} from "@/lib/characterVisibility";
import { cn } from "@/lib/studioDesign";

const CHIP = "inline-flex min-h-6 items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold leading-tight";

const VISIBILITY_TONE: Record<CharacterVisibility, string> = {
  public: "bg-emerald-500/10 text-emerald-200 ring-1 ring-inset ring-emerald-400/25",
  link: "bg-sky-500/10 text-sky-200 ring-1 ring-inset ring-sky-400/25",
  private: "bg-zinc-500/15 text-zinc-300 ring-1 ring-inset ring-white/10",
};

const MODERATION_TONE: Record<ModerationStatus, string> = {
  approved: "bg-white/[0.04] text-zinc-400 ring-1 ring-inset ring-white/10",
  pending: "bg-amber-500/10 text-amber-200 ring-1 ring-inset ring-amber-400/30",
  rejected: "bg-rose-500/10 text-rose-200 ring-1 ring-inset ring-rose-400/30",
};

const NOTE_COLLAPSE_AT = 70;

type StatusProps = {
  isSimulation: boolean;
  visibility: CharacterVisibility;
  moderation: ModerationStatus;
};

/** 작품 종류 · 공개 범위 · 검수 상태를 서로 다른 칩으로 분리해 보여 준다. 라벨은 characterVisibility가 소유한다. */
export function StudioWorkStatus({ isSimulation, visibility, moderation }: StatusProps) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="작품 상태" data-testid="studio-work-status">
      <li
        className={cn(
          CHIP,
          isSimulation
            ? "bg-cyan-500/10 text-cyan-200 ring-1 ring-inset ring-cyan-400/25"
            : "bg-violet-500/10 text-violet-200 ring-1 ring-inset ring-violet-400/25",
        )}
        data-status="kind"
      >
        {isSimulation ? "시뮬레이션" : "캐릭터"}
      </li>
      <li className={cn(CHIP, VISIBILITY_TONE[visibility])} data-status="visibility">
        {visibilityLabel(visibility)}
      </li>
      <li className={cn(CHIP, MODERATION_TONE[moderation])} data-status="moderation">
        {moderationLabel(moderation)}
      </li>
    </ul>
  );
}

const PENDING_HINT = "검수가 끝나기 전에는 다른 사람에게 보이지 않습니다.";
const REJECTED_HINT = "반려되어 다른 사람에게 보이지 않습니다. 내용을 수정한 뒤 다시 저장해 주세요.";

function RejectionReason({ reason }: { reason: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = reason.length > NOTE_COLLAPSE_AT;
  return (
    <>
      <p className="mt-1.5 font-semibold text-rose-200">반려 사유</p>
      <p
        className={cn("whitespace-pre-line break-words text-rose-100/90", !expanded && long && "line-clamp-3")}
        data-testid="studio-work-reject-reason"
      >
        {reason}
      </p>
      {long ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 inline-flex min-h-8 items-center rounded-md px-1 text-xs font-semibold text-rose-200 underline underline-offset-2 hover:text-white"
        >
          {expanded ? "접기" : "전체 보기"}
        </button>
      ) : null}
    </>
  );
}

export function StudioWorkNotice({ moderation, note }: { moderation: ModerationStatus; note: string }) {
  if (moderation === "approved") return null;
  if (moderation === "pending") {
    return (
      <p className="text-xs leading-relaxed text-amber-200/90" data-testid="studio-work-notice">
        {PENDING_HINT}
      </p>
    );
  }
  const reason = note.trim();
  return (
    <div
      className="rounded-lg border border-rose-400/25 bg-rose-500/[0.07] px-2.5 py-2 text-xs leading-relaxed text-rose-100"
      data-testid="studio-work-notice"
    >
      <p>{REJECTED_HINT}</p>
      {reason ? <RejectionReason reason={reason} /> : null}
    </div>
  );
}
