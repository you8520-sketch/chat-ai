/**
 * Flash·서버 전담 산출물 — OpenRouter primary(Opus 등) 컨텍스트·출력 방화벽
 */

import type { ChatMsg } from "@/lib/ai";
import {
  extractHtmlStatusFieldLabels,
  HTML_FLASH_SERVER_ONLY_BLOCK,
  stripPromotedHtmlVisualCardContent,
} from "@/lib/htmlVisualCardPolicy";
import {
  stripAllStatusWindowOutputArtifacts,
  stripStatusWindowJsonBlock,
  extractModelHtmlVisualFences,
} from "@/lib/statusMeta/stripArtifacts";
import { stripPromotedStatusWindowContent } from "@/lib/statusWindowNotePolicy";

export type FlashFirewallOpts = {
  /** plain 줄글 매턴 상태창 — 메인 모델이 하단 출력, Flash는 HTML만 */
  modelOutputsPlainStatus?: boolean;
  /** 제작자 상태창 위젯 — RP 후 <<<STATUS_VALUES>>> JSON만 허용 */
  statusWidgetActive?: boolean;
};

function buildFlashOwnedForbiddenList(
  modelOutputsPlainStatus: boolean,
  statusWidgetActive?: boolean
): string {
  if (statusWidgetActive) {
    return `Creator status widget is ON. Gemini Flash handles user-note HTML/plain status when needed.

FORBIDDEN in RP prose:
- Inline status lines, pipe tables, \`\`\`html, \`\`\`json fences, bare trailing { ... } objects in prose

Status values: see [STATUS WIDGET] field spec above.`;
  }

  if (modelOutputsPlainStatus) {
    return `Gemini Flash generates **HTML visual cards only** when HTML is explicitly requested.
YOU output plain-text / markdown status lines at the bottom when user note requires them.

FORBIDDEN in your reply:
- \`\`\`html / HTML tags / UI mockups (Flash renders HTML)
- \`\`\`json / trailing { ... } status objects
- Translation of character lore, user notes, or prior turns

ALLOWED at the very end after one blank line:
- Plain-text status field lines ("라벨 : 값") per user note template
- Markdown pipe-table status when user note specifies markdown format`;
  }

  return `Gemini Flash (background) + server jobs own ALL of the following. You only write Korean RP prose and dialogue.

1. Status windows — pipe-table, plain-text emoji fields, timestamps/stats UI, \`\`\`json status blocks
2. HTML visual cards — \`\`\`html, inline HTML, messenger/alert/card UI
3. Character-setting translation — English prompt layers are pre-built by Flash; never translate or rewrite setting chunks
4. Memory / history compression — long-term memory, rolling summaries, status-meta extraction (never output extraction JSON)

FORBIDDEN in your reply (stripped even if you generate them):
- | pipe tables |, status panels, structured UI metadata
- \`\`\`json / trailing { ... } status objects
- <<<STATUS_VALUES>>>, <<<STATUS_VALUES char>>>, <<<STATUS_VALUES user>>>, <<<END_STATUS>>> markers
- \`\`\`html / HTML tags / UI mockups
- Translation of character lore, user notes, or prior turns into another language

Do NOT copy status/HTML/JSON templates from character setting, user note, persona, or chat history.`;
}

/** 글로벌 로어북 HTML 항목 시드 + primary system tail */
export function buildPrimaryModelFlashFirewallBlock(opts?: FlashFirewallOpts): string {
  const modelOutputsPlainStatus = opts?.modelOutputsPlainStatus === true;
  const statusWidgetActive = opts?.statusWidgetActive === true;
  const ownedBlock = statusWidgetActive
    ? `[STATUS WIDGET — CREATOR (SERVER RENDERS HTML)]
You fill JSON values in <<<STATUS_VALUES>>> after RP prose. Flash/server render the widget UI.`
    : modelOutputsPlainStatus
    ? `[HTML VISUAL CARD — SERVER GENERATED]
User enabled HTML visual output. Gemini Flash generates \`\`\`html blocks when HTML is explicitly requested.

Plain-text / markdown status windows (no HTML keyword) = YOU output at the bottom of your reply.`
    : HTML_FLASH_SERVER_ONLY_BLOCK;

  return `${ownedBlock}

[FLASH-OWNED — PRIMARY MODEL MUST NOT DO THESE]
${buildFlashOwnedForbiddenList(modelOutputsPlainStatus, statusWidgetActive)}`;
}

/** @deprecated use buildPrimaryModelFlashFirewallBlock(opts) */
export const PRIMARY_MODEL_FLASH_OWNED_BLOCK = buildPrimaryModelFlashFirewallBlock();

export type SanitizePrimaryModelOpts = {
  modelOutputsPlainStatus?: boolean;
};

/** Primary 모델 **출력** 후처리 — HTML/JSON 제거 · plain 상태창은 모델 출력 시 유지 */
export function sanitizePrimaryModelOutputArtifacts(
  text: string,
  opts?: SanitizePrimaryModelOpts
): string {
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
  if (opts?.modelOutputsPlainStatus) return cleaned;
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
