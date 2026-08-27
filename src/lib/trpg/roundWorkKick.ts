import type { TrpgRoundPhase } from "./types";
import type { TrpgRoundWork } from "./roundLock";

export function shouldKickTrpgAdvance(opts: {
  workType: TrpgRoundWork["type"];
  phase: TrpgRoundPhase | "NONE";
  botGenerationInFlight: boolean;
  gmGenerationInFlight: boolean;
  gmStaleReclaimEligible?: boolean;
}): boolean {
  if (opts.gmStaleReclaimEligible) return true;
  switch (opts.workType) {
    case "generate_bots":
      return !opts.botGenerationInFlight;
    case "acquire_gm_lock":
      return !opts.gmGenerationInFlight && opts.phase !== "GENERATING_NARRATION";
    case "wait_humans":
    case "bot_retry_required":
    case "idle":
      return false;
    default: {
      const _exhaustive: never = opts.workType;
      return _exhaustive;
    }
  }
}
