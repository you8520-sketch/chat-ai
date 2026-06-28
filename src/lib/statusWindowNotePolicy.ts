import {
  textRequestsHtmlVisualCardStanding,
  extractHtmlStatusFieldLabels,
  extractHtmlStatusFieldLabelsFromPipeTable,
  stripEmojisAndDecorators,
} from "@/lib/htmlVisualCardPolicy";
import {
  resolveStatusWindowOutputFormat,
  sourcesHaveExplicitMarkdownStatusRequest,
  type StatusWindowOutputFormat,
} from "@/lib/statusWindowOutputFormat";
import { extractOocSnippets } from "@/lib/userImpersonationPolicy";
import {
  extractFocusZoneNote,
  parseUserNoteCombined,
} from "@/lib/userNoteStatusWindow";
import { STATE_WINDOW_POLICY_BLOCK, STATUS_WIDGET_STATE_POLICY_BLOCK } from "@/lib/stateWindowPolicy";
import { isPlainTextStatusFormatSpec } from "@/lib/statusMeta/formatSpec";
import { extractPipeTableLines, isPipeTableLine } from "@/lib/statusWindowPipeTable";
import {
  resolveStatusWindowPlacementFromSources,
  type StatusWindowPlacement,
} from "@/lib/statusWindowPlacement";

const STATUS_WINDOW_TOPIC =
  /상태창|状态창|状態창|status\s*window|스탯\s*창|스텟\s*창|status\s*panel|stat\s*window/i;

const STATUS_WINDOW_OUTPUT_INTENT =
  /(?:표기|표시|출력|보여|적(?:어|용)|넣(?:어|을)|하단|상단|맨\s*아래|맨\s*위|매\s*턴|every\s*turn|each\s*turn|본문\s*하단|본문\s*상단|turn\s*end|append|bottom|top)/i;

const STATUS_WINDOW_DENY =
  /상태창\s*(?:금지|출력\s*금지|不要|끄|비활)|状态창\s*(?:금지|출력\s*금지|不要|끄|비활)|status\s*window\s*(?:off|disable|disabled|금지)|(?:표기|출력)\s*금지/i;

export type UserNoteStatusWindowPolicy = {
  everyTurn: boolean;
  policyBlock: string;
  formatSpec: string | null;
  placement: StatusWindowPlacement;
  /** 구체적 지시 없으면 plain — Flash 줄글 기본 */
  outputFormat: StatusWindowOutputFormat;
};

function noteRequestsPlainStatusWindow(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || hasStatusWindowDeny(trimmed)) return false;
  if (!STATUS_WINDOW_TOPIC.test(trimmed)) return false;
  if (!STATUS_WINDOW_OUTPUT_INTENT.test(trimmed)) return false;
  return true;
}

function isPlainStatusFieldTemplateLine(line: string, fieldLabels: string[]): boolean {
  if (fieldLabels.length === 0) return false;
  const trimmed = line.trim();
  if (!trimmed || /^\|.+\|$/.test(trimmed)) return false;

  const core = stripEmojisAndDecorators(trimmed);
  if (!core) return false;
  return fieldLabels.some((label) => {
    const l = label.trim();
    return core === l || core.includes(l) || l.includes(core);
  });
}

/** 이모지 줄글 필드 목록 — pipe-table 없이 Flash plain-text 상태창용 */
export function extractPlainEmojiStatusFieldBlock(
  text: string,
  opts?: { allowPlainTextFields?: boolean }
): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const fieldLabels = extractHtmlStatusFieldLabels(trimmed, opts);
  if (fieldLabels.length === 0) return null;

  const fieldLines: string[] = [];
  for (const line of trimmed.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (isPlainStatusFieldTemplateLine(t, fieldLabels)) {
      fieldLines.push(t);
    }
  }

  return fieldLines.length > 0 ? fieldLines.join("\n") : null;
}

function sourcesHavePlainStatusWindowIntent(sources: {
  userNote?: string;
  userPersona?: string;
}): boolean {
  const noteText = sources.userNote?.trim() ?? "";
  const personaText = sources.userPersona?.trim() ?? "";
  for (const text of [
    noteText,
    noteBody(noteText),
    extractFocusZoneNote(noteText),
    personaText,
  ]) {
    if (text.trim() && noteRequestsPlainStatusWindow(text)) return true;
  }
  return false;
}

/** 줄글 상태창 필드 블록 — 지시문은 다른 구간에 있어도 noteHasStatusIntent면 필드만으로 추출 */
function resolvePlainStatusFieldFormatSpec(
  text: string,
  noteHasStatusIntent: boolean
): string | null {
  const trimmed = text.trim();
  if (!trimmed || extractPipeTableLines(trimmed)) return null;
  const hasLocalIntent = noteRequestsPlainStatusWindow(trimmed);
  if (!hasLocalIntent && !noteHasStatusIntent) return null;
  return extractPlainEmojiStatusFieldBlock(trimmed, {
    allowPlainTextFields: noteHasStatusIntent || hasLocalIntent,
  });
}

