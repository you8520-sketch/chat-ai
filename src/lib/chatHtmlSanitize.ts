import DOMPurify from "isomorphic-dompurify";

const CHAT_STATUS_ALLOWED_TAGS = [
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "caption",
  "br",
  "span",
] as const;

const CHAT_STATUS_ALLOWED_ATTR = [
  "class",
  "style",
  "colspan",
  "rowspan",
  "align",
] as const;

/** 채팅 AI 출력 HTML 상태창 — 표 관련 태그만 허용 */
export function sanitizeChatStatusHtml(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  return DOMPurify.sanitize(trimmed, {
    ALLOWED_TAGS: [...CHAT_STATUS_ALLOWED_TAGS],
    ALLOWED_ATTR: [...CHAT_STATUS_ALLOWED_ATTR],
    FORBID_TAGS: [
      "script",
      "iframe",
      "object",
      "embed",
      "link",
      "meta",
      "form",
      "input",
      "button",
      "base",
      "a",
      "img",
      "style",
    ],
    FORBID_ATTR: [
      "onerror",
      "onclick",
      "onload",
      "onmouseover",
      "onfocus",
      "onblur",
      "oninput",
    ],
  }).trim();
}

const VISUAL_CARD_ALLOWED_TAGS = [
  "div",
  "span",
  "p",
  "br",
  "h1",
  "h2",
  "h3",
  "h4",
  "strong",
  "em",
  "b",
  "i",
  "ul",
  "ol",
  "li",
  "section",
  "article",
  "header",
  "blockquote",
] as const;

const VISUAL_CARD_ALLOWED_ATTR = ["style", "class"] as const;

/** 메인 모델이 뱉는 문서/HTML head 누출 — Flash ```html``` 카드 밖에서 제거 */
export function stripLeakedDocumentMarkup(text: string): string {
  let out = text;
  out = out.replace(/<!DOCTYPE[^>]*>/gi, "");
  out = out.replace(/<link\b[\s\S]*?(?:>|(?=\n))/gi, "");
  out = out.replace(/<meta\b[\s\S]*?(?:>|(?=\n))/gi, "");
  out = out.replace(/<style\b[\s\S]*?<\/style>/gi, "");
  out = out.replace(/<\/?(?:html|head|body)\b[^>]*>/gi, "");
  return out;
}

/** HTML VISUAL CARD MODE — inline-style card template */
export function sanitizeChatVisualCardHtml(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  return DOMPurify.sanitize(trimmed, {
    ALLOWED_TAGS: [...VISUAL_CARD_ALLOWED_TAGS],
    ALLOWED_ATTR: [...VISUAL_CARD_ALLOWED_ATTR],
    FORBID_TAGS: [
      "script",
      "iframe",
      "object",
      "embed",
      "link",
      "meta",
      "form",
      "input",
      "button",
      "base",
      "a",
      "img",
      "style",
      "table",
    ],
    FORBID_ATTR: [
      "onerror",
      "onclick",
      "onload",
      "onmouseover",
      "onfocus",
      "onblur",
      "oninput",
    ],
  }).trim();
}
