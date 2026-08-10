import { isGemini31ProModel } from "@/lib/chatModels";
import type { NoGodmoddingMode } from "@/lib/noGodmodding";

/**
 * Gemini 3.1 Pro — minimal user-agency supplement.
 *
 * Production Gemini 3.1 already receives the shared
 * `[USER CONTROL — COLLABORATIVE INTERACTIVE]` owner (#307) plus the
 * collaborative CURRENT USER INPUT wrapper. That block covers major [B]
 * dialogue / consent / identity decisions, but does not explicitly cover:
 *   - inventing unconfirmed [B] body facts (e.g. piercing holes)
 *   - locking ambiguous wearable/gift intent to one outcome
 *   - completing the action after asking a question that needs [B]'s answer
 *
 * These two sentences close that gap without hardening into "never narrate
 * the user" / "always stop and ask". Other models are unaffected.
 */

export const GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE =
  "[USER AGENCY — GEMINI 3.1 BODY/INTENT BOUNDARY]";

export const GEMINI31_USER_AGENCY_BODY_FACT_SENTENCE =
  "사용자의 신체 상태와 이미 정해진 행동은 페르소나·대화에서 확인된 사실을 기준으로 이어간다. 확인되지 않은 신체 전제나 사용자의 답이 필요한 행동은 캐릭터의 관찰·제안·질문·준비 단계까지 자연스럽게 진행하고, 사용자가 다음 반응으로 확정할 자리를 남긴다.";

export const GEMINI31_USER_AGENCY_AMBIGUOUS_INTENT_SENTENCE =
  "물건의 착용자·수령자·행동 대상처럼 사용자의 의도가 여러 방향으로 해석될 수 있을 때는 한 방향을 사실로 확정하기보다, 캐릭터의 반응이나 짧은 확인을 통해 사용자가 의도를 자연스럽게 드러낼 수 있게 한다.";

export const GEMINI31_USER_AGENCY_SUPPLEMENT = `${GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE}
${GEMINI31_USER_AGENCY_BODY_FACT_SENTENCE}
${GEMINI31_USER_AGENCY_AMBIGUOUS_INTENT_SENTENCE}`;

export function shouldInjectGemini31UserAgencySupplement(opts: {
  modelId?: string | null;
  godmoddingMode?: NoGodmoddingMode | null;
  contentKind?: string | null;
}): boolean {
  if (!isGemini31ProModel(opts.modelId ?? "")) return false;
  // Only the shared collaborative interactive owner path — not auto-continue
  // or limited co-narration, which use different ownership contracts.
  if ((opts.godmoddingMode ?? "standard") !== "standard") return false;
  if (opts.contentKind === "simulation") return false;
  return true;
}

/** Returns the two-sentence supplement, or null when the gate is closed. */
export function resolveGemini31UserAgencySupplement(opts: {
  modelId?: string | null;
  godmoddingMode?: NoGodmoddingMode | null;
  contentKind?: string | null;
}): string | null {
  if (!shouldInjectGemini31UserAgencySupplement(opts)) return null;
  return GEMINI31_USER_AGENCY_SUPPLEMENT;
}

/**
 * Append the Gemini 3.1 supplement after the shared no-godmodding owner.
 * Idempotent — does not double-inject if the title is already present.
 */
export function appendGemini31UserAgencySupplement(
  baseBlock: string,
  opts: {
    modelId?: string | null;
    godmoddingMode?: NoGodmoddingMode | null;
    contentKind?: string | null;
  }
): string {
  const base = baseBlock.trim();
  const supplement = resolveGemini31UserAgencySupplement(opts);
  if (!supplement) return base;
  if (base.includes(GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE)) return base;
  if (!base) return supplement;
  return `${base}\n\n${supplement}`;
}
