import { parseMarkdownPipeTable } from "@/lib/chatRichContent";
import { extractHtmlStatusFieldLabels } from "@/lib/htmlVisualCardPolicy";
import { extractPipeTableLines } from "@/lib/statusWindowNotePolicy";

export function parseTableRowCells(line: string): string[] {
  const trimmed = line.trim();
  const inner = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
  const withoutEnd = inner.endsWith("|") ? inner.slice(0, -1) : inner;
  return withoutEnd.split("|").map((c) => c.trim());
}

export function isTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return false;
  const cells = parseTableRowCells(trimmed);
  if (cells.length === 0) return false;
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, "")));
}

export type ParsedFormatSpecStructure = {
  lines: string[];
  dataRowTemplates: string[][];
};

/** pipe-table 없이 이모지 줄글 필드만 있는 formatSpec (pipe-table→라벨 줄 변환 포함) */
export function isPlainTextStatusFormatSpec(formatSpec: string): boolean {
  const trimmed = formatSpec.trim();
  if (!trimmed || extractPipeTableLines(trimmed)) return false;
  if (extractHtmlStatusFieldLabels(trimmed).length > 0) return true;
  const lines = plainTextStatusFieldLines(trimmed);
  return lines.length >= 1 && lines.every((l) => l.length >= 2);
}

export function plainTextStatusFieldLines(formatSpec: string): string[] {
  return formatSpec
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export function plainTextStatusFieldCount(formatSpec: string): number {
  return extractHtmlStatusFieldLabels(formatSpec).length;
}

/** User-note pipe table → structural lines + per-row cell templates */
export function parseFormatSpecStructure(formatSpec: string): ParsedFormatSpecStructure {
  const raw = extractPipeTableLines(formatSpec);
  if (!raw) return { lines: [], dataRowTemplates: [] };

  const lines = raw.split("\n").map((l) => l.trimEnd());
  const dataRowTemplates: string[][] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || isTableSeparatorLine(trimmed)) continue;
    dataRowTemplates.push(parseTableRowCells(trimmed));
  }
  return { lines, dataRowTemplates };
}

function formatPipeRow(cells: string[]): string {
  return `| ${cells.map((c) => c.trim()).join(" | ")} |`;
}

/** 라벨-only 행(템플릿 1칸) — AI가 값을 여러 셀로 나눠도 값 칸 하나로 합침 */
function isLabelOnlyTemplateRow(template: string[]): boolean {
  return template.length === 1 && template[0]!.trim().length > 0;
}

function filledCellMatchesLabel(filledCell: string, label: string): boolean {
  const f = filledCell.trim();
  const l = label.trim();
  if (!f || !l) return false;
  if (f === l) return true;
  // 라벨 접두 + 값(· / :)이면 에코가 아님 — stripLabelPrefixFromValue에서 처리
  if (stripLabelPrefixFromValue(l, f) !== f) return false;
  // 라벨 앞 emoji·핵심 문구 일치 (🔍 하고 싶은 것 …)
  const fCore = f.replace(/^[^\w\uAC00-\uD7A3]+/, "").slice(0, 12);
  const lCore = l.replace(/^[^\w\uAC00-\uD7A3]+/, "").slice(0, 12);
  return fCore.length >= 4 && lCore.length >= 4 && (f.includes(lCore) || l.includes(fCore));
}

/** Flash가 "라벨 · 값1 · 값2"처럼 라벨을 값 칸에 붙여 반환할 때 접두 제거 */
export function stripLabelPrefixFromValue(label: string, value: string): string {
  const l = label.trim();
  const v = value.trim();
  if (!v || !l) return v;
  if (v === l) return "";

  for (const sep of [" · ", " ·", " : ", ": ", " — ", " - "]) {
    if (v.startsWith(l + sep)) return v.slice(l.length + sep.length).trim();
  }

  if (v.startsWith(l) && v.length > l.length) {
    const tail = v.slice(l.length).trim();
    if (/^[·•:：\-—]\s*/.test(tail)) {
      return tail.replace(/^[·•:：\-—]\s*/, "").trim();
    }
  }

  return v;
}

/** 값 칸 후보 — 라벨 에코(템플릿 그대로 복사) 제외 */
function collectValueParts(filled: string[], startIdx: number, label: string): string[] {
  const parts: string[] = [];
  for (const cell of filled.slice(startIdx)) {
    const trimmed = cell.trim();
    if (!trimmed) continue;
    const normalized = stripLabelPrefixFromValue(label, trimmed);
    if (!normalized) continue;
    if (normalized === trimmed && filledCellMatchesLabel(trimmed, label)) continue;
    parts.push(normalized);
  }
  return parts;
}

