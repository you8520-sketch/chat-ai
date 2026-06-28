/** Turn 0 user half — raw history alternation only (not a system block). */
export const OPENING_TURN_USER = "[채팅 시작]";

export function isOpeningTurn(turn: { user: string }): boolean {
  return turn.user === OPENING_TURN_USER;
}

export function extractGreetingFromMessageRows(
  rows: Array<{ role: string; model?: string; content: string }>
): string | null {
  for (const row of rows) {
    if (row.role === "assistant" && row.model === "greeting" && row.content.trim()) {
      return row.content.trim();
    }
  }
  return null;
}
