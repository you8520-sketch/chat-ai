export type ChatRichBlock =
  | { kind: "novel"; text: string }
  | { kind: "markdown-table"; text: string }
  | { kind: "html"; text: string };

/** 줄바꿈 없이 ` ```html <div` 로 이어지는 모델 출력도 허용 */
const FENCED_HTML_CLOSED_RE = /```html\s*([\s\S]*?)```/gi;
const BARE_HTML_TABLE_RE = /<table\b[\s\S]*?<\/table>/gi;
const BARE_VISUAL_CARD_RE = /<div\s+style\s*=[\s\S]*?<\/div>\s*(?:<\/div>\s*)*/i;

function parseTableCells(line: string): string[] {
  const trimmed = line.trim();
  const inner = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
  const withoutEnd = inner.endsWith("|") ? inner.slice(0, -1) : inner;
  return withoutEnd.split("|").map((c) => c.trim());
}

function isTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return false;
  const cells = parseTableCells(trimmed);
  if (cells.length === 0) return false;
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, "")));
}

function isTableDataLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return false;
  if (isTableSeparatorLine(trimmed)) return false;
  const cells = parseTableCells(trimmed);
  return cells.length >= 1;
}

function isTableLine(line: string): boolean {
  const trimmed = line.trim();
  return isTableSeparatorLine(trimmed) || isTableDataLine(trimmed);
}

function isMarkdownTableBlock(lines: string[]): boolean {
  if (lines.length < 2) return false;
  if (isTableSeparatorLine(lines[0]!)) {
    return lines.slice(1).some((line) => isTableDataLine(line));
  }
  if (!isTableDataLine(lines[0]!)) return false;
  return isTableSeparatorLine(lines[1]!);
}

export type ParsedMarkdownTable = {
  alignments: ("left" | "center" | "right")[];
  rows: string[][];
  hasHeader: boolean;
};

function parseAlignments(sepCells: string[]): ("left" | "center" | "right")[] {
  return sepCells.map((cell) => {
    const c = cell.replace(/\s/g, "");
    if (c.startsWith(":") && c.endsWith(":")) return "center" as const;
    if (c.endsWith(":")) return "right" as const;
    return "left" as const;
  });
}

export function parseMarkdownPipeTable(markdown: string): ParsedMarkdownTable | null {
  const lines = markdown
    .trim()
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim());
  if (!isMarkdownTableBlock(lines)) return null;

  const separatorFirst = isTableSeparatorLine(lines[0]!);
  const hasHeader = !separatorFirst;
  const sepLineIdx = separatorFirst ? 0 : 1;

  const sepCells = parseTableCells(lines[sepLineIdx]!);
  const alignments = parseAlignments(sepCells);

  const rows: string[][] = [];
  if (hasHeader) {
    rows.push(parseTableCells(lines[0]!));
    while (alignments.length < rows[0]!.length) alignments.push("left");
  }

  for (let i = sepLineIdx + 1; i < lines.length; i++) {
    if (!isTableDataLine(lines[i]!)) break;
    rows.push(parseTableCells(lines[i]!));
  }

  if (rows.length === 0) return null;
  return { alignments, rows, hasHeader };
}

function extractMarkdownTables(text: string): { before: string; table: string; after: string } | null {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length - 1; i++) {
    if (!isTableLine(lines[i]!)) continue;
    const slice = lines.slice(i);
    const end = slice.findIndex((line, idx) => idx > 0 && line.trim() && !isTableLine(line));
    const blockLines = end === -1 ? slice : slice.slice(0, end);
    if (!isMarkdownTableBlock(blockLines)) continue;
    const table = blockLines.join("\n");
    const before = lines.slice(0, i).join("\n").trimEnd();
    const afterStart = i + blockLines.length;
    const after = lines.slice(afterStart).join("\n").trimStart();
    return { before, table, after };
  }
  return null;
}

