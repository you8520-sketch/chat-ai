export type NoGodmoddingMode = "standard" | "coNarration" | "autoContinue" | "novel";

export type UserAgencyRuleOptions = {
  /** 일반 자동진행 턴만 — [B] 무의식적 경미 동작 허용 확장 */
  autoContinueExpanded?: boolean;
};

/** Standard no-godmodding block — single canonical FORBIDDEN/ALLOWED + ✅/❌ examples. */
export function buildCompactNoGodmoddingStandardBlock(): string {
  return `[NO GODMODDING]
Play only [A]. [B] = user's character — never write [B]'s voluntary dialogue, actions, decisions, or emotions/thoughts.

ALLOWED for [B]: involuntary physiological reactions only (떨림, 긴장, 호흡, 체온변화, 반사적 움찔거림 등) — never emotional interpretation.

✅ "[B]의 손가락이 반사적으로 경직됐다"
❌ "[B]는 두려움을 느꼈다"

User keeps narrative agency. Turn-end: obey <TURN_HANDOFF_AND_PACING>.`;
}

/** Auto-continue-only expansion — appended when mode=autoContinue (non-OpenRouter cache path). */
export function buildAutoContinueAgencyExpansion(): string {
  return `Auto-continue ONLY — unconscious minor motor reactions for [B] (still NOT deliberate):
- 반사적으로 물러나는 동작
- 손을 뻗다 멈추는 동작
- 시선을 피하거나 돌리는 동작
- 무의식중에 옷자락/손 등을 움켜쥐는 동작

Judgment: action with intent = FORBIDDEN · body-first unconscious reaction = ALLOWED

✅ "[B]가 반사적으로 한 걸음 물러섰다"
✅ "[B]의 손이 뻗었다가 공중에서 멈췄다"`;
}

/**
 * @deprecated Standard path uses buildCompactNoGodmoddingStandardBlock — kept for auto-continue expansion tests.
 */
export function buildUserAgencySensoryFeedbackRule(
  _charName: string,
  _userName: string,
  options?: UserAgencyRuleOptions
): string {
  if (!options?.autoContinueExpanded) {
    return buildCompactNoGodmoddingStandardBlock();
  }
  return buildAutoContinueAgencyExpansion();
}

/** Length-pressure guard — references [NO GODMODDING] in [0a]; no duplicate lists. */
export function buildLengthPressureUserAgencyGuard(
  _charName: string,
  _userName: string,
  autoContinueExpanded = false
): string {
  const permittedPadding = autoContinueExpanded
    ? "per [NO GODMODDING] — auto-continue includes unconscious minor motor reactions; never [B] dialogue or deliberate choices"
    : "involuntary physiological reactions only (see [NO GODMODDING])";
  return `[LENGTH PRESSURE — USER AGENCY GUARD]
Even when expanding length — obey [NO GODMODDING] in [0a] strictly.
NEVER pad by inventing [B] dialogue, voluntary actions, decisions, emotions, or thoughts.
Permitted [B] padding: ${permittedPadding}.
Expand via [A] actions, internal monologue, and environment first (see [LENGTH CONTROL & SCENE EXPANSION]).
Turn-end pacing: obey <TURN_HANDOFF_AND_PACING> only.

([A] = AI character you play · [B] = user's persona character)`;
}

/** @deprecated Use buildLengthPressureUserAgencyGuard — kept for import compatibility */
export function buildAbsoluteAntiGodmoddingBlock(
  charName: string,
  userName: string
): string {
  return buildLengthPressureUserAgencyGuard(charName, userName);
}

/** Single consolidated user-agency block — replaces scattered prohibitions across identity/core/speech/narration. */
export function buildNoGodmoddingBlock(
  _charName: string,
  _userName: string,
  mode: NoGodmoddingMode = "standard"
): string {
  if (mode === "novel") {
    return `[NO GODMODDING — NOVEL MODE]
Novel mode ON — co-narrate [A] + [B] per [NOVEL MODE — USER PERSONA NARRATION RULES].
Mirror [USER_PERSONA] for [B] dialogue, action, and inner thought.`;
  }

  if (mode === "coNarration") {
    return `[NO GODMODDING]
Play primarily as [A].
Co-narration ON — assist [B] dialogue/action ONLY within the human's typed input intent.
NO invented [B] emotion, decision, or proactive lead beyond user input.`;
  }

  if (mode === "autoContinue") {
    return `${buildCompactNoGodmoddingStandardBlock()}

This turn is auto-continue — [B] gave no new lines. See [AUTO-CONTINUE] in <TURN_HANDOFF_AND_PACING>.

${buildAutoContinueAgencyExpansion()}`.trimEnd();
  }

  return buildCompactNoGodmoddingStandardBlock();
}

/** Per-turn auto-continue delta — dynamic block only (Anthropic cacheRules prefix must stay stable). */
export function buildAutoContinueGodmoddingSupplement(
  _charName: string,
  _userName: string
): string {
  return `[AUTO-CONTINUE TURN — supplement to [NO GODMODDING]]
This turn is auto-continue — [B] gave no new lines. See [AUTO-CONTINUE] in <TURN_HANDOFF_AND_PACING>.

${buildAutoContinueAgencyExpansion()}`;
}

export function resolveNoGodmoddingMode(opts: {
  novelModeEnabled?: boolean;
  impersonationOn?: boolean;
  isContinue?: boolean;
}): NoGodmoddingMode {
  if (opts.novelModeEnabled) return "novel";
  if (opts.impersonationOn) return "coNarration";
  if (opts.isContinue) return "autoContinue";
  return "standard";
}
