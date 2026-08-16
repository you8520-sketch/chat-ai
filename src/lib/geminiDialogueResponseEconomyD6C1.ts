/**
 * Phase D6-C1 — Gemini dialogue response economy (experiment-only).
 *
 * Production default: OFF. Not imported by chat routes / contextBuilder.
 * Live harness may REPLACE the IMMERSIVE_PROSE_BLOCK dialogue semantic
 * paragraph when arm=B (system message string replace only).
 *
 * Sole variable: IMMERSIVE_PROSE dialogue semantic owner (1 paragraph).
 * NEW SYSTEM SECTION = 0 · NEW NEGATIVE BLOCK = 0 · DIALOGUE % PROMPT = 0
 */

/** Production dialogue semantic owner (IMMERSIVE_PROSE_BLOCK paragraph). */
export const D6C1_PRODUCTION_DIALOGUE_OWNER =
  "대사는 이 캐릭터가 지금 이 상대에게 실제로 할 법한 말이어야 한다. 성격·관계가 말의 내용·생략·농담·망설임·충돌에 드러나게 하고 설정 브리핑으로 만들지 않는다. 붙잡으려 질문을 발명하지 말고, 이유가 없으면 침묵·본업·퇴장도 자연스럽다. 관심·호감은 정본·성격·누적 상호작용을 따르며 이유 없는 첫 만남 특별취급·기시감을 만들지 않는다(정본·친화 성격·사건 근거·명시 인연 예외). 관계는 중립·거리·경계도 포함한다.";

/**
 * D6-C1 candidate — one central speech intent / response-anchor economy.
 * Exact wording from Phase D6-C1 brief §4.
 */
export const D6C1_CANDIDATE_DIALOGUE_OWNER =
  "대사는 이 캐릭터가 지금 상대에게 건넬 하나의 중심 의도를 자연스러운 발화로 표현한다. 성격과 관계는 말의 선택·생략·농담·망설임·충돌에 드러나고, 설정 정보와 감정은 현재 판단·행동·표정·시선·거리·환경 반응에 흡수되어 장면 전체에서 드러난다. 질문·제안·경고가 필요하면 그 중심 의도 안에서 하나의 반응 지점을 만든다. 인물은 말뿐 아니라 침묵·본업·퇴장·행동으로도 존재감을 이어간다. 관심·호감과 관계 변화는 정본·성격·누적 상호작용의 결과로 나타나며, 중립·거리·경계도 자연스러운 관계 상태다.";

export type GeminiDialogueEconomyArm = "A" | "B";

/** Rough Korean-token estimate for budget reporting (chars × 0.9). */
export function estimateOwnerTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length * 0.9));
}

/** Forbidden new-negative scan (candidate must not introduce these as new quota). */
const NEW_NEGATIVE_RE =
  /금지|하지\s*말|하지\s*않는다|말고|\bnever\b|\bdo\s*not\b|\bdon't\b|\bavoid\b|10\s*~\s*15|10-15|퍼센트|%|한\s*줄만|짧게\s*말해|대사를\s*줄여|질문하지\s*마/gi;

export function countNewNegativeDirectives(text: string): number {
  return (text.match(NEW_NEGATIVE_RE) ?? []).length;
}

export function d6c1PromptBudgetReport(): {
  production_owner: string;
  candidate_owner: string;
  production_chars: number;
  candidate_chars: number;
  production_tokens: number;
  candidate_tokens: number;
  owner_token_delta: number;
  candidate_new_negative_count: number;
  new_section_count: number;
  dialogue_percentage_prompt: "NONE";
} {
  const production_tokens = estimateOwnerTokens(D6C1_PRODUCTION_DIALOGUE_OWNER);
  const candidate_tokens = estimateOwnerTokens(D6C1_CANDIDATE_DIALOGUE_OWNER);
  return {
    production_owner: D6C1_PRODUCTION_DIALOGUE_OWNER,
    candidate_owner: D6C1_CANDIDATE_DIALOGUE_OWNER,
    production_chars: D6C1_PRODUCTION_DIALOGUE_OWNER.length,
    candidate_chars: D6C1_CANDIDATE_DIALOGUE_OWNER.length,
    production_tokens,
    candidate_tokens,
    owner_token_delta: candidate_tokens - production_tokens,
    candidate_new_negative_count: countNewNegativeDirectives(
      D6C1_CANDIDATE_DIALOGUE_OWNER
    ),
    new_section_count: 0,
    dialogue_percentage_prompt: "NONE",
  };
}

