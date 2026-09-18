export type TranscriptMessage = { role: string };

/** Client transcript mirror of server hasLaterMessageAfter for variant picker UX. */
export function hasLaterTranscriptTurn(
  messages: TranscriptMessage[],
  messageIndex: number
): boolean {
  for (let j = messageIndex + 1; j < messages.length; j++) {
    const role = messages[j]?.role;
    if (role === "user" || role === "assistant") return true;
  }
  return false;
}

export function shouldShowVariantPicker(opts: {
  role: string;
  variantCount: number;
  canonAdopted?: boolean;
  showToolbar: boolean;
  messageIndex: number;
  messages: TranscriptMessage[];
}): boolean {
  return (
    opts.showToolbar &&
    opts.role === "assistant" &&
    opts.variantCount > 1 &&
    !opts.canonAdopted &&
    !hasLaterTranscriptTurn(opts.messages, opts.messageIndex)
  );
}
