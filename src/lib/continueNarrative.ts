/** 채팅 UI·DB에 저장되는 유저 메시지 표시 텍스트 */
export const CONTINUE_USER_DISPLAY = "자동진행";
const LEGACY_CONTINUE_USER_DISPLAY = "계속하기";

export function isContinueUserMessage(content: string): boolean {
  const trimmed = content.trim();
  return trimmed === CONTINUE_USER_DISPLAY || trimmed === LEGACY_CONTINUE_USER_DISPLAY;
}

import {
  buildNovelModeUserPersonaRules,
} from "@/lib/userPersonaNarrationRules";
import { isHtmlDisplayOnlyTurn, isOocCreativeHtmlTurn } from "@/lib/htmlDisplayOnlyTurn";
import { isOocHtmlRequest } from "@/lib/oocHtmlRequest";
import {
  chatOocSuppressesUserNoteExtras,
  classifyChatOocIntent,
  isChatOocRpContinuing,
  type ChatOocIntent,
} from "@/lib/chatOocPriority";
import type { DialogueTurn } from "@/lib/hybridMemory";

/** description에 반말/구어 힌트 */
export function personaUsesInformalSpeech(description: string): boolean {
  return /반말|구어|캐주얼|informal|~했어|~아니야|~지\s*[\?？]|~네\s*[\?？]/i.test(description);
}

function userPersonaSpeechTail(_persona: string, usesBanmal: boolean): string {
  if (usesBanmal) {
    return `[USER PERSONA SPEECH — [B]]
- [B] speaks casual Korean 반말 ONLY (~어/~지/~네/~야). NEVER ~습니다/~요/~세요/~십니다 for [B].
- [B] does NOT call [A] "OO님" / "OO님께서" — use name without honorific or casual forms from [USER_PERSONA].
- [CORE RP] §3 [SPEECH] for [A] must NEVER bleed onto [B] lines.`;
  }
  return `[USER PERSONA SPEECH — [B]]
- Match [USER_PERSONA] register exactly. Do NOT copy [A]'s honorific level onto [B].`;
}

import { estimateTokens } from "@/lib/tokenEstimate";
import { buildCompactTerminalLengthAbsoluteTail } from "@/lib/responseLength";

/** 재생성 rejected draft — full-text mode only (REGENERATE_FULL_REJECTED_DRAFT=1) */
export const REGENERATE_REJECTED_DRAFT_MIN_CHARS = 2000;
export const REGENERATE_REJECTED_DRAFT_MAX_CHARS = 6000;

/** Compact divergence summary — narrative beats only, not wording */
export const REGENERATE_DIVERGENCE_SUMMARY_MIN_TOKENS = 180;
export const REGENERATE_DIVERGENCE_SUMMARY_MAX_TOKENS = 320;

/** @deprecated full draft — opt-in via REGENERATE_FULL_REJECTED_DRAFT */
export function formatRejectedDraftForRegenerate(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (trimmed.length <= REGENERATE_REJECTED_DRAFT_MAX_CHARS) return trimmed;
  const tailBudget = REGENERATE_REJECTED_DRAFT_MAX_CHARS - REGENERATE_REJECTED_DRAFT_MIN_CHARS - 5;
  const head = trimmed.slice(0, REGENERATE_REJECTED_DRAFT_MIN_CHARS).trimEnd();
  const tail = trimmed.slice(-Math.max(400, tailBudget)).trimStart();
  return `${head}\n…\n${tail}`;
}

/** true — inject full rejected draft (legacy); default is compact divergence summary only */
export function isRegenerateFullRejectedDraftEnabled(): boolean {
  const raw = process.env.REGENERATE_FULL_REJECTED_DRAFT?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function truncateToTokenBudget(text: string, maxTokens: number): string {
  const trimmed = text.trim();
  if (!trimmed || estimateTokens(trimmed) <= maxTokens) return trimmed;
  const ellipsis = "…";
  const budget = Math.max(1, maxTokens - estimateTokens(ellipsis));
  let lo = 0;
  let hi = trimmed.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (estimateTokens(trimmed.slice(0, mid)) <= budget) lo = mid;
    else hi = mid - 1;
  }
  if (lo <= 0) return ellipsis;
  return `${trimmed.slice(0, lo).trimEnd()}${ellipsis}`;
}

