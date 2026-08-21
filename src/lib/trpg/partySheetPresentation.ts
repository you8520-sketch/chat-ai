import type { TrpgSheetHudCard } from "./sheetView";

/** Presentation-only: the viewer's canonical sheet remains owned by TrpgSelfSheetHud. */
export function partyDetailedSheetCards(
  sheets: readonly TrpgSheetHudCard[],
  viewerParticipantId: number | null
): TrpgSheetHudCard[] {
  return sheets.filter(
    (card) =>
      !card.isSelf &&
      (viewerParticipantId == null || card.participantId !== viewerParticipantId)
  );
}

export function viewerSelfSheetCard(
  sheets: readonly TrpgSheetHudCard[],
  viewerParticipantId: number | null
): TrpgSheetHudCard | undefined {
  return (
    sheets.find((card) => card.isSelf) ??
    sheets.find(
      (card) =>
        viewerParticipantId != null &&
        card.participantId === viewerParticipantId
    )
  );
}
