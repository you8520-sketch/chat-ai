import type { TrpgPublicParticipant } from "./snapshot";
import type { RoundPresentationMode, RoundPresentationPhase } from "./roundPresentation";

export type LiveTurnProcessStage =
  | "none"
  | "opening"
  | "wait_humans"
  | "bots"
  | "presenting"
  | "rolls"
  | "gm"
  | "reroll";

export function isLiveTurnCinematicMotion(
  mode: RoundPresentationMode,
  phase: RoundPresentationPhase
): boolean {
  return (
    mode === "cinematic" &&
    (phase === "actor-action" || phase === "actor-dice" || phase === "actor-result")
  );
}

/** Hide the process pill when dice/result or revealing GM owns the screen. */
export function shouldHideProcessTimerForPresentation(opts: {
  overlayVisible: boolean;
  presentationMode: RoundPresentationMode | string;
  presentationPhase: RoundPresentationPhase | string;
  gmProseRevealing: boolean;
}): boolean {
  if (opts.overlayVisible) return true;
  if (opts.presentationMode !== "cinematic") return false;
  if (opts.presentationPhase === "actor-dice" || opts.presentationPhase === "actor-result") return true;
  if (opts.presentationPhase === "complete") return true;
  if (opts.presentationPhase === "gm-narration" && opts.gmProseRevealing) return true;
  return false;
}

/** Single owner: cinematic actor-action slot waiting for backend bot action materialization. */
export function resolveCinematicWaitingForBotAction(opts: {
  cinematicActorAction: boolean;
  cinematicAiActionActive: boolean;
  activePresentationActionKind?: string | null;
  activePresentationActorHasAction: boolean;
  activePresentationActionAvailable: boolean;
  botGenerationInFlight?: boolean;
  workType: string;
}): boolean {
  if (!opts.cinematicActorAction || opts.cinematicAiActionActive) return false;
  if (opts.activePresentationActionKind === "human") return false;
  if (opts.activePresentationActorHasAction && opts.activePresentationActionAvailable) return false;
  return opts.botGenerationInFlight === true || opts.workType === "generate_bots";
}

export function liveTurnProcessStage(opts: {
  waitingOpening: boolean;
  narrationRerolling: boolean;
  workType: string;
  phase: string;
  viewerLocked: boolean;
  cinematicMotion: boolean;
  presentationStarting: boolean;
  gmTextReady: boolean;
  botGenerationInFlight?: boolean;
  overlayVisible?: boolean;
  presentationMode?: RoundPresentationMode | string;
  presentationPhase?: RoundPresentationPhase | string;
  cinematicAiActionActive?: boolean;
  /** Cinematic actor-action slot waiting for backend bot action materialization (not human). */
  cinematicWaitingForBotAction?: boolean;
  gmProseRevealing?: boolean;
}): LiveTurnProcessStage {
  if (opts.waitingOpening) return "opening";
  if (opts.narrationRerolling) return "reroll";
  if (
    shouldHideProcessTimerForPresentation({
      overlayVisible: opts.overlayVisible === true,
      presentationMode: opts.presentationMode ?? (opts.cinematicMotion ? "cinematic" : "idle"),
      presentationPhase: opts.presentationPhase ?? (opts.cinematicMotion ? "actor-action" : "idle"),
      gmProseRevealing: opts.gmProseRevealing === true,
    })
  ) {
    return "none";
  }
  if (
    opts.presentationMode === "cinematic" &&
    opts.presentationPhase === "actor-action"
  ) {
    if (opts.cinematicAiActionActive) return "presenting";
    if (
      opts.cinematicWaitingForBotAction &&
      (opts.botGenerationInFlight || opts.workType === "generate_bots")
    ) {
      return "bots";
    }
    return "none";
  }
  if (opts.presentationMode === "cinematic" && opts.presentationPhase === "gm-narration") {
    return opts.gmTextReady ? "none" : "gm";
  }
  if (opts.workType === "bot_retry_required" && !opts.botGenerationInFlight) return "none";
  if (opts.workType === "wait_humans" && opts.viewerLocked) return "wait_humans";
  if (opts.workType === "generate_bots" || opts.botGenerationInFlight) return "bots";
  if (
    opts.workType === "acquire_gm_lock" ||
    opts.phase === "LOCKING_ACTIONS" ||
    opts.phase === "ADJUDICATING" ||
    opts.phase === "ROLLING"
  ) {
    return "rolls";
  }
  if (opts.phase === "GENERATING_NARRATION" && !opts.gmTextReady) return "gm";
  return "none";
}

export function isLiveTurnProcessing(opts: {
  waitingOpening: boolean;
  narrationRerolling: boolean;
  viewerLocked: boolean;
  phase: string;
  workType: string;
  cinematicMotion: boolean;
  presentationStarting: boolean;
  gmTextReady: boolean;
  botGenerationInFlight?: boolean;
}): boolean {
  if (opts.waitingOpening || opts.narrationRerolling) return true;
  if (opts.presentationStarting || opts.cinematicMotion) return true;
  if (opts.phase === "GENERATING_NARRATION" && !opts.gmTextReady) return true;
  if (opts.workType === "bot_retry_required" && !opts.botGenerationInFlight) return false;
  if (opts.phase === "LOCKING_ACTIONS" || opts.phase === "ADJUDICATING" || opts.phase === "ROLLING") {
    return true;
  }
  if (opts.workType === "generate_bots" || opts.botGenerationInFlight || opts.workType === "acquire_gm_lock") {
    return true;
  }
  return opts.workType === "wait_humans" && opts.viewerLocked;
}

export function liveTurnBotProgress(
  participants: readonly Pick<TrpgPublicParticipant, "kind" | "canAct" | "status" | "ready">[]
): { done: number; total: number } | null {
  const acting = participants.filter(
    (part) => part.kind === "ai_character" && part.canAct && part.status === "active"
  );
  if (acting.length === 0) return null;
  const done = acting.filter((part) => part.ready === "submitted").length;
  if (done > acting.length) return null;
  return { done, total: acting.length };
}

export function liveTurnProcessLabel(opts: {
  stage: LiveTurnProcessStage;
  botProgress?: { done: number; total: number } | null;
}): string | null {
  switch (opts.stage) {
    case "opening":
      return "오프닝 장면 준비 중";
    case "wait_humans":
      return "다른 플레이어 입력 대기 중";
    case "bots":
      return opts.botProgress
        ? `동료 행동 구성 중 · ${opts.botProgress.done}/${opts.botProgress.total}`
        : "동료 행동 구성 중";
    case "presenting":
      return "동료 행동 표시 중";
    case "rolls":
      return "라운드 판정 준비 중";
    case "gm":
      return "GM 장면 작성 중";
    case "reroll":
      return "장면 다시 작성 중";
    default:
      return null;
  }
}

export function formatLiveTurnProcessStatus(opts: {
  stage: LiveTurnProcessStage;
  elapsedSec: number;
  botProgress?: { done: number; total: number } | null;
}): string | null {
  const label = liveTurnProcessLabel(opts);
  if (!label) return null;
  return `● ${label} · ${Math.max(0, Math.floor(opts.elapsedSec))}초`;
}

export function nextLiveTurnElapsedSec(opts: {
  active: boolean;
  startedAt: number | null;
  now: number;
}): { startedAt: number | null; elapsedSec: number } {
  if (!opts.active) return { startedAt: null, elapsedSec: 0 };
  const startedAt = opts.startedAt ?? opts.now;
  return {
    startedAt,
    elapsedSec: Math.max(0, Math.floor((opts.now - startedAt) / 1000)),
  };
}