function normalizeDraftForDivergenceSummary(text: string): string {
  return text
    .replace(/\[태그:[^\]]+\]/gi, "")
    .replace(/<<<STATUS_VALUES[\s\S]*?(?:<<<END_STATUS>>>|$)/gi, "")
    .replace(/<<<END_STATUS>>>/gi, "")
    .replace(/📅[^\n]*/g, "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function splitDraftParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function extractKeyDialogueBeats(text: string, maxBeats = 5): string[] {
  const beats: string[] = [];
  const seen = new Set<string>();
  const patterns = [/"([^"]{3,100})"/g, /「([^」]{3,100})」/g];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const line = m[1]?.trim();
      if (!line || seen.has(line)) continue;
      seen.add(line);
      beats.push(`"${line.length > 100 ? `${line.slice(0, 97)}…` : line}"`);
      if (beats.length >= maxBeats) return beats;
    }
  }
  return beats;
}

function bulletMajorActions(paragraphs: string[], maxBullets = 4): string[] {
  if (paragraphs.length <= 2) return [];
  const middle = paragraphs.slice(1, -1);
  const bullets: string[] = [];
  for (const p of middle) {
    const compact = p.replace(/^\*+|\*+$/g, "").trim();
    if (!compact || compact.length < 12) continue;
    bullets.push(compact);
    if (bullets.length >= maxBullets) break;
  }
  if (bullets.length > 0) return bullets;
  if (paragraphs.length >= 2) {
    const fallback = paragraphs[1]!.replace(/^\*+|\*+$/g, "").trim();
    if (fallback.length >= 12) bullets.push(fallback);
  }
  return bullets;
}

/**
 * Compact beat summary for regen diverge — forbidden beats only (no positive scene anchor).
 * Purpose: block repeating the rejected arc without priming the same opening situation.
 */
export function buildRegenerateDivergenceSummary(rejectedAssistantDraft?: string | null): string {
  const normalized = normalizeDraftForDivergenceSummary(rejectedAssistantDraft ?? "");
  if (!normalized) return "";

  const paragraphs = splitDraftParagraphs(normalized);
  const openingRaw = paragraphs[0] ?? normalized.slice(0, 800);
  const endingRaw =
    paragraphs.length > 1 ? paragraphs[paragraphs.length - 1]! : normalized.slice(-800);
  const actions = bulletMajorActions(paragraphs);
  const dialogue = extractKeyDialogueBeats(normalized);

  const sectionBudget = Math.floor(REGENERATE_DIVERGENCE_SUMMARY_MAX_TOKENS / 4);
  const forbiddenOpening = truncateToTokenBudget(openingRaw, sectionBudget);
  const forbiddenEnding =
    endingRaw.trim() === openingRaw.trim()
      ? ""
      : truncateToTokenBudget(endingRaw, sectionBudget);

  const lines: string[] = [
    "[Rejected turn: avoid these beats; summary only]",
  ];

  if (forbiddenOpening) {
    lines.push(`Opening to avoid: ${forbiddenOpening}`);
  }

  if (actions.length > 0) {
    lines.push("Action beats to avoid:");
    for (const a of actions) {
      lines.push(`- ${truncateToTokenBudget(a, Math.max(40, sectionBudget - 10))}`);
    }
  }

  if (dialogue.length > 0) {
    lines.push("Dialogue to avoid:");
    for (const d of dialogue) lines.push(`- ${d}`);
  }

  if (forbiddenEnding) lines.push(`Ending hook to avoid: ${forbiddenEnding}`);

  let summary = lines.join("\n");
  return truncateToTokenBudget(summary, REGENERATE_DIVERGENCE_SUMMARY_MAX_TOKENS);
}

export function buildRegenerateDivergenceReferenceBlock(
  rejectedAssistantDraft?: string | null,
  opts?: { includeFullRejectedDraft?: boolean }
): string {
  const useFull =
    opts?.includeFullRejectedDraft === true ||
    (opts?.includeFullRejectedDraft !== false && isRegenerateFullRejectedDraftEnabled());

  if (useFull) {
    const rejected = formatRejectedDraftForRegenerate(rejectedAssistantDraft ?? "");
    if (!rejected) return "";
    return `\n[Rejected draft — do NOT repeat this development; diverge clearly]
${rejected}\n`;
  }

  const summary = buildRegenerateDivergenceSummary(rejectedAssistantDraft);
  if (!summary) return "";
  return `\n${summary}\n`;
}

