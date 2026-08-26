import {
  classifyNovelParagraph,
  novelParagraphSpacingClass,
  type NovelParagraphKind,
} from "@/lib/novelParagraphs";
import type { TrpgSpeechBeat } from "./sceneSpeech";

/** Classify a scene beat for inter-beat GM spacing (pairs with novelParagraphSpacingClass gm mode). */
export function classifyTrpgSceneBeatKind(beat: TrpgSpeechBeat): NovelParagraphKind {
  if (beat.speaker === "GM") return "narration";
  if (beat.speaker) return "dialogue";
  return classifyNovelParagraph(beat.text.trim());
}

/** Inter-beat gap between adjacent GM scene beats — same GM spacing policy as intra-NovelText blocks. */
export function trpgSceneBeatSpacingClass(
  beat: TrpgSpeechBeat,
  prevBeat: TrpgSpeechBeat | null
): string {
  if (!prevBeat) return "";
  return novelParagraphSpacingClass(
    classifyTrpgSceneBeatKind(beat),
    classifyTrpgSceneBeatKind(prevBeat),
    "gm"
  );
}
