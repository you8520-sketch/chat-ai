/**
 * Recovery draft write lifetime — one gate per consumeChatStream session.
 * ChatStreamDraft is room-global (single slot); writes must stop at server terminal.
 */
export type StreamDraftWriteGate = {
  isActive: () => boolean;
  tryWrite: (write: () => void) => void;
  closeAndClear: (clear: () => void) => void;
};

export function createStreamDraftWriteGate(): StreamDraftWriteGate {
  let active = true;
  return {
    isActive: () => active,
    tryWrite(write) {
      if (active) write();
    },
    closeAndClear(clear) {
      if (!active) return;
      active = false;
      clear();
    },
  };
}