/** 재생성 — 직전 상황은 유지, 전개·반응·대사는 달리 */
export function buildRegenerateCoreDirective(_charName?: string): string {
  return `[REGENERATE INTENT - DIFFERENT DEVELOPMENT]
- 같은 장면, 같은 사실, 같은 관계 단계에서 다시 쓴다.
- 첫 행동/감정 비트는 거절된 초안과 달라야 한다.
- 문장만 바꾸는 재작성은 실패다. 행동, 대사, 감정 전환, 마무리 중 최소 둘을 새롭게 전개한다.
- avoid 목록의 표현과 비트를 재사용하지 않는다.`;
}

const REGENERATE_DIVERGE_AXES = [
  "첫 비트를 초안과 다르게 시작한다. 대사 시작이었다면 행동/감각부터, 행동 시작이었다면 다른 거리감이나 침묵부터 연다.",
  "초안의 감정 박자를 따라가지 말고 내적 긴장, 망설임, 회피 중 하나를 새 축으로 둔다.",
  "공간, 접촉, 거리, 빛 같은 감각 초점을 초안과 다르게 옮긴다.",
  "[A]가 초안보다 더 대담하게 다가가거나 더 조심스럽게 물러나는 식으로 힘의 방향을 바꾼다.",
] as const;

function hashRegenAttemptId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** regenAttemptId 기반 — 매 시도마다 다른 전개 축 1개 */
export function buildRegenerateDivergeAxisLine(regenAttemptId?: string | null): string {
  const id = regenAttemptId?.trim();
  if (!id) return "";
  const axis = REGENERATE_DIVERGE_AXES[hashRegenAttemptId(id) % REGENERATE_DIVERGE_AXES.length]!;
  return `\n[REGEN DIVERGE AXIS]\n- ${axis}`;
}

/** regen user 턴 — diverge가 길이 축소 변명이 되지 않도록 1줄 recency */
export function buildRegenerateLengthRecencyLine(targetResponseChars?: number | null): string {
  const tier = buildCompactTerminalLengthAbsoluteTail(targetResponseChars);
  return `- Divergence is NOT an excuse for a shorter reply — same length tier as a normal turn (${tier}).`;
}

/** @deprecated use buildRegenerateDivergenceReferenceBlock */
export function buildRegenerateRejectedDraftBlock(rejectedAssistantDraft?: string | null): string {
  return buildRegenerateDivergenceReferenceBlock(rejectedAssistantDraft);
}

/** system prompt — 재생성 diverge 단일 출처 (user 턴과 중복 금지) */
export function buildRegenerateAttemptRecencyLine(regenAttemptId?: string | null): string {
  const id = regenAttemptId?.trim();
  if (!id) return "";
  return `\n[REGEN_ATTEMPT ${id}] fresh prose required; differ in actions, dialogue, and beats.`;
}

export function buildRegenerateSystemDirective(input: {
  charName?: string;
  rejectedAssistantDraft?: string | null;
  regenAttemptId?: string | null;
  includeFullRejectedDraft?: boolean;
}): string {
  return `[REGENERATE - MANDATORY DIVERGENCE]
Do not mention regeneration, system rules, or internal metadata. Preserve canon, memory, user-control mode, Korean webnovel style, and normal length behavior.${buildRegenerateAttemptRecencyLine(input.regenAttemptId)}${buildRegenerateDivergeAxisLine(input.regenAttemptId)}
${buildRegenerateCoreDirective(input.charName)}
- Same scene, not a new scene. Do not shorten the reply.${buildRegenerateDivergenceReferenceBlock(input.rejectedAssistantDraft, {
    includeFullRejectedDraft: input.includeFullRejectedDraft,
  })}`;
}

export type AutoContinueResumeContext = {
  afterOocTurn: boolean;
  dropOocTurnFromHistory: boolean;
  oocIntent: ChatOocIntent;
};

function lastNonContinueTurnIndex(turns: DialogueTurn[]): number {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (!isContinueUserMessage(turns[i]!.user)) return i;
  }
  return -1;
}

function classifyExclusiveOocTurn(userMessage: string): {
  hasOoc: boolean;
  dropFromHistory: boolean;
  oocIntent: ChatOocIntent;
} {
  const userMsg = userMessage.trim();
  const intent = classifyChatOocIntent(userMsg);
  const htmlDisplayOnly = isHtmlDisplayOnlyTurn(userMsg);
  const oocCreativeHtml = isOocCreativeHtmlTurn(userMsg);
  const hasOoc = intent !== "none" || htmlDisplayOnly || oocCreativeHtml;
  const dropFromHistory =
    intent === "rp_unrelated" ||
    chatOocSuppressesUserNoteExtras(userMsg) ||
    htmlDisplayOnly ||
    oocCreativeHtml;
  const oocIntent: ChatOocIntent =
    intent !== "none" ? intent : hasOoc ? "rp_unrelated" : "none";
  return { hasOoc, dropFromHistory, oocIntent };
}

