/** Strip model-generated status tables / JSON — RP prose only for save & stream */

import { extractFencedHtmlBlock } from "@/lib/chatRichContent";
import type { ParsedStatusWidgetTurnValues } from "@/lib/statusWidget/types";
import {
  splitProseAndStatusWidgetValues,
  stripIncompleteStatusWidgetTail,
} from "@/lib/statusWidget/parseValues";
import { stripEmojisAndDecorators } from "@/lib/htmlVisualCardPolicy";
import type { StatusWindowPlacement } from "@/lib/statusWindowPlacement";
import { isPlainTextStatusFormatSpec, plainTextStatusFieldLines } from "./formatSpec";

const PLAIN_STATUS_VALUE_SEP = /[:：—–\-|｜]\s*/;
const PLAIN_STATUS_LINE_PREFIX = /^[-•*●○▪▶>\s]+|^\d+[.)]\s*|^\*{1,2}|^【|^「|^『/;

function normalizeFieldLabelForMatch(label: string): string {
  return stripEmojisAndDecorators(label)
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolvePlainStatusFieldLabels(formatSpec: string): string[] {
  return plainTextStatusFieldLines(formatSpec)
    .map(normalizeFieldLabelForMatch)
    .filter((l) => l.length >= 2);
}

function normalizeStatusLineForMatch(line: string): string {
  let s = line.trim();
  for (let pass = 0; pass < 3 && PLAIN_STATUS_LINE_PREFIX.test(s); pass++) {
    s = s.replace(PLAIN_STATUS_LINE_PREFIX, "").trim();
  }
  return stripEmojisAndDecorators(s.replace(/\*\*/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

function lineStartsWithPlainStatusLabel(line: string, label: string): boolean {
  const core = normalizeStatusLineForMatch(line);
  const lCore = normalizeFieldLabelForMatch(label);
  if (!core || !lCore) return false;
  if (core === lCore || core.startsWith(lCore)) return true;
  const anchor = lCore.slice(0, Math.max(4, Math.min(lCore.length, 16)));
  if (!core.startsWith(anchor)) return false;
  const tail = core.slice(anchor.length).trimStart();
  if (!tail) return true;
  return /^[:：—–\-|｜]/.test(tail) || tail.length <= 80;
}

function plainStatusLabelMatchesLine(line: string, fieldLabels: string[]): boolean {
  const norm = normalizeStatusLineForMatch(line);
  if (!norm || norm.length < 2) return false;
  if (norm.length > 220) return false;

  return fieldLabels.some((label) => {
    const lNorm = normalizeFieldLabelForMatch(label);
    if (!lNorm) return false;
    if (norm === lNorm) return true;
    if (norm.startsWith(lNorm)) {
      const tail = norm.slice(lNorm.length).trimStart();
      if (!tail) return true;
      if (PLAIN_STATUS_VALUE_SEP.test(norm)) return true;
      return tail.length >= 1;
    }
    return lineStartsWithPlainStatusLabel(line, label);
  });
}

/** 하단 연속 구간 — 구분자 있는 라벨 포함 줄만 관대히 수집 */
function lenientBottomStatusLine(line: string, fieldLabels: string[]): boolean {
  const norm = normalizeStatusLineForMatch(line);
  if (!norm || norm.length > 200 || !PLAIN_STATUS_VALUE_SEP.test(norm)) return false;
  return fieldLabels.some((label) => {
    const lNorm = normalizeFieldLabelForMatch(label);
    const anchor = lNorm.slice(0, Math.min(10, lNorm.length));
    return anchor.length >= 4 && norm.toLowerCase().includes(anchor.toLowerCase());
  });
}

function splitMultiFieldStatusLine(line: string, fieldLabels: string[]): string[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  const found: { idx: number; label: string }[] = [];
  const lower = trimmed.toLowerCase();
  for (const label of fieldLabels) {
    const lNorm = normalizeFieldLabelForMatch(label);
    const needle = lNorm.slice(0, Math.min(12, lNorm.length)).toLowerCase();
    if (needle.length < 4) continue;
    const idx = lower.indexOf(needle);
    if (idx >= 0) found.push({ idx, label });
  }
  if (found.length <= 1) return [trimmed];

  found.sort((a, b) => a.idx - b.idx);
  const chunks: string[] = [];
  for (let i = 0; i < found.length; i++) {
    const start = found[i]!.idx;
    const end = i + 1 < found.length ? found[i + 1]!.idx : trimmed.length;
    const chunk = trimmed.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks.length > 0 ? chunks : [trimmed];
}

function isPlainStatusPrefixDebris(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  return /^[-•*●○▪▶>\d.)\]\s]+$/.test(t);
}

function splitGluedPlainStatusLine(
  line: string,
  fieldLabels: string[]
): { prose: string; statusLines: string[] } {
  const trimmed = line.trim();
  if (trimmed && plainStatusLabelMatchesLine(trimmed, fieldLabels)) {
    return { prose: "", statusLines: [trimmed] };
  }

  let earliestCut = line.length;
  for (const label of fieldLabels) {
    const core = normalizeFieldLabelForMatch(label);
    if (core.length < 4) continue;
    const needle = core.slice(0, Math.min(12, core.length));
    let searchFrom = 0;
    while (searchFrom < line.length) {
      const pos = line.toLowerCase().indexOf(needle.toLowerCase(), searchFrom);
      if (pos < 0) break;
      if (pos > 0) {
        const tail = line.slice(pos).trimStart();
        if (
          plainStatusLabelMatchesLine(tail, fieldLabels) ||
          fieldLabels.some((l) => lineStartsWithPlainStatusLabel(tail, l))
        ) {
          earliestCut = Math.min(earliestCut, pos);
          break;
        }
      }
      searchFrom = pos + 1;
    }
  }
  if (earliestCut >= line.length) return { prose: line, statusLines: [] };
  let prose = line.slice(0, earliestCut).trimEnd();
  if (isPlainStatusPrefixDebris(prose)) prose = "";
  const statusPart = line.slice(earliestCut).trim();
  const statusLines: string[] = [];
  if (statusPart) statusLines.push(statusPart);
  return { prose, statusLines };
}

function pushStatusLines(target: string[], lines: string[], fieldLabels: string[]): void {
  for (const raw of lines) {
    for (const part of splitMultiFieldStatusLine(raw, fieldLabels)) {
      target.push(part.trimEnd());
    }
  }
}

function stripGluedPlainStatusSuffix(line: string, fieldLabels: string[]): string {
  return splitGluedPlainStatusLine(line, fieldLabels).prose;
}

function linePartiallyMatchesStatusField(line: string, fieldLabels: string[]): boolean {
  const norm = normalizeStatusLineForMatch(line);
  if (!norm || norm.length > 180) return false;
  return fieldLabels.some((label) => {
    const lNorm = normalizeFieldLabelForMatch(label);
    const anchor = lNorm.slice(0, Math.min(8, lNorm.length));
    if (anchor.length < 4) return false;
    if (!norm.toLowerCase().startsWith(anchor.toLowerCase())) return false;
    return PLAIN_STATUS_VALUE_SEP.test(norm) || norm.length <= lNorm.length + 32;
  });
}

function isStatusCandidateLine(
  line: string,
  fieldLabels: string[],
  partialLines: boolean
): boolean {
  return (
    plainStatusLabelMatchesLine(line, fieldLabels) ||
    (partialLines && linePartiallyMatchesStatusField(line, fieldLabels))
  );
}

type CollectPlainStatusOpts = {
  /** 스트리밍 중 미완성 상태 줄 — 본문 상단 플래시 방지 */
  partialLines?: boolean;
  /** bottom 지정인데 모델이 상단에 상태를 먼저 쓴 경우 */
  relocateMisplacedStatus?: boolean;
  placement?: StatusWindowPlacement;
};

function collectPlainStatusParts(
  text: string,
  fieldLabels: string[],
  opts: CollectPlainStatusOpts = {}
): { proseLines: string[]; statusLines: string[] } {
  const partialLines = opts.partialLines === true;
  const isStatusLine = (line: string) =>
    isStatusCandidateLine(line.trim(), fieldLabels, partialLines);
  const splitLines = text.split("\n").map((line) => splitGluedPlainStatusLine(line, fieldLabels));
  const proseLines: string[] = [];
  const statusLines: string[] = [];

  for (const { prose, statusLines: gluedStatus } of splitLines) {
    if (gluedStatus.length > 0) pushStatusLines(statusLines, gluedStatus, fieldLabels);
    const t = prose.trim();
    if (!t) {
      if (statusLines.length === 0 && proseLines.length > 0) proseLines.push("");
      continue;
    }
    if (isStatusLine(t)) {
      pushStatusLines(statusLines, [prose.trimEnd()], fieldLabels);
    } else if (!isPlainStatusPrefixDebris(prose)) {
      proseLines.push(prose);
    }
  }

  // 본문 어디에든 남은 매칭 줄 → 상태로 이동
  const proseKept: string[] = [];
  for (const line of proseLines) {
    const t = line.trim();
    if (t && isStatusLine(t)) {
      pushStatusLines(statusLines, [line.trimEnd()], fieldLabels);
    } else {
      proseKept.push(line);
    }
  }

  // bottom 요청인데 모델이 상태를 본문 앞에 쓴 경우 → 카드 쪽으로 이동
  if (opts.relocateMisplacedStatus && opts.placement === "bottom") {
    while (proseKept.length > 0) {
      const t = proseKept[0]?.trim();
      if (!t) {
        proseKept.shift();
        continue;
      }
      if (isStatusLine(t) || lenientBottomStatusLine(t, fieldLabels)) {
        pushStatusLines(statusLines, [proseKept.shift()!.trimEnd()], fieldLabels);
      } else {
        break;
      }
    }
  }

  // 하단 연속 구간 — `-`, `**`, `—` 등 변형 줄 추가 수집
  let end = proseKept.length;
  while (end > 0 && !proseKept[end - 1]?.trim()) end--;
  const tailStatus: string[] = [];
  let i = end - 1;
  while (i >= 0) {
    const t = proseKept[i]!.trim();
    if (!t) break;
    if (isStatusLine(t) || lenientBottomStatusLine(t, fieldLabels)) {
      tailStatus.unshift(proseKept[i]!.trimEnd());
      i--;
    } else {
      break;
    }
  }

  return {
    proseLines: proseKept.slice(0, i + 1),
    statusLines: [...statusLines, ...tailStatus.flatMap((l) => splitMultiFieldStatusLine(l, fieldLabels))],
  };
}

/** 저장 직전 — 분량 보강·prose 복원 등으로 상태창이 빠진 경우 stream/model에서 복구 */
export function finalizePlainStatusSavedText(
  savedText: string,
  formatSpec: string,
  placement: StatusWindowPlacement,
  recoverySources: string[] = []
): string {
  const spec = formatSpec.trim();
  if (!spec || !isPlainTextStatusFormatSpec(spec)) return savedText;
  const fieldLabels = resolvePlainStatusFieldLabels(spec);
  if (fieldLabels.length === 0) return savedText;

  let { proseLines, statusLines } = collectPlainStatusParts(savedText, fieldLabels, {
    placement,
    relocateMisplacedStatus: true,
  });

  if (statusLines.length === 0) {
    for (const src of recoverySources) {
      if (!src?.trim()) continue;
      const recovered = collectPlainStatusParts(src, fieldLabels, {
        placement,
        relocateMisplacedStatus: true,
      });
      if (recovered.statusLines.length > 0) {
        statusLines = recovered.statusLines;
        break;
      }
    }
  }

  if (statusLines.length === 0) return savedText;
  return joinPlainStatusParts(proseLines, statusLines, placement);
}

function joinPlainStatusParts(
  proseLines: string[],
  statusLines: string[],
  placement: StatusWindowPlacement
): string {
  const prose = [...proseLines];
  const status = [...statusLines];
  if (status.length === 0) return prose.join("\n").trimEnd();

  if (placement === "top") {
    while (prose.length > 0 && !prose[0]?.trim()) prose.shift();
    return [...status, "", ...prose].join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
  }

  while (prose.length > 0 && !prose[prose.length - 1]?.trim()) prose.pop();
  return [...prose, "", ...status].join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

/** 유저노트 plain formatSpec — 모델이 본문에 넣은 줄글 상태창 제거(StatusMetaCard 전담) */
export function stripPlainTextStatusFieldBlock(text: string, formatSpec: string): string {
  const spec = formatSpec.trim();
  if (!spec || !isPlainTextStatusFormatSpec(spec)) return text;

  const fieldLabels = resolvePlainStatusFieldLabels(spec);
  if (fieldLabels.length === 0) return text;

  const out: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push("");
      continue;
    }
    if (plainStatusLabelMatchesLine(trimmed, fieldLabels)) continue;
    const cleaned = stripGluedPlainStatusSuffix(line, fieldLabels);
    if (cleaned.trim()) out.push(cleaned);
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

/** 지문 옆(같은 줄) 붙음 방지 + 상태 블록을 요청 위치(상·하단)로 정렬 */
export function ensurePlainStatusBlockLayout(
  text: string,
  formatSpec: string,
  placement: StatusWindowPlacement = "bottom"
): string {
  const spec = formatSpec.trim();
  if (!spec || !isPlainTextStatusFormatSpec(spec)) return text;
  const fieldLabels = resolvePlainStatusFieldLabels(spec);
  if (fieldLabels.length === 0) return text;

  const { proseLines, statusLines } = collectPlainStatusParts(text, fieldLabels, {
    placement,
    relocateMisplacedStatus: true,
  });
  if (statusLines.length === 0) return text;
  return joinPlainStatusParts(proseLines, statusLines, placement);
}

export type PartitionPlainStatusOpts = {
  /** 스트리밍 중 — 미완성 상태 줄을 본문에서 빼 하단 카드로 */
  streaming?: boolean;
};

/** 표시용 — RP 본문과 줄글 상태창 분리 (카드 UI 렌더) */
export function partitionPlainStatusBlockForDisplay(
  text: string,
  formatSpec: string,
  placement: StatusWindowPlacement = "bottom",
  opts: PartitionPlainStatusOpts = {}
): { prose: string; statusBlock: string | null } {
  const spec = formatSpec.trim();
  if (!spec || !isPlainTextStatusFormatSpec(spec)) {
    return { prose: text, statusBlock: null };
  }
  const fieldLabels = resolvePlainStatusFieldLabels(spec);
  if (fieldLabels.length === 0) return { prose: text, statusBlock: null };

  const { proseLines, statusLines } = collectPlainStatusParts(text, fieldLabels, {
    partialLines: opts.streaming === true,
    relocateMisplacedStatus: true,
    placement,
  });
  if (statusLines.length === 0) return { prose: text, statusBlock: null };

  return {
    prose: proseLines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd(),
    statusBlock: statusLines.join("\n").trimEnd(),
  };
}

/** Flash 전담 — 저장·StatusMeta 입력에서 모델 plain 상태 줄 제거 */
export function stripPlainStatusFromProse(
  text: string,
  formatSpec: string,
  placement: StatusWindowPlacement = "bottom"
): string {
  const { prose } = partitionPlainStatusBlockForDisplay(text, formatSpec, placement);
  return prose.trimEnd() || text.trimEnd();
}

function extractTrailingBareStatusJsonObject(text: string): string | null {
  const trimmed = text.trimEnd();

  const complete = trimmed.match(/(\{[\s\S]*\})\s*$/);
  if (complete?.[1]) {
    const body = complete[1].trim();
    if (body.startsWith("{") && body.endsWith("}")) return body;
  }

  const lastBrace = trimmed.lastIndexOf("{");
  if (lastBrace >= 0) {
    const tail = trimmed.slice(lastBrace).trim();
    if (tail.startsWith("{")) return tail;
  }

  return null;
}

function hasTrailingIncompleteJsonFence(text: string): boolean {
  const open = text.search(/(?:^|\n)```json\b/i);
  if (open < 0) return false;
  const tail = text.slice(open);
  return (tail.match(/```/g) ?? []).length < 2;
}

function stripTrailingIncompleteStatusJsonFence(text: string): string {
  if (!hasTrailingIncompleteJsonFence(text)) return text;
  const m = text.match(/(?:^|\n)```json\b/i);
  if (!m || m.index == null) return text;
  return text.slice(0, m.index).trimEnd();
}

const JSON_FENCE_TAIL_RE = /```json\s*[\s\S]*?```\s*$/i;

export function stripStatusWindowJsonBlock(text: string): string {
  let out = text.trimEnd();

  for (let pass = 0; pass < 4; pass++) {
    const m = out.match(JSON_FENCE_TAIL_RE);
    if (!m || m.index == null) break;
    out = out.slice(0, m.index).trimEnd();
  }

  out = stripTrailingIncompleteStatusJsonFence(out);

  const bare = extractTrailingBareStatusJsonObject(out);
  if (bare) {
    const bareMatch = out.match(/\n(\{[\s\S]*\})\s*$/);
    if (bareMatch?.index != null) {
      out = out.slice(0, bareMatch.index).trimEnd();
    }
  }

  return out;
}

function isStatusTableHeaderLine(trimmed: string): boolean {
  return (
    /^\|\s*항목\s*\|\s*내용\s*\|/i.test(trimmed) ||
    (/^\|\s*[^|]+\|\s*[^|]+\|\s*$/.test(trimmed) &&
      /(?:상태|시간|장소|속마음|NPC|낙서|하고\s*싶|🕒|🏠)/i.test(trimmed))
  );
}

function isTableSeparatorLine(trimmed: string): boolean {
  return /^\|\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(trimmed.replace(/\s/g, ""));
}

function isMarkdownPipeRow(trimmed: string): boolean {
  return (
    /^\|\s*[^|\n]+(\|\s*[^|\n]*)+\|\s*$/.test(trimmed) ||
    /^\|\s*[^|\n]+(\|[^|\n]*)+\|?\s*$/.test(trimmed)
  );
}

function isPipeTableRunStart(lines: string[], index: number): boolean {
  const trimmed = lines[index]?.trim() ?? "";
  if (!isMarkdownPipeRow(trimmed) && !isStatusTableHeaderLine(trimmed)) return false;
  for (let j = index + 1; j < Math.min(lines.length, index + 6); j++) {
    const next = lines[j]?.trim() ?? "";
    if (!next) continue;
    if (isMarkdownPipeRow(next) || isTableSeparatorLine(next)) return true;
  }
  return isTableSeparatorLine(lines[index + 1]?.trim() ?? "");
}

/** 상태창 pipe-table 분리 — 본문 / 추출된 표 */
export function splitStatusMarkdownTables(text: string): { prose: string; tables: string[] } {
  const lines = text.split("\n");
  const out: string[] = [];
  const tables: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i]!.trim();

    if (isStatusTableHeaderLine(trimmed) || isPipeTableRunStart(lines, i)) {
      const tableLines = [lines[i]!];
      i++;
      while (i < lines.length) {
        const row = lines[i]!.trim();
        if (!row) break;
        if (isMarkdownPipeRow(row) || isTableSeparatorLine(row) || row.includes("|")) {
          tableLines.push(lines[i]!);
          i++;
          continue;
        }
        break;
      }
      if (tableLines.length >= 2) {
        tables.push(tableLines.join("\n"));
        while (i < lines.length && !lines[i]!.trim()) i++;
        continue;
      }
      out.push(...tableLines);
      continue;
    }

    if (isTableSeparatorLine(trimmed)) {
      i++;
      continue;
    }

    out.push(lines[i]!);
    i++;
  }

  return {
    prose: out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd(),
    tables,
  };
}

export function stripRenderedStatusMarkdownTable(text: string): string {
  return splitStatusMarkdownTables(text).prose;
}

const STATUS_TABLE_TAIL_HINT =
  /(?:항목|내용|상태|시간|장소|속마음|낙서|하고\s*싶|NPC|🕒|🏠)/i;

/** 본문 끝에 줄바꿈 없이 붙은 pipe-table — StatusMetaCard로 분리되므로 RP에서 제거 */
function stripTrailingGluedPipeTable(text: string): string {
  const m = text.match(/^([\s\S]*?)(\s*\|[^|\n]+\|(?:[^|\n]+\|)+[\s\S]*)$/);
  if (!m?.[1] || !m[2]) return text;
  const tail = m[2];
  const pipeLines = tail.split("\n").filter((line) => line.includes("|"));
  const hasStatusTableShape =
    /^\s*\|\s*항목\s*\|\s*내용\s*\|/im.test(tail) ||
    /\|:?-{2,}:?\s*\|/.test(tail) ||
    (STATUS_TABLE_TAIL_HINT.test(tail) && pipeLines.length >= 2);
  if (!hasStatusTableShape) return text;
  return m[1].trimEnd();
}

/** 모델이 본문에 넣은 ```html — 서버 Flash가 대체 */
export function extractModelHtmlVisualFences(text: string): { prose: string; fences: string[] } {
  const fences: string[] = [];
  const re = /```html\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const block = extractFencedHtmlBlock(match[0]) ?? match[0].trim();
    fences.push(block);
  }

  let prose = text.replace(/```html\s*[\s\S]*?```/gi, "").trimEnd();
  const open = prose.search(/```html\s/i);
  if (open >= 0) {
    const tail = prose.slice(open);
    const block = extractFencedHtmlBlock(tail) ?? tail.trim();
    if (block) fences.push(block.startsWith("```") ? block : `\`\`\`html\n${block}\n\`\`\``);
    prose = prose.slice(0, open).trimEnd();
  }

  return { prose, fences };
}

/** 모델이 본문에 넣은 ```html — 서버 Flash/StatusMetaCard가 대체 */
function stripModelHtmlVisualFences(text: string): string {
  return extractModelHtmlVisualFences(text).prose;
}

export type StripStatusArtifactsOptions = {
  /** @deprecated 항상 true — primary 모델 ```html 은 Flash 전담 */
  stripModelHtml?: boolean;
  /** true — plain/markdown 상태창은 모델 출력 유지(HTML·JSON만 제거) */
  modelOutputsPlainStatus?: boolean;
};

export type PartitionModelStatusResult = {
  prose: string;
  capturedTableMarkdown: string | null;
  capturedHtmlFence: string | null;
  /** <<<STATUS_VALUES>>> 블록 — stripStatusWindowJsonBlock 전에 추출 */
  capturedStatusWidgetValues?: ParsedStatusWidgetTurnValues | null;
};

/** RP 본문과 모델이 넣은 상태창(표·HTML) 분리 — 제거 전 캡처 */
export function partitionModelStatusArtifacts(
  text: string,
  opts?: StripStatusArtifactsOptions
): PartitionModelStatusResult {
  const widgetSplit = splitProseAndStatusWidgetValues(text);
  const capturedStatusWidgetValues =
    widgetSplit.values.character || widgetSplit.values.user ? widgetSplit.values : null;
  let working = widgetSplit.prose;

  if (opts?.modelOutputsPlainStatus) {
    working = stripStatusWindowJsonBlock(working);
    const extracted = extractModelHtmlVisualFences(working);
    working = extracted.prose.replace(/\n```json\s*[\s\S]*$/i, "").trimEnd();
    return {
      prose: working,
      capturedTableMarkdown: null,
      capturedHtmlFence:
        extracted.fences.length > 0 ? extracted.fences[extracted.fences.length - 1]! : null,
      capturedStatusWidgetValues,
    };
  }

  working = stripStatusWindowJsonBlock(working);
  const { prose: afterTables, tables } = splitStatusMarkdownTables(working);
  working = stripTrailingGluedPipeTable(afterTables);

  let capturedHtmlFence: string | null = null;
  const extracted = extractModelHtmlVisualFences(working);
  working = extracted.prose;
  capturedHtmlFence =
    extracted.fences.length > 0 ? extracted.fences[extracted.fences.length - 1]! : null;

  working = working.replace(/\n```json\s*[\s\S]*$/i, "").trimEnd();

  return {
    prose: working,
    capturedTableMarkdown: tables.length > 0 ? tables[tables.length - 1]! : null,
    capturedHtmlFence,
    capturedStatusWidgetValues,
  };
}

/** RP prose only — strip JSON fences, bare objects, status markdown tables, glued tails */
export function stripAllStatusWindowOutputArtifacts(
  text: string,
  opts?: StripStatusArtifactsOptions
): string {
  return partitionModelStatusArtifacts(stripIncompleteStatusWidgetTail(text), opts).prose;
}
