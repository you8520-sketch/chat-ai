/**
 * Phase D4 — Gemini positive forward-generation owner (experiment-only).
 *
 * Production default: OFF. Not imported by chat routes / contextBuilder.
 * Live harness may REPLACE the user-tail length owner when arm=B and model is
 * Gemini 3.1 Pro.
 *
 * D4 principles:
 *   ADD NOTHING · REPLACE OWNERS · SPEND OUTPUT ON NEW SCENE
 *   NEW_SECTION_COUNT = 0 · NEW_NEGATIVE_DIRECTIVE_COUNT = 0
 *   D2/D3 [GEMINI SCENE CONTINUITY] is NOT used.
 */
import { isGemini31ProModel } from "@/lib/chatModels";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "@/lib/responseLength";

export type GeminiPositiveForwardArm = "A" | "B";

/** Production user-tail length owner (arm A baseline). */
export const D4A_PRODUCTION_LENGTH_OWNER = USER_TAIL_LENGTH_OWNER_SENTENCE;

/**
 * D4-A candidate — positive forward scene owner.
 * Exact wording from Phase D4 brief §7.
 * Causal graph: JUDGMENT → ACTION → RESPONSE → CONSEQUENCE → NEXT CHANGE
 */
export const D4A_POSITIVE_FORWARD_LENGTH_OWNER =
  "이번 응답은 한국어 3,200~4,200자 범위의 하나의 밀도 있는 장면으로 완성한다. 직전 장면과 현재 입력에서 이미 성립한 상황의 바로 다음 변화에서 시작해, 캐릭터의 새 판단·행동이 상대와 환경의 새 반응·결과를 만들고 그 결과가 다시 다음 변화를 낳도록 충분히 전개한다.";

/** Forbidden new-negative scan (candidate must not introduce these). */
const NEW_NEGATIVE_RE =
  /금지|하지\s*말|하지\s*않는다|말고|\bnever\b|\bdo\s*not\b|\bdon't\b|\bavoid\b/gi;

export function estimateOwnerTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length * 0.9));
}

export function countNewNegativeDirectives(text: string): number {
  return (text.match(NEW_NEGATIVE_RE) ?? []).length;
}

export function d4aPromptBudgetReport(): {
  production_owner: string;
  candidate_owner: string;
  production_tokens: number;
  candidate_tokens: number;
  owner_token_delta: number;
  candidate_new_negative_count: number;
  new_section_count: number;
} {
  const production_tokens = estimateOwnerTokens(D4A_PRODUCTION_LENGTH_OWNER);
  const candidate_tokens = estimateOwnerTokens(D4A_POSITIVE_FORWARD_LENGTH_OWNER);
  return {
    production_owner: D4A_PRODUCTION_LENGTH_OWNER,
    candidate_owner: D4A_POSITIVE_FORWARD_LENGTH_OWNER,
    production_tokens,
    candidate_tokens,
    owner_token_delta: candidate_tokens - production_tokens,
    candidate_new_negative_count: countNewNegativeDirectives(
      D4A_POSITIVE_FORWARD_LENGTH_OWNER
    ),
    new_section_count: 0,
  };
}

/**
 * Replace production length owner with D4-A candidate on the terminal user turn.
 * System prompt is unchanged. No new sections.
 */
export function applyD4ALengthOwnerArmToMessages(input: {
  messages: Array<{ role: string; content: string }>;
  modelId: string;
  arm: GeminiPositiveForwardArm;
}): {
  messages: Array<{ role: string; content: string }>;
  replaced: boolean;
  ownerTokenDelta: number;
} {
  if (input.arm !== "B" || !isGemini31ProModel(input.modelId)) {
    return {
      messages: input.messages,
      replaced: false,
      ownerTokenDelta: 0,
    };
  }

  let replaced = false;
  const messages = input.messages.map((m, i) => {
    const isLastUser =
      m.role === "user" &&
      !input.messages.slice(i + 1).some((x) => x.role === "user");
    if (!isLastUser) return m;
    if (!m.content.includes(D4A_PRODUCTION_LENGTH_OWNER)) return m;
    replaced = true;
    return {
      ...m,
      content: m.content.split(D4A_PRODUCTION_LENGTH_OWNER).join(
        D4A_POSITIVE_FORWARD_LENGTH_OWNER
      ),
    };
  });

  const budget = d4aPromptBudgetReport();
  return {
    messages,
    replaced,
    ownerTokenDelta: replaced ? budget.owner_token_delta : 0,
  };
}
