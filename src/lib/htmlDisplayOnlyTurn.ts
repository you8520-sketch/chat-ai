import { extractOocSnippets } from "@/lib/userImpersonationPolicy";
import { userRequestsHtmlOutput } from "@/lib/htmlVisualCardPolicy";
import { DISPLAY_INPUT_ONLY, RP_STOP_OR_FLASH_ONLY } from "@/lib/oocHtmlTurnPatterns";

export { RP_STOP_OR_FLASH_ONLY } from "@/lib/oocHtmlTurnPatterns";

function snippetRequestsHtmlDisplayOnly(snippet: string): boolean {
  const s = snippet.trim();
  if (!s || !userRequestsHtmlOutput(s)) return false;
  return (
    DISPLAY_INPUT_ONLY.test(s) ||
    /플래시\s*만|flash\s*only|메인\s*모델\s*(?:금지|쓰지|없)/i.test(s)
  );
}

function snippetRequestsOocCreativeHtml(snippet: string): boolean {
  const s = snippet.trim();
  if (!s || !userRequestsHtmlOutput(s)) return false;
  if (DISPLAY_INPUT_ONLY.test(s)) return false;
  return RP_STOP_OR_FLASH_ONLY.test(s);
}

/** 유저가 RP 없이 입력 내용 HTML 표시만 요청 — Flash-only 턴 */
export function isHtmlDisplayOnlyTurn(userMessage: string): boolean {
  const trimmed = userMessage.trim();
  if (!trimmed) return false;

  for (const snippet of extractOocSnippets(trimmed)) {
    if (snippetRequestsHtmlDisplayOnly(snippet)) return true;
  }

  if (!userRequestsHtmlOutput(trimmed)) return false;
  return (
    DISPLAY_INPUT_ONLY.test(trimmed) ||
    /플래시\s*만|flash\s*only|메인\s*모델\s*(?:금지|쓰지|없)/i.test(trimmed)
  );
}

/**
 * OOC + RP 중단 + HTML 연출 — 메인 모델 RP 생략, Flash가 OOC 지시대로 UI/내용 생성
 */
export function isOocCreativeHtmlTurn(userMessage: string): boolean {
  const trimmed = userMessage.trim();
  if (!trimmed) return false;

  for (const snippet of extractOocSnippets(trimmed)) {
    if (snippetRequestsOocCreativeHtml(snippet)) return true;
  }

  if (!userRequestsHtmlOutput(trimmed)) return false;
  if (DISPLAY_INPUT_ONLY.test(trimmed)) return false;
  return RP_STOP_OR_FLASH_ONLY.test(trimmed);
}

/** Flash-only — 메인 OpenRouter 스킵 */
export function isHtmlFlashOnlyTurn(userMessage: string): boolean {
  return isHtmlDisplayOnlyTurn(userMessage) || isOocCreativeHtmlTurn(userMessage);
}

function messageHasOocHtmlIntent(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || !userRequestsHtmlOutput(trimmed)) return false;
  if (extractOocSnippets(trimmed).some((s) => userRequestsHtmlOutput(s))) return true;
  return /^OOC\s*[:\：]/i.test(trimmed) || /[\(（]\s*OOC/i.test(trimmed) || /\*\s*\[OOC/i.test(trimmed);
}

/** 채팅 입력 OOC+HTML 연출 턴 — 제작자 상태창 위젯 비표시 */
export function chatInputSuppressesStatusWidget(userMessage: string): boolean {
  if (isHtmlFlashOnlyTurn(userMessage)) return true;
  return messageHasOocHtmlIntent(userMessage);
}
