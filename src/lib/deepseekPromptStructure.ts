import type { ChatMsg } from "@/lib/ai";
import type { ChunkCategory } from "@/types";
import { isContinueUserMessage } from "@/lib/continueNarrative";
import { OPENING_TURN_USER } from "@/lib/chatGreetingContext";

export type DeepSeekXmlGroup = "persona" | "world_lore" | "ltm";

export const DEEPSEEK_XML_TAGS = {
  persona: "PERSONA",
  worldLore: "WORLD_LORE",
  longTermMemory: "LONG_TERM_MEMORY",
  chatHistory: "CHAT_HISTORY",
} as const;

export const LTM_ABSOLUTE_FACTS_RULE = `이 항목에 기록된 내용은 과거에 실제로 일어난 '절대적인 기정사실(Absolute Facts)'이다. 대화를 진행할 때 이 사실들과 모순되는 발언이나 행동을 절대 하지 마라.`;

/**
 * DeepSeek-only user-turn reminder (V4 Pro xml mode).
 * Anti-fragment fencing + length stabilization only — style lives in common [IMMERSIVE PROSE].
 */
export const DEEPSEEK_BOTTOM_REMINDER =
  "[System Reminder: 지문은 -다/-했다체(경어 금지), 실제 발화만 큰따옴표, 속마음·감정은 따옴표 없이 지문으로. 대사는 캐릭터 말투에 따라 짧을 수 있다. 지문은 이어지는 행동·감각·의도를 같은 의미 단락 안에서 자연스럽게 연결하며, 짧은 문장마다 새 문단을 만들거나 한두 단어짜리 파편문을 습관적으로 반복하지 않는다.]" +
  "\n[DEEPSEEK LENGTH — SINGLE CALL]\n" +
  "Complete the requested narrative depth in this single response. " +
  "Obey TARGET_LENGTH / MINIMUM_FLOOR independently of the length of recent messages; " +
  "never imitate a short prior assistant reply as the desired response length.";

export function wrapDeepSeekXmlTag(tag: string, body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  return `<${tag}>\n${trimmed}\n</${tag}>`;
}

export function wrapDeepSeekLongTermMemory(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  return wrapDeepSeekXmlTag(
    DEEPSEEK_XML_TAGS.longTermMemory,
    `${LTM_ABSOLUTE_FACTS_RULE}\n\n${trimmed}`
  );
}

export function resolveDeepSeekLoreXmlGroup(category: ChunkCategory): DeepSeekXmlGroup {
  if (category === "world" || category === "background" || category === "abilities") {
    return "world_lore";
  }
  return "persona";
}

export function buildDeepSeekBottomReminderBlock(extraTail?: string | null): string {
  const extra = extraTail?.trim();
  if (!extra) return DEEPSEEK_BOTTOM_REMINDER;
  return `${DEEPSEEK_BOTTOM_REMINDER}\n${extra}`;
}

/**
 * DeepSeek-only thin-history length nudge (no numeric compensation target).
 * Desired visible band ~2,500–4,000 with spaces; TARGET/FLOOR live in common LENGTH.
 * Style/fill materials stay in common [IMMERSIVE PROSE].
 */
export const DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA =
  "[SHORT HISTORY]\n" +
  "Recent assistant length is context, not a response-length example. " +
  "In this single response, develop a full scene of roughly normal requested length even with sparse history. " +
  "Sustain it through meaningful dialogue, inner experience, relationships, atmosphere, and consequences rather than micro-action padding.";

/**
 * DeepSeek + regenerate only — diverge ≠ shorten.
 * Common LENGTH / Terminal stay unchanged; this counters avoid/diverge compression pressure.
 */
export const DEEPSEEK_REGEN_LENGTH_BLOCK =
  "[REGEN LENGTH]\n" +
  "A different development must still be a full-length scene. " +
  "Divergence means choosing different meaningful actions, dialogue, inner reactions, or developments—not compressing or omitting narrative depth.";

/**
 * DeepSeek-only — brief RP user lines are cues, not length exemplars.
 * Same block for normal and regenerate (no separate regen variant).
 */
export const DEEPSEEK_SHORT_USER_TURN_BLOCK =
  "[SHORT USER TURN]\n" +
  "A brief user message is an interaction cue, not a request for a brief reply. " +
  "Maintain the normal requested narrative depth and continue the scene naturally.";

/** Significant chars after stripping whitespace + common punctuation (reuse count style). */
export const DEEPSEEK_SHORT_USER_TURN_MAX_CHARS = 20;

const SHORT_HISTORY_AVG_NO_WS_THRESHOLD = 2200;

const REGEN_USER_ANCHOR_MARKERS = [
  "[User message — fixed anchor, not dialogue to rewrite]",
  "[User message — fixed anchor; OOC inside is mandatory]",
  "[User message — OOC inside is mandatory]",
] as const;

function countNoWsChars(text: string): number {
  return [...text.replace(/\s+/g, "")].length;
}