/** Merge extracted cells with template labels/placeholders */
export function mergeTemplateRow(template: string[], filled: string[]): string[] {
  const label = template[0]?.trim() ?? "";

  if (isLabelOnlyTemplateRow(template)) {
    if (filled.length === 1) {
      const raw = filled[0]?.trim() ?? "";
      const stripped = stripLabelPrefixFromValue(label, raw);
      if (!stripped) return [label || raw];
      return label ? [label, stripped] : [stripped];
    }

    if (filled.length > 1) {
      const startIdx = filledCellMatchesLabel(filled[0] ?? "", label) ? 1 : 0;
      const valueParts = collectValueParts(filled, startIdx, label);
      if (valueParts.length === 0) return [label || filled[0]?.trim() || ""];
      if (valueParts.length === 1) return label ? [label, valueParts[0]!] : [valueParts[0]!];
      const combined = valueParts.join(" · ");
      return label ? [label, combined] : [combined];
    }
  }

  const width = Math.max(template.length, filled.length, 1);
  const out: string[] = [];
  for (let i = 0; i < width; i++) {
    const value = filled[i]?.trim() ?? "";
    const cellLabel = template[i]?.trim() ?? "";
    out.push(value || cellLabel);
  }
  return out;
}

export function buildFilledTableMarkdown(
  structure: ParsedFormatSpecStructure,
  filledRows: string[][]
): string {
  if (structure.lines.length === 0) return "";

  let rowIdx = 0;
  const out: string[] = [];
  for (const line of structure.lines) {
    const trimmed = line.trim();
    if (isTableSeparatorLine(trimmed)) {
      out.push(trimmed);
      continue;
    }
    if (trimmed.startsWith("|")) {
      const template = structure.dataRowTemplates[rowIdx] ?? parseTableRowCells(trimmed);
      const filled = filledRows[rowIdx] ?? [];
      rowIdx++;
      out.push(formatPipeRow(mergeTemplateRow(template, filled)));
      continue;
    }
    out.push(line);
  }
  return ensureMarkdownTableSeparator(out.join("\n"));
}

/** GFM pipe-table — separator row 없으면 StatusMetaCard HTML 표 파싱 실패 */
function ensureMarkdownTableSeparator(markdown: string): string {
  const trimmed = markdown.trim();
  if (!trimmed || parseMarkdownPipeTable(trimmed)) return trimmed;

  const lines = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return trimmed;
  if (!lines.every((line) => line.startsWith("|") && !isTableSeparatorLine(line))) return trimmed;

  const colCount = Math.max(...lines.map((line) => parseTableRowCells(line).length), 1);
  const separator = `| ${Array(colCount).fill(":---").join(" | ")} |`;
  return [separator, ...lines].join("\n");
}

export function normalizeTemplateFilledRows(
  structure: ParsedFormatSpecStructure,
  rawRows: unknown
): string[][] {
  if (!Array.isArray(rawRows)) return [];
  const expected = structure.dataRowTemplates.length;
  const rows: string[][] = [];
  for (let i = 0; i < expected; i++) {
    const template = structure.dataRowTemplates[i] ?? [];
    const raw = rawRows[i];
    const filled = Array.isArray(raw)
      ? raw.map((c) => (typeof c === "string" ? c.trim() : c != null ? String(c).trim() : ""))
      : [];
    rows.push(mergeTemplateRow(template, filled));
  }
  return rows;
}

/** AI가 반환한 tableMarkdown — 라벨 에코·열 분할 후처리 */
export function rebalanceTableMarkdownWithFormatSpec(
  markdown: string,
  formatSpec: string
): string {
  const structure = parseFormatSpecStructure(formatSpec);
  if (structure.dataRowTemplates.length === 0) return markdown.trim();

  const parsed = parseMarkdownPipeTable(markdown);
  if (!parsed) return markdown.trim();

  const body = parsed.hasHeader ? parsed.rows.slice(1) : parsed.rows;
  if (body.length === 0) return markdown.trim();

  const filledRows = body.map((row, i) =>
    mergeTemplateRow(structure.dataRowTemplates[i] ?? row, row)
  );
  return buildFilledTableMarkdown(structure, filledRows);
}

export function tableMarkdownHasContent(markdown: string): boolean {
  const parsed = parseMarkdownPipeTable(markdown);
  if (!parsed) {
    return markdown.split("\n").some((line) => {
      const t = line.trim();
      if (!t) return false;
      const valuePart = t.includes(":") ? t.split(/[:：]/).slice(1).join(":").trim() : t;
      return Boolean(valuePart && valuePart !== "—" && valuePart !== "-");
    });
  }
  const body = parsed.hasHeader ? parsed.rows.slice(1) : parsed.rows;
  return body.some((row) => row.some((cell) => cell.trim() && cell.trim() !== "—"));
}
