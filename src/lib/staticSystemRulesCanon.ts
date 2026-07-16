/**
 * Static prompt dedup — CANON / SCOPE / KNOWLEDGE (OpenRouter top).
 * Meaning-preserving merge of priority + scene + CORE RP + knowledge + absolute prohibition.
 */
import { AUTO_PROGRESSION_CORE_ROLE } from "@/lib/autoProgressionRules";
import {
  CHARACTER_KNOWLEDGE_BOUNDARY_BLOCK_COMPACT,
} from "@/lib/characterKnowledgeBoundary";

export const ABSOLUTE_PROHIBITION_RULES = `=== 절대 금지 규칙 ===
현재 장면과 무관한 직업·등급·과거사·설정 나열 금지.`;

/** CORE RP body (without surrounding blank-line join from buildCoreMasterPrompt). */
export function buildCoreRpCanonFragment(opts: {
  novelModeEnabled?: boolean;
  autoProgressionEnabled?: boolean;
  impersonationOn?: boolean;
  party?: boolean;
}): string {
  let role: string;
  if (opts.autoProgressionEnabled) {
    role = AUTO_PROGRESSION_CORE_ROLE;
  } else if (opts.novelModeEnabled) {
    role = `ROLE — 소설 모드 ON. [NO GODMODDING — NOVEL MODE] · [NOVEL MODE — USER PERSONA NARRATION RULES] 적용.`;
  } else if (opts.impersonationOn) {
    role = `ROLE — AI는 [A]와 AI가 담당하는 NPC·환경을 연기한다. 필요 시 여러 AI 캐릭터와 NPC를 동시에 연기할 수 있다.\n[B]는 [USER CONTROL MODE - LIMITED CO-NARRATION]를 따른다.`;
  } else {
    role = `ROLE — AI는 [A]와 AI가 담당하는 NPC·환경을 연기한다. 필요 시 여러 AI 캐릭터와 NPC를 동시에 연기할 수 있다.\n[B]는 [NO GODMODDING]를 따른다.`;
  }

  const continuity = opts.autoProgressionEnabled
    ? `CONTINUITY — 현재 장면과 기존 인과를 이어간다.`
    : `CONTINUITY — 같은 장면을 이어간다.`;

  const integrity = opts.autoProgressionEnabled
    ? `INTEGRITY — 각 인물의 정본, 지식 경계, 관계와 말투를 개별적으로 유지한다.`
    : `INTEGRITY — 캐릭터·관계·세계관을 유지한다.`;

  const coreHeader = opts.autoProgressionEnabled
    ? `[CORE RP]`
    : `[CORE RP] [A]=AI · [B]=user.`;

  const parts: string[] = [coreHeader, role, integrity, continuity];
  if (opts.party) {
    parts.push(`[PARTY] Multi-user room. Prefix "nickname:" identifies speaker.`);
  }
  return parts.join("\n\n");
}

export function buildCanonScopeKnowledgeBlock(opts: {
  novelModeEnabled?: boolean;
  autoProgressionEnabled?: boolean;
  impersonationOn?: boolean;
  party?: boolean;
}): string {
  const knowledge = CHARACTER_KNOWLEDGE_BOUNDARY_BLOCK_COMPACT;
  return `[CANON / SCOPE / KNOWLEDGE]
=== 설정 적용 우선순위 ===

1. CHARACTER CANON · WORLD CANON · [CHARACTER KNOWLEDGE BOUNDARY] (절대 유지 — PLAYER/SCENARIO META는 [A] 기억·대사로 노출 금지)
2. 장기기억(LTM)
3. 최근 대화를 해석하는 데 필요한 RAG
4. 최근 대화

=== 서술 시점 (필수) ===
- 현재 장면 안에서만 서술한다.

${buildCoreRpCanonFragment(opts)}

${knowledge}

${ABSOLUTE_PROHIBITION_RULES}`;
}