/** 자동진행 — OOC 직후 RP 재개: 히스토리 절단 + 프롬프트 컨텍스트 */
export function resolveAutoContinueHistoryTurns(completedTurns: DialogueTurn[]): {
  historyTurns: DialogueTurn[];
  resumeCtx: AutoContinueResumeContext | null;
} {
  const anchorIndex = lastNonContinueTurnIndex(completedTurns);
  if (anchorIndex < 0) {
    return { historyTurns: completedTurns, resumeCtx: null };
  }

  const classified = classifyExclusiveOocTurn(completedTurns[anchorIndex]!.user);
  if (!classified.hasOoc) {
    return { historyTurns: completedTurns, resumeCtx: null };
  }

  const resumeCtx: AutoContinueResumeContext = {
    afterOocTurn: true,
    dropOocTurnFromHistory: classified.dropFromHistory,
    oocIntent: classified.oocIntent,
  };

  const historyTurns = classified.dropFromHistory
    ? completedTurns.slice(0, anchorIndex)
    : completedTurns;

  return { historyTurns, resumeCtx };
}

function buildResumeAfterOocSection(ctx: AutoContinueResumeContext): string {
  if (ctx.dropOocTurnFromHistory) {
    return `[RESUME IN-CHARACTER RP — NOT OOC]
- The turn before this Continue was OOC/meta/HTML/display-only — NOT an in-fiction scene beat.
- Do NOT repeat, explain, paraphrase, or continue any OOC lines, HTML UI copy, meta commentary, or fourth-wall text from that turn.
- Resume dense in-character RP from the last established in-scene moment in chat history and [Memory] — pick up where the fiction left off before the OOC interruption.
- Output = pure RP prose/dialogue only (no OOC prefixes; status widget only if [STATUS WIDGET] requires it).`;
  }

  return `[RESUME RP — OOC WAS SCENE GUIDANCE ONLY]
- The previous turn included in-chat OOC scene guidance — apply that intent in-character only.
- Do NOT speak as OOC, quote OOC blocks, or read meta/HTML instructions aloud.
- Continue the current RP arc in Korean web-novel prose from the prior in-scene beat.`;
}

export type ContinueNarrativeCommandInput = {
  personaName: string;
  charName?: string;
  usesBanmal?: boolean;
  novelModeEnabled?: boolean;
  /** 리롤 — 직전 assistant 초안 (히스토리에서 제거됨) */
  regenerate?: boolean;
  rejectedAssistantDraft?: string | null;
  /** 직전 턴 OOC — RP 재개 (히스토리 절단은 route에서 처리) */
  resumeAfterOoc?: AutoContinueResumeContext | null;
};

/**
 * 자동진행 버튼 전용 — API user 턴에 주입되는 히든 마스터 지시서.
 * DB에는 CONTINUE_USER_DISPLAY만 저장한다.
 */
export function buildContinueNarrativeCommand(input: ContinueNarrativeCommandInput): string {
  const persona = input.personaName.trim() || "the user character";
  const charName = input.charName?.trim() || "the AI character";
  const regenNote =
    input.regenerate === true
      ? `\n- Regenerate: obey [REGENERATE — MANDATORY DIVERGENCE] in system prompt (rejected draft excluded from history).`
      : "";

  const personaRules = input.novelModeEnabled
    ? buildNovelModeUserPersonaRules(charName, persona)
    : "";
  const sceneLead = input.novelModeEnabled
    ? `- 소설 모드 — [NOVEL MODE — USER PERSONA NARRATION RULES]에 따라 [A]+[B] 연기.`
    : `- [NO GODMODDING] 준수.`;

  const resumeAfterOoc = input.resumeAfterOoc?.afterOocTurn
    ? buildResumeAfterOocSection(input.resumeAfterOoc)
    : "";
  const sceneAnchor = input.resumeAfterOoc?.afterOocTurn
    ? `- Resume the in-fiction scene per [RESUME IN-CHARACTER RP — NOT OOC] or [RESUME RP — OOC WAS SCENE GUIDANCE ONLY] below — NOT from OOC/meta/HTML output.`
    : `- Advance naturally from the exact micro-moment the previous assistant turn ended.`;
  const antiRepeatTarget = input.resumeAfterOoc?.dropOocTurnFromHistory
    ? "the OOC/meta/HTML turn or any failed auto-continue echo of it"
    : "the immediately previous assistant turn";

  const personaRulesBlock = personaRules ? `\n${personaRules}\n` : "";

  return `[SYSTEM DIRECTIVE: CONTINUE THE NARRATIVE]${regenNote}
- The user clicked Continue / auto-advance. No new user dialogue or explicit action.
${sceneAnchor}
${sceneLead}
${personaRulesBlock}${resumeAfterOoc ? `\n${resumeAfterOoc}\n` : ""}
[STRICT ANTI-REPETITION RULE]
- NEVER repeat dialogue, exclamations, physical beats, or OOC/meta/HTML lines from ${antiRepeatTarget}.`;
}

