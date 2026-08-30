/** ONE REVEAL SESSION = ONE REQUEST ID = ONE GENERATION IDENTITY. */
export type RevealSessionIdentity = {
  requestId: string;
  aiIndex: number;
};

export type RevealRowSnapshot = {
  role?: string;
  requestId?: string | null;
} | null | undefined;

export function isRevealRowWritable(
  identity: RevealSessionIdentity,
  row: RevealRowSnapshot,
  rowIndex: number
): boolean {
  if (rowIndex !== identity.aiIndex) return false;
  if (!row || row.role !== "assistant") return false;
  return row.requestId === identity.requestId;
}

export type PendingRevealSession = {
  controller: { reset: () => void };
  requestId: string;
  aiIndex: number;
};
