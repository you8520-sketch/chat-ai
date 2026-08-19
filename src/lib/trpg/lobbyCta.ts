/** Lobby re-enter CTA label. Campaign status only — no runtime/phase coupling. */
export function trpgLobbyReenterCtaLabel(campaignStatus: string): string {
  switch (campaignStatus) {
    case "CHARACTER_SETUP":
      return "캐릭터 설정 계속하기";
    case "WAITING_FOR_PLAYERS":
      return "대기실 열기";
    case "CAMPAIGN_COMPLETE":
      return "캠페인 보기";
    default:
      return "캠페인 계속하기";
  }
}

export function trpgLobbyCanInvite(campaignStatus: string): boolean {
  return campaignStatus === "CHARACTER_SETUP" || campaignStatus === "WAITING_FOR_PLAYERS";
}
