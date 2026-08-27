import {
  classifyNovelParagraph,
  novelParagraphSpacingClass,
  type NovelParagraphKind,
} from "@/lib/novelParagraphs";
import type { TrpgSpeechBeat } from "./sceneSpeech";

/** Map a parsed scene beat to a NovelText paragraph kind for spacing only. */
export function classifyTrpgSceneBeatParagraphKind(beat: TrpgSpeechBeat): NovelParagraphKind {
  if (beat.speaker === "GM") return "narration";
  if (beat.speaker) return "dialogue";
  const trimmed = beat.text.trim();
  if (!trimmed) return "narration";
  return classifyNovelParagraph(trimmed);
}

/** Inter-beat gap delegates to the shared AI spacing policy — no local em values. */
export function trpgSceneBeatSpacingClass(
  beat: TrpgSpeechBeat,
  previous: TrpgSpeechBeat | null
): string {
  if (!previous) return "";
  return novelParagraphSpacingClass(
    classifyTrpgSceneBeatParagraphKind(beat),
    classifyTrpgSceneBeatParagraphKind(previous),
    "ai"
  );
}
