import { isCheaperInferenceGemini31ProModel } from "@/lib/chatModels";
import {
  buildCompactTerminalLayoutRecencyLine,
  buildWebnovelOutputLayoutRecencyBlock,
} from "@/lib/webnovelOutputFormat";

/**
 * When true, Gemini 3.1 Pro uses terminal user-tail layout recency only;
 * system `[OUTPUT LAYOUT]` block is omitted. Default OFF.
 *
 * Phase B.1 live A/B (2026-08-29): terminal-only FAILED quality parity on Q1/Q2/Q4.
 * Production keeps dual injection — system rich contract + user-tail recency reinforcement.
 * Classification: ONE POLICY, MULTIPLE PURPOSEFUL INJECTIONS (not TRUE D2).
 */
export function isGemini31TerminalLayoutOwnerOnly(): boolean {
  return process.env.GEMINI31_TERMINAL_LAYOUT_OWNER_ONLY === "1";
}

/** Phase B.1 — dual layout injection is intentional reinforcement, not a policy conflict. */
export function isGemini31IntentionalLayoutMultiInjection(): boolean {
  return !isGemini31TerminalLayoutOwnerOnly();
}

export function shouldInjectSystemLayoutRecency(opts: {
  isOpenRouter: boolean;
  modelId?: string | null;
  skipIds?: string[] | null;
}): boolean {
  if (!opts.isOpenRouter) return true;
  if (opts.skipIds?.includes("rule-output-layout-recency")) return false;
  if (
    isCheaperInferenceGemini31ProModel(opts.modelId ?? "") &&
    isGemini31TerminalLayoutOwnerOnly()
  ) {
    return false;
  }
  return true;
}

export type LayoutOwnerComparison = {
  systemLayoutText: string;
  userTailLayoutText: string;
  exactDuplication: boolean;
  semanticDuplication: boolean;
  systemOnlyRules: string[];
  userTailOnlyRules: string[];
};

/** Side-by-side layout owner audit — system block is full contract; user tail is compact recency line. */
export function compareLayoutOwners(): LayoutOwnerComparison {
  const systemLayoutText = buildWebnovelOutputLayoutRecencyBlock();
  const userTailLayoutText = buildCompactTerminalLayoutRecencyLine();
  const normalizedSystem = systemLayoutText.replace(/\s+/g, " ").trim().toLowerCase();
  const normalizedUser = userTailLayoutText.replace(/\s+/g, " ").trim().toLowerCase();
  const exactDuplication =
    normalizedSystem.includes(normalizedUser) || normalizedUser.includes(normalizedSystem);
  const semanticDuplication =
    /blank line|빈 줄|독립 문단|dialogue.*paragraph/i.test(systemLayoutText) &&
    /빈 줄|대사/i.test(userTailLayoutText);

  const systemOnlyRules: string[] = [];
  if (/SEMANTIC PARAGRAPHING/i.test(systemLayoutText)) {
    systemOnlyRules.push("SEMANTIC_PARAGRAPHING full rules");
  }
  if (/Wrong:|Right:/i.test(systemLayoutText)) {
    systemOnlyRules.push("layout examples (Wrong/Right)");
  }
  if (/화자 변경|장면의 중심/i.test(systemLayoutText)) {
    systemOnlyRules.push("paragraph break triggers (scene/speaker change)");
  }

  const userTailOnlyRules: string[] = [];
  if (/레이아웃:/i.test(userTailLayoutText)) {
    userTailOnlyRules.push("compact recency label (레이아웃:)");
  }

  return {
    systemLayoutText,
    userTailLayoutText,
    exactDuplication,
    semanticDuplication,
    systemOnlyRules,
    userTailOnlyRules,
  };
}
