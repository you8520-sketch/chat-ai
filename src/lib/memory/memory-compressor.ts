import { callGeminiBackground } from "@/lib/ai";
import { COMPRESSION_TRIGGER, MEMORY_BUDGET } from "./memory-constants";
import {
  clearBuffer,
  getBufferMessages,
  getOrCreateChatMemory,
  updateChatMemory,
} from "./memory-db";
import type { MemoryBufferRow, MemoryTier } from "./memory-types";

const running = new Set<string>();

function runKey(userId: number, characterId: number): string {
  return `${userId}:${characterId}`;
}

function clampText(text: string, max: number): string {
  const t = text.trim();
  if (!t) return "";
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 1)) + "…";
}

function buildLocalFallbackSummary(messages: MemoryBufferRow[], charName: string, maxChars: number): string {
  const lines: string[] = [];
  for (const m of messages) {
    const label = m.role === "user" ? "유저" : charName;
    const snippet = m.content.replace(/\s+/g, " ").trim().slice(0, 120);
    if (snippet) lines.push(`- ${label}: ${snippet}`);
  }
  return clampText(lines.join("\n"), maxChars);
}
function formatBufferDialogue(messages: MemoryBufferRow[], charName: string): string {
  return messages
    .map((m) => {
      const label = m.role === "user" ? "유저" : charName;
      return `${label}: ${m.content.slice(0, 2000)}`;
    })
    .join("\n");
}

async function callGeminiCompression(system: string, userContent: string): Promise<string> {
  try {
    const { text } = await callGeminiBackground(system, [{ role: "user", content: userContent }]);
    return text.trim();
  } catch {
    return "";
  }
}

/**
 * 버퍼 메시지 20개 이상일 때 Gemini로 recent/archive 갱신 (백그라운드 전용)
 */
export async function compressMemoryBuffer(opts: {
  chatId: number;
  userId: number;
  characterId: number;
  charName: string;
  tier: MemoryTier;
}): Promise<boolean> {
  const key = runKey(opts.userId, opts.characterId);
  if (running.has(key)) return false;

  const buffer = getBufferMessages(opts.chatId);
  if (buffer.length < COMPRESSION_TRIGGER) return false;

  running.add(key);
  try {
    const memory = getOrCreateChatMemory(opts.chatId, opts.userId, opts.characterId, opts.tier);
    const budget = MEMORY_BUDGET[opts.tier];
    const batch = buffer.slice(0, COMPRESSION_TRIGGER);
    const dialogue = formatBufferDialogue(batch, opts.charName);

    const system = `당신은 롤플레이 대화 요약기입니다. 핵심 사건·감정·관계·호칭·약속만 한국어 불릿(-) 목록으로 압축하세요. 불필요한 수식어는 제외하고 정보 밀도를 높이세요. 요약 본문만 출력하세요.`;

    const userContent = `[기존 최근 요약]
${memory.recent_summary.trim() || "(없음)"}

[새 대화 ${batch.length}메시지]
${dialogue}

위 내용을 통합해 ${budget.recent}자 이내 불릿 요약:`;

    let newRecent = await callGeminiCompression(system, userContent);
    if (!newRecent.trim()) {
      newRecent = buildLocalFallbackSummary(batch, opts.charName, budget.recent);
      console.warn(
        `[memory] Gemini 요약 실패 → 로컬 요약 사용 user=${opts.userId} char=${opts.characterId}`
      );
    }
    if (!newRecent.trim()) return false;
    newRecent = clampText(newRecent, budget.recent);

    let newArchive = memory.archive_summary;
    if (memory.recent_summary.trim()) {
      const merged = [memory.archive_summary.trim(), memory.recent_summary.trim()].filter(Boolean).join("\n\n");
      newArchive = clampText(merged, budget.archive);
    }

    const lastIndex = batch[batch.length - 1]?.message_index ?? 0;
    updateChatMemory(opts.chatId, opts.userId, opts.characterId, {
      recent_summary: newRecent,
      archive_summary: newArchive,
      membership_tier: opts.tier,
      last_compressed_at: new Date().toISOString(),
    });
    clearBuffer(opts.chatId, lastIndex);

    console.info(
      `[memory] compressed user=${opts.userId} char=${opts.characterId} batch=${batch.length} recent=${newRecent.length}ch`
    );
    return true;
  } catch (e) {
    console.error(`[memory] compression failed user=${opts.userId} char=${opts.characterId}:`, (e as Error).message);
    return false;
  } finally {
    running.delete(key);
  }
}

/** 채팅 응답 지연 없이 백그라운드 실행 */
export function scheduleMemoryCompression(opts: {
  chatId: number;
  userId: number;
  characterId: number;
  charName: string;
  tier: MemoryTier;
}): void {
  void compressMemoryBuffer(opts);
}
