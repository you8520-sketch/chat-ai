import type { TrpgRoundPhase } from "./types";

const ACTIVE_GENERATION_PHASES = new Set<TrpgRoundPhase | string>([
  "LOCKING_ACTIONS",
  "ADJUDICATING",
  "ROLLING",
  "GENERATING_NARRATION",
  "APPLYING_STATE",
]);

/** True when the room should treat server-side generation as in progress (not bot_retry_required idle). */
export function trpgRoomGenerating(opts: {
  phase: TrpgRoundPhase | string;
  workType: string;
  botGenerationInFlight: boolean;
  narrationRerolling: boolean;
}): boolean {
  return (
    ACTIVE_GENERATION_PHASES.has(String(opts.phase)) ||
    opts.workType === "generate_bots" ||
    opts.botGenerationInFlight ||
    opts.workType === "acquire_gm_lock" ||
    opts.narrationRerolling
  );
}

export function trpgRetryBotsDisabled(opts: { busy: boolean; botGenerationInFlight: boolean }): boolean {
  return opts.busy || opts.botGenerationInFlight;
}
