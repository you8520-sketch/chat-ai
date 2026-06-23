import {
  sourcesHaveExplicitHtmlOutputRequest,
  userRequestsHtmlOutput,
} from "@/lib/htmlVisualCardPolicy";
import { sourcesHavePipeTableStatusTemplate } from "@/lib/statusWindowPipeTable";
import { extractOocSnippets } from "@/lib/userImpersonationPolicy";

/** 유저노트 상태창 표시 형식 — 구체적 지시 없으면 plain(줄글) */
export type StatusWindowOutputFormat = "plain" | "markdown" | "html";

const MARKDOWN_KEYWORD = /(?:마크다운|markdown)/i;
const TABLE_FORMAT_KEYWORD = /(?:표\s*형식|표형식|pipe[\s-]*table)/i;

function snippetRequestsMarkdownPipeTable(text: string): boolean {
  const t = text.trim();
  if (!t || userRequestsHtmlOutput(t)) return false;
  if (/(?:줄글|plain[\s-]*text)/i.test(t) && !MARKDOWN_KEYWORD.test(t)) return false;
  return MARKDOWN_KEYWORD.test(t) && TABLE_FORMAT_KEYWORD.test(t);
}

/** 유저가 상태창을 마크다운 pipe-table 형식으로 요청했는지 (마크다운 + 표형식 둘 다 필요) */
export function userRequestsMarkdownStatusOutput(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  for (const snippet of extractOocSnippets(trimmed)) {
    if (snippetRequestsMarkdownPipeTable(snippet)) return true;
  }
  return snippetRequestsMarkdownPipeTable(trimmed);
}

export function sourcesHaveExplicitMarkdownStatusRequest(sources: {
  userNote?: string;
  userPersona?: string;
  userMessage?: string;
}): boolean {
  for (const raw of [sources.userNote, sources.userPersona, sources.userMessage]) {
    if (raw?.trim() && userRequestsMarkdownStatusOutput(raw)) return true;
  }
  return false;
}

/** HTML > markdown(명시 또는 pipe-table 템플릿) > plain(기본 줄글) */
export function resolveStatusWindowOutputFormat(sources: {
  userNote?: string;
  userPersona?: string;
  userMessage?: string;
}): StatusWindowOutputFormat {
  if (sourcesHaveExplicitHtmlOutputRequest(sources)) return "html";
  if (sourcesHaveExplicitMarkdownStatusRequest(sources)) return "markdown";
  if (sourcesHavePipeTableStatusTemplate(sources)) return "markdown";
  return "plain";
}
