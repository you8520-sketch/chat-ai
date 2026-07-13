import DOMPurify from "isomorphic-dompurify";

export const CREATOR_PROFILE_HTML_MAX = 5_000;

const ALLOWED_TAGS = [
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "hr",
  "i",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "span",
  "strong",
  "u",
  "ul",
];

const ALLOWED_ATTR = ["alt", "class", "href", "rel", "src", "target", "title"];

export function sanitizeCreatorHtml(input: unknown): string {
  const raw = String(input ?? "").slice(0, CREATOR_PROFILE_HTML_MAX);
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  }).trim();
}
