/**
 * Background·서버 전담 산출물 — OpenRouter primary 컨텍스트·출력 방화벽
 */

import type { ChatMsg } from "@/lib/ai";
import {
  extractHtmlStatusFieldLabels,
  HTML_OUTPUT_OWNERSHIP_BLOCK,
  stripPromotedHtmlVisualCardContent,
} from "@/lib/htmlVisualCardPolicy";
import {
  stripAllStatusWindowOutputArtifacts,
  stripStatusWindowJsonBlock,
  extractModelHtmlVisualFences,
} from "@/lib/statusMeta/stripArtifacts";
import { stripPromotedStatusWindowContent } from "@/lib/statusWindowNotePolicy";

export type FlashFirewallOpts = {
  /** @deprecated 단일 HTML OUTPUT OWNERSHIP 블록 — opts 무시 */
  modelOutputsPlainStatus?: boolean;
  /** @deprecated 단일 HTML OUTPUT OWNERSHIP 블록 — opts 무시 */
  statusWidgetActive?: boolean;
  /** @deprecated 단일 HTML OUTPUT OWNERSHIP 블록 — opts 무시 */
  mainModelOwnsHtmlVisualCard?: boolean;
  /** @deprecated 단일 HTML OUTPUT OWNERSHIP 블록 — opts 무시 */
  mainModelOwnsRelationshipExtract?: boolean;
};

/** 글로벌 로어북 HTML 항목 시드 + primary system tail */
export function buildPrimaryModelFlashFirewallBlock(_opts?: FlashFirewallOpts): string {
  return HTML_OUTPUT_OWNERSHIP_BLOCK;
}

/** @deprecated use buildPrimaryModelFlashFirewallBlock(opts) */
export const PRIMARY_MODEL_FLASH_OWNED_BLOCK = buildPrimaryModelFlashFirewallBlock();

export type SanitizePrimaryModelOpts = {
  modelOutputsPlainStatus?: boolean;
  modelOutputsHtmlVisualCard?: boolean;
};

/** Primary 모델 **출력** 후처리 — HTML/JSON 제거 · plain 상태창은 모델 출력 시 유지 */
export function sanitizePrimaryModelOutputArtifacts(
  text: string,
  opts?: SanitizePrimaryModelOpts
): string {
  if (opts?.modelOutputsHtmlVisualCard) {
    return stripAllStatusWindowOutputArtifacts(text, { modelOutputsHtmlVisualCard: true });
  }
  if (opts?.modelOutputsPlainStatus) {
    let out = stripStatusWindowJsonBlock(text);
    out = extractModelHtmlVisualFences(out).prose;
    return out.trimEnd();
  }
  return stripAllStatusWindowOutputArtifacts(text, { stripModelHtml: true });
}

/** Primary 모델 **입력** 소스(캐릭터 설정·노트 등) — Flash 담당 UI/상태 템플릿 제거 */
export function sanitizePrimaryModelContextSource(text: string): string {
  const raw = text?.trim() ?? "";
  if (!raw) return "";
  let out = stripPromotedStatusWindowContent(raw);
  out = stripPromotedHtmlVisualCardContent(out, extractHtmlStatusFieldLabels(out));
  return out.trim();
}

const HISTORY_STRIPPED_PLACEHOLDER =
  "[이전 assistant 응답 — RP 본문만 표시; 상태창/HTML/JSON은 Flash·서버 출력]";

/** 히스토리 assistant 턴 — plain 상태창은 모델 연속성을 위해 유지 */
export function sanitizePrimaryModelAssistantHistory(
  content: string,
  opts?: SanitizePrimaryModelOpts
): string {
  const trimmed = content.trim();
  if (!trimmed) return trimmed;
  const cleaned = sanitizePrimaryModelOutputArtifacts(trimmed, opts).trim();
  if (opts?.modelOutputsPlainStatus || opts?.modelOutputsHtmlVisualCard) return cleaned;
  return cleaned || HISTORY_STRIPPED_PLACEHOLDER;
}

/** OpenRouter primary 컨텍스트용 — assistant 턴만 Flash 산출물 제거 */
export function sanitizePrimaryModelHistoryMessages(
  messages: ChatMsg[],
  opts?: SanitizePrimaryModelOpts
): ChatMsg[] {
  return messages.map((m) =>
    m.role === "assistant"
      ? { ...m, content: sanitizePrimaryModelAssistantHistory(m.content, opts) }
      : m
  );
}
