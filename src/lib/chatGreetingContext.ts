import type { ChatMsg } from "@/lib/ai";

/** AI history — 오프닝 직전 유저 앵커 (모델이 장면을 사실로 인지) */
export const OPENING_SCENE_USER_ANCHOR =
  "[채팅 시작] 아래 오프닝에 서술된 장소·시간·신체 상태·상황을 현재 RP의 확정 사실로 유지하세요. 임의로 다른 장소·상황을 만들지 마세요.";

export function extractGreetingFromMessageRows(
  rows: Array<{ role: string; model?: string; content: string }>
): string | null {
  for (const row of rows) {
    if (row.role === "assistant" && row.model === "greeting" && row.content.trim()) {
      return row.content.trim();
    }
  }
  return null;
}

export function buildOpeningSceneSystemBlock(greeting: string): string {
  const text = greeting.trim();
  if (!text) return "";
  return `[OPENING SCENE — established facts at chat start]
The following is the canonical opening for this chat. Treat location, time, physical state, and immediate situation in this text (including *narration*) as true until the story explicitly changes them. Do NOT invent a different starting location or ignore scene details here.

${text}`;
}

/** 대화 히스토리 앞에 오프닝 user/assistant 페어 추가 (OpenRouter 교대 규칙 유지) */
export function prependOpeningSceneToHistory(greeting: string, history: ChatMsg[]): ChatMsg[] {
  const text = greeting.trim();
  if (!text) return history;
  return [
    { role: "user", content: OPENING_SCENE_USER_ANCHOR },
    { role: "assistant", content: text },
    ...history,
  ];
}
