import type { TrpgSheetHudCard } from "./sheetView";

/** Presentation-only: the viewer's canonical sheet remains owned by TrpgSelfSheetHud. */
export function partyDetailedSheetCards(
  sheets: readonly TrpgSheetHudCard[]
): TrpgSheetHudCard[] {
  return sheets.filter((card) => !card.isSelf);
}
