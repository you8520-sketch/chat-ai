import { stripEmotionTagsForDisplay } from "@/lib/emotionTag";
import { stripInternalTagLeakage, stripRpMetaPreamble } from "@/lib/narrativeRules";
import { savedVisibleTextForReceipt } from "@/lib/chatRichContent";
export { visibleAssistantDisplayKoreanWordCount } from "@/lib/koreanWordCount";

export type VisibleAssistantLengthOpts = {
  allowHtml?: boolean;
  templateLabels?: string[];
  templateFields?: { label: string; hint: string }[];
  includeStatus?: boolean;
};

/** 채팅에 보이는 assistant 텍스트 — HTML·마크업 코드 제외, 표·카드 표시 글자 포함 */
export function visibleAssistantDisplayText(content: string): string {
  const cleaned = stripInternalTagLeakage(content);
  const display = stripRpMetaPreamble(stripEmotionTagsForDisplay(cleaned));
  return savedVisibleTextForReceipt(display);
}

/** tier 최소·목표·최대·UI 카운트 공통 — HTML 코드 제외 표시 글자수 */
export function visibleAssistantDisplayCharCount(content: string): number {
  return visibleAssistantDisplayText(content).length;
}

/** @alias visibleAssistantDisplayCharCount */
export function visibleAssistantMessageLength(
  content: string,
  _opts?: VisibleAssistantLengthOpts
): number {
  return visibleAssistantDisplayCharCount(content);
}

/** @deprecated visibleAssistantDisplayCharCount 사용 */
export function countVisibleAssistantProseChars(content: string): number {
  return visibleAssistantDisplayCharCount(content);
}