function resolvePlainEmojiStatusFormatSpec(text: string): string | null {
  return resolvePlainStatusFieldFormatSpec(text, noteRequestsPlainStatusWindow(text));
}

function noteBody(fullNote: string): string {
  return parseUserNoteCombined(fullNote ?? "").body.trim();
}

function isPlainStatusFieldLine(line: string, fieldLabels: string[]): boolean {
  return isPlainStatusFieldTemplateLine(line, fieldLabels);
}

export { extractPipeTableLines } from "@/lib/statusWindowPipeTable";

function snippetRequestsStatusWindow(snippet: string): boolean {
  const s = snippet.trim();
  if (!s || STATUS_WINDOW_DENY.test(s)) return false;
  return STATUS_WINDOW_TOPIC.test(s);
}

function hasStatusWindowDeny(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (STATUS_WINDOW_DENY.test(trimmed)) return true;
  for (const snippet of extractOocSnippets(trimmed)) {
    if (STATUS_WINDOW_DENY.test(snippet)) return true;
  }
  return false;
}

function buildEveryTurnPolicyBlock(
  formatSpec: string | null,
  placement: StatusWindowPlacement,
  outputFormat: StatusWindowOutputFormat = "plain"
): string {
  const formatBlock = formatSpec?.trim()
    ? `\n[STATUS FIELD TEMPLATE — Flash fills these; do NOT copy into your reply]\n${formatSpec.trim()}`
    : "";
  const placementLabel = placement === "top" ? "TOP" : "BOTTOM";
  const flashFormatHint =
    outputFormat === "markdown"
      ? "Flash will render a markdown pipe-table status block from the template below."
      : 'Flash will render plain-text lines ("라벨 : 값") from the template below.';
  const placementHint =
    placement === "top"
      ? "Status appears at the TOP of the turn in the UI, separated from prose."
      : "Status appears at the BOTTOM of the turn in the UI, separated from prose.";

  return `[STATUS UI — FLASH-GENERATED (${placementLabel})]
User note requires a status window after EVERY reply.
Status window generation is handled entirely by the background DeepSeek V3 model. Output narrative prose only.

${flashFormatHint}
${placementHint}${formatBlock}`;
}

function isStatusWindowDirectiveLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (STATUS_WINDOW_DENY.test(trimmed)) return true;
  for (const snippet of extractOocSnippets(trimmed)) {
    if (snippetRequestsStatusWindow(snippet) || STATUS_WINDOW_DENY.test(snippet)) return true;
  }
  if (snippetRequestsStatusWindow(trimmed)) return true;
  if (STATUS_WINDOW_TOPIC.test(trimmed) && STATUS_WINDOW_OUTPUT_INTENT.test(trimmed)) return true;
  return false;
}

/** 매 턴 policy로 승격된 상태창 지시·표 템플릿 — identity/note에서 제거 (policy 블록과 중복 방지) */
export function stripPromotedStatusWindowContent(text: string): string {
  const fieldLabels = extractHtmlStatusFieldLabels(text);
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (isPipeTableLine(trimmed)) {
      while (i < lines.length) {
        const t = lines[i]!.trim();
        if (!t) {
          i++;
          continue;
        }
        if (isPipeTableLine(t)) {
          i++;
          continue;
        }
        break;
      }
      continue;
    }
    if (isStatusWindowDirectiveLine(trimmed)) {
      i++;
      continue;
    }
    if (fieldLabels.length > 0 && isPlainStatusFieldLine(trimmed, fieldLabels)) {
      i++;
      continue;
    }
    out.push(line);
    i++;
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** 기본 OOC-only policy일 때 유저노트·페르소나의 '상태창 금지' 중복 제거 */
export function stripDefaultStatusWindowDenyLines(text: string): string {
  const lines = text.split("\n");
  const kept = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    if (STATUS_WINDOW_DENY.test(trimmed)) return false;
    for (const snippet of extractOocSnippets(trimmed)) {
      if (STATUS_WINDOW_DENY.test(snippet)) return false;
    }
    return true;
  });
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** 상태창 policy 주입 후 persona/note/mandatory에서 중복 지시 제거 */
export function stripRedundantStatusWindowFromSource(
  text: string | null | undefined,
  policy: UserNoteStatusWindowPolicy
): string {
  const raw = text?.trim() ?? "";
  if (!raw) return "";
  if (policy.everyTurn) return stripPromotedStatusWindowContent(raw);
  return stripDefaultStatusWindowDenyLines(raw);
}

