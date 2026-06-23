/** 채팅 UI·DB에 저장되는 유저 메시지 표시 텍스트 */
export const CONTINUE_USER_DISPLAY = "자동진행";
const LEGACY_CONTINUE_USER_DISPLAY = "계속하기";

export function isContinueUserMessage(content: string): boolean {
  const trimmed = content.trim();
  return trimmed === CONTINUE_USER_DISPLAY || trimmed === LEGACY_CONTINUE_USER_DISPLAY;
}

import {
  buildAutoContinueUserPersonaRules,
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

/** 재생성 rejected draft — 최소 2,000자 보존, 초과 시 head+tail */
export const REGENERATE_REJECTED_DRAFT_MIN_CHARS = 2000;
export const REGENERATE_REJECTED_DRAFT_MAX_CHARS = 6000;

export function formatRejectedDraftForRegenerate(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (trimmed.length <= REGENERATE_REJECTED_DRAFT_MAX_CHARS) return trimmed;
  const tailBudget = REGENERATE_REJECTED_DRAFT_MAX_CHARS - REGENERATE_REJECTED_DRAFT_MIN_CHARS - 5;
  const head = trimmed.slice(0, REGENERATE_REJECTED_DRAFT_MIN_CHARS).trimEnd();
  const tail = trimmed.slice(-Math.max(400, tailBudget)).trimStart();
  return `${head}\n…\n${tail}`;
}

/** 재생성 — 직전 상황은 유지, 전개·반응·대사는 달리 */
export function buildRegenerateCoreDirective(_charName?: string): string {
  return `[REGENERATE INTENT — user wants a DIFFERENT story development]
- Continue naturally from the situation in chat history and the fixed user anchor (same facts, setting, relationship stage).
- Write a NEW [A] response with different actions, reactions, dialogue beats, and emotional turns — NOT a paraphrase of the rejected draft.
- Do NOT copy the rejected draft verbatim or reuse its key plot beats, set-piece order, closing hook, or signature dialogue lines.
- Opening 2 sentences must use different actions/dialogue than [Rejected draft]. Include at least one new dialogue line and one new plot beat absent from [Rejected draft].
- Play ONLY [A] narration and dialogue — [A] speech register: see [CORE RP] §3 [SPEECH].`;
}

export function buildRegenerateRejectedDraftBlock(rejectedAssistantDraft?: string | null): string {
  const rejected = formatRejectedDraftForRegenerate(rejectedAssistantDraft ?? "");
  if (!rejected) return "";
  return `\n[Rejected draft — do NOT repeat this development; diverge clearly]
${rejected}\n`;
}

/** system prompt — 재생성 diverge 단일 출처 (user 턴과 중복 금지) */
export function buildRegenerateSystemDirective(input: {
  charName?: string;
  rejectedAssistantDraft?: string | null;
}): string {
  return `[REGENERATE — MANDATORY DIVERGENCE]
${buildRegenerateCoreDirective(input.charName)}
- This turn REPLACES the rejected assistant draft — paraphrase-only regen is a failure.
- Choose a visibly different emotional turn, action chain, or scene development while staying in character and honoring the fixed user anchor.
- NEVER reuse dialogue lines, physical beats, or scene-ending hooks from [Rejected draft].${buildRegenerateRejectedDraftBlock(input.rejectedAssistantDraft)}`;
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
    : buildAutoContinueUserPersonaRules(charName, persona);
  const sceneLead = input.novelModeEnabled
    ? `- Continue the web-novel scene — both [A] and [B] may speak and act per [NOVEL MODE — USER PERSONA NARRATION RULES].`
    : `- [B] may show unconscious [B] reactions per [NO GODMODDING] (auto-continue expanded) — never [B] deliberate dialogue, decisions, or voluntary lead.`;

  const resumeAfterOoc = input.resumeAfterOoc?.afterOocTurn
    ? buildResumeAfterOocSection(input.resumeAfterOoc)
    : "";
  const sceneAnchor = input.resumeAfterOoc?.afterOocTurn
    ? `- Resume the in-fiction scene per [RESUME IN-CHARACTER RP — NOT OOC] or [RESUME RP — OOC WAS SCENE GUIDANCE ONLY] below — NOT from OOC/meta/HTML output.`
    : `- Advance naturally from the exact micro-moment the previous assistant turn ended.`;
  const antiRepeatTarget = input.resumeAfterOoc?.dropOocTurnFromHistory
    ? "the OOC/meta/HTML turn or any failed auto-continue echo of it"
    : "the immediately previous assistant turn";

  return `[SYSTEM DIRECTIVE: CONTINUE THE NARRATIVE]${regenNote}
- The user clicked Continue / auto-advance. No new user dialogue or explicit action.
${sceneAnchor}
${sceneLead}

${personaRules}
${resumeAfterOoc ? `\n${resumeAfterOoc}\n` : ""}
[STRICT ANTI-REPETITION RULE]
- NEVER repeat dialogue, exclamations, physical beats, or OOC/meta/HTML lines from ${antiRepeatTarget}.

[CONTEXT & MEMORY INTEGRATION]
- Reflect [CORE RP] §3 [SPEECH], relationship stage, [User Notes], and [Memory].

[OUTPUT RULE]
- Dense Korean web-novel prose — obey [WRITING STYLE: 한국 웹소설 표준 포맷 및 호흡 통제] and [LENGTH CONTROL & SCENE EXPANSION]. Narration ends in -다/-한다/-했다.`;
}

export type RegenerateUserPromptInput = {
  userMessage: string;
  personaName: string;
  charName?: string;
  usesBanmal?: boolean;
  /** 리롤 대상 assistant 초안 — 전개 diverge 참고 (히스토리에서 제거됨) */
  rejectedAssistantDraft?: string | null;
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

  return `[SYSTEM: REGENERATE — CHAT OOC takes priority${exclusive ? "; user note status/HTML suspended" : ""}]
- Rewrite the last assistant turn, but obey the user's OOC in the anchor below FIRST.
${exclusive ? "- User note standing status window and extra HTML are OFF this turn — output ONLY what chat OOC requests.\n- Do NOT open RP narration — Flash/HTML (or minimal output) only per OOC." : "- User note standing status/world rules still apply alongside OOC.\n- If OOC allows RP continuation, keep it minimal unless OOC requests more."}
- Do NOT change what the user said or meant in the anchor below.
${buildRegenerateRejectedDraftBlock(input.rejectedAssistantDraft)}

[User message — fixed anchor; OOC inside is mandatory]
${msg}`;
}

/** 리롤 — 마지막 user 턴은 고정, assistant만 재작성 (diverge는 system [REGENERATE] 단일 출처) */
export function buildRegenerateUserPrompt(input: RegenerateUserPromptInput): string {
  const msg = input.userMessage.trim();

  return `[SYSTEM: REGENERATE — rewrite ONLY the last assistant message]
- Obey [REGENERATE — MANDATORY DIVERGENCE] in system prompt — user wants visibly different development, not a paraphrase.
- Do NOT change what the user said or meant in the anchor below.
- Do NOT write new quoted dialogue for [B] unless it already appears verbatim in the user message below.
${userPersonaSpeechTail(input.personaName, !!input.usesBanmal)}

[User message — fixed anchor, not dialogue to rewrite]
${msg}`;
}
