import { repairProfileInlineFormatMarkup } from "@/lib/profileTextFormat";

export type ProfileBlock =
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "quote"; text: string }
  | { type: "hr" }
  | { type: "img"; url: string; alt: string };

/** 한 줄 전체가 이미지 URL인지 (imgur · uploads 등) */
export function parseBareProfileImageUrl(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (
    /^(https?:\/\/[^\s<>"']+\.(?:png|jpe?g|gif|webp|avif)(?:\?[^\s<>"']*)?|https?:\/\/i\.imgur\.com\/[^\s<>"'?#]+|\/uploads\/[^\s<>"']+)$/i.test(
      trimmed
    )
  ) {
    return trimmed;
  }
  return null;
}

export function isAllowedProfileImageUrl(url: string): boolean {
  const u = url.trim();
  if (!u) return false;
  if (u.startsWith("/uploads/")) return true;
  return /^https?:\/\//i.test(u);
}

/** 본문에 URL만 적힌 줄 → 마크다운 이미지로 변환 */
export function normalizeBareImageUrlLines(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const bare = parseBareProfileImageUrl(line);
      if (bare) return `![이미지](${bare})`;
      return line;
    })
    .join("\n");
}

/** 본문 마크다운 `![alt](url)` 에서 URL 추출 */
export function extractMarkdownImageUrls(content: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const m of content.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    const url = m[1]?.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

/** 본문 마크다운 `![alt](url)` + URL 단독 줄에서 이미지 URL 추출 */
export function extractInlineImageUrls(content: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const url of extractMarkdownImageUrls(content)) {
    if (!seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }
  for (const line of content.replace(/\r\n/g, "\n").split("\n")) {
    const bare = parseBareProfileImageUrl(line);
    if (bare && !seen.has(bare)) {
      seen.add(bare);
      urls.push(bare);
    }
  }
  return urls;
}

/** 본문에 삽입된 이미지는 갤러리(상단·사이드)에서 제외 */
export function galleryImageUrls(allUrls: string[], biography: string): string[] {
  const inline = new Set(extractInlineImageUrls(biography));
  return allUrls.filter((u) => !inline.has(u));
}

/** 본문 삽입 URL을 imageUrls 문자열에서 제거 */
export function removeUrlFromImageList(imageUrlsText: string, url: string): string {
  return parseImageUrlLines(imageUrlsText)
    .filter((u) => u !== url)
    .join("\n");
}

/** biography에 헤더·목록이 한 줄로 붙었거나 literal \\n 인 경우 구조 복원 */
export function normalizeBiographyStructure(raw: string): string {
  let text = raw.replace(/\r\n/g, "\n").replace(/\\n/g, "\n").trim();
  if (!text) return "";

  text = pairFieldLabelValueLines(text);

  const lineCount = text.split("\n").filter((l) => l.trim()).length;
  const hasInlineMarkdown =
    /[^\n]##\s/.test(text) ||
    /[^\n]###\s/.test(text) ||
    /##[^\n]+###\s/.test(text) ||
    /[^\n]\s-\s+\*\*/.test(text);

  const shouldReflow =
    hasInlineMarkdown || (lineCount <= 2 && /##\s|###\s|-\s+\*\*/.test(text));

  if (shouldReflow) {
    text = text
      .replace(/(##\s+[^\n#]+?)(\s*###\s+)/g, "$1\n\n$2")
      .replace(/\s+(###\s+)/g, "\n\n$1")
      .replace(/\s+(##\s+(?!#))/g, "\n\n$1")
      .replace(/\s+(-\s+\*\*[^*]+\*\*[^-\n]*)/g, "\n$1")
      .replace(/\s+(-\s+[^-\n]{2,24}[:：][^\n]*)/g, "\n$1")
      .replace(/([^\n])\s+(-\s+\*\*)/g, "$1\n$2")
      .replace(/\s+(!\[[^\]]*\]\([^)]+\))/g, "\n\n$1")
      .replace(/\s+(>\s+)/g, "\n\n$1")
      .replace(/\s+(---+)\s*/g, "\n\n$1\n\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  if (/^#{1,3}\s/m.test(text)) {
    return sanitizeProfileMarkdownArtifacts(
      normalizeBareImageUrlLines(autoBoldFieldLabels(text))
    );
  }

  return sanitizeProfileMarkdownArtifacts(
    normalizeBareImageUrlLines(autoBoldFieldLabels(applyDefaultBiographyStructure(text)))
  );
}

/** `- 코드네임: 애쉬` → `- **코드네임:** 애쉬` (미리보기 가독성) · [color]/[size] 태그는 건드리지 않음 */
export function autoBoldFieldLabels(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      if (hasProfileInlineFormatTags(line)) return line;
      const bullet = line.match(/^(\s*[-*•]\s+)(.+)$/);
      if (bullet) {
        return `${bullet[1]}${autoBoldFieldLabelContent(bullet[2])}`;
      }
      const trimmed = line.trim();
      if (
        trimmed &&
        trimmed.length <= 64 &&
        !trimmed.startsWith("#") &&
        !trimmed.startsWith(">") &&
        !trimmed.startsWith("!") &&
        !/^https?:\/\//i.test(trimmed)
      ) {
        const formatted = autoBoldFieldLabelContent(trimmed);
        if (formatted !== trimmed) {
          return line.replace(trimmed, formatted);
        }
      }
      return line;
    })
    .join("\n");
}

function hasProfileInlineFormatTags(text: string): boolean {
  return /\[color:|\[\/color\]|\[size:|\[\/size\]/i.test(text);
}

function autoBoldFieldLabelContent(content: string): string {
  const trimmed = content.trim();
  if (!trimmed || trimmed.includes("**") || hasProfileInlineFormatTags(trimmed)) return content;

  const match = trimmed.match(/^(.{1,24}?)([:：])\s*(.+)$/);
  if (match) {
    const label = match[1].trim();
    const value = match[3].trim();
    if (isProfileFieldLabel(label) && value) {
      return `**${label}${match[2]}** ${value}`;
    }
  }

  const labelOnly = trimmed.match(/^(.{1,24}?)([:：])\s*$/);
  if (labelOnly && isProfileFieldLabel(labelOnly[1].trim())) {
    return `**${labelOnly[1].trim()}${labelOnly[2]}**`;
  }

  return content;
}

export function isProfileFieldLabel(label: string): boolean {
  if (label.length < 2 || label.length > 24) return false;
  if (/https?|\/\/|!\[|[\[\]]/.test(label)) return false;
  if (/^[\d\s./\\-]+$/.test(label)) return false;
  return true;
}

const SECTION_TITLE_RE = /^(메인\s*캐릭터|서브\s*캐릭터|배경|세계관|설정|조연|주인공|npc)/i;

/** `이름:` 다음 줄에 값만 있는 붙여넣기 → 한 줄로 병합 */
function pairFieldLabelValueLines(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (hasProfileInlineFormatTags(line)) {
      out.push(line);
      continue;
    }

    const trimmed = line.trim();
    const labelOnly = trimmed.match(/^(.{1,24}?)([:：])\s*$/);
    if (labelOnly && isProfileFieldLabel(labelOnly[1].trim())) {
      const indent = line.match(/^(\s*)/)?.[1] ?? "";
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j += 1;
      if (j < lines.length) {
        const nextTrim = lines[j].trim();
        const nextIsLabelOnly =
          /^(.{1,24}?)([:：])\s*$/.test(nextTrim) &&
          isProfileFieldLabel((nextTrim.match(/^(.{1,24}?)([:：])/)?.[1] ?? "").trim());
        const nextIsStructural =
          nextTrim.startsWith("#") ||
          nextTrim.startsWith(">") ||
          nextTrim.startsWith("!") ||
          /^[-*•]\s+/.test(nextTrim) ||
          /^https?:\/\//i.test(nextTrim);
        if (!nextIsLabelOnly && !nextIsStructural) {
          out.push(`${indent}${trimmed} ${nextTrim}`);
          i = j;
          continue;
        }
      }
    }

    out.push(line);
  }

  return out.join("\n");
}

function isValidCharacterHeading(line: string): boolean {
  const t = line.trim();
  if (t.length < 2) return false;
  if (/^[\)\(\[\]{}.,;!?·…\s\-—]+$/.test(t)) return false;
  if (SECTION_TITLE_RE.test(t)) return false;
  return true;
}

/** 깨진 마크다운·빈 헤더 등 렌더링 잔여물 제거 */
export function sanitizeProfileMarkdownArtifacts(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => {
      const h3 = line.match(/^###\s+(.+)$/);
      if (h3 && !isValidCharacterHeading(h3[1] ?? "")) return false;
      const h2 = line.match(/^##\s+(.+)$/);
      if (h2 && /^[\)\(\[\]\s]+$/.test((h2[1] ?? "").trim())) return false;
      return true;
    })
    .join("\n")
    .replace(/!\[[^\]]*\]\(\s*\)/g, "")
    .replace(/!\[[^\]]*\]\(\s*(?=\n|$)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 헤더가 없을 때 공통 디자인 템플릿으로 구조 부여 (generateProfile designOnlyMarkdown과 동일) */
export function applyDefaultBiographyStructure(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";

  const hasSubChar = /서브|조연|npc|부캐/i.test(trimmed);
  const lines = trimmed.split(/\n/).map((l) => l.trim()).filter(Boolean);
  let nameLine = lines[0] ?? "";
  let bodyLines = lines.slice(1);

  if (nameLine && SECTION_TITLE_RE.test(nameLine)) {
    nameLine = lines[1] ?? "";
    bodyLines = lines.slice(2);
  }

  const nameLike =
    isValidCharacterHeading(nameLine) &&
    nameLine.length <= 40 &&
    !/[.:：]/.test(nameLine);

  if (nameLike && nameLine) {
    const rest = bodyLines.join("\n").trim();
    const sections = rest.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    const listItems = sections
      .flatMap((p) => p.split(/\n/).map((l) => l.trim()).filter(Boolean))
      .map((p) => (p.startsWith("- ") ? p : `- ${p}`))
      .join("\n");
    return `## 메인 캐릭터\n\n### ${nameLine}\n\n${listItems}`;
  }

  if (hasSubChar) {
    return `## 메인 캐릭터\n\n${trimmed}`;
  }

  const paragraphs = trimmed.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length <= 1) {
    return `## 배경\n\n${trimmed}`;
  }
  return paragraphs
    .map((p, i) => (i === 0 ? `## 배경\n\n${p}` : p.startsWith("- ") ? p : `\n\n${p}`))
    .join("")
    .trim();
}

/** 파싱 결과가 마크다운 구조를 반영하지 못한 경우 */
export function biographyNeedsRenormalize(content: string, blocks: ProfileBlock[]): boolean {
  const hasHeadersInSource = /##\s|###\s/.test(content);
  const hasHeaderBlocks = blocks.some((b) => b.type === "h2" || b.type === "h3");
  if (hasHeadersInSource && !hasHeaderBlocks) return true;

  for (const block of blocks) {
    if (block.type === "h2" || block.type === "h3") {
      if (/###\s|##\s|-\s+\*\*/.test(block.text)) return true;
    }
  }

  if (blocks.length === 1 && blocks[0]?.type === "p") {
    const text = blocks[0].text;
    if (/##\s|###\s/.test(text)) return true;
    if (/-\s+\*\*/.test(content) && !blocks.some((b) => b.type === "ul")) return true;
  }
  return false;
}

function parseImageUrlLines(input: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const part of input.split(/[\n,]+/)) {
    const url = part.trim();
    if (!url || seen.has(url)) continue;
    if (url.startsWith("http") || url.startsWith("/uploads/")) {
      seen.add(url);
      urls.push(url);
    }
  }
  return urls;
}

/** AI/유저 마크다운 → 사이트 공통 블록 (HTML 직접 삽입 없음 — XSS 방지) */
export function parseProfileMarkdown(content: string): ProfileBlock[] {
  const normalized = repairProfileInlineFormatMarkup(normalizeBiographyStructure(content));
  let blocks = parseProfileMarkdownLines(normalized);
  if (biographyNeedsRenormalize(normalized, blocks)) {
    const retrySource =
      blocks.length === 1 && blocks[0]?.type === "p"
        ? normalizeBiographyStructure(blocks[0].text)
        : normalized;
    blocks = parseProfileMarkdownLines(retrySource);
  }
  return blocks;
}

function parseProfileMarkdownLines(content: string): ProfileBlock[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ProfileBlock[] = [];
  let para: string[] = [];
  let list: string[] = [];

  const flushPara = () => {
    if (para.length === 0) return;
    blocks.push({ type: "p", text: para.join(" ").trim() });
    para = [];
  };

  const flushList = () => {
    if (list.length === 0) return;
    blocks.push({ type: "ul", items: [...list] });
    list = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      flushList();
      continue;
    }
    if (/^---+$/.test(line)) {
      flushPara();
      flushList();
      blocks.push({ type: "hr" });
      continue;
    }
    if (line.startsWith("## ")) {
      flushPara();
      flushList();
      blocks.push({ type: "h2", text: line.slice(3).trim() });
      continue;
    }
    if (line.startsWith("### ")) {
      flushPara();
      flushList();
      blocks.push({ type: "h3", text: line.slice(4).trim() });
      continue;
    }
    if (line.startsWith("> ")) {
      flushPara();
      flushList();
      blocks.push({ type: "quote", text: line.slice(2).trim() });
      continue;
    }
    const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imgMatch) {
      flushPara();
      flushList();
      blocks.push({ type: "img", alt: imgMatch[1].trim(), url: imgMatch[2].trim() });
      continue;
    }
    const bareUrl = parseBareProfileImageUrl(line);
    if (bareUrl) {
      flushPara();
      flushList();
      blocks.push({ type: "img", alt: "이미지", url: bareUrl });
      continue;
    }
    if (/^[-*•]\s+/.test(line)) {
      flushPara();
      list.push(line.replace(/^[-*•]\s+/, "").trim());
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return blocks;
}