export type RegenerateUserPromptInput = {
  userMessage: string;
  personaName: string;
  charName?: string;
  usesBanmal?: boolean;
  /** 유저 사칭(co-narration) ON일 때만 유저 말투 규칙 주입 — OFF면 [NO GODMODDING]과 충돌 */
  coNarrationEnabled?: boolean;
  /** 리롤 대상 assistant 초안 — 전개 diverge 참고 (히스토리에서 제거됨) */
  rejectedAssistantDraft?: string | null;
  /** 재생성마다 달라지는 nonce — 동일 프롬프트 캐시·결정론적 재출력 방지 */
  regenAttemptId?: string | null;
  targetResponseChars?: number | null;
};

/** 재생성 시 OOC·HTML·상태창 지시가 기본 RP 재작성 지시보다 우선 */
export function oocOverridesRegenerateRpDirective(userMessage: string): boolean {
  const t = userMessage.trim();
  if (!t) return false;
  if (chatOocSuppressesUserNoteExtras(t)) return true;
  if (isChatOocRpContinuing(t)) return true;
  if (isHtmlDisplayOnlyTurn(t)) return true;
  if (isOocHtmlRequest(t)) return true;
  return false;
}

/** 리롤 — OOC/HTML/상태창 우선 (긴 RP 재개 금지) */
export function buildRegenerateOocPriorityPrompt(input: RegenerateUserPromptInput): string {
  const msg = input.userMessage.trim();
  const exclusive = chatOocSuppressesUserNoteExtras(msg);

  const rules = exclusive
    ? `- OOC in the anchor below overrides standing status/HTML and default regen.
- Do NOT write RP narration — output ONLY what OOC requests (HTML/Flash or minimal).
- Do NOT change what the user said in the anchor.`
    : `- OOC in the anchor below takes priority over default regen.
- If OOC forbids RP, output only what OOC requests; otherwise keep RP minimal unless OOC asks for more.
- Do NOT change what the user said in the anchor.`;

  return `[SYSTEM: REGENERATE — CHAT OOC takes priority${exclusive ? " (user note status/HTML suspended)" : ""}]
${rules}

[User message — fixed anchor; OOC inside is mandatory]
${msg}`;
}

/** 리롤 — 마지막 user 턴은 고정, assistant만 재작성 (diverge·attempt nonce는 system [REGENERATE] 단일 출처) */
export function buildRegenerateUserPrompt(input: RegenerateUserPromptInput): string {
  const msg = input.userMessage.trim();

  // 유저 말투 규칙은 co-narration ON일 때만 — OFF에서 주입하면
  // "[B] 대사를 쓰라"는 신호가 되어 [NO GODMODDING]과 충돌한다.
  const speechTail = input.coNarrationEnabled
    ? `\n${userPersonaSpeechTail(input.personaName, !!input.usesBanmal)}`
    : "";

  return `[SYSTEM: REGENERATE — rewrite ONLY the last assistant message]
- Obey [REGENERATE — MANDATORY DIVERGENCE] in system prompt — user wants visibly different development, not a paraphrase.
- Do NOT change what the user said or meant in the anchor below.
- Do NOT write new quoted dialogue for [B] unless it already appears verbatim in the user message below.
${buildRegenerateLengthRecencyLine(input.targetResponseChars)}${speechTail}

[User message — fixed anchor, not dialogue to rewrite]
${msg}`;
}
