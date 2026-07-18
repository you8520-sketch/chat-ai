/**
 * DeepSeek + thin-history only: peel creator greeting (model=greeting → turn0) out of
 * assistant-role conversation history so its length is not a response exemplar.
 * Continuity facts stay available via [OPENING SCENE CONTEXT].
 */
import type { ChatMsg } from "@/lib/ai";
import { OPENING_TURN_USER } from "@/lib/chatGreetingContext";

export const DEEPSEEK_OPENING_SCENE_CONTEXT_HEADER =
  "[OPENING SCENE CONTEXT — ALREADY OCCURRED]";

/** Continuity block — prompt-only; never surface this label in user-visible output. */
export function buildDeepSeekOpeningSceneContextBlock(greetingContent: string): string {
  const body = greetingContent.trim();
  if (!body) return "";
  return (
    `${DEEPSEEK_OPENING_SCENE_CONTEXT_HEADER}\n` +
    "아래 내용은 제작자가 정의한 이 채팅의 시작 장면이며 이미 발생한 과거 맥락이다.\n" +
    "사실·행동·대사·관계 상태는 연속성에 사용하되, 이 텍스트의 길이나 문장 수를 다음 답변 길이의 예시로 모방하지 않는다.\n\n" +
    body
  );
}

function isOpeningSyntheticUser(content: string): boolean {
  const t = content.trim();
  return t === OPENING_TURN_USER || t.startsWith(`${OPENING_TURN_USER}\n`);
}

/**
 * Peel turn0 `[채팅 시작]` + creator greeting assistant pair from history.
 * Only the opening synthetic pair is removed — real user/assistant turns stay intact.
 */
export function peelCreatorOpeningGreetingFromHistory(history: ChatMsg[]): {
  history: ChatMsg[];
  openingGreeting: string | null;
  peeledSyntheticOpeningTurn: boolean;
} {
  if (history.length < 2) {
    return { history, openingGreeting: null, peeledSyntheticOpeningTurn: false };
  }
  const first = history[0]!;
  const second = history[1]!;
  if (first.role !== "user" || second.role !== "assistant") {
    return { history, openingGreeting: null, peeledSyntheticOpeningTurn: false };
  }
  if (!isOpeningSyntheticUser(first.content)) {
    return { history, openingGreeting: null, peeledSyntheticOpeningTurn: false };
  }
  const greeting = second.content.trim();
  if (!greeting) {
    return { history, openingGreeting: null, peeledSyntheticOpeningTurn: false };
  }
  return {
    history: history.slice(2),
    openingGreeting: greeting,
    peeledSyntheticOpeningTurn: true,
  };
}

/** True when DeepSeek thin-history should remap greeting out of assistant role. */
export function shouldRemapDeepSeekOpeningGreeting(opts: {
  deepSeekXmlMode: boolean;
  shortHistory: boolean;
  openingGreeting: string | null;
}): boolean {
  return (
    opts.deepSeekXmlMode && opts.shortHistory && Boolean(opts.openingGreeting?.trim())
  );
}
