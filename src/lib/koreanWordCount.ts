import { visibleAssistantDisplayText } from "@/lib/chatDisplayLength";

/** RP 표시 텍스트 — 연속 한글 덩어리(공백·구두점으로 구분) = 1단어 */
export function countKoreanWords(text: string): number {
  const visible = visibleAssistantDisplayText(text);
  if (!visible.trim()) return 0;
  return visible.split(/[^가-힣]+/).filter(Boolean).length;
}

/** @alias countKoreanWords — tier 검증·UI 공통 */
export function visibleAssistantDisplayKoreanWordCount(text: string): number {
  return countKoreanWords(text);
}
