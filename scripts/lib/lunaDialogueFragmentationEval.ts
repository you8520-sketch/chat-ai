/** Evaluation-only dialogue fragmentation status — not injected into generation prompts. */

export type DialogueFragmentationSceneType =
  | "CONFLICT_DIALOGUE"
  | "NEGOTIATION"
  | "DIALOGUE_CENTERED"
  | "QUIET_RELATIONSHIP"
  | "PROCEDURE_COMPLETION"
  | "URGENT_ACTION"
  | string;

export function isDialogueCenteredSceneType(sceneType: string): boolean {
  return (
    sceneType === "CONFLICT_DIALOGUE" ||
    sceneType === "NEGOTIATION" ||
    sceneType === "DIALOGUE_CENTERED"
  );
}

export type DialogueFragmentationInput = {
  mergeableDialogueFragmentPairs: number;
  maxConsecutiveSameSpeakerDialogueBlocks: number;
  dialogueBlockCount: number;
  shortDialogueRatio: number;
  dialogueBlocksPer1000VisibleChars: number;
  sceneType: DialogueFragmentationSceneType;
  /** Same-speaker run of >=3 short blocks — proxy for split single intention */
  consecutiveShortSameSpeakerBlocks?: number;
};

export function consecutiveShortSameSpeakerBlocks(
  blocks: Array<{ speaker: string; visible: number }>
): number {
  let max = 0;
  let run = 0;
  let last: string | null = null;
  for (const b of blocks) {
    if (b.speaker !== "unknown" && b.visible <= 15 && b.speaker === last) {
      run += 1;
      max = Math.max(max, run + 1);
    } else {
      run = 0;
      last = b.speaker;
      if (b.speaker !== "unknown") last = b.speaker;
    }
  }
  return max;
}

export function dialogueFragmentationStatus(
  input: DialogueFragmentationInput
): "PASS" | "WARNING" | "FAILURE" {
  const dialogueCentered = isDialogueCenteredSceneType(input.sceneType);
  const urgentAction = input.sceneType === "URGENT_ACTION";
  /** Same-speaker short runs alone are not failure — need mergeable split-intent signal. */
  const splitThreePlus =
    (input.consecutiveShortSameSpeakerBlocks ?? 0) >= 3 &&
    input.mergeableDialogueFragmentPairs >= 2;

  if (input.mergeableDialogueFragmentPairs >= 4) return "FAILURE";
  if (splitThreePlus) return "FAILURE";
  if (
    !urgentAction &&
    input.dialogueBlockCount >= 13 &&
    input.shortDialogueRatio >= 0.6 &&
    input.mergeableDialogueFragmentPairs >= 2 &&
    !dialogueCentered
  ) {
    return "FAILURE";
  }

  if (input.mergeableDialogueFragmentPairs >= 2 && input.mergeableDialogueFragmentPairs <= 3) {
    return "WARNING";
  }
  if (
    !urgentAction &&
    input.shortDialogueRatio >= 0.7 &&
    input.dialogueBlocksPer1000VisibleChars >= 1.5 &&
    input.mergeableDialogueFragmentPairs >= 1 &&
    !dialogueCentered
  ) {
    return "WARNING";
  }

  return "PASS";
}

export function fragmentationStatusRank(s: "PASS" | "WARNING" | "FAILURE"): number {
  return s === "FAILURE" ? 2 : s === "WARNING" ? 1 : 0;
}
