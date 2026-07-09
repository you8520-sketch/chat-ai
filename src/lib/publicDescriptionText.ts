const BLOCK_END_RE = /<\/(?:div|p|li|h[1-6]|blockquote|pre|tr)>/gi;

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCodePoint(n) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const n = Number.parseInt(code, 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : "";
    });
}

export function publicDescriptionVisibleText(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(BLOCK_END_RE, "\n")
    .replace(/<[^>]+>/g, "")
    .split("\n")
    .map((line) => decodeHtmlEntities(line).trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function countPublicDescriptionVisibleChars(value: string): number {
  return Array.from(publicDescriptionVisibleText(value)).length;
}

function isOpeningTag(token: string): boolean {
  return /^<([a-z][\w:-]*)\b[^>]*>$/i.test(token) && !/\/\s*>$/.test(token);
}

function tagNameOf(token: string): string | null {
  const match = token.match(/^<\/?\s*([a-z][\w:-]*)/i);
  return match?.[1]?.toLowerCase() ?? null;
}

export function truncatePublicDescriptionHtmlByVisibleChars(
  html: string,
  maxChars: number
): string {
  if (maxChars <= 0) return "";
  let used = 0;
  let output = "";
  const stack: string[] = [];
  const tokens = html.match(/<[^>]+>|[^<]+/g) ?? [];

  for (const token of tokens) {
    if (used >= maxChars) break;
    if (token.startsWith("<")) {
      const tag = tagNameOf(token);
      if (/^<\//.test(token)) {
        if (tag) {
          const idx = stack.lastIndexOf(tag);
          if (idx >= 0) stack.splice(idx, 1);
        }
      } else if (tag && isOpeningTag(token)) {
        stack.push(tag);
      }
      output += token;
      continue;
    }

    const remaining = maxChars - used;
    const chars = Array.from(token);
    if (chars.length <= remaining) {
      output += token;
      used += chars.length;
      continue;
    }
    output += chars.slice(0, remaining).join("");
    used = maxChars;
    break;
  }

  for (const tag of stack.reverse()) {
    output += `</${tag}>`;
  }
  return output;
}
