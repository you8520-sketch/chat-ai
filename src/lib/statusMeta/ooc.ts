import { extractOocSnippets } from "@/lib/userImpersonationPolicy";
import { userRequestsHtmlOutput } from "@/lib/htmlVisualCardPolicy";

const STATUS_OOC_TOPIC =
  /상태창|状态창|状態창|status\s*window|스탯\s*창|스텟\s*창|status\s*panel|stat\s*window/i;

/** OOC 상태창 1회 요청 (HTML 없어도 — 서버가 줄글 상태창으로 렌더) */
export function userMessageRequestsStatusWindowOoc(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  for (const snippet of extractOocSnippets(trimmed)) {
    if (STATUS_OOC_TOPIC.test(snippet)) return true;
  }
  return STATUS_OOC_TOPIC.test(trimmed) && /(?:보여|띄워|출력|표시|보기)/i.test(trimmed);
}

/** OOC 상태창 + HTML — HTML Flash 경로 (StatusMeta 줄글 추출과 중복 방지) */
export function userMessageRequestsStatusWindowOocWithHtml(text: string): boolean {
  return userRequestsHtmlOutput(text) && userMessageRequestsStatusWindowOoc(text);
}