function pipeTableToPlainLineFormatSpec(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || !extractPipeTableLines(trimmed)) return null;
  const labels = extractHtmlStatusFieldLabelsFromPipeTable(trimmed);
  if (labels.length === 0) return null;
  return labels.join("\n");
}

/** 마크다운 요청 + 이모지 줄글 필드만 있을 때 pipe-table formatSpec으로 변환 */
function plainEmojiFieldsToPipeTableFormatSpec(
  text: string,
  noteHasStatusIntent: boolean
): string | null {
  const plain = resolvePlainStatusFieldFormatSpec(text, noteHasStatusIntent);
  if (!plain) return null;
  const rows = plain
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `| ${line} |`);
  return rows.length > 0 ? rows.join("\n") : null;
}

/** 마크다운+표형식 요청 시 plain formatSpec → pipe-table로 보정 */
function coerceFormatSpecForOutputFormat(
  formatSpec: string | null,
  outputFormat: StatusWindowOutputFormat,
  sources: { userNote?: string; userPersona?: string },
  noteHasStatusIntent: boolean
): string | null {
  const noteText = sources.userNote?.trim() ?? "";
  const personaText = sources.userPersona?.trim() ?? "";
  const body = noteBody(noteText);
  const focus = extractFocusZoneNote(noteText).trim();

  if (outputFormat === "markdown") {
    if (formatSpec?.trim() && !isPlainTextStatusFormatSpec(formatSpec)) {
      return formatSpec;
    }
    for (const text of [body, focus, noteText, personaText]) {
      if (!text.trim()) continue;
      const rawPipe = extractPipeTableLines(text);
      if (rawPipe) return rawPipe;
      if (sourcesHaveExplicitMarkdownStatusRequest(sources)) {
        const fromPlain = plainEmojiFieldsToPipeTableFormatSpec(text, noteHasStatusIntent);
        if (fromPlain) return fromPlain;
      }
    }
    return formatSpec?.trim() && !isPlainTextStatusFormatSpec(formatSpec) ? formatSpec : null;
  }

  return formatSpec;
}

/** 유저노트·페르소나 — formatSpec (기본=줄글 · 마크다운 명시 시 pipe-table 유지) */
export function resolveStatusFormatSpecFromSources(sources: {
  userNote?: string;
  userPersona?: string;
  outputFormat?: StatusWindowOutputFormat;
}): string | null {
  const noteText = sources.userNote?.trim() ?? "";
  const personaText = sources.userPersona?.trim() ?? "";
  const outputFormat =
    sources.outputFormat ??
    resolveStatusWindowOutputFormat({ userNote: noteText, userPersona: personaText });
  const noteHasStatusIntent = sourcesHavePlainStatusWindowIntent(sources);
  const body = noteBody(noteText);
  const focus = extractFocusZoneNote(noteText).trim();

  for (const text of [body, focus, noteText, personaText]) {
    if (!text.trim()) continue;

    if (outputFormat === "markdown") {
      const rawPipe = extractPipeTableLines(text);
      if (rawPipe) return rawPipe;
      if (sourcesHaveExplicitMarkdownStatusRequest(sources)) {
        const fromPlain = plainEmojiFieldsToPipeTableFormatSpec(text, noteHasStatusIntent);
        if (fromPlain) return fromPlain;
      }
      continue;
    }

    const plain = resolvePlainStatusFieldFormatSpec(text, noteHasStatusIntent);
    if (plain) return plain;

    if (outputFormat === "plain") {
      const fromPipe = pipeTableToPlainLineFormatSpec(text);
      if (fromPipe) return fromPipe;
    }
  }
  return null;
}

function analyzeEveryTurnFromSources(
  sources: {
    userNote?: string;
    userPersona?: string;
  },
  outputFormat: StatusWindowOutputFormat
): { everyTurn: boolean; formatSpec: string | null } {
  const noteText = sources.userNote?.trim() ?? "";
  const personaText = sources.userPersona?.trim() ?? "";
  const noteHasStatusIntent = sourcesHavePlainStatusWindowIntent(sources);
  const body = noteBody(noteText);
  const focus = extractFocusZoneNote(noteText).trim();

  const hasIntent = (text: string) =>
    noteRequestsPlainStatusWindow(text) || noteHasStatusIntent;

  for (const text of [body, focus, noteText, personaText]) {
    if (!text.trim() || !hasIntent(text)) continue;

    if (outputFormat === "markdown") {
      const rawPipe = extractPipeTableLines(text);
      if (rawPipe) return { everyTurn: true, formatSpec: rawPipe };
      if (sourcesHaveExplicitMarkdownStatusRequest(sources)) {
        const fromPlain = plainEmojiFieldsToPipeTableFormatSpec(text, noteHasStatusIntent);
        if (fromPlain) return { everyTurn: true, formatSpec: fromPlain };
      }
      continue;
    }

    const plain = resolvePlainStatusFieldFormatSpec(text, noteHasStatusIntent);
    if (plain) return { everyTurn: true, formatSpec: plain };

    if (outputFormat === "plain") {
      const fromPipe = pipeTableToPlainLineFormatSpec(text);
      if (fromPipe) return { everyTurn: true, formatSpec: fromPipe };
    }
  }

  return { everyTurn: false, formatSpec: null };
}