/** Whitespace + common punctuation removed; matches SHORT HISTORY no-ws counting spirit. */
export function countDeepSeekShortUserTurnChars(text: string): number {
  return [
    ...text.replace(
      /[\s.,!?…·~〜"'“”‘’`´\-–—_/\\()[\]{}<>:;，。！？、·～「」『』【】《》〈〉]/g,
      ""
    ),
  ].length;
}

/** RP user body from normal or regenerate-wrapped currentUserMessage. */
export function extractDeepSeekRpUserTurnText(currentUserMessage: string): string {
  const t = currentUserMessage.trim();
  if (!t) return "";
  for (const marker of REGEN_USER_ANCHOR_MARKERS) {
    const idx = t.indexOf(marker);
    if (idx >= 0) return t.slice(idx + marker.length).trim();
  }
  if (/^\[CURRENT USER INPUT\]/i.test(t)) {
    return t.replace(/^\[CURRENT USER INPUT\]\s*/i, "").trim();
  }
  // Unparsed system / continue wrappers are not short RP turns.
  if (/^\[SYSTEM:/i.test(t)) return "";
  return t;
}

function isDeepSeekNonRpUserCue(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (t === OPENING_TURN_USER || t.startsWith(`${OPENING_TURN_USER}\n`)) return true;
  if (isContinueUserMessage(t)) return true;
  if (/^\[SYSTEM:/i.test(t)) return true;
  if (/[\[\(（]\s*OOC\b/i.test(t) || /\bOOC\s*[:：\]\)]/i.test(t)) return true;
  return false;
}

/** True only for very short ordinary RP lines (e.g. 배고파. / 응. / 왜?). */
export function isDeepSeekShortUserTurn(currentUserMessage: string): boolean {
  const rp = extractDeepSeekRpUserTurnText(currentUserMessage);
  if (!rp || isDeepSeekNonRpUserCue(rp)) return false;
  return countDeepSeekShortUserTurnChars(rp) <= DEEPSEEK_SHORT_USER_TURN_MAX_CHARS;
}

export function resolveDeepSeekShortUserTurnExtra(
  currentUserMessage: string
): string | null {
  return isDeepSeekShortUserTurn(currentUserMessage)
    ? DEEPSEEK_SHORT_USER_TURN_BLOCK
    : null;
}

/** When recent assistants average under ~2200 no-ws (or none), return an extra length nudge. */
export function resolveDeepSeekShortHistoryLengthExtra(
  history: Array<{ role: string; content: string }>
): string | null {
  const recent = history
    .filter((m) => m.role === "assistant" && m.content.trim())
    .slice(-3);
  if (recent.length === 0) return DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA;
  const avg =
    recent.reduce((sum, m) => sum + countNoWsChars(m.content), 0) / recent.length;
  if (avg < SHORT_HISTORY_AVG_NO_WS_THRESHOLD) return DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA;
  return null;
}

export function prependDeepSeekBottomReminder(
  userContent: string,
  extraTail?: string | null
): string {
  const reminder = buildDeepSeekBottomReminderBlock(extraTail);
  const body = userContent.trim();
  if (!body) return reminder;
  if (body.startsWith(DEEPSEEK_BOTTOM_REMINDER)) return body;
  return `${reminder}\n\n${body}`;
}

export function formatDeepSeekChatHistoryBlock(history: ChatMsg[]): string {
  const lines = history
    .filter((m) => m.content.trim())
    .map((m) => {
      const role = m.role === "assistant" ? "Assistant" : "User";
      return `${role}: ${m.content.trim()}`;
    });
  if (lines.length === 0) return "";
  return wrapDeepSeekXmlTag(DEEPSEEK_XML_TAGS.chatHistory, lines.join("\n\n"));
}

export type DeepSeekXmlBuffers = Record<DeepSeekXmlGroup, string[]>;

export function createDeepSeekXmlBuffers(): DeepSeekXmlBuffers {
  return { persona: [], world_lore: [], ltm: [] };
}

export function flushDeepSeekXmlBuffers(
  buffers: DeepSeekXmlBuffers,
  groups: DeepSeekXmlGroup[] = ["persona", "world_lore", "ltm"]
): string[] {
  const flushed: string[] = [];
  if (groups.includes("persona")) {
    const personaBody = buffers.persona.join("\n\n").trim();
    if (personaBody) {
      flushed.push(wrapDeepSeekXmlTag(DEEPSEEK_XML_TAGS.persona, personaBody));
    }
    buffers.persona = [];
  }
  if (groups.includes("world_lore")) {
    const worldBody = buffers.world_lore.join("\n\n").trim();
    if (worldBody) {
      flushed.push(wrapDeepSeekXmlTag(DEEPSEEK_XML_TAGS.worldLore, worldBody));
    }
    buffers.world_lore = [];
  }
  if (groups.includes("ltm")) {
    const ltmBody = buffers.ltm.join("\n\n").trim();
    if (ltmBody) {
      flushed.push(wrapDeepSeekLongTermMemory(ltmBody));
    }
    buffers.ltm = [];
  }
  return flushed;
}

export function logDeepSeekContextStructure(opts: {
  systemPrompt: string;
  history: ChatMsg[];
}): void {
  const current = opts.history.at(-1);
  const priorHistory = opts.history.slice(0, -1);
  const chatHistoryBlock = formatDeepSeekChatHistoryBlock(priorHistory);
  console.log("[DeepSeek context structure]", {
    tags: {
      PERSONA: opts.systemPrompt.includes(`<${DEEPSEEK_XML_TAGS.persona}>`),
      WORLD_LORE: opts.systemPrompt.includes(`<${DEEPSEEK_XML_TAGS.worldLore}>`),
      LONG_TERM_MEMORY: opts.systemPrompt.includes(`<${DEEPSEEK_XML_TAGS.longTermMemory}>`),
      CHAT_HISTORY: chatHistoryBlock.includes(`<${DEEPSEEK_XML_TAGS.chatHistory}>`),
    },
    bottomReminderBeforeCurrentTurn:
      current?.role === "user" && current.content.trim().startsWith(DEEPSEEK_BOTTOM_REMINDER),
    historyTurns: priorHistory.length,
    chatHistoryPreview: chatHistoryBlock.slice(0, 200),
    currentTurnPreview: current?.content.slice(0, 120) ?? "",
  });
}
