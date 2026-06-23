import DOMPurify from "isomorphic-dompurify";

const ALLOWED_TAGS = [
  "div",
  "span",
  "p",
  "br",
  "hr",
  "b",
  "i",
  "u",
  "s",
  "strong",
  "em",
  "sub",
  "sup",
  "h1",
  "h2",
  "h3",
  "h4",
  "ul",
  "ol",
  "li",
  "a",
  "blockquote",
  "pre",
  "code",
  "img",
  "table",
  "thead",
  "tbody",
  "tr",
  "td",
  "th",
  "style",
] as const;

const ALLOWED_ATTR = [
  "class",
  "style",
  "href",
  "target",
  "rel",
  "src",
  "alt",
  "title",
  "width",
  "height",
  "colspan",
  "rowspan",
  "align",
] as const;

/** 제작자 코멘트 HTML — 스크립트·이벤트 핸들러 제거, 태그 allowlist */
export function sanitizeCreatorCommentHtml(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  return DOMPurify.sanitize(trimmed, {
    ALLOWED_TAGS: [...ALLOWED_TAGS],
    ALLOWED_ATTR: [...ALLOWED_ATTR],
    FORBID_TAGS: ["script", "iframe", "object", "embed", "link", "meta", "form", "input", "button", "base"],
    FORBID_ATTR: ["onerror", "onclick", "onload", "onmouseover", "onfocus", "onblur", "oninput"],
    ADD_ATTR: ["target", "rel"],
  }).trim();
}
