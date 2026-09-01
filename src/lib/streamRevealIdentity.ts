import type { StreamRevealController } from "@/lib/streamReveal";

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
  controller: StreamRevealController;
  requestId: string;
  aiIndex: number;
  /** Snap visible buffer to already-received server text during stream. */
  catchUpToReceived?: () => void;
};