/** HTML Visual Card(로어북) + 상태창 동시 요청 → 서버 pipe-table 경로 비활성 */
function htmlStatusWindowComboActive(sources: {
  userNote?: string;
  userPersona?: string;
}): boolean {
  const noteText = sources.userNote?.trim() ?? "";
  const personaText = sources.userPersona?.trim() ?? "";
  const combined = [noteText, personaText].filter(Boolean).join("\n");
  if (!STATUS_WINDOW_TOPIC.test(combined)) return false;
  return (
    textRequestsHtmlVisualCardStanding(noteText) ||
    textRequestsHtmlVisualCardStanding(personaText)
  );
}

function resolvePlacementFromSources(sources: {
  userNote?: string;
  userPersona?: string;
  userMessage?: string;
  characterSetting?: string;
}): StatusWindowPlacement {
  return resolveStatusWindowPlacementFromSources(sources, "bottom");
}

export function resolveStatusWindowPolicyFromSources(sources: {
  userNote?: string;
  userPersona?: string;
  userMessage?: string;
  characterSetting?: string;
  statusWidgetActive?: boolean;
}): UserNoteStatusWindowPolicy {
  const noteText = sources.userNote?.trim() ?? "";
  const personaText = sources.userPersona?.trim() ?? "";
  const placement = resolvePlacementFromSources(sources);
  const outputFormat = resolveStatusWindowOutputFormat({
    userNote: noteText,
    userPersona: personaText,
  });

  if (sources.statusWidgetActive) {
    return {
      everyTurn: false,
      policyBlock: STATUS_WIDGET_STATE_POLICY_BLOCK,
      formatSpec: null,
      placement,
      outputFormat,
    };
  }

  const combined = [noteText, personaText].filter(Boolean).join("\n");
  if (hasStatusWindowDeny(combined)) {
    return {
      everyTurn: false,
      policyBlock: "",
      formatSpec: null,
      placement,
      outputFormat,
    };
  }

  if (htmlStatusWindowComboActive(sources)) {
    return {
      everyTurn: false,
      policyBlock: "",
      formatSpec: null,
      placement,
      outputFormat,
    };
  }

  const noteHasStatusIntent = sourcesHavePlainStatusWindowIntent(sources);
  const { everyTurn, formatSpec: rawFormatSpec } = analyzeEveryTurnFromSources(
    sources,
    outputFormat
  );
  const formatSpec = coerceFormatSpecForOutputFormat(
    rawFormatSpec,
    outputFormat,
    sources,
    noteHasStatusIntent
  );

  if (everyTurn && formatSpec) {
    return {
      everyTurn: true,
      policyBlock: buildEveryTurnPolicyBlock(formatSpec, placement, outputFormat),
      formatSpec,
      placement,
      outputFormat,
    };
  }

  return {
    everyTurn: false,
    policyBlock: STATE_WINDOW_POLICY_BLOCK,
    formatSpec: null,
    placement,
    outputFormat,
  };
}

/** @deprecated resolveStatusWindowPolicyFromSources 사용 */
export function resolveUserNoteStatusWindowPolicy(fullNote: string): UserNoteStatusWindowPolicy {
  return resolveStatusWindowPolicyFromSources({ userNote: fullNote });
}

/** @deprecated Flash owns every-turn status — main model never outputs plain status */
export function modelPlainStatusEveryTurnActive(_policy: UserNoteStatusWindowPolicy): boolean {
  return false;
}

/** 매 턴 Flash 줄글 상태창(이모지·plain 필드) 활성 */
export function flashPlainStatusEveryTurnActive(
  policy: UserNoteStatusWindowPolicy
): boolean {
  return policy.everyTurn && policy.formatSpec != null;
}

/** 매 턴 Flash markdown pipe-table 상태창 (줄글 formatSpec 제외) */
export function markdownPipeTableStatusWindowActive(
  policy: UserNoteStatusWindowPolicy
): boolean {
  if (policy.outputFormat !== "markdown") return false;
  if (!policy.formatSpec?.trim()) return false;
  return !isPlainTextStatusFormatSpec(policy.formatSpec);
}