function extractBareHtmlTable(text: string): { before: string; html: string; after: string } | null {
  BARE_HTML_TABLE_RE.lastIndex = 0;
  const match = BARE_HTML_TABLE_RE.exec(text);
  if (!match) return null;
  const before = text.slice(0, match.index).trimEnd();
  const after = text.slice(match.index + match[0].length).trimStart();
  return { before, html: match[0].trim(), after };
}

function findClosedHtmlFence(text: string): { index: number; length: number; html: string } | null {
  FENCED_HTML_CLOSED_RE.lastIndex = 0;
  const match = FENCED_HTML_CLOSED_RE.exec(text);
  if (!match || match.index == null) return null;
  return { index: match.index, length: match[0].length, html: match[1]!.trim() };
}

/** 닫는 ``` 없이 끊긴 HTML 카드(LOOP_ABORT 등) — 렌더 시도 */
function extractUnclosedHtmlFence(text: string): { before: string; html: string } | null {
  const match = /```html\s*([\s\S]*)$/i.exec(text);
  if (!match || match.index == null) return null;
  const html = match[1]!.trim();
  if (!html || !/<(?:div|table|h[1-6]|p)\b/i.test(html)) return null;
  return { before: text.slice(0, match.index).trimEnd(), html };
}

function extractBareVisualCardDiv(text: string): { before: string; html: string; after: string } | null {
  BARE_VISUAL_CARD_RE.lastIndex = 0;
  const match = BARE_VISUAL_CARD_RE.exec(text);
  if (!match || match.index == null) return null;
  if (!/max-width|background-color|border-radius/i.test(match[0])) return null;
  const before = text.slice(0, match.index).trimEnd();
  const after = text.slice(match.index + match[0].length).trimStart();
  return { before, html: match[0].trim(), after };
}

/** assistant 출력에 HTML visual card(펜스·베어 카드·표)가 포함됐는지 */
export function responseHasHtmlVisualCard(text: string): boolean {
  return splitChatRichBlocks(text).some((b) => b.kind === "html");
}

/** 모델 출력에서 ```html 펜스 블록 1개 추출 — 없으면 null */
export function extractFencedHtmlBlock(text: string): string | null {
  FENCED_HTML_CLOSED_RE.lastIndex = 0;
  const match = FENCED_HTML_CLOSED_RE.exec(text.trim());
  if (!match?.[1]?.trim()) return null;
  return `\`\`\`html\n${match[1].trim()}\n\`\`\``;
}

/** assistant 본문 → 소설 본문 / 마크다운 표 / HTML 블록 */
export function splitChatRichBlocks(text: string): ChatRichBlock[] {
  const input = text.trim();
  if (!input) return [];

  const blocks: ChatRichBlock[] = [];
  let rest = input;

  while (rest.length > 0) {
    const closedFence = findClosedHtmlFence(rest);
    const bareHtmlMatch = extractBareHtmlTable(rest);
    const bareCardMatch = extractBareVisualCardDiv(rest);
    const tableMatch = extractMarkdownTables(rest);

    const htmlIdx = closedFence?.index ?? -1;
    const bareHtmlIdx = bareHtmlMatch ? rest.indexOf(bareHtmlMatch.html) : -1;
    const bareCardIdx = bareCardMatch ? rest.indexOf(bareCardMatch.html) : -1;
    const tableIdx =
      tableMatch && (tableMatch.before.length > 0 || tableMatch.table)
        ? rest.indexOf(tableMatch.table)
        : tableMatch
          ? 0
          : -1;

    type NextKind = "fenced-html" | "bare-html" | "bare-card" | "table" | "none";
    let nextKind: NextKind = "none";
    let nextIdx = rest.length;

    const candidates: { kind: NextKind; idx: number }[] = [];
    if (htmlIdx >= 0) candidates.push({ kind: "fenced-html", idx: htmlIdx });
    if (bareHtmlIdx >= 0) candidates.push({ kind: "bare-html", idx: bareHtmlIdx });
    if (bareCardIdx >= 0) candidates.push({ kind: "bare-card", idx: bareCardIdx });
    if (tableIdx >= 0) candidates.push({ kind: "table", idx: tableIdx });

    if (candidates.length > 0) {
      const earliest = candidates.reduce((a, b) => (a.idx <= b.idx ? a : b));
      nextKind = earliest.kind;
      nextIdx = earliest.idx;
    }

    if (nextKind === "none") {
      const unclosed = extractUnclosedHtmlFence(rest);
      if (unclosed) {
        if (unclosed.before) blocks.push({ kind: "novel", text: unclosed.before });
        blocks.push({ kind: "html", text: unclosed.html });
      } else {
        blocks.push({ kind: "novel", text: rest });
      }
      break;
    }

    const prose = rest.slice(0, nextIdx).trim();
    if (prose) blocks.push({ kind: "novel", text: prose });

    if (nextKind === "fenced-html" && closedFence) {
      blocks.push({ kind: "html", text: closedFence.html });
      rest = rest.slice(nextIdx + closedFence.length).trimStart();
      continue;
    }

    if (nextKind === "bare-html" && bareHtmlMatch) {
      blocks.push({ kind: "html", text: bareHtmlMatch.html });
      rest = bareHtmlMatch.after;
      continue;
    }

    if (nextKind === "bare-card" && bareCardMatch) {
      blocks.push({ kind: "html", text: bareCardMatch.html });
      rest = bareCardMatch.after;
      continue;
    }

    if (nextKind === "table" && tableMatch) {
      blocks.push({ kind: "markdown-table", text: tableMatch.table });
      rest = tableMatch.after;
      continue;
    }

    blocks.push({ kind: "novel", text: rest });
    break;
  }

  return blocks.length > 0 ? blocks : [{ kind: "novel", text: input }];
}

export type PartitionedRichBlocks = {
  /** 본문 앞(또는 중간) HTML — 기본 상단 배치 */
  topHtml: string[];
  /** RP 본문·표 (HTML 제외) */
  body: ChatRichBlock[];
  /** 맨 끝 HTML — 상태창(Flash) 등 하단 배치 */
  bottomHtml: string[];
};

/**
 * HTML 배치 — 맨 끝 ```html = 하단(상태창), 그 외 HTML = 상단.
 * [html, novel] → top / [novel, html] → bottom / [html, novel, html] → top + bottom
 */
export function partitionRichBlocksForDisplay(blocks: ChatRichBlock[]): PartitionedRichBlocks {
  if (blocks.length === 0) {
    return { topHtml: [], body: [], bottomHtml: [] };
  }

  const bottomHtml: string[] = [];
  let cut = blocks.length;

  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]!;
    if (block.kind === "html") {
      bottomHtml.unshift(block.text);
      cut = i;
    } else {
      break;
    }
  }

  const topHtml: string[] = [];
  const body: ChatRichBlock[] = [];
  for (let i = 0; i < cut; i++) {
    const block = blocks[i]!;
    if (block.kind === "html") {
      topHtml.push(block.text);
    } else {
      body.push(block);
    }
  }

  return { topHtml, body, bottomHtml };
}

/** 마크다운 표 — 셀에 보이는 글자만 (파이프·구분선 제외) */
export function visibleTextFromMarkdownTable(markdown: string): string {
  const parsed = parseMarkdownPipeTable(markdown);
  if (!parsed) {
    return markdown
      .split("\n")
      .map((line) => line.replace(/^\|?|\|?$/g, "").replace(/\|/g, " "))
      .join(" ")
      .replace(/:?-{3,}:?/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return parsed.rows
    .flat()
    .map((c) => c.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

/** HTML 상태창 — 태그 제외 표시 텍스트만 */
export function visibleTextFromHtmlBlock(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 저장 본문 — RP + 상태창 표시 텍스트 (마크업·파이프·HTML 태그 제외) */
export function savedVisibleTextForReceipt(text: string): string {
  return splitChatRichBlocks(text)
    .map((block) => {
      if (block.kind === "novel") return block.text;
      if (block.kind === "markdown-table") return visibleTextFromMarkdownTable(block.text);
      if (block.kind === "html") return visibleTextFromHtmlBlock(block.text);
      return "";
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}
