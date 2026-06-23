import { responseHasHtmlVisualCard } from "@/lib/chatRichContent";
import { chatOocSuppressesUserNoteExtras } from "@/lib/chatOocPriority";
import {
  htmlPolicyReplacesMarkdownStatus,
  resolveHtmlVisualCardPolicyFromSources,
  userMessageRequestsHtmlVisualCard,
} from "@/lib/htmlVisualCardPolicy";
import { userMessageRequestsStatusWindowOoc, userMessageRequestsStatusWindowOocWithHtml } from "@/lib/statusMeta/ooc";
import type { StatusMeta, StatusMetaRecord } from "@/lib/statusMeta/types";
import { statusMetaHasDisplayContent } from "@/lib/statusMeta/render";

/** HTML Flash 상태창·턴 HTML — StatusMetaCard(줄글 Flash)와 중복 표시 방지 */
export function chatUsesHtmlVisualStatusWindow(sources: {
  userNote?: string;
  userPersona?: string;
  characterSetting?: string;
  userMessage?: string;
  markdownStatusWindowActive?: boolean;
  /** 위젯 ON — HTML 상태는 위젯 전담, plain/markdown StatusMeta는 유지 */
  statusWidgetActive?: boolean;
}): boolean {
  if (sources.statusWidgetActive) return false;
  if (sources.userMessage?.trim() && chatOocSuppressesUserNoteExtras(sources.userMessage)) {
    return true;
  }
  if (sources.markdownStatusWindowActive) return false;
  const policy = resolveHtmlVisualCardPolicyFromSources({
    userNote: sources.userNote,
    userPersona: sources.userPersona,
    characterSetting: sources.characterSetting,
    userMessage: sources.userMessage,
    markdownStatusWindowActive: sources.markdownStatusWindowActive,
  });
  if (!policy.enabled) return false;
  if (htmlPolicyReplacesMarkdownStatus(policy)) return true;
  if (policy.standing) return true;
  if (sources.userMessage?.trim() && userMessageRequestsHtmlVisualCard(sources.userMessage)) {
    return true;
  }
  return false;
}

export function resolveStatusMetaExtractionEnabled(opts: {
  htmlReplacesMarkdownStatus?: boolean;
  /** HTML Flash standing — 매턴 HTML 상태창이 StatusMeta(줄글)보다 우선 */
  htmlVisualCardStanding?: boolean;
  /** 이번 턴 HTML Flash ON — StatusMeta(줄글 Flash) 추출·폴링 금지 */
  htmlVisualCardEnabled?: boolean;
  /** 채팅 OOC rp_unrelated — 유저노트 상태창 추출 금지 */
  chatOocRpUnrelated?: boolean;
  statusWindowEveryTurn: boolean;
  userMessage: string;
}): boolean {
  if (opts.chatOocRpUnrelated) return false;
  if (userMessageRequestsStatusWindowOocWithHtml(opts.userMessage)) return false;
  if (opts.htmlReplacesMarkdownStatus || opts.htmlVisualCardStanding) return false;
  if (opts.htmlVisualCardEnabled) return false;
  if (opts.statusWindowEveryTurn) return true;
  if (userMessageRequestsStatusWindowOoc(opts.userMessage)) return true;
  return false;
}

export function shouldShowStatusMetaCard(opts: {
  messageContent: string;
  statusMeta?: StatusMeta | null;
  statusMetaPending?: boolean;
  statusMetaFailed?: boolean;
  statusMetaRequested?: boolean;
  userNote?: string;
  userPersona?: string;
  /** 직전 유저 턴 — HTML Flash turn-trigger 판별 */
  userMessage?: string;
  markdownStatusWindowActive?: boolean;
  statusWidgetActive?: boolean;
  isStreaming?: boolean;
}): boolean {
  if (
    opts.isStreaming &&
    !opts.statusMetaPending &&
    !opts.statusMetaRequested &&
    !opts.statusMetaFailed
  ) {
    return false;
  }

  if (
    responseHasHtmlVisualCard(opts.messageContent) &&
    !opts.markdownStatusWindowActive
  ) {
    return false;
  }

  if (
    chatUsesHtmlVisualStatusWindow({
      userNote: opts.userNote,
      userPersona: opts.userPersona,
      userMessage: opts.userMessage,
      markdownStatusWindowActive: opts.markdownStatusWindowActive,
      statusWidgetActive: opts.statusWidgetActive,
    })
  ) {
    return false;
  }

  return (
    !!opts.statusMetaRequested ||
    !!opts.statusMetaPending ||
    !!opts.statusMetaFailed ||
    !!opts.statusMeta
  );
}

/** SSR/클라이언트 — HTML standing·variant 본문 기준으로 status_meta 노출 여부 */
export function resolveClientStatusMetaFlags(opts: {
  statusRecord: StatusMetaRecord | null;
  messageContent: string;
  userNote?: string;
  userPersona?: string;
  userMessage?: string;
  markdownStatusWindowActive?: boolean;
  statusWidgetActive?: boolean;
}): {
  statusMeta: StatusMeta | null;
  statusMetaPending: boolean;
  statusMetaRequested: boolean;
  statusMetaFailed: boolean;
} {
  const rec = opts.statusRecord;
  if (!rec) {
    return {
      statusMeta: null,
      statusMetaPending: false,
      statusMetaRequested: false,
      statusMetaFailed: false,
    };
  }

  const show = shouldShowStatusMetaCard({
    messageContent: opts.messageContent,
    statusMeta: rec.meta,
    statusMetaPending: rec.pending,
    statusMetaFailed: rec.failed,
    statusMetaRequested: true,
    userNote: opts.userNote,
    userPersona: opts.userPersona,
    userMessage: opts.userMessage,
    markdownStatusWindowActive: opts.markdownStatusWindowActive,
    statusWidgetActive: opts.statusWidgetActive,
  });

  if (!show) {
    return {
      statusMeta: null,
      statusMetaPending: false,
      statusMetaRequested: false,
      statusMetaFailed: false,
    };
  }

  const hasContent = statusMetaHasDisplayContent(rec.meta, rec.formatSpec);
  const pending = rec.pending === true && !hasContent;
  const failed = rec.failed === true && !hasContent && !pending;

  return {
    statusMeta: pending ? null : rec.meta,
    statusMetaPending: pending,
    statusMetaRequested: true,
    statusMetaFailed: failed,
  };
}