/**
 * Replace production dialogue semantic owner with D6-C1 candidate on system.
 * User tail / history / runtime unchanged. No new sections.
 */
export function applyD6C1DialogueOwnerArmToMessages(input: {
  messages: Array<{ role: string; content: string }>;
  arm: GeminiDialogueEconomyArm;
}): {
  messages: Array<{ role: string; content: string }>;
  replaced: boolean;
  replaceCount: number;
  systemText: string;
  ownerTokenDelta: number;
} {
  if (input.arm !== "B") {
    const systemText =
      input.messages.find((m) => m.role === "system")?.content ?? "";
    return {
      messages: input.messages,
      replaced: false,
      replaceCount: 0,
      systemText,
      ownerTokenDelta: 0,
    };
  }

  let replaceCount = 0;
  const messages = input.messages.map((m) => {
    if (m.role !== "system") return m;
    if (!m.content.includes(D6C1_PRODUCTION_DIALOGUE_OWNER)) {
      return m;
    }
    const next = m.content.split(D6C1_PRODUCTION_DIALOGUE_OWNER).join(
      D6C1_CANDIDATE_DIALOGUE_OWNER
    );
    replaceCount =
      m.content.split(D6C1_PRODUCTION_DIALOGUE_OWNER).length - 1;
    return { ...m, content: next };
  });

  const systemText = messages.find((m) => m.role === "system")?.content ?? "";
  const budget = d6c1PromptBudgetReport();
  return {
    messages,
    replaced: replaceCount > 0,
    replaceCount,
    systemText,
    ownerTokenDelta: budget.owner_token_delta,
  };
}

/** Guard-meaning checklist for API=0 review (no live calls). */
export const D6C1_GUARD_PRESERVATION_REVIEW = {
  character_voice: {
    production: "실제로 할 법한 말",
    candidate: "하나의 중심 의도를 자연스러운 발화로 표현",
    preserved: true,
  },
  relationship_consistency: {
    production: "성격·관계가 말의 내용·생략·농담·망설임·충돌에 드러남",
    candidate: "성격과 관계는 말의 선택·생략·농담·망설임·충돌에 드러남",
    preserved: true,
  },
  canon_based_affection: {
    production: "관심·호감은 정본·성격·누적 상호작용을 따름 (+ 첫 만남 예외)",
    candidate: "관심·호감과 관계 변화는 정본·성격·누적 상호작용의 결과",
    preserved: true,
    note: "Explicit first-meeting/deja-vu exception clause compressed into canon/interaction result; no new affection pressure.",
  },
  neutral_distant_allowed: {
    production: "관계는 중립·거리·경계도 포함",
    candidate: "중립·거리·경계도 자연스러운 관계 상태",
    preserved: true,
  },
  silence_action_allowed: {
    production: "침묵·본업·퇴장도 자연스럽다",
    candidate: "침묵·본업·퇴장·행동으로도 존재감을 이어간다",
    preserved: true,
  },
  setting_briefing_suppression: {
    production: "설정 브리핑으로 만들지 않는다",
    candidate: "설정 정보와 감정은 … 판단·행동·표정·시선·거리·환경 반응에 흡수",
    preserved: true,
  },
  new_system_sections: 0,
  new_negative_directives: 0,
  dialogue_percentage_prompt: "NONE",
  paragraph_count: 1,
} as const;
