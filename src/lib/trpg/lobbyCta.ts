import { TRPG_ROUND_PHASES, type TrpgRoundPhase } from "./types";

function isTrpgRoundPhase(value: string): value is TrpgRoundPhase {
  return (TRPG_ROUND_PHASES as readonly string[]).includes(value);
}

/** Lobby re-enter CTA label. Campaign status only — no runtime/phase coupling. */
export function trpgLobbyReenterCtaLabel(campaignStatus: string): string {
  if (!isTrpgRoundPhase(campaignStatus)) return "계속";
  switch (campaignStatus) {
    case "CHARACTER_SETUP":
      return "설정 계속";
    case "WAITING_FOR_PLAYERS":
      return "대기실";
    case "CAMPAIGN_COMPLETE":
      return "보기";
    case "ACTION_INPUT":
    case "BOT_ACTION":
    case "LOCKING_ACTIONS":
    case "ADJUDICATING":
    case "ROLLING":
    case "GENERATING_NARRATION":
    case "APPLYING_STATE":
    case "ROUND_COMPLETE":
    case "ERROR_RECOVERY":
      return "계속";
    default: {
      const _exhaustive: never = campaignStatus;
      return _exhaustive;
    }
  }
}

export function trpgLobbyCanInvite(campaignStatus: string): boolean {
  return campaignStatus === "CHARACTER_SETUP" || campaignStatus === "WAITING_FOR_PLAYERS";
}
