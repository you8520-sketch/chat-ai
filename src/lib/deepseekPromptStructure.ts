import type { ChatMsg } from "@/lib/ai";
import type { ChunkCategory } from "@/types";

export type DeepSeekXmlGroup = "persona" | "world_lore" | "ltm";

export const DEEPSEEK_XML_TAGS = {
  persona: "PERSONA",
  worldLore: "WORLD_LORE",
  longTermMemory: "LONG_TERM_MEMORY",
  chatHistory: "CHAT_HISTORY",
} as const;

export const LTM_ABSOLUTE_FACTS_RULE = `이 항목에 기록된 내용은 과거에 실제로 일어난 '절대적인 기정사실(Absolute Facts)'이다. 대화를 진행할 때 이 사실들과 모순되는 발언이나 행동을 절대 하지 마라.`;

export const DEEPSEEK_BOTTOM_REMINDER =
  "[System Reminder: 지문은 -다/-했다체(경어 금지), 실제 발화만 큰따옴표, 속마음·감정은 따옴표 없이 지문으로.]";

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
